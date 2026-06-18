// api/admin/costs.js
// GET /api/admin/costs?code=ABC123 → { events: [...], byKind: { ... }, total_eur, total_usd }

const { createClient } = require('@supabase/supabase-js')
const { checkAuth } = require('../_lib/auth')
const { loadAccessibleMemorial } = require('../_lib/access')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

module.exports = async function handler(req, res) {
  if (!checkAuth(req, res)) return
  if (req.method !== 'GET') return res.status(405).end()
  try {
    const code = (req.query.code || '').toUpperCase().trim()
    if (!code) return res.status(400).json({ error: 'code fehlt.' })

    // Nur Kosten eigener Gedenkbücher (bzw. Admin) lesen.
    const access = await loadAccessibleMemorial(supabase, req.auth, code)
    if (access.error) return res.status(access.status).json({ error: access.error })

    const { data, error } = await supabase
      .from('cost_events')
      .select('*')
      .eq('memorial_id', code)
      .order('created_at', { ascending: true })
    if (error) throw error

    const events = data || []
    const byKind = {}
    let total_eur = 0
    let total_usd = 0
    for (const e of events) {
      const k = e.kind || 'other'
      const eur = Number(e.cost_eur || 0)
      const usd = Number(e.cost_usd || 0)
      if (!byKind[k]) byKind[k] = { count: 0, cost_eur: 0, cost_usd: 0, input_tokens: 0, output_tokens: 0, audio_seconds: 0, characters: 0, images: 0 }
      byKind[k].count          += 1
      byKind[k].cost_eur       += eur
      byKind[k].cost_usd       += usd
      byKind[k].input_tokens   += Number(e.input_tokens  || 0)
      byKind[k].output_tokens  += Number(e.output_tokens || 0)
      byKind[k].audio_seconds  += Number(e.audio_seconds || 0)
      byKind[k].characters     += Number(e.characters    || 0)
      byKind[k].images         += Number(e.images        || 0)
      total_eur += eur
      total_usd += usd
    }

    return res.json({ events, byKind, total_eur, total_usd })
  } catch (e) {
    console.error('/api/admin/costs:', e)
    res.status(500).json({ error: e.message })
  }
}
