// api/_lib/voicelive.js
// ============================================================================
// Gemeinsame Bausteine für das LIVE-SPRACHGESPRÄCH (Azure AI Speech „Voice Live").
// Benutzt von api/voicelive-token.js (Ticket ausstellen) und dem WebSocket-Relay
// in server.js.
//
// WARUM EIN RELAY UND KEINE DIREKTVERBINDUNG AUS DEM BROWSER?
//   1. Schlüssel: Ein Browser-WebSocket kann keinen Authorization-Header setzen;
//      Microsofts Beispiele hängen den Ressourcenschlüssel als Query-Parameter an
//      (`?api-key=…`) — der Schlüssel läge damit im Browser. Inakzeptabel.
//   2. Region/DSGVO: Der von Microsoft für Browser empfohlene WebRTC-Pfad
//      (`/voice-live/realtime/calls`) nutzt laut Doku „global standard deployments"
//      und routet zur nächstgelegenen Region — also KEINE EU-Garantie. Über das
//      Relay binden wir die Sitzung fest an die Sweden-Central-Ressource (einzige
//      Voice-Live-Region in der EU) und an ein NICHT-globales Chat-Deployment.
//   3. Kosten: Nur serverseitig lassen sich die `response.done`-Usage-Blöcke
//      mitzählen und über recordCost() aufs Buch buchen (Budget-Obergrenze).
//
// Wir fahren CASCADED: azure-speech-STT + bestehendes gpt-4.1 + azure-tts. Voice
// Live orchestriert davon nur Barge-in/VAD/Streaming. Das native
// Speech-to-Speech (`gpt-realtime`) ist bewusst NICHT gewählt — es gibt es nur
// als „Global"-Deployment (weltweite Verarbeitung).
// ============================================================================

const crypto = require('crypto')

// Ticket-Lebensdauer: kurz. Es wird unmittelbar nach dem Ausstellen für den
// WS-Verbindungsaufbau benutzt; danach lebt die Sitzung über die offene
// Verbindung weiter, nicht über das Ticket.
const TICKET_TTL_MS = 2 * 60 * 1000

// Obergrenze für die vom Browser gelieferten Interview-Anweisungen. Der
// Interview-Prompt wird — wie bei /api/ask — im Browser aus src/categories.js
// gebaut; die Grenze verhindert nur, dass jemand über den offenen Endpunkt
// beliebig große Prompts durchschiebt.
const MAX_INSTRUCTIONS = 24000

// Nachrichten-Typen, die der BROWSER durchs Relay nach oben schicken darf.
// Alles andere wird verworfen — insbesondere `session.update`: Modell, Stimme,
// Turn-Detection und Transkription setzt ausschließlich das Relay (sonst könnte
// ein Client die Sitzung auf ein teureres Modell oder weg von der EU-Region
// umbiegen).
const CLIENT_ALLOWED_TYPES = new Set([
  'input_audio_buffer.append',
  'input_audio_buffer.commit',
  'input_audio_buffer.clear',
  'conversation.item.create',
  'response.create',
  'response.cancel',
])

// ── EU-Residenz hängt am MODELLNAMEN ──────────────────────────────
// Voice Live betreibt die nativ unterstützten Modelle selbst; wir wählen den
// Deployment-Typ NICHT — er steht je Region und Modell in der Microsoft-Doku
// (learn.microsoft.com/azure/ai-services/speech-service/regions?tabs=voice-live).
// Für unsere Ressource in `swedencentral` gilt (geprüft 2026-08-02):
//
//   gpt-4.1        → Standard        = in-Region verarbeitet  → EU  ✓
//   gpt-4.1-mini   → Standard        = in-Region verarbeitet  → EU  ✓
//   gpt-4o         → Data zone std.  = EU-Datenzone           → EU  ✓
//   gpt-4o-mini    → Data zone std.  = EU-Datenzone           → EU  ✓
//   gpt-4.1-nano   → Data zone std.  = EU-Datenzone           → EU  ✓
//   phi4-mm-realtime / phi4-mini → Regional                   → EU  ✓
//   gpt-realtime, gpt-realtime-mini, gpt-realtime-1.5, azure-realtime,
//   gpt-5*, gpt-5.x*  → GLOBAL STANDARD = weltweit verarbeitet → NICHT EU  ✗
//
// Die Falle: `gpt-realtime` ist das ECHTE Speech-to-Speech-Modell und klingt
// deutlich natürlicher — es umzustellen wäre verlockend und würde die
// Verarbeitung still nach außerhalb der EU verlegen. Eine einzige Env-Variable
// entscheidet also über die Rechtsgrundlage. Deshalb steht hier eine Allowlist:
// Ein nicht freigegebenes Modell schaltet das Live-Gespräch AB, statt es
// stillschweigend global laufen zu lassen.
//
// Wer ein anderes Modell braucht, nimmt Bring-Your-Own-Model (eigenes, nicht-
// globales Deployment in unserer Foundry-Ressource) — dann gilt der Deployment-
// Typ unseres Deployments, und der Name gehört hier eingetragen.
const EU_RESIDENT_MODELS = new Set([
  'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano',
  'gpt-4o', 'gpt-4o-mini',
  'phi4-mm-realtime', 'phi4-mini',
])

function isEuResidentModel(model) {
  return EU_RESIDENT_MODELS.has(String(model || '').trim().toLowerCase())
}

// ── Konfiguration ─────────────────────────────────────────────────
// Eigene Ressource, getrennt von der bestehenden westeurope-Speech-Ressource:
// Voice Live gibt es in der EU NUR in Sweden Central.
function voiceLiveConfig() {
  const endpoint = (process.env.AZURE_VOICELIVE_ENDPOINT || '').trim().replace(/\/+$/, '')
  return {
    endpoint,
    key:        (process.env.AZURE_VOICELIVE_KEY || '').trim(),
    // Deployment-Name des Chat-Modells. MUSS ein Nicht-„Global"-Deployment sein
    // (DataZone-EU oder Regional) — sonst verarbeitet Azure weltweit.
    chatModel:  (process.env.AZURE_VOICELIVE_CHAT_MODEL || 'gpt-4.1').trim(),
    apiVersion: (process.env.AZURE_VOICELIVE_API_VERSION || '2026-04-10').trim(),
  }
}

// Konfiguriert = Endpunkt + Schlüssel gesetzt UND ein Modell, das in der EU
// verarbeitet wird. Ein nicht freigegebenes Modell lässt den Relay gar nicht
// erst anlaufen — lieber kein Live-Gespräch als eines außerhalb der EU.
function isVoiceLiveConfigured() {
  const c = voiceLiveConfig()
  if (!c.endpoint || !c.key) return false
  if (!isEuResidentModel(c.chatModel)) {
    console.error(
      `[voicelive] DEAKTIVIERT: AZURE_VOICELIVE_CHAT_MODEL="${c.chatModel}" ist nicht als ` +
      'EU-verarbeitet freigegeben (Deployment-Typ „Global standard" verarbeitet weltweit). ' +
      `Erlaubt: ${[...EU_RESIDENT_MODELS].join(', ')}. Siehe Kommentar in api/_lib/voicelive.js.`)
    return false
  }
  return true
}

// WebSocket-URL der Sitzung. Bewusst der `/voice-live/realtime`-Pfad (Server-zu-
// Server) und NICHT `/voice-live/realtime/calls` (WebRTC-Signaling, global geroutet).
function voiceLiveUrl() {
  const c = voiceLiveConfig()
  const host = c.endpoint.replace(/^https?:\/\//, '')
  const q = new URLSearchParams({ 'api-version': c.apiVersion, model: c.chatModel })
  return `wss://${host}/voice-live/realtime?${q.toString()}`
}

// ── Preisklasse ───────────────────────────────────────────────────
// Ergibt sich aus dem Chat-Modell und ist nicht wählbar (Microsoft-Doku).
// Schlüssel passend zu PRICING in api/_lib/cost.js.
function tierForModel(model) {
  const m = String(model || '').toLowerCase()
  if (/nano|phi4/.test(m)) return 'lite'
  if (/mini/.test(m))      return 'basic'
  return 'pro'   // gpt-realtime, gpt-4o, gpt-4.1, gpt-5, gpt-5-chat
}

// ── Usage → Tokenströme ───────────────────────────────────────────
// Der `response.done`-Usage-Block ist mit der Realtime-API kompatibel:
//   { input_tokens, output_tokens,
//     input_token_details:  { cached_tokens, text_tokens, audio_tokens },
//     output_token_details: { text_tokens, audio_tokens } }
// Abgerechnet wird nach STROM (Sprach-Audio / natives LLM-Audio / Text), siehe
// die Meter-Erklärung in cost.js. Im cascaded Betrieb läuft das Audio über
// azure-speech/azure-tts → `speechAudio*`. `native` schaltet auf die
// LLM-Audio-Meter um, falls später doch ein Speech-to-Speech-Modell gefahren wird.
function sumUsage(usage, into = {}, { native = false } = {}) {
  const t = into
  const add = (k, n) => { if (n) t[k] = (t[k] || 0) + n }
  const u = usage || {}
  const inD = u.input_token_details || {}
  const outD = u.output_token_details || {}

  const cached = inD.cached_tokens || 0
  // Gecachte Tokens sind in input_tokens enthalten und werden separat (billiger)
  // berechnet — sonst zahlten wir sie doppelt.
  const audioIn = Math.max(0, (inD.audio_tokens || 0) - (inD.cached_tokens_details?.audio_tokens || 0))
  const textIn  = Math.max(0, (inD.text_tokens  || 0) - (inD.cached_tokens_details?.text_tokens  || 0))

  add(native ? 'llmAudioIn'  : 'speechAudioIn',  audioIn)
  add(native ? 'llmAudioOut' : 'speechAudioOut', outD.audio_tokens || 0)
  add('textIn',  textIn)
  add('textOut', outD.text_tokens || 0)
  add('cached',  cached)

  // Fallback: Liefert Azure keine Detail-Aufschlüsselung, den Gesamtwert nicht
  // verlieren — lieber als Text verbuchen (günstigster Satz, aber nicht 0) und
  // im Log sichtbar machen, als still nichts zu berechnen.
  if (!inD.audio_tokens && !inD.text_tokens && u.input_tokens)  add('textIn',  u.input_tokens)
  if (!outD.audio_tokens && !outD.text_tokens && u.output_tokens) add('textOut', u.output_tokens)
  return t
}

// Summe aller Tokens (für die `input_tokens`/`output_tokens`-Spalten in cost_events).
function totalTokens(t = {}) {
  const inT  = (t.speechAudioIn || 0) + (t.llmAudioIn || 0) + (t.textIn || 0) + (t.cached || 0)
  const outT = (t.speechAudioOut || 0) + (t.llmAudioOut || 0) + (t.textOut || 0)
  return { inT, outT }
}

// ── Relay-Ticket ──────────────────────────────────────────────────
// Kurzlebiges, signiertes Ticket statt eines Azure-Tokens: Der Browser bekommt
// NIE Zugriff auf die Azure-Ressource, sondern nur die Erlaubnis, EINE
// Relay-Sitzung für genau dieses Buch zu öffnen. Signiert mit ADMIN_TOKEN_SECRET
// (ohne gesetztes Secret wird gar kein Ticket ausgestellt → Feature ist aus).
function base64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function ticketSecret() {
  return process.env.ADMIN_TOKEN_SECRET || ''
}

function signTicket(payload) {
  const secret = ticketSecret()
  if (!secret) return null
  const body = base64url(JSON.stringify({ ...payload, exp: Date.now() + TICKET_TTL_MS }))
  const sig = base64url(crypto.createHmac('sha256', secret).update(body).digest())
  return `${body}.${sig}`
}

// Gibt die Nutzlast zurück ({ id, code, contributionId, language, voice, guest })
// oder null (ungültig/abgelaufen/kein Secret).
function verifyTicket(ticket) {
  const secret = ticketSecret()
  if (!secret || !ticket) return null
  const parts = String(ticket).split('.')
  if (parts.length !== 2) return null
  const [body, sig] = parts
  const expected = base64url(crypto.createHmac('sha256', secret).update(body).digest())
  if (sig.length !== expected.length) return null
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
  try {
    const data = JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString())
    if (typeof data.exp !== 'number' || Date.now() >= data.exp) return null
    return data
  } catch {
    return null
  }
}

// ── Sitzungs-Konfiguration (session.update) ───────────────────────
// Wird AUSSCHLIESSLICH vom Relay gebaut. `instructions` ist das einzige Stück,
// das vom Browser kommt (der Interview-Prompt aus src/categories.js — genau wie
// das `system`-Feld von /api/ask).
// Werkzeug, über das das Modell seine Stelle im Fragenkatalog meldet.
//
// Im Mikrofon-Modus steht die Position als Marker („[[K2.3]] …") vorne im Text
// und wird vor dem Vorlesen entfernt. Im Live-Gespräch geht der Text UNVERÄNDERT
// in die Sprachausgabe — der Marker wurde also mitgesprochen und klang wie
// Kauderwelsch. Statt die Position im gesprochenen Text zu transportieren,
// meldet das Modell sie hier über einen Werkzeugaufruf: hörbar bleibt nur das
// Gespräch, die Fortschrittsanzeige bekommt trotzdem ihre Zahlen.
//
// Steht bewusst serverseitig: Der Browser darf die Sitzung nicht umkonfigurieren.
// NUR beim Wechsel auf eine neue Katalogfrage, NICHT bei jeder Äußerung.
//
// Gemessen: Das Modell beantwortet einen Werkzeugaufruf mit einer REINEN
// Aufruf-Runde, ohne zu sprechen — die gesprochene Frage braucht dann eine
// zweite Runde. Bei jeder Frage aufgerufen kostete das doppelte Wartezeit und
// doppelten Textkontext (der Hauptkostentreiber). Die Anweisung „zusätzlich
// zur Antwort, niemals statt ihr" hat daran nichts geändert — gegen ein Modell
// anzuprompten ist unzuverlässig.
//
// Deshalb die bewusste Abwägung (Nutzerentscheidung): Die Anzeige wird gröber
// (sie bleibt während der Nachfragen auf der zuletzt gemeldeten Katalogfrage
// stehen), dafür bleibt das Gespräch flüssig. `nachfrage` ist ganz entfallen —
// es wäre hier immer 0 und nur eine weitere Gelegenheit für Fehlmeldungen.
const POSITION_TOOL = {
  type: 'function',
  name: 'position_melden',
  description: 'Meldet den Wechsel zu einer neuen Katalogfrage. NUR aufrufen, wenn du eine neue Frage AUS DEM FRAGENKATALOG beginnst — NICHT bei vertiefenden Nachfragen und nicht bei sonstigen Wortmeldungen.',
  parameters: {
    type: 'object',
    properties: {
      kapitel: { type: 'integer', description: 'Nummer des Kapitels aus dem FRAGENKATALOG (1-basiert).' },
      frage:   { type: 'integer', description: 'Nummer der Frage innerhalb dieses Kapitels (1-basiert).' },
      fertig:  { type: 'boolean', description: 'true, wenn alle Fragen aller Kapitel beantwortet sind und das Gespräch endet.' },
    },
    required: ['kapitel', 'frage'],
  },
}

function buildSessionUpdate({ instructions, language, voice }) {
  // Kürzen, ohne den SCHLUSS zu verlieren: ganz am Ende der Anweisungen stehen
  // die Vorlese-Regeln und die SPRACHREGEL (langDirective, bewusst als letzte
  // Instruktion gebaut). Ein einfaches slice(0, MAX) hätte bei langen
  // Fragenkatalogen genau sie abgeschnitten — das Live-Gespräch wäre auf Deutsch
  // gelaufen, vorgelesen mit der fremdsprachigen Stimme. Deshalb fällt die MITTE
  // weg statt des Endes.
  const raw = String(instructions || '')
  const TAIL = 2000
  const CUT = ' […] '
  const text = raw.length <= MAX_INSTRUCTIONS
    ? raw
    : raw.slice(0, MAX_INSTRUCTIONS - TAIL - CUT.length) + CUT + raw.slice(-TAIL)
  return {
    type: 'session.update',
    session: {
      instructions: text,
      modalities: ['text', 'audio'],
      input_audio_format: 'pcm16',
      output_audio_format: 'pcm16',
      // STT über Azure Speech (deckt deutlich mehr Sprachen ab als ein natives
      // Speech-to-Speech-Modell und ist bei Störgeräuschen robuster).
      input_audio_transcription: {
        model: 'azure-speech',
        ...(language ? { language } : {}),
      },
      // Semantische Sprechpausen-Erkennung. Die Werte sind für ERZÄHLENDE
      // ausgelegt, nicht für kurze Auskunftsdialoge — jemand, der aus seinem
      // Leben erzählt, macht mitten im Satz Pausen und darf dabei nicht
      // unterbrochen werden. Alle Angaben aus der Voice-Live-Doku:
      //   threshold          0.0–1.0, Default 0.5. HÖHER = es braucht mehr
      //                      Sicherheit, dass wirklich jemand spricht (weniger
      //                      Fehl-Unterbrechungen). Vorher stand hier 0.3 —
      //                      zu empfindlich.
      //   prefix_padding_ms  Default für diesen Typ 420. Vorher 200 — damit
      //                      wurde der Anfang der Antwort abgeschnitten.
      //   silence_duration_ms Default 500. Das ist eine halbe Sekunde Stille bis
      //                      „Satz zu Ende" — beim Erzählen viel zu wenig,
      //                      genau die gemeldeten Unterbrechungen. Jetzt 1600.
      //   remove_filler_words „ähm/hm" lösen keine Unterbrechung mehr aus.
      //                      Braucht `languages`; der multilinguale Typ deckt
      //                      u. a. Deutsch ab (der einfache primär Englisch).
      turn_detection: {
        type: 'azure_semantic_vad_multilingual',
        threshold: 0.5,
        prefix_padding_ms: 420,
        silence_duration_ms: 1600,
        remove_filler_words: true,
        ...(language ? { languages: [String(language).slice(0, 2)] } : {}),
        interrupt_response: true,   // Dazwischenreden bleibt ausdrücklich möglich
      },
      // Ausgabe über die am Buch hinterlegte Azure-Stimme, damit das
      // Live-Gespräch genauso klingt wie die bisherige Vorlesefunktion.
      // `temperature` steuert laut Doku die Schwankungsbreite in Betonung und
      // Sprechmelodie (nur HD-/MAI-Stimmen). Bewusst unter dem Beispielwert 0.8:
      // Die Stimme wirkte im Test überdreht — hier geht es um Lebensgeschichten,
      // nicht um eine Produktvorführung. `rate` etwas unter 1.0 nimmt zusätzlich
      // Tempo heraus.
      ...(voice ? { voice: { type: 'azure-standard', name: voice, temperature: 0.6, rate: '0.95' } } : {}),
      input_audio_noise_reduction: { type: 'azure_deep_noise_suppression' },
      input_audio_echo_cancellation: { type: 'server_echo_cancellation' },
      // Fortschrittsmeldung per Werkzeug statt im gesprochenen Text (s. o.).
      tools: [POSITION_TOOL],
      tool_choice: 'auto',
    },
  }
}

module.exports = {
  TICKET_TTL_MS, MAX_INSTRUCTIONS, CLIENT_ALLOWED_TYPES,
  voiceLiveConfig, isVoiceLiveConfigured, voiceLiveUrl, isEuResidentModel, EU_RESIDENT_MODELS,
  tierForModel, sumUsage, totalTokens,
  signTicket, verifyTicket, buildSessionUpdate, POSITION_TOOL,
}
