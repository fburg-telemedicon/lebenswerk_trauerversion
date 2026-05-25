// api/transcribe.js
// POST /api/transcribe  { audio: base64, mimeType, audioSeconds?, memorialCode?, contributionId? }  →  { text }

const { costSTT, recordCost } = require('./_lib/cost')

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  try {
    const { audio, mimeType, audioSeconds, memorialCode, contributionId } = req.body
    if (!audio) return res.status(400).json({ error: 'audio fehlt.' })

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
    formData.append('model',    model)
    formData.append('language', 'de')

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
      body:    formData,
    })

    const data = await response.json()
    if (!response.ok) throw new Error(data.error?.message || 'Transkription fehlgeschlagen')

    if (memorialCode) {
      const secs = Number.isFinite(parseFloat(audioSeconds)) ? parseFloat(audioSeconds) : 0
      await recordCost({
        memorial_id: String(memorialCode).toUpperCase().trim(),
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
