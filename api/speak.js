// api/speak.js
// POST /api/speak  { text, memorialCode?, contributionId? }  → audio/mpeg  (OpenAI TTS)

const { createClient } = require('@supabase/supabase-js')
const { costTTS, recordCost } = require('./_lib/cost')
const { memorialExists } = require('./_lib/access')
const { enforce } = require('./_lib/ratelimit')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  try {
    if (!(await enforce(req, res, { name: 'speak', limit: 30, windowSeconds: 60 }))) return

    const { text, memorialCode, contributionId } = req.body
    if (!text) return res.status(400).json({ error: 'text fehlt.' })

    // An einen echten Gedenkbuch-Code gebunden (offener Endpunkt, aber kein
    // anonymer TTS-Proxy auf fremde Rechnung). Prüfung VOR dem OpenAI-Aufruf.
    const code = String(memorialCode || '').toUpperCase().trim()
    if (!code) return res.status(400).json({ error: 'memorialCode fehlt.' })
    if (!(await memorialExists(supabase, code))) {
      return res.status(403).json({ error: 'Ungültiger Code.' })
    }

    const model = 'tts-1-hd'
    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input: text,
        voice: 'shimmer',
        speed: 0.95,
      }),
    })

    if (!response.ok) {
      const err = await response.json().catch(() => ({}))
      return res.status(500).json({ error: err.error?.message || `HTTP ${response.status}` })
    }

    const buffer = await response.arrayBuffer()
    res.setHeader('Content-Type', 'audio/mpeg')
    res.setHeader('Cache-Control', 'no-store')
    res.send(Buffer.from(buffer))

    {
      const chars = String(text).length
      await recordCost({
        memorial_id: code,
        contribution_id: contributionId || null,
        kind: 'tts',
        provider: 'openai',
        model,
        characters: chars,
        cost_usd: costTTS(model, chars),
      })
    }
  } catch (e) {
    console.error('/api/speak error:', e)
    res.status(500).json({ error: e.message })
  }
}
