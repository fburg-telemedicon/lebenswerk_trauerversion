// api/transcribe.js
// POST /api/transcribe  { audio: base64, mimeType, audioSeconds?, memorialCode?, contributionId?, language? }  →  { text }
//
// STT-Anbieter umschaltbar (DSGVO/EU-Migration):
//   SPEECH_PROVIDER = 'openai' (Default) | 'azure'
// Azure nutzt Azure AI Speech „Fast Transcription" (EU-Region, höhere Kapazität
// als das whisper-Modell-Deployment). Nötige Env für den azure-Pfad:
//   AZURE_SPEECH_KEY, AZURE_SPEECH_REGION (z. B. westeurope)
//   AZURE_SPEECH_ENDPOINT  optional (sonst aus Region gebildet)

const { createClient } = require('@supabase/supabase-js')
const { costSTT, recordCost } = require('./_lib/cost')
const { memorialExists } = require('./_lib/access')
const { enforce } = require('./_lib/ratelimit')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

const PROVIDER = (process.env.SPEECH_PROVIDER || 'openai').toLowerCase()
const LOCALE = { de: 'de-DE', en: 'en-US', pl: 'pl-PL' }

// ── OpenAI Whisper ────────────────────────────────────────────────
async function transcribeOpenAI({ buffer, mimeType, ext, language }) {
  const model = 'whisper-1'
  const formData = new FormData()
  formData.append('file', new Blob([buffer], { type: mimeType || 'audio/webm' }), `audio.${ext}`)
  formData.append('model', model)
  const sttLang = ['de', 'pl', 'en'].includes(language) ? language : null
  if (sttLang) formData.append('language', sttLang)

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: formData,
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error?.message || 'Transkription fehlgeschlagen')
  return { text: data.text || '', provider: 'openai', model }
}

// ── Azure AI Speech (Fast Transcription) ──────────────────────────
async function transcribeAzure({ buffer, mimeType, ext, language }) {
  const region = process.env.AZURE_SPEECH_REGION
  const key    = process.env.AZURE_SPEECH_KEY
  if (!region || !key) throw new Error('Azure Speech ist nicht konfiguriert (AZURE_SPEECH_REGION/KEY).')
  const base = (process.env.AZURE_SPEECH_ENDPOINT || `https://${region}.api.cognitive.microsoft.com`).replace(/\/+$/, '')
  const url  = `${base}/speechtotext/transcriptions:transcribe?api-version=2025-10-15`

  const locales = LOCALE[language] ? [LOCALE[language]] : [] // [] = automatische Spracherkennung
  const form = new FormData()
  form.append('audio', new Blob([buffer], { type: mimeType || 'audio/webm' }), `audio.${ext}`)
  form.append('definition', JSON.stringify({ locales }))

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Ocp-Apim-Subscription-Key': key },
    body: form,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error?.message || data.message || `Azure STT HTTP ${response.status}`)
  const text = (data.combinedPhrases || []).map(p => p.text).join(' ').trim()
  return { text, provider: 'azure', model: 'azure-stt' }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  try {
    if (!(await enforce(req, res, { name: 'transcribe', limit: 30, windowSeconds: 60 }))) return

    const { audio, mimeType, audioSeconds, memorialCode, contributionId, language } = req.body
    if (!audio) return res.status(400).json({ error: 'audio fehlt.' })

    // An einen echten Gedenkbuch-Code gebunden (offener Endpunkt, aber kein
    // anonymer STT-Proxy auf fremde Rechnung). Prüfung VOR dem Anbieter-Aufruf.
    const code = String(memorialCode || '').toUpperCase().trim()
    if (!code) return res.status(400).json({ error: 'memorialCode fehlt.' })
    if (!(await memorialExists(supabase, code))) {
      return res.status(403).json({ error: 'Ungültiger Code.' })
    }

    const buffer = Buffer.from(audio, 'base64')
    const ext    = mimeType?.includes('ogg') ? 'ogg'
                 : mimeType?.includes('mp4') ? 'mp4'
                 : 'webm'

    const result = PROVIDER === 'azure'
      ? await transcribeAzure({ buffer, mimeType, ext, language })
      : await transcribeOpenAI({ buffer, mimeType, ext, language })

    {
      const secs = Number.isFinite(parseFloat(audioSeconds)) ? parseFloat(audioSeconds) : 0
      await recordCost({
        memorial_id: code,
        contribution_id: contributionId || null,
        kind: 'stt',
        provider: result.provider,
        model: result.model,
        audio_seconds: secs,
        cost_usd: costSTT(result.model, secs),
      })
    }

    return res.json({ text: result.text })
  } catch (e) {
    console.error('/api/transcribe error:', e)
    res.status(500).json({ error: e.message })
  }
}
