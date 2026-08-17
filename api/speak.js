// api/speak.js
// POST /api/speak  { text, memorialCode?, contributionId? }  → audio/mpeg
//
// Einziges TTS ist Azure AI Speech (deutsche Neural-Stimmen, EU-Region) –
// KEIN Fallback. Der frühere OpenAI-TTS-Fallback (SPEECH_PROVIDER) wurde am
// 2026-06-22 entfernt (nicht von der Datenschutzerklärung gedeckt: US-Transfer).
//
// Die Stimmen-/Sprachwahl und der Azure-Aufruf selbst liegen seit dem Hörbuch-
// Export in `api/_lib/tts.js` — dieselbe Logik braucht auch der Generierungs-
// Worker. Hier bleibt nur der HTTP-Endpunkt (Rate-Limit, Code-Prüfung, Budget,
// Kostenbuchung).
//
// Nötige Env:
//   AZURE_SPEECH_KEY, AZURE_SPEECH_REGION (z. B. westeurope)
//   AZURE_SPEECH_TTS_VOICE  optional (Default siehe _lib/ttsvoices.js)

const { createClient } = require('./_lib/store')
const { costTTS, recordCost, enforceBudget } = require('./_lib/cost')
const { resolvePublicCode } = require('./_lib/access')
const { enforce } = require('./_lib/ratelimit')
const { stripForSpeech, speakAzure } = require('./_lib/tts')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

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
