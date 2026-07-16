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
const { memorialExists } = require('./_lib/access')
const { enforce } = require('./_lib/ratelimit')

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
  de:      process.env.AZURE_SPEECH_TTS_VOICE       || 'de-DE-KatjaNeural',
  'de-CH': process.env.AZURE_SPEECH_TTS_VOICE_DE_CH || 'de-CH-LeniNeural',
  pl:      process.env.AZURE_SPEECH_TTS_VOICE_PL    || 'pl-PL-ZofiaNeural',
  en:      process.env.AZURE_SPEECH_TTS_VOICE_EN    || 'en-US-JennyNeural',
  es:      process.env.AZURE_SPEECH_TTS_VOICE_ES    || 'es-ES-ElviraNeural',
  it:      process.env.AZURE_SPEECH_TTS_VOICE_IT    || 'it-IT-ElsaNeural',
  eu:      process.env.AZURE_SPEECH_TTS_VOICE_EU    || 'eu-ES-AinhoaNeural',
  he:      process.env.AZURE_SPEECH_TTS_VOICE_HE    || 'he-IL-HilaNeural',
  ar:      process.env.AZURE_SPEECH_TTS_VOICE_AR    || 'ar-EG-SalmaNeural',
}
// Sprachcode → Stimme. Erst exakt (de-CH), dann der Sprachteil (de), sonst Deutsch.
function pickVoice(language) {
  const code = String(language || 'de')
  return TTS_VOICES[code] || TTS_VOICES[code.slice(0, 2)] || TTS_VOICES.de
}

// ── Azure AI Speech (Neural TTS) ──────────────────────────────────
async function speakAzure(text, language) {
  const region = process.env.AZURE_SPEECH_REGION
  const key    = process.env.AZURE_SPEECH_KEY
  if (!region || !key) throw new Error('Azure Speech ist nicht konfiguriert (AZURE_SPEECH_REGION/KEY).')
  const voice = pickVoice(language)
  const rate  = process.env.AZURE_SPEECH_TTS_RATE || '+6%' // Sprechtempo, per Env feinjustierbar
  const lang  = voice.slice(0, 5) || 'de-DE' // z. B. "de-DE" / "pl-PL" / "he-IL"
  const ssml  = `<speak version='1.0' xml:lang='${lang}'><voice name='${voice}'>`
              + `<prosody rate='${rate}'>${xmlEscape(text)}</prosody></voice></speak>`

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
  return { buffer: Buffer.from(await response.arrayBuffer()), model: 'azure-tts-neural' }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  try {
    if (!(await enforce(req, res, { name: 'speak', limit: 30, windowSeconds: 60 }))) return

    const { text, memorialCode, contributionId, language } = req.body
    if (!text) return res.status(400).json({ error: 'text fehlt.' })
    // Emojis aus dem Vorlese-Text entfernen.
    const speechText = stripForSpeech(text)
    if (!speechText) return res.status(400).json({ error: 'kein vorlesbarer Text.' })

    // An einen echten Gedenkbuch-Code gebunden (offener Endpunkt, aber kein
    // anonymer TTS-Proxy auf fremde Rechnung). Prüfung VOR dem Anbieter-Aufruf.
    const code = String(memorialCode || '').toUpperCase().trim()
    if (!code) return res.status(400).json({ error: 'memorialCode fehlt.' })
    if (!(await memorialExists(supabase, code))) {
      return res.status(403).json({ error: 'Ungültiger Code.' })
    }
    // Kosten-Obergrenze je Buch erschöpft → keine Sprachausgabe mehr (402).
    if (!(await enforceBudget(res, code))) return

    let result
    try {
      result = await speakAzure(speechText, language)
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
        memorial_id: code,
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
