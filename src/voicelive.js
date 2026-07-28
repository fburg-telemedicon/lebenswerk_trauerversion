// src/voicelive.js
// ============================================================================
// Browser-Seite des LIVE-SPRACHGESPRÄCHS (4. Aufnahme-Modus).
//
// Statt der halbduplex-Kette Aufnehmen → /api/transcribe → /api/ask → /api/speak
// steht hier EINE offene Verbindung: Mikrofon-Audio fließt fortlaufend hoch, die
// Antwort-Stimme fortlaufend herunter. Dadurch darf die erzählende Person
// nachdenken, ohne dass die Aufnahme abbricht, und sie kann die KI unterbrechen.
//
// Die Verbindung geht NICHT direkt zu Azure, sondern zu unserem eigenen Relay
// (/api/voicelive-relay). Warum, steht in api/_lib/voicelive.js: der
// Ressourcenschlüssel darf den Server nicht verlassen, und die Sitzung muss fest
// in der EU-Region hängen.
//
// Vertrag nach außen (bewusst identisch zum Mikrofon-Modus): Am Ende liefert
// `messages` dieselbe {role, content}-Struktur wie das getippte/aufgenommene
// Interview. Alles danach — Speichern über /api/contributions, Buchgenerierung,
// Exporte — bleibt unberührt.
// ============================================================================

const SAMPLE_RATE = 24000   // Voice Live erwartet PCM16 mono @ 24 kHz

// AudioWorklet, der die Mikrofon-Blöcke an den Haupt-Thread schickt. Als Blob
// eingebettet, damit keine zusätzliche Datei durch den Vite-Build muss.
//
// WICHTIG: process() bekommt nur 128 Samples je Aufruf — das wären bei 24 kHz
// rund 190 WebSocket-Nachrichten pro Sekunde. Deshalb wird hier auf ~100 ms
// (2400 Samples) gepuffert; das ist für die Sprechpausen-Erkennung immer noch
// fein genug und hält die Verbindung ruhig.
const CHUNK_SAMPLES = 2400
const WORKLET_SRC = `
const CHUNK = ${CHUNK_SAMPLES}
class MicTap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(CHUNK); this.n = 0 }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (!ch || !ch.length) return true
    let i = 0
    while (i < ch.length) {
      const take = Math.min(CHUNK - this.n, ch.length - i)
      this.buf.set(ch.subarray(i, i + take), this.n)
      this.n += take; i += take
      if (this.n === CHUNK) { this.port.postMessage(this.buf.slice(0)); this.n = 0 }
    }
    return true
  }
}
registerProcessor('mic-tap', MicTap)
`

// Auf 24 kHz umrechnen, FALLS der Browser den gewünschten AudioContext-Takt nicht
// übernommen hat. `new AudioContext({sampleRate})` ist ein WUNSCH — manche Browser
// (und iOS) liefern trotzdem den Gerätetakt, meist 48 kHz. Schickt man solche
// Blöcke ungerechnet als „pcm16 @ 24 kHz" hoch, hört der Dienst doppelt so schnell
// gesprochenen Kauderwelsch und erkennt schlicht nichts. Lineare Interpolation
// genügt für Sprache; `carry` hält den letzten Wert über die Blockgrenze, sonst
// knackt es alle 100 ms.
function makeResampler(fromRate, toRate) {
  if (!fromRate || fromRate === toRate) return f => f
  const ratio = fromRate / toRate
  let pos = 0
  let carry = 0
  return (input) => {
    const out = new Float32Array(Math.max(0, Math.floor((input.length - pos) / ratio) + 1))
    let n = 0
    while (pos < input.length && n < out.length) {
      const i = Math.floor(pos)
      const frac = pos - i
      const a = i === 0 ? carry : input[i - 1]
      const b = input[i]
      out[n++] = a + (b - a) * frac
      pos += ratio
    }
    carry = input[input.length - 1] || 0
    pos -= input.length
    if (pos < 0) pos = 0
    return n === out.length ? out : out.subarray(0, n)
  }
}

function floatToPcm16(float32) {
  const out = new Int16Array(float32.length)
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]))
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out
}

function toBase64(bytes) {
  let bin = ''
  const chunk = 0x8000   // in Häppchen, sonst sprengt großes Audio den Aufruf-Stack
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

function fromBase64(b64) {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

// ── Wiedergabe ────────────────────────────────────────────────────
// Die Antwort kommt als Strom kleiner PCM-Blöcke. Sie werden lückenlos
// hintereinander geplant (Web Audio), damit keine Knackser entstehen; bei
// Barge-in wird die gesamte geplante Kette verworfen.
class Player {
  // `onChange(speaking)` meldet JEDEN Wechsel zwischen „gibt Ton aus" und „still".
  // Nötig, weil das Ende der Wiedergabe sonst unbemerkt bliebe: Die Antwort ist
  // serverseitig längst fertig (`response.done`), während im Browser noch
  // Sekunden an Audio in der Warteschlange stehen. Ohne diese Meldung blieb die
  // Anzeige auf „Ich spreche" stehen, bis zufällig ein anderes Ereignis kam.
  constructor(ctx, onChange) {
    this.ctx = ctx
    this.at = 0
    this.sources = []
    this.onChange = onChange
  }
  push(pcm16) {
    const frames = pcm16.length
    if (!frames) return
    const buf = this.ctx.createBuffer(1, frames, SAMPLE_RATE)
    const ch = buf.getChannelData(0)
    for (let i = 0; i < frames; i++) ch[i] = pcm16[i] / 0x8000
    const src = this.ctx.createBufferSource()
    src.buffer = buf
    src.connect(this.ctx.destination)
    const now = this.ctx.currentTime
    if (this.at < now) this.at = now + 0.05   // kleiner Vorlauf gegen Aussetzer
    src.start(this.at)
    this.at += buf.duration
    const wasSilent = this.sources.length === 0
    this.sources.push(src)
    if (wasSilent) this.onChange?.(true)
    src.onended = () => {
      this.sources = this.sources.filter(s => s !== src)
      if (this.sources.length === 0) this.onChange?.(false)
    }
  }
  stop() {
    const wasSpeaking = this.sources.length > 0
    for (const s of this.sources) { try { s.onended = null; s.stop() } catch {} }
    this.sources = []
    this.at = 0
    if (wasSpeaking) this.onChange?.(false)
  }
  get speaking() { return this.sources.length > 0 }
}

// ── Sitzung ───────────────────────────────────────────────────────
// startVoiceLive({...}) → { stop(), messages }
//
// Callbacks:
//   onReady()                    Verbindung steht, es darf gesprochen werden
//   onUserText(text)             fertiges Transkript einer Nutzer-Äußerung
//   onAiText(text)               fertiger Text einer KI-Antwort
//   onAiPartial(text)            laufender Text der KI (für die Anzeige)
//   onState({listening, speaking})
//   onFallback(reason)           Modus nicht möglich/abgebrochen → Aufrufer
//                                schaltet auf die Mikrofon-Modi zurück
export async function startVoiceLive({
  memorialCode, contributionId, language, instructions, history = [], voice,
  onReady, onUserText, onAiText, onAiPartial, onState, onFallback, onStream, onAudioBlocked, onPosition,
}) {
  const messages = []
  let ws = null, ctx = null, stream = null, node = null, srcNode = null
  let player = null
  let stopped = false
  let aiPartial = ''
  let removeUnlock = null
  let kicked = false
  // Zähler für die Diagnose-Anzeige. Ein stummes Gespräch hat mehrere mögliche
  // Ursachen (Ton gesperrt, nichts kommt an, nichts wird eingeplant); diese
  // Zahlen unterscheiden sie, statt raten zu lassen.
  const stats = { sent: 0, deltas: 0, played: 0, state: '?', rate: 0, lastError: '' }
  // Buchführung je Antwortrunde für die Fortschrittsmeldung (siehe unten):
  // Hat die Runde gesprochen? Und wurde ein Werkzeugaufruf beantwortet?
  let respHadAudio = false
  let respAnsweredCall = false

  // Erste Frage anstoßen — aber ERST, wenn der Ton auch wirklich hörbar ist.
  // Sonst spricht die KI in einen stummgeschalteten Browser hinein und die
  // Eröffnungsfrage ist unwiederbringlich verpufft. Wird an zwei Stellen
  // aufgerufen: wenn die Sitzung steht, und nach dem Freischalten des Tons.
  // (Funktionsdeklaration, weil sie schon im Audio-Aufbau referenziert wird.)
  function kickoff() {
    if (kicked || stopped) return
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    if (ctx?.state !== 'running') return
    kicked = true
    ws.send(JSON.stringify({ type: 'response.create' }))
  }

  const cleanup = () => {
    stopped = true
    try { removeUnlock?.() } catch {}
    try { node?.disconnect() } catch {}
    try { srcNode?.disconnect() } catch {}
    try { stream?.getTracks().forEach(t => t.stop()) } catch {}
    try { player?.stop() } catch {}
    try { ctx?.close() } catch {}
    try { ws?.close() } catch {}
    ws = null
  }

  const fail = (reason) => {
    if (stopped) return
    cleanup()
    onFallback?.(reason)
  }

  // 1) Ticket holen. Jede Fehlerantwort bedeutet „nicht verfügbar" — dann bleibt
  //    der Beitragende bei den bisherigen Mikrofon-Modi.
  let ticketData
  try {
    const r = await fetch('/api/voicelive-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // `voice` mitschicken, damit das Live-Gespräch DIESELBE Stimme benutzt wie
      // der Mikrofon-Modus (sonst wechselt sie beim Moduswechsel).
      body: JSON.stringify({ memorialCode, contributionId, language, voice }),
    })
    if (!r.ok) { onFallback?.(r.status === 402 ? 'budget' : 'unavailable'); return null }
    ticketData = await r.json()
  } catch {
    onFallback?.('network'); return null
  }

  // 2) Mikrofon + Audio-Kontext. Der Kontext läuft direkt mit 24 kHz, damit kein
  //    eigenes Resampling nötig ist.
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
    const AC = window.AudioContext || window.webkitAudioContext
    ctx = new AC({ sampleRate: SAMPLE_RATE })
    try { await ctx.resume() } catch { /* siehe unten */ }
    // Ein AudioContext, der NICHT während einer Nutzer-Geste entsteht, startet in
    // vielen Browsern „suspended" — und ein späteres resume() greift ohne Geste
    // nicht. Hier ist das der Normalfall: Die Sitzung wird aus einem Effekt heraus
    // aufgebaut, die Geste (Auswahl im Menü) ist da längst vorbei. Folge wäre ein
    // stummes Gespräch: kein Ton heraus UND kein Audio hinein (der Worklet läuft
    // ebenfalls nicht). Deshalb: einmalig auf die nächste Berührung warten.
    if (ctx.state !== 'running') {
      const evs = ['pointerdown', 'touchend', 'keydown']
      const unlock = async () => {
        try { await ctx.resume() } catch {}
        if (ctx.state === 'running') { removeUnlock?.(); onAudioBlocked?.(false); kickoff() }
      }
      removeUnlock = () => { evs.forEach(e => document.removeEventListener(e, unlock, true)); removeUnlock = null }
      evs.forEach(e => document.addEventListener(e, unlock, true))
      onAudioBlocked?.(true)
    }
    console.info(`Voice Live: AudioContext ${ctx.state}, ${ctx.sampleRate} Hz`)
    // Die Wiedergabe ist die EINZIGE Quelle für „spricht gerade". Vorher setzten
    // mehrere Ereignisse den Zustand nebeneinander (Audio-Block, response.done),
    // ohne dass eines das tatsächliche ENDE der Ausgabe kannte.
    player = new Player(ctx, speaking => { if (!stopped) onState?.({ listening: true, speaking }) })
    const workletUrl = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'application/javascript' }))
    await ctx.audioWorklet.addModule(workletUrl)
    URL.revokeObjectURL(workletUrl)
    srcNode = ctx.createMediaStreamSource(stream)
    node = new AudioWorkletNode(ctx, 'mic-tap')
    srcNode.connect(node)
    // Der Worklet-Knoten muss verbunden sein, damit er läuft — aber lautlos
    // (sonst hörte sich die Person selbst).
    const mute = ctx.createGain()
    mute.gain.value = 0
    node.connect(mute).connect(ctx.destination)
    // Der aufrufende Flow zeigt daraus die Schallwellen-Animation — die einzige
    // Rückmeldung, an der eine erzählende Person sieht, dass ihr Mikrofon
    // überhaupt etwas aufnimmt.
    onStream?.(stream)
  } catch (e) {
    // Mikrofon verweigert / kein AudioWorklet (sehr alte Browser) → Rückfall.
    cleanup()
    onFallback?.(e?.name === 'NotAllowedError' ? 'mic_denied' : 'audio_unsupported')
    return null
  }

  // 3) Relay-Verbindung.
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  ws = new WebSocket(`${proto}//${location.host}${ticketData.path}?ticket=${encodeURIComponent(ticketData.ticket)}`)

  ws.onopen = () => {
    // Erste Nachricht: der Interview-Prompt. Die restliche Sitzungs-Konfiguration
    // (Modell, Stimme, Sprache, Pausen-Erkennung) setzt der Server.
    ws.send(JSON.stringify({ type: 'relay.start', instructions }))
  }

  ws.onerror = () => fail('connection')
  ws.onclose = () => { if (!stopped) fail('closed') }

  // Falls doch einmal ein Binär-Frame ankommt: als ArrayBuffer statt als Blob,
  // damit er synchron gelesen werden kann (ein Blob wäre nur asynchron lesbar und
  // würde die Reihenfolge der Audio-Blöcke durcheinanderbringen).
  ws.binaryType = 'arraybuffer'

  ws.onmessage = (ev) => {
    let evt
    try {
      const text = typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(ev.data)
      evt = JSON.parse(text)
    } catch (e) {
      // NICHT stillschweigend verwerfen — genau das hat verborgen, dass alle
      // Azure-Ereignisse als Blob ankamen und weggeworfen wurden.
      stats.lastError = 'Unlesbares Ereignis (' + (typeof ev.data) + ')'
      console.error('Voice Live: Ereignis nicht lesbar', typeof ev.data, e)
      return
    }
    switch (evt.type) {
      case 'relay.ready': {
        // Bisheriges Gespräch in die Sitzung übernehmen, damit ein Wechsel mitten
        // im Interview (oder eine fortgesetzte Sitzung) nicht wieder bei Frage 1
        // anfängt. Die letzten Runden reichen — der volle Verlauf steckt ohnehin
        // im gespeicherten Beitrag, und jedes Element kostet Kontext-Tokens.
        for (const m of history.slice(-40)) {
          if (!m?.content || (m.role !== 'user' && m.role !== 'assistant')) continue
          ws.send(JSON.stringify({
            type: 'conversation.item.create',
            item: {
              type: 'message',
              role: m.role,
              content: [{ type: m.role === 'user' ? 'input_text' : 'text', text: String(m.content) }],
            },
          }))
        }
        // Anstoß: Die KI stellt die nächste Frage, ohne dass die Person erst
        // sprechen muss (sonst warten beide Seiten aufeinander). Passiert nur,
        // wenn der Ton nicht noch vom Browser gesperrt ist — siehe kickoff().
        kickoff()
        onReady?.()
        onState?.({ listening: true, speaking: false })
        break
      }
      case 'relay.closed':
      case 'relay.error':
        fail(evt.reason || 'relay')
        break

      // Die Person hat zu sprechen begonnen → laufende Antwort sofort abbrechen
      // (Barge-in). Ohne das redete die KI über sie hinweg weiter.
      case 'input_audio_buffer.speech_started':
        player.stop()   // meldet den Wechsel selbst (siehe Player.onChange)
        break

      case 'response.audio.delta':
        if (evt.delta) {
          stats.deltas++
          respHadAudio = true
          try {
            const bytes = fromBase64(evt.delta)
            player.push(new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 1))
            stats.played++
          } catch (e) {
            stats.lastError = 'Wiedergabe: ' + (e?.message || e)
            console.error('Voice Live: Wiedergabe fehlgeschlagen', e)
          }
        }
        break

      // Fertiges Transkript einer Nutzer-Äußerung.
      case 'conversation.item.input_audio_transcription.completed': {
        const text = (evt.transcript || '').trim()
        if (text) { messages.push({ role: 'user', content: text }); onUserText?.(text) }
        break
      }

      // Laufender bzw. fertiger Text der KI-Antwort.
      case 'response.audio_transcript.delta':
        aiPartial += evt.delta || ''
        onAiPartial?.(aiPartial)
        break
      case 'response.audio_transcript.done': {
        const text = (evt.transcript || aiPartial || '').trim()
        aiPartial = ''
        if (text) { messages.push({ role: 'assistant', content: text }); onAiText?.(text) }
        break
      }
      // ── Fortschrittsmeldung per Werkzeugaufruf ──
      // Das Modell meldet seine Katalog-Position hierüber statt im gesprochenen
      // Text (der Marker wurde sonst mitgesprochen). Zwei Fälle sind zu
      // unterscheiden, siehe `response.done` unten.
      case 'response.function_call_arguments.done': {
        if (evt.name !== 'position_melden') break
        let pos = null
        try {
          const a = JSON.parse(evt.arguments || '{}')
          // `followup` bleibt 0: Gemeldet wird nur der Wechsel auf eine neue
          // Katalogfrage (siehe POSITION_TOOL). Während der Nachfragen bekommt
          // keine Nachricht eine Position — die Anzeige bleibt dann auf der
          // zuletzt gemeldeten Frage stehen, was genau so gewollt ist.
          pos = a.fertig === true
            ? { done: true }
            : { chapter: Number(a.kapitel) || 0, question: Number(a.frage) || 0, followup: 0 }
          if (!pos.done && (!pos.chapter || !pos.question)) pos = null
        } catch (e) {
          stats.lastError = 'Positionsmeldung unlesbar'
          console.error('Voice Live: position_melden nicht lesbar', evt.arguments, e)
        }
        if (pos) onPosition?.(pos)
        // Ergebnis zurückmelden — ohne Antwort bleibt der Werkzeugaufruf in der
        // Sitzung offen und das Modell wartet.
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'conversation.item.create',
            item: { type: 'function_call_output', call_id: evt.call_id, output: '{"ok":true}' },
          }))
          respAnsweredCall = true
        }
        break
      }

      case 'response.created':
        respHadAudio = false
        respAnsweredCall = false
        break

      case 'response.done':
        // KEINE Zustandsmeldung hier: Die Antwort ist serverseitig fertig, im
        // Browser läuft die Ausgabe aber oft noch — das meldet der Player.
        // Hat die Runde NUR das Werkzeug aufgerufen und nichts gesagt, wartet die
        // Person sonst auf eine Frage, die nie kommt: Dann eine Antwortrunde
        // nachziehen. Wurde gesprochen, wäre ein zweiter Anstoß eine doppelte
        // Frage — deshalb die Unterscheidung.
        if (respAnsweredCall && !respHadAudio && ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'response.create' }))
        }
        respAnsweredCall = false
        break
      case 'error':
        console.error('Voice Live error:', evt.error)
        break
      default:
        break
    }
  }

  // 4) Mikrofon-Blöcke hochschicken. Die Sprechpausen-/Satzende-Erkennung macht
  //    der Dienst (semantische VAD) — der Client sendet einfach durchgehend.
  const resample = makeResampler(ctx.sampleRate, SAMPLE_RATE)
  if (ctx.sampleRate !== SAMPLE_RATE) {
    console.warn(`Voice Live: AudioContext läuft mit ${ctx.sampleRate} Hz statt ${SAMPLE_RATE} Hz — es wird umgerechnet.`)
  }
  node.port.onmessage = (e) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return

    // KEIN Mikrofonsignal senden, solange die KI spricht.
    //
    // Ohne diese Sperre hört sich die KI über den Lautsprecher selbst zu:
    // Nachgewiesen im Transkript — ihre eigene Frage („…mit beruflichen
    // Herausforderungen oder Rückschlägen umgegangen") kam als Nutzer-Antwort
    // zurück („Bist du mit beruflichen Kindern besonders?"), woraufhin sie
    // erklärte, sie dürfe keine Fragen beantworten. Zusätzlich gingen kurze
    // echte Antworten („ja bitte") in diesem Selbstgespräch unter.
    //
    // Die serverseitige Echo-Unterdrückung (server_echo_cancellation) und die
    // des Browsers reichen am Lautsprecher nicht aus — mit Kopfhörern gäbe es
    // das Problem nicht, aber darauf kann man sich nicht verlassen.
    //
    // PREIS: Dazwischenreden ist währenddessen nicht möglich; die KI lässt sich
    // nicht mehr mitten im Satz unterbrechen. Bewusst in Kauf genommen — ein
    // Interview, das sich selbst befragt, ist deutlich schädlicher als eine
    // verlorene Unterbrechungsmöglichkeit.
    if (player?.speaking) return

    const pcm = floatToPcm16(resample(e.data))
    if (!pcm.length) return
    stats.sent++
    ws.send(JSON.stringify({
      type: 'input_audio_buffer.append',
      audio: toBase64(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength)),
    }))
  }

  return {
    messages,
    // Damit die Oberfläche den Ton aus einer echten Klick-Geste heraus
    // freischalten kann (siehe „suspended" oben).
    async resume() {
      try { await ctx?.resume() } catch {}
      const ok = ctx?.state === 'running'
      if (ok) { removeUnlock?.(); onAudioBlocked?.(false); kickoff() }
      return ok
    },
    // Momentaufnahme für die Diagnose-Anzeige.
    stats() { return { ...stats, state: ctx?.state || '?', rate: ctx?.sampleRate || 0 } },
    // Kurzer Testton über GENAU DEN AudioContext, der auch die KI-Stimme
    // ausgibt. Hört man ihn, liegt es nicht an der Wiedergabe, sondern daran,
    // dass keine Audiodaten ankommen — und umgekehrt. Das trennt die beiden
    // Ursachen in zwei Sekunden, statt sie zu erraten.
    async testTone() {
      try {
        await ctx?.resume()
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.frequency.value = 440
        gain.gain.value = 0.15
        osc.connect(gain).connect(ctx.destination)
        const t = ctx.currentTime
        osc.start(t); osc.stop(t + 0.4)
        return ctx.state
      } catch (e) { return 'Fehler: ' + (e?.message || e) }
    },
    stop() { cleanup() },
  }
}
