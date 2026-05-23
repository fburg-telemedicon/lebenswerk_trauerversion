// api/ask.js
// POST /api/ask  { system, messages }  → { text }

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const { system, messages } = req.body
    if (!messages) return res.status(400).json({ error: 'messages fehlt.' })

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 1000,
        system: system || '',
        messages,
      }),
    })

    const data = await response.json()
    if (data.error) return res.status(500).json({ error: data.error.message })
    return res.json({ text: data.content?.[0]?.text || '' })
  } catch (e) {
    console.error('/api/ask error:', e)
    res.status(500).json({ error: e.message })
  }
}
