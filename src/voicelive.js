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
  constructor(ctx) {
    this.ctx = ctx
    this.at = 0
    this.sources = []
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
    this.sources.push(src)
    src.onended = () => { this.sources = this.sources.filter(s => s !== src) }
  }
  stop() {
    for (const s of this.sources) { try { s.stop() } catch {} }
    this.sources = []
    this.at = 0
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
  memorialCode, contributionId, language, instructions, history = [],
  onReady, onUserText, onAiText, onAiPartial, onState, onFallback, onStream,
}) {
  const messages = []
  let ws = null, ctx = null, stream = null, node = null, srcNode = null
  let player = null
  let stopped = false
  let aiPartial = ''

  const cleanup = () => {
    stopped = true
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
      body: JSON.stringify({ memorialCode, contributionId, language }),
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
    if (ctx.state === 'suspended') await ctx.resume()
    player = new Player(ctx)
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

  ws.onmessage = (ev) => {
    let evt
    try { evt = JSON.parse(ev.data) } catch { return }
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
        // sprechen muss (sonst warten beide Seiten aufeinander).
        ws.send(JSON.stringify({ type: 'response.create' }))
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
        player.stop()
        onState?.({ listening: true, speaking: false })
        break

      case 'response.audio.delta':
        if (evt.delta) {
          const bytes = fromBase64(evt.delta)
          player.push(new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2))
          onState?.({ listening: true, speaking: true })
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
      case 'response.done':
        onState?.({ listening: true, speaking: player.speaking })
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
    const pcm = floatToPcm16(resample(e.data))
    if (!pcm.length) return
    ws.send(JSON.stringify({
      type: 'input_audio_buffer.append',
      audio: toBase64(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength)),
    }))
  }

  return {
    messages,
    stop() { cleanup() },
  }
}
