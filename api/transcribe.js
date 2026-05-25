// api/transcribe.js
// POST /api/transcribe  { audio: base64, mimeType }  →  { text }

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  try {
    const { audio, mimeType } = req.body
    if (!audio) return res.status(400).json({ error: 'audio fehlt.' })

    const buffer = Buffer.from(audio, 'base64')
    const ext    = mimeType?.includes('ogg') ? 'ogg'
                 : mimeType?.includes('mp4') ? 'mp4'
                 : 'webm'

    const formData = new FormData()
    formData.append(
      'file',
      new Blob([buffer], { type: mimeType || 'audio/webm' }),
      `audio.${ext}`
    )
    formData.append('model',    'whisper-1')
    formData.append('language', 'de')

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
      body:    formData,
    })

    const data = await response.json()
    if (!response.ok) throw new Error(data.error?.message || 'Transkription fehlgeschlagen')
    return res.json({ text: data.text || '' })
  } catch (e) {
    console.error('/api/transcribe error:', e)
    res.status(500).json({ error: e.message })
  }
}
