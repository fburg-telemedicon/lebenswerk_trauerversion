// api/speak.js
// POST /api/speak  { text }  → audio/mpeg binary

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const { text } = req.body
    if (!text) return res.status(400).json({ error: 'text fehlt.' })

    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tts-1-hd',
        input: text,
        voice: 'shimmer',   // warm, empathisch
        speed: 0.95,
      }),
    })

    if (!response.ok) {
      const err = await response.json().catch(() => ({}))
      return res.status(500).json({ error: err.error?.message || 'TTS fehlgeschlagen' })
    }

    const buffer = await response.arrayBuffer()
    res.setHeader('Content-Type', 'audio/mpeg')
    res.setHeader('Cache-Control', 'no-store')
    res.send(Buffer.from(buffer))
  } catch (e) {
    console.error('/api/speak error:', e)
    res.status(500).json({ error: e.message })
  }
}
