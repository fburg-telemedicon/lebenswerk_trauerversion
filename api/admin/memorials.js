// api/admin/memorials.js
// GET    /api/admin/memorials              →  alle Gedenkbücher (auth required)
// DELETE /api/admin/memorials?code=ABC123  →  Gedenkbuch + Beiträge löschen (auth required)

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
      const { data, error } = await supabase
        .from('memorials')
        .select('id, name, organizer, gender, book_variant, book_v1_text, book_v2_text, eulogy_text, funeral_date, created_at')
        .order('created_at', { ascending: false })
      if (error) throw error
      return res.json(data || [])
    }

    if (req.method === 'DELETE') {
      const code = (req.query.code || '').toUpperCase().trim()
      if (!code) return res.status(400).json({ error: 'code fehlt.' })

      const { error: cErr } = await supabase.from('contributions').delete().eq('memorial_id', code)
      if (cErr) throw cErr
      const { error: mErr } = await supabase.from('memorials').delete().eq('id', code)
      if (mErr) throw mErr
      return res.json({ ok: true })
    }

    if (req.method === 'PATCH') {
      const code = (req.query.code || '').toUpperCase().trim()
      if (!code) return res.status(400).json({ error: 'code fehlt.' })
      const { field, text } = req.body || {}
      const allowedFields = new Set(['book_v1_text', 'book_v2_text', 'eulogy_text'])
      if (!allowedFields.has(field)) {
        return res.status(400).json({ error: 'Ungültiges Feld.' })
      }
      const { error } = await supabase.from('memorials').update({ [field]: text ?? null }).eq('id', code)
      if (error) throw error
      return res.json({ ok: true })
    }

    return res.status(405).end()
  } catch (e) {
    console.error('/api/admin/memorials:', e)
    res.status(500).json({ error: e.message })
  }
}
