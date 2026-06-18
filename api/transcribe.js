// api/transcribe.js
// POST /api/transcribe  { audio: base64, mimeType, audioSeconds?, memorialCode?, contributionId? }  →  { text }

const { createClient } = require('@supabase/supabase-js')
const { costSTT, recordCost } = require('./_lib/cost')
const { memorialExists } = require('./_lib/access')
const { enforce } = require('./_lib/ratelimit')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  try {
    if (!(await enforce(req, res, { name: 'transcribe', limit: 30, windowSeconds: 60 }))) return

    const { audio, mimeType, audioSeconds, memorialCode, contributionId, language } = req.body
    if (!audio) return res.status(400).json({ error: 'audio fehlt.' })

    // An einen echten Gedenkbuch-Code gebunden (offener Endpunkt, aber kein
    // anonymer Whisper-Proxy auf fremde Rechnung). Prüfung VOR dem OpenAI-Aufruf.
    const code = String(memorialCode || '').toUpperCase().trim()
    if (!code) return res.status(400).json({ error: 'memorialCode fehlt.' })
    if (!(await memorialExists(supabase, code))) {
      return res.status(403).json({ error: 'Ungültiger Code.' })
    }

    const buffer = Buffer.from(audio, 'base64')
    const ext    = mimeType?.includes('ogg') ? 'ogg'
                 : mimeType?.includes('mp4') ? 'mp4'
                 : 'webm'

    const model = 'whisper-1'
    const formData = new FormData()
    formData.append(
      'file',
      new Blob([buffer], { type: mimeType || 'audio/webm' }),
      `audio.${ext}`
    )
    formData.append('model', model)
    // Sprache der Aufnahme an Whisper geben (vom Beitragenden gewählt). Nur
    // unterstützte Codes setzen; sonst Auto-Erkennung durch Whisper.
    const sttLang = ['de', 'pl', 'en'].includes(language) ? language : null
    if (sttLang) formData.append('language', sttLang)

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
      body:    formData,
    })

    const data = await response.json()
    if (!response.ok) throw new Error(data.error?.message || 'Transkription fehlgeschlagen')

    {
      const secs = Number.isFinite(parseFloat(audioSeconds)) ? parseFloat(audioSeconds) : 0
      await recordCost({
        memorial_id: code,
        contribution_id: contributionId || null,
        kind: 'stt',
        provider: 'openai',
        model,
        audio_seconds: secs,
        cost_usd: costSTT(model, secs),
      })
    }

    return res.json({ text: data.text || '' })
  } catch (e) {
    console.error('/api/transcribe error:', e)
    res.status(500).json({ error: e.message })
  }
}
