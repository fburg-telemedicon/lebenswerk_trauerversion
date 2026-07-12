// api/admin/feedback.js
// GET /api/admin/feedback  → Beitragenden-Bewertungen (Qualitätsmanagement).
// Auth erforderlich. Liefert nur Bewertungen aus Gedenkbüchern, auf die der/die
// angemeldete Benutzer:in Zugriff hat (Admin = alle; sonst eigene + erlaubte
// Kategorien) – inkl. Zeitpunkt, Name des/der Beitragenden und Buchprojekt.

const { createClient } = require('../_lib/store')
const { checkAuth } = require('../_lib/auth')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

// Prüft, ob der/die eingeloggte Benutzer:in auf die Bewertung (Contribution)
// zugreifen darf: Admin = alles; sonst nur eigene Bücher der erlaubten Kategorien.
// Liefert bei Erfolg die contribution_id + memorial_id, sonst null.
async function accessibleContribution(req, id) {
  const { data: c } = await supabase
    .from('contributions').select('id, memorial_id').eq('id', id).maybeSingle()
  if (!c) return null
  if (req.auth.admin) return c
  const cats = Array.isArray(req.auth.cats) ? req.auth.cats : []
  if (!req.auth.uid || cats.length === 0) return null
  const { data: m } = await supabase
    .from('memorials').select('id').eq('id', c.memorial_id)
    .eq('owner_user', req.auth.uid).in('product_category', cats).maybeSingle()
  return m ? c : null
}

module.exports = async function handler(req, res) {
  if (!checkAuth(req, res)) return

  // Erledigt-Status setzen bzw. Bewertung löschen (per Contribution-id).
  if (req.method === 'PATCH' || req.method === 'DELETE') {
    try {
      const id = (req.query.id || '').trim()
      if (!id) return res.status(400).json({ error: 'id fehlt.' })
      const c = await accessibleContribution(req, id)
      if (!c) return res.status(404).json({ error: 'Bewertung nicht gefunden oder kein Zugriff.' })
      if (req.method === 'DELETE') {
        // Nur die Bewertung entfernen – die Contribution selbst bleibt bestehen.
        const { error } = await supabase.from('contributions')
          .update({ feedback_rating: null, feedback_text: null, feedback_at: null, feedback_done: false })
          .eq('id', id)
        if (error) throw error
        return res.json({ ok: true })
      }
      const done = req.body && req.body.done === true
      const { error } = await supabase.from('contributions').update({ feedback_done: done }).eq('id', id)
      if (error) throw error
      return res.json({ ok: true, done })
    } catch (e) {
      console.error('/api/admin/feedback mutate:', e)
      return res.status(500).json({ error: e.message })
    }
  }

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
    const memOwner = {}
    const ids = []
    const ownerIds = new Set()
    for (const m of mems || []) {
      memName[m.id] = m.name
      memOwner[m.id] = m.owner_user || null
      if (m.owner_user) ownerIds.add(m.owner_user)
      ids.push(m.id)
    }
    if (ids.length === 0) return res.json([])

    // Manager-Namen (app_users) zu den Besitzer:innen der Bücher auflösen.
    const ownerName = {}
    if (ownerIds.size > 0) {
      const { data: users } = await supabase
        .from('app_users').select('id, username').in('id', [...ownerIds])
      for (const u of users || []) ownerName[u.id] = u.username
    }

    const { data: rows, error } = await supabase
      .from('contributions')
      .select('id, memorial_id, contributor_name, relationship, feedback_rating, feedback_text, feedback_at, feedback_done')
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
      owner_username: ownerName[memOwner[r.memorial_id]] || (memOwner[r.memorial_id] ? '—' : 'Admin'),
      contributor_name: r.contributor_name,
      relationship: r.relationship,
      rating: r.feedback_rating,
      text: r.feedback_text,
      at: r.feedback_at,
      done: r.feedback_done === true,
    }))
    return res.json(out)
  } catch (e) {
    console.error('/api/admin/feedback:', e)
    res.status(500).json({ error: e.message })
  }
}
