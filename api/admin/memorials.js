// api/admin/memorials.js
// GET /api/admin/memorials  →  alle Gedenkbücher (auth required)

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
  try {
    const { data, error } = await supabase
      .from('memorials')
      .select('id, name, birth_year, death_year, organizer, created_at')
      .order('created_at', { ascending: false })
    if (error) throw error
    return res.json(data || [])
  } catch (e) {
    console.error('/api/admin/memorials:', e)
    res.status(500).json({ error: e.message })
  }
}
