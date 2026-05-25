// api/admin/memorials.js
// GET    /api/admin/memorials              →  alle Gedenkbücher (auth required)
// DELETE /api/admin/memorials?code=ABC123  →  Gedenkbuch + Beiträge löschen (auth required)

const { createClient } = require('@supabase/supabase-js')

const supabase    = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'lebenswerk-admin-secret'

const IMAGE_BUCKET   = 'memorial-images'
const SIGNED_URL_TTL = 3600 // 1 h

function checkAuth(req, res) {
  const token = (req.headers.authorization || '').replace('Bearer ', '')
  if (token !== ADMIN_TOKEN) { res.status(401).json({ error: 'Nicht autorisiert.' }); return false }
  return true
}

function collectImagePaths(book) {
  if (!book?.chapters) return []
  return book.chapters.map(c => c?.image_path).filter(Boolean)
}

function applySignedUrls(book, urlMap) {
  if (!book?.chapters) return
  for (const ch of book.chapters) {
    if (ch?.image_path && urlMap[ch.image_path]) ch.image_url = urlMap[ch.image_path]
  }
}

async function signMemorialImages(memorials) {
  const paths = new Set()
  for (const m of memorials) {
    collectImagePaths(m.book_v1).forEach(p => paths.add(p))
    collectImagePaths(m.book_v2).forEach(p => paths.add(p))
  }
  if (paths.size === 0) return
  const { data, error } = await supabase.storage.from(IMAGE_BUCKET).createSignedUrls([...paths], SIGNED_URL_TTL)
  if (error || !Array.isArray(data)) return
  const urlMap = {}
  for (const entry of data) {
    if (entry?.path && entry?.signedUrl) urlMap[entry.path] = entry.signedUrl
  }
  for (const m of memorials) {
    applySignedUrls(m.book_v1, urlMap)
    applySignedUrls(m.book_v2, urlMap)
  }
}

module.exports = async function handler(req, res) {
  if (!checkAuth(req, res)) return
  try {
    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('memorials')
        .select('id, name, organizer, gender, book_variant, book_v1, book_v2, eulogy_text, funeral_date, created_at')
        .order('created_at', { ascending: false })
      if (error) throw error
      const memorials = data || []
      await signMemorialImages(memorials)

      // Gesamtkosten pro Memorial aggregieren
      const { data: costRows } = await supabase.from('cost_events').select('memorial_id, cost_eur, cost_usd')
      const totalsEur = {}
      const totalsUsd = {}
      for (const r of costRows || []) {
        totalsEur[r.memorial_id] = (totalsEur[r.memorial_id] || 0) + Number(r.cost_eur || 0)
        totalsUsd[r.memorial_id] = (totalsUsd[r.memorial_id] || 0) + Number(r.cost_usd || 0)
      }
      for (const m of memorials) {
        m.cost_total_eur = totalsEur[m.id] || 0
        m.cost_total_usd = totalsUsd[m.id] || 0
      }

      return res.json(memorials)
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
      const allowedFields = new Set(['book_v1', 'book_v2', 'eulogy_text'])
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
