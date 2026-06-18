// api/ask.js
// POST /api/ask  { system, messages, memorialCode?, kind? }  → { text }

const { createClient } = require('@supabase/supabase-js')
const { costClaude, recordCost } = require('./_lib/cost')
const { memorialExists } = require('./_lib/access')
const { enforce } = require('./_lib/ratelimit')
const { verifyToken } = require('./_lib/auth')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    // Eingeloggte BENUTZER (gültiger Bearer-Token – Superadmin ODER app_user,
    // nicht nur Admins) sind von der IP-Drossel ausgenommen: die Buch-
    // generierung macht legitim viele Calls in Folge. Maßgeblich ist allein
    // ein gültiger Token, nicht das Admin-Flag. Anonyme Beitragende bleiben
    // auf 20/min begrenzt.
    const isLoggedIn = !!verifyToken((req.headers.authorization || '').replace('Bearer ', '').trim())
    if (!isLoggedIn && !(await enforce(req, res, { name: 'ask', limit: 20, windowSeconds: 60 }))) return

    const { system, messages, memorialCode, kind, contributionId } = req.body
    if (!messages) return res.status(400).json({ error: 'messages fehlt.' })

    // Offener Endpunkt (kein Login im Beitragenden-Flow), aber an einen echten
    // Gedenkbuch-Code gebunden – damit kein anonymer Claude-Proxy auf fremde
    // Rechnung. Prüfung VOR dem (kostenpflichtigen) Claude-Aufruf.
    const code = String(memorialCode || '').toUpperCase().trim()
    if (!code) return res.status(400).json({ error: 'memorialCode fehlt.' })
    if (!(await memorialExists(supabase, code))) {
      return res.status(403).json({ error: 'Ungültiger Code.' })
    }

    const model = 'claude-sonnet-4-5'
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 8000,
        system: system || '',
        messages,
      }),
    })

    const data = await response.json()
    if (data.error) return res.status(500).json({ error: data.error.message })
    const text = data.content?.[0]?.text || ''

    if (data.usage) {
      const inT  = data.usage.input_tokens  || 0
      const outT = data.usage.output_tokens || 0
      await recordCost({
        memorial_id: code,
        contribution_id: contributionId || null,
        kind: kind || 'reasoning',
        provider: 'anthropic',
        model,
        input_tokens: inT,
        output_tokens: outT,
        cost_usd: costClaude(model, inT, outT),
      })
    }

    return res.json({ text })
  } catch (e) {
    console.error('/api/ask error:', e)
    res.status(500).json({ error: e.message })
  }
}
