// api/admin/memorials.js
// GET    /api/admin/memorials              →  alle Gedenkbücher (auth required)
// DELETE /api/admin/memorials?code=ABC123  →  Gedenkbuch + Beiträge löschen (auth required)

const { createClient } = require('@supabase/supabase-js')
const { checkAuth, canAccessCategory } = require('../_lib/auth')
const { loadAccessibleMemorial } = require('../_lib/access')
const { audit } = require('../_lib/audit')
const { isValidCategory, DEFAULT_CATEGORY } = require('../_lib/categories')
const { deleteMemorialCompletely, IMAGE_BUCKET } = require('../_lib/delete-memorial')
const { genCode } = require('../_lib/codes')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

const SIGNED_URL_TTL = 3600 // 1 h

// Optionale Sammelbestellungs-/Abholadresse säubern. Nur bekannte Felder,
// getrimmt, max. Länge je Feld. Sind alle Felder leer -> null (Adresse ist
// optional). Land standardmäßig "Deutschland", falls leer aber sonst befüllt.
function sanitizePickupAddress(addr) {
  if (!addr || typeof addr !== 'object') return null
  const clean = {}
  for (const key of ['name', 'addon', 'street', 'zip', 'city', 'country']) {
    const v = typeof addr[key] === 'string' ? addr[key].trim().slice(0, 200) : ''
    clean[key] = v
  }
  const hasAny = ['name', 'addon', 'street', 'zip', 'city'].some(k => clean[k])
  if (!hasAny) return null
  if (!clean.country) clean.country = 'Deutschland'
  return clean
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
        .select('id, name, organizer, gender, book_variant, book_v1, book_v2, eulogy_text, funeral_date, cutoff_days, show_intro_video, product_category, owner_user, intake, languages, note, pickup_address, content_reports, purge_info, created_at')
        .order('created_at', { ascending: false })

      // Nicht-Admins sehen nur ihre eigenen Bücher und nur erlaubte Kategorien.
      if (!req.auth.admin) {
        const cats = Array.isArray(req.auth.cats) ? req.auth.cats : []
        if (!req.auth.uid || cats.length === 0) return res.json([])
        query = query.eq('owner_user', req.auth.uid).in('product_category', cats)
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
      const { name, organizer, gender, bookVariant, funeralDate, cutoffDays, showIntroVideo, productCategory, intake, languages, note, pickupAddress } = req.body || {}
      if (!name || !organizer) return res.status(400).json({ error: 'Name und Organisator sind Pflichtfelder.' })

      const category = isValidCategory(productCategory) ? productCategory : DEFAULT_CATEGORY
      if (!canAccessCategory(req.auth, category)) {
        return res.status(403).json({ error: 'Keine Berechtigung für diese Produktkategorie.' })
      }

      const ALLOWED_LANGS = ['de', 'pl', 'en']
      let langs = Array.isArray(languages) ? [...new Set(languages.filter(l => ALLOWED_LANGS.includes(l)))] : []
      if (langs.length === 0) langs = ['de']

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
        owner_user: req.auth.admin ? null : (req.auth.uid || null),
        intake: intake && typeof intake === 'object' ? intake : null,
        languages: langs,
        note: (typeof note === 'string' && note.trim()) ? note.trim() : null,
        pickup_address: sanitizePickupAddress(pickupAddress),
      })
      if (error) throw error
      await audit(req, { actor: req.auth, action: 'memorial.create', target: code, detail: { category } })
      return res.json({ code })
    }

    if (req.method === 'DELETE') {
      const code = (req.query.code || '').toUpperCase().trim()
      if (!code) return res.status(400).json({ error: 'code fehlt.' })

      // Nur Eigentümer (bzw. Admin) dürfen löschen.
      const access = await loadAccessibleMemorial(supabase, req.auth, code)
      if (access.error) return res.status(access.status).json({ error: access.error })

      const storageWarnings = await deleteMemorialCompletely(supabase, code)
      await audit(req, { actor: req.auth, action: 'memorial.delete', target: code })
      return res.json({ ok: true, ...(storageWarnings.length ? { storageWarnings } : {}) })
    }

    if (req.method === 'PATCH') {
      const code = (req.query.code || '').toUpperCase().trim()
      if (!code) return res.status(400).json({ error: 'code fehlt.' })

      // Nur Eigentümer (bzw. Admin) dürfen Buch/Trauerrede überschreiben.
      const access = await loadAccessibleMemorial(supabase, req.auth, code)
      if (access.error) return res.status(access.status).json({ error: access.error })

      const { field, text, meta } = req.body || {}

      // Auftragsdaten (Stammdaten des Buchs) bearbeiten. Nur die mitgesendeten
      // Felder werden aktualisiert; Validierung/Normalisierung wie bei POST.
      if (meta && typeof meta === 'object') {
        if (meta.name != null && !String(meta.name).trim()) return res.status(400).json({ error: 'Name darf nicht leer sein.' })
        if (meta.organizer != null && !String(meta.organizer).trim()) return res.status(400).json({ error: 'Organisator darf nicht leer sein.' })

        const update = {}
        if (meta.name != null)       update.name = String(meta.name).trim()
        if (meta.organizer != null)  update.organizer = String(meta.organizer).trim()
        if ('gender' in meta)        update.gender = meta.gender ? String(meta.gender) : null
        if (meta.bookVariant != null) update.book_variant = (meta.bookVariant === 2 || meta.bookVariant === '2') ? 2 : 1
        if ('funeralDate' in meta)   update.funeral_date = meta.funeralDate || null
        if (meta.cutoffDays != null) {
          let days = parseInt(meta.cutoffDays, 10)
          if (!Number.isFinite(days) || days < 0) days = 7
          update.cutoff_days = days
        }
        if ('showIntroVideo' in meta) update.show_intro_video = meta.showIntroVideo !== false
        if ('intake' in meta)        update.intake = (meta.intake && typeof meta.intake === 'object') ? meta.intake : null
        if ('languages' in meta) {
          const ALLOWED_LANGS = ['de', 'pl', 'en']
          let langs = Array.isArray(meta.languages) ? [...new Set(meta.languages.filter(l => ALLOWED_LANGS.includes(l)))] : []
          if (langs.length === 0) langs = ['de']
          update.languages = langs
        }
        if ('note' in meta)          update.note = (typeof meta.note === 'string' && meta.note.trim()) ? meta.note.trim() : null
        if ('pickupAddress' in meta) update.pickup_address = sanitizePickupAddress(meta.pickupAddress)

        if (Object.keys(update).length === 0) return res.status(400).json({ error: 'Keine Felder zum Aktualisieren.' })

        const { error } = await supabase.from('memorials').update(update).eq('id', code)
        if (error) throw error
        await audit(req, { actor: req.auth, action: 'memorial.update', target: code, detail: { meta: Object.keys(update) } })
        return res.json({ ok: true })
      }

      const allowedFields = new Set(['book_v1', 'book_v2', 'eulogy_text', 'content_reports'])
      if (!allowedFields.has(field)) {
        return res.status(400).json({ error: 'Ungültiges Feld.' })
      }

      // content_reports atomar ZUSAMMENFÜHREN statt überschreiben. Sonst würde
      // beim parallelen Generieren beider Varianten der Prüf-Report der jeweils
      // anderen Variante verloren gehen (der Client schickt einen evtl. veralteten
      // Gesamtstand). Wir lesen den aktuellen Stand und mergen nur die gesendeten
      // Keys (book_v1/book_v2/eulogy_text) hinein.
      if (field === 'content_reports') {
        const incoming = (text && typeof text === 'object' && !Array.isArray(text)) ? text : {}
        const { data: cur } = await supabase.from('memorials').select('content_reports').eq('id', code).single()
        const merged = { ...(cur?.content_reports || {}), ...incoming }
        const { error: mErr } = await supabase.from('memorials').update({ content_reports: merged }).eq('id', code)
        if (mErr) throw mErr
        await audit(req, { actor: req.auth, action: 'memorial.update', target: code, detail: { field, keys: Object.keys(incoming) } })
        return res.json({ ok: true })
      }

      // Bei Büchern: vor dem Überschreiben die bisher referenzierten Bildpfade
      // ermitteln, damit anschließend die nun verwaisten Storage-Dateien (alte
      // Version − neue Version) gelöscht werden können.
      const isBookField = field === 'book_v1' || field === 'book_v2'
      let orphanPaths = []
      if (isBookField) {
        const { data: existing } = await supabase.from('memorials').select(field).eq('id', code).single()
        const oldPaths = collectImagePaths(existing?.[field])
        const newPaths = new Set(collectImagePaths(text))
        orphanPaths = [...new Set(oldPaths.filter(p => p && !newPaths.has(p)))]
      }

      const { error } = await supabase.from('memorials').update({ [field]: text ?? null }).eq('id', code)
      if (error) throw error

      // Aufräumen: nicht mehr referenzierte Bilddateien aus dem Storage löschen.
      // Fehler hier dürfen den erfolgreichen Speichervorgang NICHT scheitern lassen.
      if (orphanPaths.length) {
        const { error: rmErr } = await supabase.storage.from(IMAGE_BUCKET).remove(orphanPaths)
        if (rmErr) console.error('Verwaiste Bilder konnten nicht gelöscht werden:', rmErr)
      }

      await audit(req, { actor: req.auth, action: 'memorial.update', target: code, detail: { field, ...(orphanPaths.length ? { removed_images: orphanPaths.length } : {}) } })
      return res.json({ ok: true })
    }

    return res.status(405).end()
  } catch (e) {
    console.error('/api/admin/memorials:', e)
    res.status(500).json({ error: e.message })
  }
}
