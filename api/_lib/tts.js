// api/_lib/tts.js
// Azure AI Speech (Neural TTS) an EINER Stelle. Zwei Aufrufer:
//   • api/speak.js        – Vorlesen im Interview (ein kurzer Text je Aufruf)
//   • api/cron/generate.js – Hörbuch (Kapitel aus vielen Absätzen)
// Vorher lag das komplett in api/speak.js; das Hörbuch braucht dieselbe
// Stimmen-/Sprachwahl, aber ein anderes Ausgabeformat und Absatzpausen.
// Verhalten von /api/speak ist unverändert.
//
// Nötige Env: AZURE_SPEECH_KEY, AZURE_SPEECH_REGION (z. B. westeurope).

const { ALLOWED_TTS_VOICES, voiceGender, MULTILINGUAL_VOICE, MAI_SECONDARY_LANGS, isMaiVoice, VOICE_FEMALE_HD } = require('./ttsvoices')

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

// Emojis/Piktogramme aus dem Vorlese-Text entfernen – Azure-TTS liest sie sonst
// laut vor („lächelndes Gesicht" o. Ä.). Betrifft nur die Sprachausgabe, nicht
// den angezeigten Text.
function stripForSpeech(s) {
  return String(s)
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2B00}-\u{2BFF}\u{1F1E6}-\u{1F1FF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}]/gu, '')
    // Gendersternchen (& -Doppelpunkt/-Unterstrich) nicht mitsprechen: „Lehrer*innen"
    // → „Lehrerinnen", „Kolleg*in" → „Kollegin". Nur ZWISCHEN Buchstaben ersetzen,
    // damit echte Sternchen/Doppelpunkte (Aufzählungen, Uhrzeiten) unberührt bleiben.
    .replace(/(\p{L})[*:_](?=\p{L})/gu, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

// Neural-Stimme je Sprache (der/die Beitragende wählt die Sprache im Interview).
// Per Env feinjustierbar; ohne Sprache/unbekannt → Deutsch.
//
// Achtung, der Schlüssel ist der VOLLE Sprachcode: `de-CH` (Schweiz) darf nicht
// auf `de` gekürzt werden, sonst spricht eine deutsche Stimme mit einem Schweizer.
const TTS_VOICES = {
  // Rückfall für Bücher OHNE gespeicherte Stimme (alle vor der HD-Umstellung
  // angelegten). Bewusst dieselbe HD-Stimme, die `defaultTtsVoice()` neuen Büchern
  // gibt — sonst sprachen zwei Drittel des Bestands weiter mit der alten
  // Standardstimme, allein abhängig davon, ob die Env-Variable gesetzt ist.
  de:      process.env.AZURE_SPEECH_TTS_VOICE       || VOICE_FEMALE_HD,
  'de-CH': process.env.AZURE_SPEECH_TTS_VOICE_DE_CH || 'de-CH-LeniNeural',
  pl:      process.env.AZURE_SPEECH_TTS_VOICE_PL    || 'pl-PL-ZofiaNeural',
  en:      process.env.AZURE_SPEECH_TTS_VOICE_EN    || 'en-US-JennyNeural',
  es:      process.env.AZURE_SPEECH_TTS_VOICE_ES    || 'es-ES-ElviraNeural',
  it:      process.env.AZURE_SPEECH_TTS_VOICE_IT    || 'it-IT-ElsaNeural',
  eu:      process.env.AZURE_SPEECH_TTS_VOICE_EU    || 'eu-ES-AinhoaNeural',
  he:      process.env.AZURE_SPEECH_TTS_VOICE_HE    || 'he-IL-HilaNeural',
  ar:      process.env.AZURE_SPEECH_TTS_VOICE_AR    || 'ar-EG-SalmaNeural',
  fr:      process.env.AZURE_SPEECH_TTS_VOICE_FR    || 'fr-FR-DeniseNeural',
  ro:      process.env.AZURE_SPEECH_TTS_VOICE_RO    || 'ro-RO-AlinaNeural',
  tr:      process.env.AZURE_SPEECH_TTS_VOICE_TR    || 'tr-TR-EmelNeural',
  ru:      process.env.AZURE_SPEECH_TTS_VOICE_RU    || 'ru-RU-SvetlanaNeural',
  uk:      process.env.AZURE_SPEECH_TTS_VOICE_UK    || 'uk-UA-PolinaNeural',
}
// BCP-47 je Interviewsprache (für xml:lang; nötig, damit eine mehrsprachige Stimme
// die richtige Sprache spricht). Passend zu den Locales in api/transcribe.js.
const SPEECH_LOCALE = {
  de: 'de-DE', 'de-CH': 'de-CH', pl: 'pl-PL', en: 'en-US',
  es: 'es-ES', it: 'it-IT', eu: 'eu-ES', he: 'he-IL', ar: process.env.AZURE_SPEECH_STT_LOCALE_AR || 'ar-EG',
  fr: 'fr-FR', ro: 'ro-RO', tr: 'tr-TR', ru: 'ru-RU', uk: 'uk-UA',
}
// Sprachen, die die Multilingual-Stimmen sicher sprechen. eu/he/ar (und de-CH)
// behalten ihre dedizierte Stimme, um Fehlaussprache/HTTP-Fehler zu vermeiden.
const MULTILINGUAL_LANGS = new Set(['en', 'es', 'it', 'pl'])

// Wählt Stimme + xml:lang. `requestedVoice` = die pro Buch gewählte deutsche Stimme
// (aus memorials.tts_voice, vom Client mitgeschickt).
// - Deutsch: die gewählte Stimme (falls erlaubt), sonst Standard.
// - en/es/it/pl: die zur Buchstimme passende Person als Multilingual-Stimme
//   (gleiches Geschlecht, konsistent über Sprachen).
// - Rest (de-CH, eu, he, ar): dedizierte Standardstimme der Sprache.
function pickVoiceAndLocale(language, requestedVoice) {
  const code = String(language || 'de')
  if (code === 'de') {
    const v = (requestedVoice && ALLOWED_TTS_VOICES.has(requestedVoice)) ? requestedVoice : TTS_VOICES.de
    return { voice: v, locale: 'de-DE' }
  }
  const g = voiceGender(requestedVoice)
  // MAI-Stimmen können einige Sprachen selbst (en/es/it/fr/ro/tr/ru) — dann bleibt
  // dieselbe Stimme über die Sprachgrenze hinweg, was schöner ist als ein Wechsel.
  // Für pl/eu/he/ar/uk/de-CH können sie es NICHT; dort greift wie bisher die
  // Multilingual-Stimme bzw. die Standardstimme der Sprache.
  if (isMaiVoice(requestedVoice) && MAI_SECONDARY_LANGS.has(code) && ALLOWED_TTS_VOICES.has(requestedVoice)) {
    return { voice: requestedVoice, locale: SPEECH_LOCALE[code] || 'en-US' }
  }
  if (MULTILINGUAL_LANGS.has(code) && g) {
    return { voice: MULTILINGUAL_VOICE[g], locale: SPEECH_LOCALE[code] || 'en-US' }
  }
  const std = TTS_VOICES[code] || TTS_VOICES[code.slice(0, 2)] || TTS_VOICES.de
  return { voice: std, locale: SPEECH_LOCALE[code] || std.slice(0, 5) || 'de-DE' }
}

// Preisklasse der tatsächlich benutzten Stimme — entscheidet den Kosten-Schlüssel
// in cost.js. HD („Dragon") und die MAI-Stimmen laufen bei Azure über den teureren
// Meter „Neural HD" ($22 statt $15 je 1M Zeichen); beide sind am Doppelpunkt im
// Namen erkennbar (de-DE-Mia:MAI-Voice-2, de-DE-Seraphina:DragonHDLatestNeural).
function ttsModelKey(voice) {
  return /:(?:DragonHD|MAI-Voice)/i.test(String(voice || '')) ? 'azure-tts-hd' : 'azure-tts-neural'
}

// ── Azure AI Speech (Neural TTS) ──────────────────────────────────
// `inner` ist fertiges SSML-Innenleben (Text, Pausen, Absätze) — es steht INNERHALB
// von <voice>. Wer nur Text hat, nimmt speechInner() bzw. synth().
const DEFAULT_FORMAT = 'audio-24khz-48kbitrate-mono-mp3'

async function synthSSML(region, key, voice, locale, inner, opts = {}) {
  const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='http://www.w3.org/2001/mstts' xml:lang='${locale}'><voice name='${voice}'>${inner}</voice></speak>`
  const response = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': key,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': opts.format || DEFAULT_FORMAT,
      'User-Agent': 'lebensgeschichten',
    },
    body: ssml,
  })
  if (!response.ok) {
    const errTxt = await response.text().catch(() => '')
    throw new Error(`Azure TTS HTTP ${response.status}${errTxt ? ` – ${errTxt.slice(0, 200)}` : ''}`)
  }
  return Buffer.from(await response.arrayBuffer())
}

// Reiner Text → SSML-Innenleben, mit Sprechtempo.
// Spricht eine Stimme eine ANDERE Sprache als ihre eigene (mehrsprachige Stimmen,
// aber auch MAI-Stimmen in ihren Zweitsprachen), muss die Zielsprache explizit
// ausgezeichnet werden — sonst wird der Text mit deutscher Aussprache gelesen.
function speechInner(voice, locale, text) {
  const rate = process.env.AZURE_SPEECH_TTS_RATE || '+6%' // Sprechtempo, per Env feinjustierbar
  return (voice.includes('Multilingual') || voice.slice(0, 5).toLowerCase() !== String(locale).slice(0, 5).toLowerCase())
    ? `<lang xml:lang='${locale}'><prosody rate='${rate}'>${xmlEscape(text)}</prosody></lang>`
    : `<prosody rate='${rate}'>${xmlEscape(text)}</prosody>`
}

async function synth(region, key, voice, locale, text, opts = {}) {
  return synthSSML(region, key, voice, locale, speechInner(voice, locale, text), opts)
}

// ── Vorlesen langer Texte (Hörbuch) ───────────────────────────────
// Höhere Bitrate als beim Interview-Vorlesen: das hier wird heruntergeladen und
// behalten, nicht einmal abgespielt. 96 kbit/s mono ist die Rate, in der das
// Lutherhof-Hörbuch geliefert wurde (126 Minuten ≈ 86 MB).
const NARRATION_FORMAT = 'audio-24khz-96kbitrate-mono-mp3'

// GEMESSEN am 2026-08-17: Die MAI-Stimmen ignorieren <break> (3 s gesetzt →
// +1,4 s), die HD- und Standardstimmen halten sich daran. Verlässlich für ALLE
// ist dagegen der Absatz: jeder Vorlese-Block wird ein eigenes <p> (≈ +1,2 s).
// `mstts:silence type='Tailing'` schließt die Naht zwischen zwei Aufrufen —
// ohne sie klebt der nächste Absatz unmittelbar am vorigen.
function narrationInner(voice, locale, texts, opts = {}) {
  const rate = process.env.AZURE_SPEECH_TTS_RATE || '+6%'
  const tail = opts.tailingMs == null ? 700 : Math.max(0, opts.tailingMs)
  const body = (texts || [])
    .map(t => String(t || '').trim()).filter(Boolean)
    .map(t => `<p><prosody rate='${rate}'>${xmlEscape(t)}</prosody></p>`)
    .join('')
  // Spricht die Stimme eine andere Sprache als ihre eigene, muss die Zielsprache
  // ausgezeichnet werden (wie in speechInner) — sonst deutsche Aussprache.
  const needLang = voice.includes('Multilingual') || voice.slice(0, 5).toLowerCase() !== String(locale).slice(0, 5).toLowerCase()
  const inner = needLang ? `<lang xml:lang='${locale}'>${body}</lang>` : body
  return `<mstts:silence type='Tailing' value='${tail}ms'/>${inner}`
}

// Ein Stück Hörbuch: mehrere Absätze in EINEM Aufruf. Liefert reine MPEG-Frames
// ohne ID3 — mehrere Ergebnisse lassen sich deshalb binär aneinanderhängen.
async function synthNarration(voice, locale, texts, opts = {}) {
  const region = process.env.AZURE_SPEECH_REGION
  const key    = process.env.AZURE_SPEECH_KEY
  if (!region || !key) throw new Error('Azure Speech ist nicht konfiguriert (AZURE_SPEECH_REGION/KEY).')
  return synthSSML(region, key, voice, locale, narrationInner(voice, locale, texts, opts), { format: opts.format || NARRATION_FORMAT })
}

async function speakAzure(text, language, requestedVoice) {
  const region = process.env.AZURE_SPEECH_REGION
  const key    = process.env.AZURE_SPEECH_KEY
  if (!region || !key) throw new Error('Azure Speech ist nicht konfiguriert (AZURE_SPEECH_REGION/KEY).')
  const { voice, locale } = pickVoiceAndLocale(language, requestedVoice)
  try {
    return { buffer: await synth(region, key, voice, locale, text), model: ttsModelKey(voice) }
  } catch (e) {
    // Sicherheitsnetz: Scheitert eine mehrsprachige Stimme an einer Sprache/Locale,
    // NICHT die Vorlesefunktion abwürgen — auf die dedizierte Standardstimme der
    // Sprache ausweichen (kein Multilingual mehr).
    const code = String(language || 'de')
    const fallback = TTS_VOICES[code] || TTS_VOICES[code.slice(0, 2)] || TTS_VOICES.de
    // Auch eine MAI-Stimme kann an einer Zweitsprache scheitern → gleiches Netz.
    if ((voice.includes('Multilingual') || isMaiVoice(voice)) && fallback !== voice) {
      const loc = SPEECH_LOCALE[code] || fallback.slice(0, 5) || 'de-DE'
      return { buffer: await synth(region, key, fallback, loc, text), model: ttsModelKey(fallback) }
    }
    throw e
  }
}

module.exports = {
  xmlEscape, stripForSpeech, TTS_VOICES, SPEECH_LOCALE,
  pickVoiceAndLocale, ttsModelKey, synth, synthSSML, speechInner, speakAzure,
  NARRATION_FORMAT, narrationInner, synthNarration,
}
