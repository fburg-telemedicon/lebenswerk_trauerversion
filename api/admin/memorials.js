// api/admin/memorials.js
// GET    /api/admin/memorials              →  alle Gedenkbücher (auth required)
// DELETE /api/admin/memorials?code=ABC123  →  Gedenkbuch + Beiträge löschen (auth required)

const { createClient } = require('../_lib/store')
const { checkAuth, canAccessCategory } = require('../_lib/auth')
const { loadAccessibleMemorial } = require('../_lib/access')
const { audit } = require('../_lib/audit')
const { isValidCategory, DEFAULT_CATEGORY } = require('../_lib/categories')
const { deleteMemorialCompletely, IMAGE_BUCKET } = require('../_lib/delete-memorial')
const { genCode } = require('../_lib/codes')
const { normalizeStyle, DEFAULT_STYLE } = require('../_lib/image-styles')
const { normalizeLayout, DEFAULT_BOOK_LAYOUT } = require('../_lib/book-layouts')
const { LIFEWORK, ensureLifeworkSchema, ensureLifeworkCatalog } = require('../_lib/lifework')
const { generateInviteToken, INVITE_TTL_MS } = require('../_lib/auth')
const { sendAccessMail, inviteLink } = require('../_lib/invitemail')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

const SIGNED_URL_TTL = 3600 // 1 h

// Spalten der Buch-Liste. LEGACY = ohne show_contributors, falls
// db/show-contributors.sql noch nicht gelaufen ist (siehe GET-Handler).
const SELECT_COLS_LEGACY = 'id, name, organizer, gender, book_variant, book_v1, book_v2, eulogy_text, funeral_date, cutoff_days, show_intro_video, show_transcript, photo_upload_tab, product_category, owner_user, intake, languages, note, pickup_address, content_reports, purge_info, catalog_id, followups, uploaded_images, created_at, image_style, book_layout'
// family_tree/life_poster: die Nebenprodukte des Lebenswerks. Fehlen die Spalten
// (Migration noch nicht gelaufen), fällt der GET auf SELECT_COLS_LEGACY zurück.
const SELECT_COLS = `${SELECT_COLS_LEGACY}, show_contributors, family_tree, life_poster`

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

// Alle Bildpfade eines Buchs: Kapitelbilder + der Cover-Hintergrund.
// Wird für ZWEI Dinge benutzt — Signieren (GET) und Aufräumen verwaister
// Dateien (PATCH). Das Cover muss deshalb hier mit drin sein, sonst würde ein
// neu erzeugtes Cover den alten Hintergrund nie aufräumen (bzw. der Cover-
// Hintergrund bekäme keine URL).
function collectImagePaths(book) {
  if (!book) return []
  const out = (book.chapters || []).map(c => c?.image_path).filter(Boolean)
  if (book.cover_image_path) out.push(book.cover_image_path)
  return out
}

function applySignedUrls(book, urlMap) {
  if (!book) return
  for (const ch of (book.chapters || [])) {
    if (!ch?.image_path) continue
    const key = String(ch.image_path).replace(/^\/+/, '')
    if (urlMap[key]) ch.image_url = urlMap[key]
  }
  if (book.cover_image_path) {
    const key = String(book.cover_image_path).replace(/^\/+/, '')
    if (urlMap[key]) book.cover_image_url = urlMap[key]
  }
}

// Pfad der gespeicherten JPEG-Vorschau, abgeleitet aus dem Vollbild-Pfad.
// Muss zur Ableitung in api/admin/generate-image.js passen (<pfad>_thumb.jpg).
function thumbPathFor(p) {
  if (!p) return null
  return String(p).replace(/^\/+/, '').replace(/\.(png|jpe?g|webp)$/i, '_thumb.jpg')
}

function applyThumbUrls(book, thumbMap) {
  if (!book?.chapters) return
  for (const ch of book.chapters) {
    if (!ch?.image_path) continue
    const t = thumbPathFor(ch.image_path)
    if (t && thumbMap[t]) ch.image_thumb_url = thumbMap[t]
  }
}

// Signiert die kleinen gespeicherten JPEG-Vorschauen (<pfad>_thumb.jpg) fürs
// schnelle Bilder-Raster. Unabhängig vom Supabase-Plan (echte Dateien, keine
// Transformation). Ältere Bilder ohne Thumbnail liefern hier einen Eintrags-
// Fehler -> wird übersprungen, der Client fällt per onError auf das Vollbild
// zurück. Komplett fehlertolerant – darf den GET nicht beeinträchtigen.
async function signMemorialThumbs(memorials) {
  try {
    const thumbPaths = new Set()
    for (const m of memorials) {
      for (const p of [...collectImagePaths(m.book_v1), ...collectImagePaths(m.book_v2)]) {
        const t = thumbPathFor(p)
        if (t) thumbPaths.add(t)
      }
    }
    if (thumbPaths.size === 0) return
    const { data } = await supabase.storage.from(IMAGE_BUCKET).createSignedUrls([...thumbPaths], SIGNED_URL_TTL)
    if (!Array.isArray(data)) return
    const thumbMap = {}
    for (const entry of data) {
      if (entry?.error || !entry?.signedUrl || !entry?.path) continue
      thumbMap[String(entry.path).replace(/^\/+/, '')] = entry.signedUrl
    }
    for (const m of memorials) {
      applyThumbUrls(m.book_v1, thumbMap)
      applyThumbUrls(m.book_v2, thumbMap)
    }
  } catch (e) {
    console.error('signMemorialThumbs (non-fatal):', e.message)
  }
}

async function signMemorialImages(memorials) {
  const paths = new Set()
  for (const m of memorials) {
    collectImagePaths(m.book_v1).forEach(p => paths.add(p))
    collectImagePaths(m.book_v2).forEach(p => paths.add(p))
    // Vignetten des Lebensposters – je Station eine, im selben Bucket.
    for (const p of posterImagePaths(m.life_poster)) paths.add(p)
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
    applyPosterUrls(m.life_poster, urlMap)
  }
}

// Bildpfade des Lebensposters: je Station eine Vignette.
function posterImagePaths(poster) {
  const out = []
  for (const sec of (Array.isArray(poster?.sections) ? poster.sections : [])) {
    for (const st of (Array.isArray(sec.stations) ? sec.stations : [])) {
      if (st?.image_path) out.push(String(st.image_path).replace(/^\/+/, ''))
    }
  }
  return out
}

// image_url je Station setzen (wie bei den Kapitelbildern: image_path ist die
// gespeicherte Referenz, image_url wird bei jedem Laden frisch signiert).
function applyPosterUrls(poster, urlMap) {
  for (const sec of (Array.isArray(poster?.sections) ? poster.sections : [])) {
    for (const st of (Array.isArray(sec.stations) ? sec.stations : [])) {
      if (!st?.image_path) continue
      const key = String(st.image_path).replace(/^\/+/, '')
      if (urlMap[key]) st.image_url = urlMap[key]
    }
  }
}

// Signiert die Vollbild- UND Thumbnail-Pfade der hochgeladenen Fotos
// (memorials.uploaded_images) und hängt image_url / image_thumb_url an jeden
// Eintrag. Fehlertolerant – darf den GET nicht scheitern lassen.
async function signUploadedImages(memorials) {
  try {
    const paths = new Set()
    for (const m of memorials) {
      for (const u of (Array.isArray(m.uploaded_images) ? m.uploaded_images : [])) {
        if (u?.path) paths.add(String(u.path).replace(/^\/+/, ''))
        if (u?.thumb_path) paths.add(String(u.thumb_path).replace(/^\/+/, ''))
      }
    }
    if (paths.size === 0) return
    const { data } = await supabase.storage.from(IMAGE_BUCKET).createSignedUrls([...paths], SIGNED_URL_TTL)
    if (!Array.isArray(data)) return
    const urlMap = {}
    for (const d of data) {
      if (d?.error || !d?.signedUrl || !d?.path) continue
      urlMap[String(d.path).replace(/^\/+/, '')] = d.signedUrl
    }
    for (const m of memorials) {
      for (const u of (Array.isArray(m.uploaded_images) ? m.uploaded_images : [])) {
        if (u?.path) u.image_url = urlMap[String(u.path).replace(/^\/+/, '')] || null
        if (u?.thumb_path) u.image_thumb_url = urlMap[String(u.thumb_path).replace(/^\/+/, '')] || null
      }
    }
  } catch (e) {
    console.error('signUploadedImages (non-fatal):', e.message)
  }
}

// Katalog-Nachfragezahl (x) säubern: ganze Zahl 0..30, Default 7.
function sanitizeFollowups(v) {
  const n = parseInt(v, 10)
  if (!Number.isFinite(n) || n < 0) return 7
  return Math.min(n, 30)
}

// Kapitel-/Fragen-Struktur eines Katalogs säubern:
//   [{ title, questions: [text, …] }]  — leere Fragen/leere Kapitel fallen weg.
function sanitizeChapters(input) {
  if (!Array.isArray(input)) return []
  const out = []
  for (const ch of input) {
    if (!ch || typeof ch !== 'object') continue
    const title = typeof ch.title === 'string' ? ch.title.trim().slice(0, 300) : ''
    const questions = Array.isArray(ch.questions)
      ? ch.questions.map(q => (typeof q === 'string' ? q.trim().slice(0, 1000) : '')).filter(Boolean)
      : []
    if (!title && questions.length === 0) continue
    out.push({ title, questions })
  }
  return out
}

function sanitizeCatalogCats(input) {
  if (!Array.isArray(input)) return []
  return [...new Set(input.filter(isValidCategory))]
}

// Fragenkatalog-Verwaltung (?catalogs). Hier eingebettet wegen des Vercel-
// 12-Funktionen-Limits (analog zum ?audit-Zweig in api/admin/users.js).
//   GET    ?catalogs=1              → { catalogs }  (jeder Benutzer; Nicht-Admins
//                                      nur Kataloge ihrer erlaubten Kategorien)
//   POST   ?catalogs=1  { name, product_categories, chapters }   (nur Admin)
//   PATCH  ?catalogs=1&id=…  { name?, product_categories?, chapters? }  (nur Admin)
//   DELETE ?catalogs=1&id=…                                       (nur Admin)
async function handleCatalogs(req, res) {
  if (req.method === 'GET') {
    let q = supabase.from('question_catalogs')
      .select('id, name, product_categories, chapters, created_at')
      .order('created_at', { ascending: true })
    if (!req.auth.admin) {
      const cats = Array.isArray(req.auth.cats) ? req.auth.cats : []
      if (cats.length === 0) return res.json({ catalogs: [] })
      q = q.overlaps('product_categories', cats)
    }
    const { data, error } = await q
    if (error) throw error
    return res.json({ catalogs: data || [] })
  }

  // Schreiben nur für Admins.
  if (!req.auth.admin) return res.status(403).json({ error: 'Nur Administratoren dürfen Fragenkataloge bearbeiten.' })

  if (req.method === 'POST') {
    const { name, product_categories, chapters } = req.body || {}
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name fehlt.' })
    const { data, error } = await supabase.from('question_catalogs').insert({
      name: String(name).trim().slice(0, 200),
      product_categories: sanitizeCatalogCats(product_categories),
      chapters: sanitizeChapters(chapters),
    }).select('id, name, product_categories, chapters, created_at').single()
    if (error) throw error
    await audit(req, { actor: req.auth, action: 'catalog.create', target: data.id, detail: { name: data.name } })
    return res.json({ catalog: data })
  }

  if (req.method === 'PATCH') {
    const id = (req.query.id || '').trim()
    if (!id) return res.status(400).json({ error: 'id fehlt.' })
    const patch = {}
    if (req.body.name !== undefined) {
      if (!String(req.body.name).trim()) return res.status(400).json({ error: 'Name darf nicht leer sein.' })
      patch.name = String(req.body.name).trim().slice(0, 200)
    }
    if (req.body.product_categories !== undefined) patch.product_categories = sanitizeCatalogCats(req.body.product_categories)
    if (req.body.chapters !== undefined) patch.chapters = sanitizeChapters(req.body.chapters)
    if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'Keine Felder zum Aktualisieren.' })
    const { error } = await supabase.from('question_catalogs').update(patch).eq('id', id)
    if (error) throw error
    await audit(req, { actor: req.auth, action: 'catalog.update', target: id, detail: { changed: Object.keys(patch) } })
    return res.json({ ok: true })
  }

  if (req.method === 'DELETE') {
    const id = (req.query.id || '').trim()
    if (!id) return res.status(400).json({ error: 'id fehlt.' })
    // memorials.catalog_id ist ON DELETE SET NULL → betroffene Bücher fallen
    // automatisch auf den KI-Standardmodus zurück.
    const { error } = await supabase.from('question_catalogs').delete().eq('id', id)
    if (error) throw error
    await audit(req, { actor: req.auth, action: 'catalog.delete', target: id })
    return res.json({ ok: true })
  }

  return res.status(405).end()
}

module.exports = async function handler(req, res) {
  if (!checkAuth(req, res)) return
  try {
    if (req.query.catalogs !== undefined) return await handleCatalogs(req, res)

    if (req.method === 'GET') {
      // Nicht-Admins sehen nur ihre eigenen Bücher und nur erlaubte Kategorien.
      let scope = null
      if (!req.auth.admin) {
        const cats = Array.isArray(req.auth.cats) ? req.auth.cats : []
        if (!req.auth.uid || cats.length === 0) return res.json([])
        scope = { uid: req.auth.uid, cats }
      }

      const listQuery = (cols) => {
        let q = supabase.from('memorials').select(cols).order('created_at', { ascending: false })
        if (scope) q = q.eq('owner_user', scope.uid).in('product_category', scope.cats)
        return q
      }

      let { data, error } = await listQuery(SELECT_COLS)
      // show_contributors evtl. noch nicht migriert (db/show-contributors.sql) →
      // ohne die Spalte erneut lesen. Eine fehlende Migration darf niemals das
      // gesamte Dashboard lahmlegen; der Default (an) greift dann im Frontend.
      if (error && /show_contributors|family_tree|life_poster|column/i.test(error.message || '')) {
        ;({ data, error } = await listQuery(SELECT_COLS_LEGACY))
      }
      if (error) throw error
      const memorials = data || []
      await signMemorialImages(memorials)
      await signMemorialThumbs(memorials)
      await signUploadedImages(memorials)

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

      // Beiträge und Antworten (User-Nachrichten) pro Memorial aggregieren.
      // Bevorzugt serverseitig per RPC (zählt in Postgres, überträgt NICHT alle
      // Transkripte) – siehe supabase/memorial-stats.sql. Fallback (bis die
      // Funktion angelegt ist): messages laden und im Node zählen.
      const contribCounts = {}
      const answerCounts  = {}
      let statsRows = null
      try {
        const { data, error: rpcErr } = await supabase.rpc('memorial_contrib_stats')
        if (!rpcErr && Array.isArray(data)) statsRows = data
      } catch { /* Fallback unten */ }
      if (statsRows) {
        for (const s of statsRows) {
          contribCounts[s.memorial_id] = Number(s.contribution_count || 0)
          answerCounts[s.memorial_id]  = Number(s.answer_count || 0)
        }
      } else {
        const { data: contribRows } = await supabase.from('contributions').select('memorial_id, messages')
        for (const r of contribRows || []) {
          contribCounts[r.memorial_id] = (contribCounts[r.memorial_id] || 0) + 1
          const answers = Array.isArray(r.messages) ? r.messages.filter(msg => msg?.role === 'user').length : 0
          answerCounts[r.memorial_id] = (answerCounts[r.memorial_id] || 0) + answers
        }
      }
      for (const m of memorials) {
        m.contribution_count = contribCounts[m.id] || 0
        m.answer_count       = answerCounts[m.id] || 0
      }

      // Inhaber-Benutzernamen ergänzen (für die Admin-Liste). owner_user ist
      // null bei Büchern, die der Env-Superadmin angelegt hat.
      const ownerIds = [...new Set(memorials.map(m => m.owner_user).filter(Boolean))]
      if (ownerIds.length) {
        const { data: owners } = await supabase.from('app_users').select('id, username, logo').in('id', ownerIds)
        const byId = {}
        for (const u of owners || []) byId[u.id] = u
        for (const m of memorials) {
          const o = m.owner_user ? byId[m.owner_user] : null
          m.owner_username = o?.username || null
          m.owner_logo = o?.logo || null   // Firmenlogo des Buch-Inhabers (Data-URL) – fürs Buch-Impressum
        }
      }

      // Grafikstil + Buchlayout kommen aus dem Haupt-Select; nur Defaults für
      // (noch) leere Werte setzen.
      for (const m of memorials) {
        m.image_style = m.image_style || DEFAULT_STYLE
        m.book_layout = m.book_layout || DEFAULT_BOOK_LAYOUT
      }

      return res.json(memorials)
    }

    if (req.method === 'POST') {
      const { name, organizer, gender, bookVariant, funeralDate, cutoffDays, showIntroVideo, showTranscript, showContributors, photoUploadTab, productCategory, intake, languages, note, pickupAddress, catalogId, followups, imageStyle, bookLayout, enduserEmail, aiQuestions } = req.body || {}
      if (!name) return res.status(400).json({ error: 'Name ist ein Pflichtfeld.' })

      const category = isValidCategory(productCategory) ? productCategory : DEFAULT_CATEGORY
      if (!canAccessCategory(req.auth, category)) {
        return res.status(403).json({ error: 'Keine Berechtigung für diese Produktkategorie.' })
      }

      const isLifework = category === LIFEWORK
      // Lebenswerk hat keinen Organisator (der Endnutzer erzählt sein eigenes
      // Leben); die Spalte bekommt seinen Namen. Alle anderen Kategorien sammeln
      // Beiträge Dritter — dort bleibt der Organisator Pflicht.
      const organizerName = isLifework ? String(name).trim() : String(organizer || '').trim()
      if (!organizerName) return res.status(400).json({ error: 'Name und Organisator sind Pflichtfelder.' })
      // E-Mail-Adresse ist OPTIONAL: Mit Adresse bekommt der Endnutzer ein eigenes
      // Konto samt Einladung; ohne Adresse entsteht kein Konto und der Zugang läuft
      // über den Einladungslink (?code=…) wie bei den anderen Kategorien.
      const email = String(enduserEmail || '').trim()
      if (isLifework) {
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return res.status(400).json({ error: 'Bitte eine gültige E-Mail-Adresse des Endnutzers angeben (oder das Feld leer lassen).' })
        }
        await ensureLifeworkSchema()
      }

      const ALLOWED_LANGS = ['de', 'pl', 'en']
      let langs = Array.isArray(languages) ? [...new Set(languages.filter(l => ALLOWED_LANGS.includes(l)))] : []
      if (langs.length === 0) langs = ['de']
      // Lebenswerk: Der Admin legt EINE Sprache fest — oder keine, dann wählt der
      // Endnutzer beim ersten Start selbst (dafür müssen alle Sprachen offenstehen).
      const euLang = isLifework && Array.isArray(languages) && languages.length === 1 ? langs[0] : null
      if (isLifework) langs = euLang ? [euLang] : [...ALLOWED_LANGS]

      // Lebenswerk-Standardkatalog (12 Sitzungen à 10 Fragen), sofern der Admin
      // nicht ausdrücklich auf KI-generierte Fragen umgestellt hat.
      let catalog = catalogId || null
      if (isLifework) catalog = aiQuestions === true ? null : (catalogId || await ensureLifeworkCatalog(supabase))

      const code = genCode()
      // Lebenswerk kennt nur Variante 2 (durchkomponierte Autobiographie).
      const variant = isLifework ? 2 : ((bookVariant === 2 || bookVariant === '2') ? 2 : 1)
      let days = parseInt(cutoffDays, 10)
      if (!Number.isFinite(days) || days < 0) days = 7
      const insertRow = {
        id: code, name, organizer: organizerName, gender: gender || null, book_variant: variant,
        // Lebenswerk: kein Anlass-Datum, keine Erfassungsfrist — der Endnutzer
        // bestimmt selbst, wie schnell er erzählt.
        funeral_date: isLifework ? null : (funeralDate || null),
        cutoff_days: isLifework ? 0 : days,
        show_intro_video: isLifework ? false : showIntroVideo !== false,
        // Transkript-Umschalter bleibt sichtbar, startet aber ausgeschaltet.
        show_transcript: isLifework ? false : showTranscript !== false,
        // Es gibt nur einen Erzähler — eine Mitwirkenden-Liste ergibt keinen Sinn.
        show_contributors: isLifework ? false : showContributors !== false,
        photo_upload_tab: isLifework ? true : photoUploadTab === true,
        product_category: category,
        owner_user: req.auth.admin ? null : (req.auth.uid || null),
        intake: intake && typeof intake === 'object' ? intake : null,
        languages: langs,
        note: (typeof note === 'string' && note.trim()) ? note.trim() : null,
        pickup_address: sanitizePickupAddress(pickupAddress),
        catalog_id: catalog,
        followups: sanitizeFollowups(followups),
        image_style: normalizeStyle(imageStyle) || DEFAULT_STYLE,
        book_layout: normalizeLayout(bookLayout) || DEFAULT_BOOK_LAYOUT,
      }
      let { error } = await supabase.from('memorials').insert(insertRow)
      // Falls image-style.sql / book-layout.sql noch nicht liefen, fehlen die
      // Spalten → ohne sie erneut anlegen (Buch-Anlage darf nie an einer Migration hängen).
      if (error && /image_style|book_layout|show_contributors|column/i.test(error.message || '')) {
        delete insertRow.image_style
        delete insertRow.book_layout
        delete insertRow.show_contributors
        ;({ error } = await supabase.from('memorials').insert(insertRow))
      }
      if (error) throw error
      await audit(req, { actor: req.auth, action: 'memorial.create', target: code, detail: { category } })

      // Lebenswerk MIT E-Mail-Adresse: Konto für den Endnutzer anlegen und ihn per
      // Mail einladen. Ein Fehlschlag beim Versand darf das bereits angelegte Buch
      // nicht entwerten — der Admin bekommt stattdessen den Einladungslink zurück.
      // Ohne Adresse bleibt es beim Buch; der Endnutzer kommt dann über den
      // Einladungslink (?code=…) hinein wie ein Beitragender.
      if (!isLifework || !email) return res.json({ code })

      const out = { code }
      const invite_token = generateInviteToken()
      const invite_expires = new Date(Date.now() + INVITE_TTL_MS).toISOString()
      const { data: eu, error: euErr } = await supabase.from('app_users')
        .insert({
          username: email,
          pw_hash: null, pw_salt: null,
          invite_token, invite_expires,
          allowed_categories: [],
          is_admin: false,
          is_enduser: true,
          enduser_memorial: code,
          lang: euLang,
        })
        .select('id').single()
      if (euErr) {
        // Konto konnte nicht angelegt werden (z. B. Adresse bereits vergeben) —
        // Buch wieder entfernen, sonst stünde ein Lebenswerk ohne Erzähler da.
        await supabase.from('memorials').delete().eq('id', code)
        if (euErr.code === '23505' || /duplicate key|app_users_username_key/i.test(euErr.message || '')) {
          return res.status(409).json({ error: `Für „${email}" existiert bereits ein Zugang (Benutzer oder Endnutzer). Bitte eine andere Adresse verwenden – oder das Feld leer lassen und den Einladungslink nutzen.` })
        }
        throw euErr
      }
      out.enduser_id = eu.id
      out.invite_token = invite_token
      await audit(req, { actor: req.auth, action: 'enduser.create', target: eu.id, detail: { code, email, lang: euLang } })
      try {
        await sendAccessMail({ to: email, url: inviteLink(req, invite_token), kind: 'enduser', lang: euLang || 'de' })
        out.email_sent = true
        await audit(req, { actor: req.auth, action: 'enduser.invite_sent', target: eu.id, detail: { to: email } })
      } catch (e) {
        console.error('/api/admin/memorials enduser mail:', e)
        out.email_sent = false
        out.email_error = e.message
      }
      return res.json(out)
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

      const { field, text, meta, uploadEdit } = req.body || {}

      // Bildunterschrift/-beschreibung eines hochgeladenen Fotos bearbeiten.
      if (uploadEdit && uploadEdit.id) {
        const { data: cur } = await supabase.from('memorials').select('uploaded_images').eq('id', code).single()
        const list = Array.isArray(cur?.uploaded_images) ? cur.uploaded_images : []
        let found = false
        const next = list.map(u => {
          if (u?.id !== uploadEdit.id) return u
          found = true
          return {
            ...u,
            ...(uploadEdit.caption != null ? { caption: String(uploadEdit.caption).trim().slice(0, 300) } : {}),
            ...(uploadEdit.description != null ? { description: String(uploadEdit.description).trim().slice(0, 1000) } : {}),
          }
        })
        if (!found) return res.status(404).json({ error: 'Bild nicht gefunden.' })
        const { error } = await supabase.from('memorials').update({ uploaded_images: next }).eq('id', code)
        if (error) throw error
        await audit(req, { actor: req.auth, action: 'memorial.update', target: code, detail: { uploadEdit: uploadEdit.id } })
        return res.json({ ok: true })
      }

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
        if ('showTranscript' in meta) update.show_transcript = meta.showTranscript !== false
        if ('showContributors' in meta) update.show_contributors = meta.showContributors !== false
        if ('photoUploadTab' in meta) update.photo_upload_tab = meta.photoUploadTab === true
        if ('intake' in meta)        update.intake = (meta.intake && typeof meta.intake === 'object') ? meta.intake : null
        if ('languages' in meta) {
          const ALLOWED_LANGS = ['de', 'pl', 'en']
          let langs = Array.isArray(meta.languages) ? [...new Set(meta.languages.filter(l => ALLOWED_LANGS.includes(l)))] : []
          if (langs.length === 0) langs = ['de']
          update.languages = langs
        }
        if ('note' in meta)          update.note = (typeof meta.note === 'string' && meta.note.trim()) ? meta.note.trim() : null
        if ('pickupAddress' in meta) update.pickup_address = sanitizePickupAddress(meta.pickupAddress)
        if ('catalogId' in meta)     update.catalog_id = meta.catalogId || null
        if ('followups' in meta)     update.followups = sanitizeFollowups(meta.followups)
        if ('imageStyle' in meta)    update.image_style = normalizeStyle(meta.imageStyle) || DEFAULT_STYLE
        if ('bookLayout' in meta)    update.book_layout = normalizeLayout(meta.bookLayout) || DEFAULT_BOOK_LAYOUT

        if (Object.keys(update).length === 0) return res.status(400).json({ error: 'Keine Felder zum Aktualisieren.' })

        let { error } = await supabase.from('memorials').update(update).eq('id', code)
        // image_style/book_layout/show_contributors evtl. noch nicht migriert → ohne sie erneut speichern.
        if (error && ('image_style' in update || 'book_layout' in update || 'show_contributors' in update) && /image_style|book_layout|show_contributors|column/i.test(error.message || '')) {
          delete update.image_style
          delete update.book_layout
          delete update.show_contributors
          if (Object.keys(update).length) { ({ error } = await supabase.from('memorials').update(update).eq('id', code)) }
          else error = null
        }
        if (error) throw error
        await audit(req, { actor: req.auth, action: 'memorial.update', target: code, detail: { meta: Object.keys(update) } })
        return res.json({ ok: true })
      }

      // family_tree / life_poster: die extrahierten Strukturen der beiden
      // grafischen Nebenprodukte des Lebenswerks (Stammbaum, Lebensposter).
      const allowedFields = new Set(['book_v1', 'book_v2', 'eulogy_text', 'content_reports', 'family_tree', 'life_poster'])
      if (!allowedFields.has(field)) {
        return res.status(400).json({ error: 'Ungültiges Feld.' })
      }
      if (field === 'family_tree' || field === 'life_poster') await ensureLifeworkSchema()

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

      // Generierungs-Zeitstempel mitschreiben (für den Tagesreport: "neu erzeugte
      // Bücher/Nachrufe gestern"). Nur beim Setzen (text != null), nicht beim Leeren.
      const upd = { [field]: text ?? null }
      const tsCol = { book_v1: 'book_v1_at', book_v2: 'book_v2_at', eulogy_text: 'eulogy_at' }[field]
      if (tsCol && text != null) upd[tsCol] = new Date().toISOString()
      let { error } = await supabase.from('memorials').update(upd).eq('id', code)
      // Falls die Migration supabase/report.sql noch nicht lief, existiert die
      // *_at-Spalte nicht → ohne Zeitstempel erneut speichern (Buch darf nie scheitern).
      if (error && tsCol && upd[tsCol] !== undefined && /column|does not exist|_at/i.test(error.message || '')) {
        delete upd[tsCol]
        ;({ error } = await supabase.from('memorials').update(upd).eq('id', code))
      }
      if (error) throw error

      // Aufräumen: nicht mehr referenzierte Bilddateien (inkl. ihrer _thumb.jpg)
      // aus dem Storage löschen. Fehler hier dürfen den erfolgreichen
      // Speichervorgang NICHT scheitern lassen.
      if (orphanPaths.length) {
        const toRemove = [...orphanPaths, ...orphanPaths.map(thumbPathFor).filter(Boolean)]
        const { error: rmErr } = await supabase.storage.from(IMAGE_BUCKET).remove(toRemove)
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
