// api/contributions.js
// GET  /api/contributions?code=ABC123  → array of contributions
// POST /api/contributions              → add contribution

const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

function genCode() {
  return Array.from({ length: 6 }, () =>
    'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]
  ).join('')
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()

  try {
    if (req.method === 'GET') {
      const code = (req.query.code || '').toUpperCase().trim()
      if (!code) return res.status(400).json({ error: 'Code fehlt.' })

      const { data, error } = await supabase
        .from('contributions')
        .select('*')
        .eq('memorial_id', code)
        .order('created_at', { ascending: true })
      if (error) throw error
      return res.json(data || [])
    }

    if (req.method === 'POST') {
      const { memorialCode, contributorName, relationship, messages } = req.body
      if (!memorialCode || !contributorName || !relationship || !messages) {
        return res.status(400).json({ error: 'Pflichtfelder fehlen.' })
      }
      const id = genCode()
      const { error } = await supabase.from('contributions').insert({
        id,
        memorial_id: memorialCode.toUpperCase(),
        contributor_name: contributorName,
        relationship,
        messages,
      })
      if (error) throw error
      return res.json({ id })
    }

    res.status(405).json({ error: 'Method not allowed' })
  } catch (e) {
    console.error('/api/contributions error:', e)
    res.status(500).json({ error: e.message })
  }
}
