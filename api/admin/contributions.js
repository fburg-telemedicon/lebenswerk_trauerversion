// api/admin/contributions.js
// GET /api/admin/contributions?code=XXX  →  alle Beiträge (auth required)

const { createClient } = require('@supabase/supabase-js')

const supabase    = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'lebenswerk-admin-secret'

function checkAuth(req, res) {
  const token = (req.headers.authorization || '').replace('Bearer ', '')
  if (token !== ADMIN_TOKEN) { res.status(401).json({ error: 'Nicht autorisiert.' }); return false }
  return true
}

module.exports = async function handler(req, res) {
  if (!checkAuth(req, res)) return
  if (req.method !== 'GET') return res.status(405).end()
  const code = (req.query.code || '').toUpperCase().trim()
  if (!code) return res.status(400).json({ error: 'code fehlt.' })
  try {
    const { data, error } = await supabase
      .from('contributions')
      .select('*')
      .eq('memorial_id', code)
      .order('created_at', { ascending: true })
    if (error) throw error
    return res.json(data || [])
  } catch (e) {
    console.error('/api/admin/contributions:', e)
    res.status(500).json({ error: e.message })
  }
}
