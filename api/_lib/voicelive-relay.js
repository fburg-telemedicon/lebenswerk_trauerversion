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

  // `relay.ready` erst melden, wenn die Sitzung nach oben WIRKLICH steht und
  // Azure die Konfiguration BESTÄTIGT hat (`session.updated`).
  //
  // Das Warten auf die Bestätigung ist nicht Feinschliff, sondern nötig: Meldet
  // man schon beim Verbindungsaufbau „bereit", stößt der Browser die erste Frage
  // an, bevor Stimme und Interview-Anweisungen übernommen sind. Dann antwortet
  // die Sitzung mit der VOREINGESTELLTEN Stimme und ohne Auftrag — hörbar als
  // fremde Stimme, die Unsinn redet, bevor die eigentliche Frage kommt. Zwei
  // gleichzeitig laufende Antworten überlagern sich zusätzlich im Wiedergabe-
  // Puffer des Browsers und klingen dann nach Störgeräusch.
  let announced = false
  let configured = false
  const maybeReady = () => {
    if (announced || !started || !configured || upstream.readyState !== WebSocket.OPEN) return
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
    // Events an den Browser durchreichen (er braucht u. a. die Audio-Deltas und
    // die Transkript-Events).
    //
    // ALS TEXT, nicht als Buffer! Die `ws`-Bibliothek liefert auch Text-Frames als
    // Buffer aus; gibt man den unverändert weiter, sendet sie ihn als BINÄR-Frame.
    // Im Browser kommt dann ein Blob an — `JSON.parse` scheitert daran, und der
    // Client verwarf jedes einzelne Azure-Ereignis stillschweigend. Sichtbar war
    // das als „empfangen 0" bei laufendem Upload: Die selbst erzeugten
    // `relay.*`-Meldungen kamen an (die gehen als String raus), alles von Azure
    // nicht. Das Protokoll ist JSON-Text — also auch so weiterreichen.
    if (client.readyState === WebSocket.OPEN) {
      client.send(typeof raw === 'string' ? raw : raw.toString('utf8'))
    }

    let evt
    try { evt = JSON.parse(raw.toString()) } catch { return }

    // Azure hat die Sitzungskonfiguration übernommen → jetzt darf der Browser los.
    if (evt?.type === 'session.updated') { configured = true; maybeReady(); return }
    // Fehler von Azure IMMER protokollieren. Beim ersten Abbruch einer Sitzung
    // stand in den Logs nichts — die Ereignisse wurden nur durchgereicht. Ohne
    // diese Zeile lässt sich ein abgebrochenes Gespräch nicht nachvollziehen.
    if (evt?.type === 'error') {
      console.error('voicelive relay: Azure-Fehler:', JSON.stringify(evt.error || {}).slice(0, 400))
      // Wird die Konfiguration abgelehnt, NICHT stumm weiterlaufen lassen: sonst
      // spräche die Sitzung mit falscher Stimme und ohne Interview-Auftrag.
      if (!configured) {
        tell(client, 'error', { reason: 'session_config' })
        shutdown('session_config')
      }
      return
    }

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
  upstream.on('close', (code, reason) => {
    // Grund mitprotokollieren — „Das Live-Gespräch wurde beendet" ohne jede Spur
    // im Log war beim ersten Abbruch nicht nachvollziehbar.
    console.warn(`voicelive relay: Azure-Verbindung geschlossen (Code ${code})${reason ? ' – ' + String(reason).slice(0, 200) : ''}`)
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
