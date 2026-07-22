// api/speak.js
// POST /api/speak  { text, memorialCode?, contributionId? }  → audio/mpeg
//
// Einziges TTS ist Azure AI Speech (deutsche Neural-Stimmen, EU-Region) –
// KEIN Fallback. Der frühere OpenAI-TTS-Fallback (SPEECH_PROVIDER) wurde am
// 2026-06-22 entfernt (nicht von der Datenschutzerklärung gedeckt: US-Transfer).
// Nötige Env:
//   AZURE_SPEECH_KEY, AZURE_SPEECH_REGION (z. B. westeurope)
//   AZURE_SPEECH_TTS_VOICE  optional (Default de-DE-KatjaNeural)

const { createClient } = require('./_lib/store')
const { costTTS, recordCost, enforceBudget } = require('./_lib/cost')
const { resolvePublicCode } = require('./_lib/access')
const { enforce } = require('./_lib/ratelimit')
const { ALLOWED_TTS_VOICES, voiceGender, MULTILINGUAL_VOICE, VOICE_FEMALE_HD } = require('./_lib/ttsvoices')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

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
  if (MULTILINGUAL_LANGS.has(code) && g) {
    return { voice: MULTILINGUAL_VOICE[g], locale: SPEECH_LOCALE[code] || 'en-US' }
  }
  const std = TTS_VOICES[code] || TTS_VOICES[code.slice(0, 2)] || TTS_VOICES.de
  return { voice: std, locale: SPEECH_LOCALE[code] || std.slice(0, 5) || 'de-DE' }
}

// ── Azure AI Speech (Neural TTS) ──────────────────────────────────
async function synth(region, key, voice, locale, text) {
  const rate = process.env.AZURE_SPEECH_TTS_RATE || '+6%' // Sprechtempo, per Env feinjustierbar
  // Mehrsprachige Stimmen brauchen die Zielsprache explizit (<lang>), sonst könnten
  // sie den Text in der Grundsprache (Deutsch) aussprechen.
  const inner = voice.includes('Multilingual')
    ? `<lang xml:lang='${locale}'><prosody rate='${rate}'>${xmlEscape(text)}</prosody></lang>`
    : `<prosody rate='${rate}'>${xmlEscape(text)}</prosody>`
  const ssml = `<speak version='1.0' xml:lang='${locale}'><voice name='${voice}'>${inner}</voice></speak>`
  const response = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': key,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
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

async function speakAzure(text, language, requestedVoice) {
  const region = process.env.AZURE_SPEECH_REGION
  const key    = process.env.AZURE_SPEECH_KEY
  if (!region || !key) throw new Error('Azure Speech ist nicht konfiguriert (AZURE_SPEECH_REGION/KEY).')
  const { voice, locale } = pickVoiceAndLocale(language, requestedVoice)
  try {
    return { buffer: await synth(region, key, voice, locale, text), model: 'azure-tts-neural' }
  } catch (e) {
    // Sicherheitsnetz: Scheitert eine mehrsprachige Stimme an einer Sprache/Locale,
    // NICHT die Vorlesefunktion abwürgen — auf die dedizierte Standardstimme der
    // Sprache ausweichen (kein Multilingual mehr).
    const code = String(language || 'de')
    const fallback = TTS_VOICES[code] || TTS_VOICES[code.slice(0, 2)] || TTS_VOICES.de
    if (voice.includes('Multilingual') && fallback !== voice) {
      const loc = SPEECH_LOCALE[code] || fallback.slice(0, 5) || 'de-DE'
      return { buffer: await synth(region, key, fallback, loc, text), model: 'azure-tts-neural' }
    }
    throw e
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  try {
    if (!(await enforce(req, res, { name: 'speak', limit: 30, windowSeconds: 60 }))) return

    const { text, memorialCode, contributionId, language, voice } = req.body
    if (!text) return res.status(400).json({ error: 'text fehlt.' })
    // Emojis aus dem Vorlese-Text entfernen.
    const speechText = stripForSpeech(text)
    if (!speechText) return res.status(400).json({ error: 'kein vorlesbarer Text.' })

    // An einen echten Gedenkbuch-Code gebunden (offener Endpunkt, aber kein
    // anonymer TTS-Proxy auf fremde Rechnung). Prüfung VOR dem Anbieter-Aufruf.
    const code = String(memorialCode || '').toUpperCase().trim()
    if (!code) return res.status(400).json({ error: 'memorialCode fehlt.' })
    // Buch-Code ODER Gast-Code (Gastbeiträge zum Lebenswerk); gebucht wird auf
    // das echte Buch.
    const target = await resolvePublicCode(supabase, code)
    if (!target) {
      return res.status(403).json({ error: 'Ungültiger Code.' })
    }
    // Kosten-Obergrenze je Buch erschöpft → keine Sprachausgabe mehr (402).
    if (!(await enforceBudget(res, target.id))) return

    let result
    try {
      result = await speakAzure(speechText, language, voice)
    } catch (e) {
      console.error('/api/speak TTS error:', e)
      return res.status(500).json({ error: 'Die Sprachausgabe ist momentan nicht verfügbar. Bitte später erneut versuchen.' })
    }

    res.setHeader('Content-Type', 'audio/mpeg')
    res.setHeader('Cache-Control', 'no-store')
    res.send(result.buffer)

    {
      const chars = speechText.length
      await recordCost({
        memorial_id: target.id,
        contribution_id: contributionId || null,
        kind: 'tts',
        provider: 'azure',
        model: result.model,
        characters: chars,
        cost_usd: costTTS(result.model, chars),
      })
    }
  } catch (e) {
    console.error('/api/speak error:', e)
    res.status(500).json({ error: 'Die Sprachausgabe ist momentan nicht verfügbar. Bitte später erneut versuchen.' })
  }
}
