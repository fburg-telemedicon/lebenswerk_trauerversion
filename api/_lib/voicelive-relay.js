// api/_lib/voicelive-relay.js
// ============================================================================
// WebSocket-RELAY für das Live-Sprachgespräch.
//
//   Browser  ──wss://<unsere Domain>/api/voicelive-relay?ticket=…──▶  dieser Server
//   dieser Server ──wss://<res>.services.ai.azure.com/voice-live/realtime──▶ Azure
//
// Liegt bewusst unter _lib/: server.js registriert jede Datei unter api/ als
// HTTP-Route, Verzeichnisse mit „_" werden übersprungen. Der Relay ist keine
// HTTP-Route, sondern wird von server.js an den HTTP-Server gehängt.
//
// Aufgaben (siehe Begründung in api/_lib/voicelive.js):
//   • Schlüssel + Region bleiben serverseitig (EU-Pinning, kein Key im Browser).
//   • Sitzungs-Konfiguration setzt AUSSCHLIESSLICH der Server; vom Client wird
//     nur der Interview-Prompt übernommen und nur eine Allowlist an
//     Nachrichten-Typen durchgelassen.
//   • Kostenerfassung: jeder `response.done`-Usage-Block wird verbucht; ist die
//     Kosten-Obergrenze des Buchs erreicht, wird die Sitzung beendet.
// ============================================================================

const { WebSocketServer, WebSocket } = require('ws')
const {
  voiceLiveConfig, voiceLiveUrl, verifyTicket, buildSessionUpdate,
  tierForModel, sumUsage, totalTokens, CLIENT_ALLOWED_TYPES,
} = require('./voicelive')
const { costRealtime, recordCost, budgetExceeded } = require('./cost')

const RELAY_PATH = '/api/voicelive-relay'

// Notbremsen. Eine offene Live-Sitzung kostet, solange sie steht — anders als
// die bisherigen Einzel-Requests. Deshalb harte Obergrenzen, unabhängig davon,
// ob der Browser sich ordentlich abmeldet.
const MAX_SESSION_MS = 60 * 60 * 1000   // 60 Minuten je Sitzung
const IDLE_TIMEOUT_MS = 3 * 60 * 1000   // 3 Minuten ohne Nachricht vom Browser

function closeBoth(client, upstream, code, reason) {
  try { client?.close(code, reason) } catch {}
  try { upstream?.close() } catch {}
}

// Meldung an den Browser, die NICHT vom Azure-Protokoll stammt (eigener Namespace
// `relay.*`, damit der Client sie von Voice-Live-Events unterscheiden kann).
function tell(ws, type, extra = {}) {
  if (ws?.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify({ type: `relay.${type}`, ...extra })) } catch {}
  }
}

function handleConnection(client, ticket) {
  const cfg = voiceLiveConfig()
  const tier = tierForModel(cfg.chatModel)
  let upstream = null
  let started = false
  let closed = false
  let lastClientMsg = Date.now()
  // Kosten der laufenden Sitzung, kumuliert über alle Runden (nur fürs Logging;
  // verbucht wird je Runde, damit ein Verbindungsabbruch nichts verschluckt).
  let sessionUsd = 0

  const shutdown = (reason) => {
    if (closed) return
    closed = true
    clearInterval(watchdog)
    closeBoth(client, upstream, 1000, reason || 'ende')
  }

  const watchdog = setInterval(() => {
    if (Date.now() - lastClientMsg > IDLE_TIMEOUT_MS) {
      tell(client, 'closed', { reason: 'idle' })
      shutdown('idle')
    }
  }, 15000)
  const maxTimer = setTimeout(() => {
    tell(client, 'closed', { reason: 'max_duration' })
    shutdown('max_duration')
  }, MAX_SESSION_MS)

  // Vor dem Öffnen der Verbindung nach oben: Nachrichten des Browsers puffern,
  // damit nichts verlorengeht, während der Upstream noch verbindet.
  const pending = []

  upstream = new WebSocket(voiceLiveUrl(), ['realtime'], {
    headers: { 'api-key': cfg.key, 'User-Agent': 'lebensgeschichten' },
  })

  // `relay.ready` erst melden, wenn die Sitzung nach oben WIRKLICH steht UND
  // konfiguriert ist. Sonst schickt der Browser sein bisheriges Gespräch los,
  // bevor `started` gesetzt ist — und der Filter unten würfe es weg.
  let announced = false
  const maybeReady = () => {
    if (announced || !started || upstream.readyState !== WebSocket.OPEN) return
    announced = true
    tell(client, 'ready')
  }

  upstream.on('open', () => {
    for (const m of pending.splice(0)) {
      if (upstream.readyState === WebSocket.OPEN) upstream.send(m)
    }
    maybeReady()
  })

  upstream.on('message', async (raw) => {
    // Events unverändert an den Browser durchreichen (er braucht u. a. die
    // Audio-Deltas und die Transkript-Events).
    if (client.readyState === WebSocket.OPEN) client.send(raw)

    let evt
    try { evt = JSON.parse(raw.toString()) } catch { return }
    if (evt?.type !== 'response.done') return

    // ── Kosten je Gesprächsrunde verbuchen ──
    const usage = evt.response?.usage
    if (!usage) return
    const buckets = sumUsage(usage)
    const usd = costRealtime(tier, buckets)
    sessionUsd += usd
    const { inT, outT } = totalTokens(buckets)
    await recordCost({
      memorial_id: ticket.id,
      contribution_id: ticket.contributionId || null,
      kind: 'realtime',
      provider: 'azure',
      model: `voicelive-${tier}`,
      input_tokens: inT,
      output_tokens: outT,
      cost_usd: usd,
    })

    // Obergrenze erreicht → Sitzung beenden. Der Client sagt es dem Nutzer und
    // fällt auf die normalen Mikrofon-Modi zurück (die ihrerseits am 402 der
    // Einzel-Endpunkte hängen).
    if (await budgetExceeded(ticket.id)) {
      tell(client, 'closed', { reason: 'budget' })
      shutdown('budget')
    }
  })

  upstream.on('error', (e) => {
    console.error('voicelive relay upstream error:', e?.message || e)
    tell(client, 'error', { reason: 'upstream' })
    shutdown('upstream_error')
  })
  upstream.on('close', () => {
    tell(client, 'closed', { reason: 'upstream' })
    shutdown('upstream_closed')
  })

  client.on('message', (raw) => {
    lastClientMsg = Date.now()
    let msg
    try { msg = JSON.parse(raw.toString()) } catch { return }
    if (!msg || typeof msg.type !== 'string') return

    // Erste Nachricht des Browsers: der Interview-Prompt. Daraus baut der SERVER
    // die Sitzungs-Konfiguration (Modell, Stimme, VAD, Transkription) — der
    // Client kann sie nicht setzen.
    if (msg.type === 'relay.start') {
      if (started) return
      started = true
      const update = buildSessionUpdate({
        instructions: msg.instructions,
        language: ticket.locale,
        voice: ticket.voice,
      })
      const payload = JSON.stringify(update)
      if (upstream.readyState === WebSocket.OPEN) upstream.send(payload)
      else pending.push(payload)
      maybeReady()
      return
    }

    // Vor dem `relay.start` nichts durchlassen — sonst liefe eine Sitzung ohne
    // Interview-Anweisungen (und damit ohne Rolle/Sprache) los.
    if (!started) return
    if (!CLIENT_ALLOWED_TYPES.has(msg.type)) return

    const payload = raw.toString()
    if (upstream.readyState === WebSocket.OPEN) upstream.send(payload)
    else pending.push(payload)
  })

  client.on('close', () => { clearTimeout(maxTimer); shutdown('client_closed') })
  client.on('error', () => { clearTimeout(maxTimer); shutdown('client_error') })
}

// Hängt den Relay an den HTTP-Server. Ohne konfigurierte Voice-Live-Ressource
// wird gar nichts registriert → der Pfad antwortet nicht, der Client bleibt bei
// den Mikrofon-Modi.
function attachVoiceLiveRelay(server) {
  const wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (req, socket, head) => {
    let url
    try { url = new URL(req.url, 'http://localhost') } catch { return socket.destroy() }
    if (url.pathname !== RELAY_PATH) return   // andere Upgrade-Pfade nicht kapern
    const ticket = verifyTicket(url.searchParams.get('ticket'))
    if (!ticket) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      return socket.destroy()
    }
    wss.handleUpgrade(req, socket, head, (ws) => handleConnection(ws, ticket))
  })

  return wss
}

module.exports = { attachVoiceLiveRelay, RELAY_PATH }
