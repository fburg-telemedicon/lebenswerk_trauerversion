// api/admin/feedback.js
// GET /api/admin/feedback  → Beitragenden-Bewertungen (Qualitätsmanagement).
// Auth erforderlich. Liefert nur Bewertungen aus Gedenkbüchern, auf die der/die
// angemeldete Benutzer:in Zugriff hat (Admin = alle; sonst eigene + erlaubte
// Kategorien) – inkl. Zeitpunkt, Name des/der Beitragenden und Buchprojekt.

const { createClient } = require('@supabase/supabase-js')
const { checkAuth } = require('../_lib/auth')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

module.exports = async function handler(req, res) {
  if (!checkAuth(req, res)) return
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  try {
    // Zugängliche Gedenkbücher bestimmen (wie in admin/memorials GET).
    let memQuery = supabase.from('memorials').select('id, name, product_category, owner_user')
    if (!req.auth.admin) {
      const cats = Array.isArray(req.auth.cats) ? req.auth.cats : []
      if (!req.auth.uid || cats.length === 0) return res.json([])
      memQuery = memQuery.eq('owner_user', req.auth.uid).in('product_category', cats)
    }
    const { data: mems, error: mErr } = await memQuery
    if (mErr) throw mErr
    const memName = {}
    const ids = []
    for (const m of mems || []) { memName[m.id] = m.name; ids.push(m.id) }
    if (ids.length === 0) return res.json([])

    const { data: rows, error } = await supabase
      .from('contributions')
      .select('id, memorial_id, contributor_name, relationship, feedback_rating, feedback_text, feedback_at')
      .in('memorial_id', ids)
      .not('feedback_at', 'is', null)
      .order('feedback_at', { ascending: false })
      .limit(1000)
    if (error) {
      // Spalten evtl. noch nicht migriert (supabase/feedback.sql) → leere Liste.
      if (/feedback_|column/i.test(error.message || '')) return res.json([])
      throw error
    }
    const out = (rows || []).map(r => ({
      id: r.id,
      memorial_id: r.memorial_id,
      memorial_name: memName[r.memorial_id] || r.memorial_id,
      contributor_name: r.contributor_name,
      relationship: r.relationship,
      rating: r.feedback_rating,
      text: r.feedback_text,
      at: r.feedback_at,
    }))
    return res.json(out)
  } catch (e) {
    console.error('/api/admin/feedback:', e)
    res.status(500).json({ error: e.message })
  }
}
