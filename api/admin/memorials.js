// api/admin/memorials.js
// GET    /api/admin/memorials              →  alle Gedenkbücher (auth required)
// DELETE /api/admin/memorials?code=ABC123  →  Gedenkbuch + Beiträge löschen (auth required)

const { createClient } = require('@supabase/supabase-js')
const { checkAuth, canAccessCategory } = require('../_lib/auth')
const { isValidCategory, DEFAULT_CATEGORY } = require('../_lib/categories')
const { deleteMemorialCompletely, IMAGE_BUCKET } = require('../_lib/delete-memorial')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

const SIGNED_URL_TTL = 3600 // 1 h

function genCode() {
  return Array.from({ length: 6 }, () =>
    'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]
  ).join('')
}

function collectImagePaths(book) {
  if (!book?.chapters) return []
  return book.chapters.map(c => c?.image_path).filter(Boolean)
}

function applySignedUrls(book, urlMap) {
  if (!book?.chapters) return
  for (const ch of book.chapters) {
    if (!ch?.image_path) continue
    const key = String(ch.image_path).replace(/^\/+/, '')
    if (urlMap[key]) ch.image_url = urlMap[key]
  }
}

async function signMemorialImages(memorials) {
  const paths = new Set()
  for (const m of memorials) {
    collectImagePaths(m.book_v1).forEach(p => paths.add(p))
    collectImagePaths(m.book_v2).forEach(p => paths.add(p))
  }
  if (paths.size === 0) return
  const pathList = [...paths]
  const { data, error } = await supabase.storage.from(IMAGE_BUCKET).createSignedUrls(pathList, SIGNED_URL_TTL)
  if (error) {
    console.error('createSignedUrls error:', error)
    return
  }
  if (!Array.isArray(data)) {
    console.error('createSignedUrls returned no array:', data)
    return
  }
  const urlMap = {}
  for (const entry of data) {
    if (entry?.error) {
      console.error('Signed-URL Eintrag mit Fehler:', entry.path, entry.error)
      continue
    }
    if (entry?.path && entry?.signedUrl) {
      const key = String(entry.path).replace(/^\/+/, '')
      urlMap[key] = entry.signedUrl
    }
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
      let query = supabase
        .from('memorials')
        .select('id, name, organizer, gender, book_variant, book_v1, book_v2, eulogy_text, funeral_date, cutoff_days, show_intro_video, product_category, owner_group, intake, created_at')
        .order('created_at', { ascending: false })

      // Nicht-Admins sehen nur Bücher ihrer Gruppe und nur erlaubte Kategorien.
      if (!req.auth.admin) {
        const cats = Array.isArray(req.auth.cats) ? req.auth.cats : []
        if (!req.auth.group || cats.length === 0) return res.json([])
        query = query.eq('owner_group', req.auth.group).in('product_category', cats)
      }

      const { data, error } = await query
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

      // Beiträge und Antworten (User-Nachrichten) pro Memorial aggregieren
      const { data: contribRows } = await supabase.from('contributions').select('memorial_id, messages')
      const contribCounts = {}
      const answerCounts  = {}
      for (const r of contribRows || []) {
        contribCounts[r.memorial_id] = (contribCounts[r.memorial_id] || 0) + 1
        const answers = Array.isArray(r.messages) ? r.messages.filter(msg => msg?.role === 'user').length : 0
        answerCounts[r.memorial_id] = (answerCounts[r.memorial_id] || 0) + answers
      }
      for (const m of memorials) {
        m.contribution_count = contribCounts[m.id] || 0
        m.answer_count       = answerCounts[m.id] || 0
      }

      return res.json(memorials)
    }

    if (req.method === 'POST') {
      const { name, organizer, gender, bookVariant, funeralDate, cutoffDays, showIntroVideo, productCategory, intake } = req.body || {}
      if (!name || !organizer) return res.status(400).json({ error: 'Name und Organisator sind Pflichtfelder.' })

      const category = isValidCategory(productCategory) ? productCategory : DEFAULT_CATEGORY
      if (!canAccessCategory(req.auth, category)) {
        return res.status(403).json({ error: 'Keine Berechtigung für diese Produktkategorie.' })
      }

      const code = genCode()
      const variant = (bookVariant === 2 || bookVariant === '2') ? 2 : 1
      let days = parseInt(cutoffDays, 10)
      if (!Number.isFinite(days) || days < 0) days = 7
      const { error } = await supabase.from('memorials').insert({
        id: code, name, organizer, gender: gender || null, book_variant: variant,
        funeral_date: funeralDate || null,
        cutoff_days: days,
        show_intro_video: showIntroVideo !== false,
        product_category: category,
        owner_group: req.auth.admin ? null : (req.auth.group || null),
        intake: intake && typeof intake === 'object' ? intake : null,
      })
      if (error) throw error
      return res.json({ code })
    }

    if (req.method === 'DELETE') {
      const code = (req.query.code || '').toUpperCase().trim()
      if (!code) return res.status(400).json({ error: 'code fehlt.' })

      const storageWarnings = await deleteMemorialCompletely(supabase, code)
      return res.json({ ok: true, ...(storageWarnings.length ? { storageWarnings } : {}) })
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
