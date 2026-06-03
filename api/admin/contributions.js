// api/admin/contributions.js
// GET    /api/admin/contributions?code=XXX  →  alle Beiträge (auth required)
// PATCH  /api/admin/contributions?id=YYY    →  messages eines Beitrags ersetzen (auth required)
// DELETE /api/admin/contributions?id=YYY    →  einen Beitrag löschen (auth required)

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
  try {
    if (req.method === 'GET') {
      const code = (req.query.code || '').toUpperCase().trim()
      if (!code) return res.status(400).json({ error: 'code fehlt.' })
      const { data, error } = await supabase
        .from('contributions')
        .select('*')
        .eq('memorial_id', code)
        .order('created_at', { ascending: true })
      if (error) throw error
      return res.json(data || [])
    }

    if (req.method === 'PATCH') {
      const id = (req.query.id || '').trim()
      if (!id) return res.status(400).json({ error: 'id fehlt.' })
      const { messages } = req.body || {}
      if (!Array.isArray(messages)) return res.status(400).json({ error: 'messages muss ein Array sein.' })
      const { data, error } = await supabase
        .from('contributions')
        .update({ messages })
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      return res.json(data)
    }

    if (req.method === 'DELETE') {
      const id = (req.query.id || '').trim()
      if (!id) return res.status(400).json({ error: 'id fehlt.' })
      const { error } = await supabase.from('contributions').delete().eq('id', id)
      if (error) throw error
      return res.json({ ok: true })
    }

    return res.status(405).end()
  } catch (e) {
    console.error('/api/admin/contributions:', e)
    res.status(500).json({ error: e.message })
  }
}
