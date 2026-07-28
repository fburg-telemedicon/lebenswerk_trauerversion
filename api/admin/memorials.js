// api/admin/memorials.js
// GET    /api/admin/memorials              →  alle Gedenkbücher (auth required)
// DELETE /api/admin/memorials?code=ABC123  →  Gedenkbuch + Beiträge löschen (auth required)

const crypto = require('crypto')
const { createClient, pool } = require('../_lib/store')
const { checkAuth, canAccessCategory } = require('../_lib/auth')
const { loadAccessibleMemorial } = require('../_lib/access')
const { audit } = require('../_lib/audit')
const { isValidCategory, DEFAULT_CATEGORY, isAnamnesisCategory, isEnduserCategory } = require('../_lib/categories')
const { deleteMemorialCompletely, IMAGE_BUCKET } = require('../_lib/delete-memorial')
const { genCode } = require('../_lib/codes')
const { normalizeStyle, DEFAULT_STYLE } = require('../_lib/image-styles')
const { normalizeTextStyle, defaultTextStyle } = require('../_lib/text-styles')
const { normalizeLayout, DEFAULT_BOOK_LAYOUT } = require('../_lib/book-layouts')
const { LIFEWORK, ensureLifeworkSchema, ensureLifeworkCatalog } = require('../_lib/lifework')
const { ensureAnamnesisCatalog, ensureAnamnesisKvswCatalog } = require('../_lib/anamnesis')
const { defaultTtsVoice, sanitizeVoice } = require('../_lib/ttsvoices')
const { generateInviteToken, INVITE_TTL_MS } = require('../_lib/auth')
const { sendAccessMail, inviteLink } = require('../_lib/invitemail')
const { ALLOWED_LANGS, sanitizeLangs } = require('../_lib/languages')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

const SIGNED_URL_TTL = 3600 // 1 h

// Spalten der Buch-Liste. LEGACY = ohne show_contributors, falls
// db/show-contributors.sql noch nicht gelaufen ist (siehe GET-Handler).
const SELECT_COLS_LEGACY = 'id, name, organizer, gender, book_variant, book_v1, book_v2, eulogy_text, funeral_date, cutoff_days, show_intro_video, show_transcript, photo_upload_tab, product_category, owner_user, intake, languages, note, pickup_address, content_reports, purge_info, catalog_id, followups, uploaded_images, created_at, image_style, book_layout'
// family_tree/life_poster: die Nebenprodukte des Lebenswerks. Fehlen die Spalten
// (Migration noch nicht gelaufen), fällt der GET auf SELECT_COLS_LEGACY zurück.
const SELECT_COLS = `${SELECT_COLS_LEGACY}, show_contributors, family_tree, life_poster, text_style, stored_pdfs, interview_timer_seconds, companion_mode, proof_enabled, proof_max, proof_used, edit_lock, interview_closed, book_finalized, book_finalized_at, show_onboarding, tts_voice, gamification, hands_free, mic_manual_stop, mic_mode_switch, realtime_enabled, guest_enabled, guest_code`

// Interview-Zeitlimit (Test-Timer) normalisieren: 0 = unbegrenzt; sonst Sekunden,
// gedeckelt auf 24 h (Schutz vor Unsinn).
function sanitizeTimer(v) {
  const n = parseInt(v, 10)
  return Number.isFinite(n) && n > 0 ? Math.min(n, 24 * 3600) : 0
}

// Anzahl erlaubter Probedrucke (Endnutzer-Buchvorschau). Default 3; 0..20.
function sanitizeProofMax(v) {
  const n = parseInt(v, 10)
  if (!Number.isFinite(n)) return 3
  return Math.max(0, Math.min(n, 20))
}

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
    // Optional auf dem Server abgelegte Druck-PDF-Kopien (memorials.stored_pdfs).
    for (const v of Object.values(m.stored_pdfs || {})) {
      if (v?.path) paths.add(String(v.path).replace(/^\/+/, ''))
    }
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
    // Signierte Download-Links der abgelegten PDF-Kopien (je Variante).
    if (m.stored_pdfs && typeof m.stored_pdfs === 'object') {
      const links = {}
      for (const [variant, v] of Object.entries(m.stored_pdfs)) {
        const key = v?.path ? String(v.path).replace(/^\/+/, '') : null
        if (key && urlMap[key]) links[variant] = { url: urlMap[key], slug: v.slug || null, filename: v.filename || null, at: v.at || null }
      }
      if (Object.keys(links).length) m.stored_pdf_urls = links
    }
  }
}

// Bildpfade des Lebensposters. Aktuell: je Stil (variants) ein Satz Szenenbilder.
// `scene_path` (ein Gesamtmotiv) und Stationsbilder stammen aus früheren Fassungen
// und werden weiter signiert, damit ältere Poster darstellbar bleiben.
function posterImagePaths(poster) {
  const out = []
  if (poster?.scene_path) out.push(String(poster.scene_path).replace(/^\/+/, ''))
  for (const v of (Array.isArray(poster?.variants) ? poster.variants : [])) {
    if (v?.scene_path) out.push(String(v.scene_path).replace(/^\/+/, ''))
    // Das leere Beschriftungsfeld (eigene Grafik, wird vom Layout vervielfältigt).
    if (v?.bubble_path) out.push(String(v.bubble_path).replace(/^\/+/, ''))
    for (const t of (Array.isArray(v.tiles) ? v.tiles : [])) {
      if (t?.image_path) out.push(String(t.image_path).replace(/^\/+/, ''))
    }
  }
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
  if (poster?.scene_path) {
    const k = String(poster.scene_path).replace(/^\/+/, '')
    if (urlMap[k]) poster.scene_url = urlMap[k]
  }
  for (const v of (Array.isArray(poster?.variants) ? poster.variants : [])) {
    if (v?.scene_path) {
      const k = String(v.scene_path).replace(/^\/+/, '')
      if (urlMap[k]) v.scene_url = urlMap[k]
    }
    if (v?.bubble_path) {
      const k = String(v.bubble_path).replace(/^\/+/, '')
      if (urlMap[k]) v.bubble_url = urlMap[k]
    }
    for (const t of (Array.isArray(v.tiles) ? v.tiles : [])) {
      if (!t?.image_path) continue
      const key = String(t.image_path).replace(/^\/+/, '')
      if (urlMap[key]) t.image_url = urlMap[key]
    }
  }
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
// Vertiefende Nachfragen je Katalogfrage. Der Rückfallwert gilt NUR, wenn das
// Feld fehlt oder unbrauchbar ist.
//
// Er stand bis 2026-07-28 auf 7 — dem Wert von vor der Umstellung. Die
// Anlage-Maske schickt seither 2 mit (App.jsx, Commit 19c12ec: bei einem ganzen
// Leben halten sieben Nachfragen die erzählende Person an einer Station fest),
// der Server fiel aber weiter auf 7 zurück. Wer ein Buch über die Schnittstelle
// ohne dieses Feld anlegte, bekam still sieben Nachfragen statt zwei — genau so
// ist es dem Realtime-Testbuch passiert. Jetzt sind beide Seiten gleich.
function sanitizeFollowups(v) {
  const n = parseInt(v, 10)
  if (!Number.isFinite(n) || n < 0) return 2
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
// „Akt. Stand" eines Endnutzer-Interviews: aktuelle Katalog-Position (Kapitel/Frage)
// aus der letzten gespeicherten Assistenten-Position (`msg.pos`) + Katalogstruktur.
// Spiegelt catalogProgress() im Frontend (src/contributor.jsx). Ohne Katalog oder
// ohne Position (freies Interview / noch nicht begonnen) → null (Liste zeigt dann
// die Antwortzahl). `pos` liegt strukturiert in den Nachrichten (kein Marker-Parsing nötig).
function computeCatalogProgress(chapters, messages) {
  if (!Array.isArray(messages) || !messages.length) return null
  let pos = null
  for (let i = messages.length - 1; i >= 0; i--) { if (messages[i] && messages[i].pos) { pos = messages[i].pos; break } }
  if (!pos) return null
  if (pos.done) return { done: true, pct: 100 }
  if (!Array.isArray(chapters) || !chapters.length) return null
  const qCount = ch => (Array.isArray(ch && ch.questions) ? ch.questions.length : 0)
  const totalQ = chapters.reduce((n, ch) => n + qCount(ch), 0)
  const ci = pos.chapter - 1
  if (totalQ === 0 || !(ci >= 0 && ci < chapters.length)) return null
  const inChapter = qCount(chapters[ci])
  if (!(pos.question >= 1 && pos.question <= inChapter)) return null
  let before = 0
  for (let i = 0; i < ci; i++) before += qCount(chapters[i])
  return {
    done: false,
    chapter: pos.chapter, chapterTotal: chapters.length,
    question: pos.question, questionTotal: inChapter,
    questionLabel: pos.followup ? `${pos.question}.${pos.followup}` : String(pos.question),
    pct: Math.round(((before + pos.question - 1) / totalQ) * 100),
  }
}

// Die drei CODE-verwalteten Standard-Fragebögen (Lebenswerk, Anamnese, Anamnese
// KVSW) werden beim ERSTEN Katalog-Abruf pro Prozess sichergestellt — idempotent
// (update-or-insert). So erscheinen sie immer in der Liste (mit ihren Fragen) und
// die „Fragen ansehen"-Vorschau im Expertenmodus hat auch für frische Kategorien
// (z. B. KVSW vor dem ersten Anlegen) Daten. Nach einem Deploy synchronisiert der
// erste Abruf zugleich die im Code geänderten Fragen.
let stdCatalogsEnsured = false
async function ensureStandardCatalogs() {
  if (stdCatalogsEnsured) return
  try {
    await ensureLifeworkSchema()
    await Promise.all([
      ensureLifeworkCatalog(supabase),
      ensureAnamnesisCatalog(supabase),
      ensureAnamnesisKvswCatalog(supabase),
    ])
    stdCatalogsEnsured = true
  } catch { /* nicht kritisch — die Liste kommt auch ohne Seeding */ }
}

async function handleCatalogs(req, res) {
  if (req.method === 'GET') {
    await ensureStandardCatalogs()
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
      const lastActivity  = {} // memorial_id → ISO-Zeitpunkt der letzten Beitrags-Bearbeitung
      let statsRows = null
      try {
        const { data, error: rpcErr } = await supabase.rpc('memorial_contrib_stats')
        if (!rpcErr && Array.isArray(data)) statsRows = data
      } catch { /* Fallback unten */ }
      if (statsRows) {
        for (const s of statsRows) {
          contribCounts[s.memorial_id] = Number(s.contribution_count || 0)
          answerCounts[s.memorial_id]  = Number(s.answer_count || 0)
          if (s.last_activity) lastActivity[s.memorial_id] = s.last_activity
        }
      } else {
        // Fallback ohne RPC: created_at genügt für „zuletzt gearbeitet" (updated_at
        // gibt es erst nach dem Einmal-SQL; solange greift der Startzeitpunkt).
        const { data: contribRows } = await supabase.from('contributions').select('memorial_id, messages, created_at')
        for (const r of contribRows || []) {
          contribCounts[r.memorial_id] = (contribCounts[r.memorial_id] || 0) + 1
          const answers = Array.isArray(r.messages) ? r.messages.filter(msg => msg?.role === 'user').length : 0
          answerCounts[r.memorial_id] = (answerCounts[r.memorial_id] || 0) + answers
          const at = r.created_at
          if (at && (!lastActivity[r.memorial_id] || at > lastActivity[r.memorial_id])) lastActivity[r.memorial_id] = at
        }
      }
      for (const m of memorials) {
        m.contribution_count = contribCounts[m.id] || 0
        m.answer_count       = answerCounts[m.id] || 0
        m.last_activity      = lastActivity[m.id] || null
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

      // Endnutzer-E-Mail (Endnutzer-Kategorien: Lebenswerk, Anamnese) ergänzen: Sie
      // dient im Dashboard als Ersatz-Anzeigename, solange der Buchname noch leer ist
      // (Name → E-Mail → interne Notiz → „Name folgt"). Der Endnutzer/Patient hat sein
      // eigenes app_users-Konto mit enduser_memorial == Buch-Code.
      const enduserCodes = memorials.filter(m => isEnduserCategory(m.product_category)).map(m => m.id)
      if (enduserCodes.length) {
        const { data: eus } = await supabase
          .from('app_users').select('username, enduser_memorial')
          .eq('is_enduser', true).in('enduser_memorial', enduserCodes)
        const byCode = {}
        for (const u of eus || []) if (u.enduser_memorial) byCode[u.enduser_memorial] = u.username
        for (const m of memorials) if (byCode[m.id]) m.enduser_email = byCode[m.id]

        // „Akt. Stand": aktuelle Kapitel/Frage-Position je Endnutzer-Buch. Nur für
        // diese wenigen Bücher werden Transkripte geladen (EIN Beitrag je Buch) +
        // die zugehörigen Katalog-Kapitel. Ohne Katalog/Position → null.
        const catIds = [...new Set(memorials.filter(m => enduserCodes.includes(m.id) && m.catalog_id).map(m => m.catalog_id))]
        const chaptersByCatId = {}
        if (catIds.length) {
          const { data: cats } = await supabase.from('question_catalogs').select('id, chapters').in('id', catIds)
          for (const c of cats || []) chaptersByCatId[c.id] = Array.isArray(c.chapters) ? c.chapters : []
        }
        // Der „Akt. Stand" misst den Fortschritt des ENDNUTZERS im Fragenkatalog.
        // Gastbeiträge (Gastbeiträge zum Lebenswerk) sind eigene Interviews und
        // müssen hier draußen bleiben — sonst zeigte die Liste den Stand eines
        // Gastes an. is_guest ist neu: fehlt die Spalte, wird ohne sie gelesen.
        let { data: euContribs, error: euErr } = await supabase
          .from('contributions').select('memorial_id, messages, is_guest').in('memorial_id', enduserCodes)
        if (euErr && /is_guest|column/i.test(euErr.message || '')) {
          ;({ data: euContribs } = await supabase.from('contributions').select('memorial_id, messages').in('memorial_id', enduserCodes))
        }
        const msgsByCode = {}
        for (const r of euContribs || []) {
          if (r.is_guest) continue
          if (!msgsByCode[r.memorial_id]) msgsByCode[r.memorial_id] = r.messages
        }
        for (const m of memorials) {
          if (!enduserCodes.includes(m.id)) continue
          m.progress = computeCatalogProgress(m.catalog_id ? chaptersByCatId[m.catalog_id] : null, msgsByCode[m.id])
        }
      }

      // Grafikstil + Buchlayout kommen aus dem Haupt-Select; nur Defaults für
      // (noch) leere Werte setzen.
      for (const m of memorials) {
        m.image_style = m.image_style || DEFAULT_STYLE
        m.book_layout = m.book_layout || DEFAULT_BOOK_LAYOUT
        m.text_style  = m.text_style  || defaultTextStyle(m.product_category)
      }

      return res.json(memorials)
    }

    if (req.method === 'POST') {
      const { name, organizer, gender, bookVariant, funeralDate, cutoffDays, showIntroVideo, showTranscript, showContributors, photoUploadTab, productCategory, intake, languages, note, pickupAddress, catalogId, followups, imageStyle, bookLayout, textStyle, interviewTimerSeconds, companionMode, proofEnabled, proofMax, enduserEmail, showOnboarding, ttsVoice, gamification, handsFree, micManualStop, micModeSwitch, realtimeEnabled, guestEnabled } = req.body || {}
      const category = isValidCategory(productCategory) ? productCategory : DEFAULT_CATEGORY
      // Endnutzer-Kategorien: EIN Endnutzer/Patient spricht selbst und bekommt einen
      // eigenen Zugang (E-Mail-Einladung oder ?code-Link). Kein Organisator, Name
      // optional. Lebenswerk = Autobiographie, Anamnese = Anamnesebogen.
      const isEnduser = isEnduserCategory(category)
      // Der Name ist Pflicht — außer bei Endnutzer-Kategorien: Kennt der Manager den
      // Namen nicht, trägt der Endnutzer/Patient ihn beim ersten Start selbst nach
      // (PATCH /api/memorial). Bis dahin bleibt das Feld leer.
      if (!name && !isEnduser) return res.status(400).json({ error: 'Name ist ein Pflichtfeld.' })
      if (!canAccessCategory(req.auth, category)) {
        return res.status(403).json({ error: 'Keine Berechtigung für diese Produktkategorie.' })
      }

      const isLifework = category === LIFEWORK
      // Lebenswerk hat keinen Organisator (der Endnutzer erzählt sein eigenes
      // Leben); die Spalte bekommt seinen Namen. Alle anderen Kategorien sammeln
      // Beiträge Dritter — dort bleibt der Organisator Pflicht.
      // Anamnese: die Organizer-Spalte trägt die betreuende Ärztin/den Arzt (optional,
      // vom Admin eingegeben) — NICHT den Patientennamen. Übrige Endnutzer (Lebenswerk):
      // der Erzähler selbst; andere Kategorien: der eingegebene Organisator (Pflicht).
      const organizerName = isAnamnesisCategory(category)
        ? String(organizer || '').trim()
        : (isEnduser ? String(name || '').trim() : String(organizer || '').trim())
      if (!organizerName && !isEnduser) return res.status(400).json({ error: 'Name und Organisator sind Pflichtfelder.' })
      // E-Mail-Adresse ist OPTIONAL: Mit Adresse bekommt der Endnutzer ein eigenes
      // Konto samt Einladung; ohne Adresse entsteht kein Konto und der Zugang läuft
      // über den Einladungslink (?code=…) wie bei den anderen Kategorien.
      const email = String(enduserEmail || '').trim()
      if (isEnduser) {
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return res.status(400).json({ error: 'Bitte eine gültige E-Mail-Adresse des Endnutzers angeben (oder das Feld leer lassen).' })
        }
      }
      // Schema sicherstellen (idempotent, gecacht) — u. a. die text_style-Spalte,
      // die für ALLE Kategorien gebraucht wird, nicht nur fürs Lebenswerk.
      await ensureLifeworkSchema()

      let langs = sanitizeLangs(languages)
      // Lebenswerk: Der Admin legt EINE Sprache fest — oder keine, dann wählt der
      // Endnutzer beim ersten Start selbst (dafür müssen alle Sprachen offenstehen).
      const euLang = isEnduser && Array.isArray(languages) && languages.length === 1 ? langs[0] : null
      if (isEnduser) langs = euLang ? [euLang] : [...ALLOWED_LANGS]

      // Lebenswerk-Standardkatalog (12 Sitzungen à 10 Fragen), sofern der Admin
      // nicht ausdrücklich auf KI-generierte Fragen umgestellt hat.
      // Beim Lebenswerk führt der Standardkatalog das Interview, solange kein
      // anderer gewählt wurde. (Die frühere zweite Checkbox „nur KI-Fragen" war
      // dieselbe Entscheidung an zweiter Stelle und ist entfallen.)
      // Anamnese: fester Standard-Fragebogen ist Default (Technik wie Lebenswerk,
      // Inhalt eigen/medizinisch). Der Manager kann in den Experteneinstellungen auf
      // FREIE Fragen umstellen — dann sendet die Form den Sentinel '__free__'.
      let catalog = catalogId === '__free__' ? null : (catalogId || null)
      if (isLifework && !catalog) catalog = await ensureLifeworkCatalog(supabase)
      else if (category === 'anamnesis' && catalogId !== '__free__' && !catalog) catalog = await ensureAnamnesisCatalog(supabase)
      else if (category === 'anamnesis_kvsw' && catalogId !== '__free__' && !catalog) catalog = await ensureAnamnesisKvswCatalog(supabase)

      const code = genCode()
      // Lebenswerk kennt nur Variante 2 (durchkomponierte Autobiographie).
      const variant = isLifework ? 2 : ((bookVariant === 2 || bookVariant === '2') ? 2 : 1)
      let days = parseInt(cutoffDays, 10)
      if (!Number.isFinite(days) || days < 0) days = 7
      const insertRow = {
        // name/organizer sind in der DB NOT NULL. Beim Lebenswerk dürfen sie leer
        // bleiben (Endnutzer trägt den Namen beim Start nach) — dann LEERSTRING,
        // nicht null. Die Anzeige zeigt bei leerem Namen „Name folgt".
        id: code, name: String(name || '').trim(), organizer: organizerName,
        gender: gender || null, book_variant: variant,
        // Lebenswerk: kein Anlass-Datum, keine Erfassungsfrist — der Endnutzer
        // bestimmt selbst, wie schnell er erzählt.
        funeral_date: isLifework ? null : (funeralDate || null),
        cutoff_days: isLifework ? 0 : days,
        show_intro_video: isLifework ? false : showIntroVideo !== false,
        // Die Checkbox entscheidet, ob der Transkript-SCHALTER angeboten wird — auch
        // beim Lebenswerk (vorher war das Feld dort fest auf false, die Checkbox lief
        // also ins Leere). Eingeschaltet startet das Interview trotzdem ohne Transkript.
        show_transcript: showTranscript !== false,
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
        text_style: normalizeTextStyle(category, textStyle),
        interview_timer_seconds: sanitizeTimer(interviewTimerSeconds),
        // Begleiteter Co-Interview-Modus nur beim Lebenswerk (ein Erzähler + Begleitperson).
        companion_mode: isLifework ? companionMode === true : false,
        // Probedruck-Tab (Endnutzer-Buchvorschau) nur beim Lebenswerk.
        proof_enabled: isLifework ? proofEnabled === true : false,
        proof_max: isLifework ? sanitizeProofMax(proofMax) : 0,
        proof_used: 0,
        // Einführungs-/Onboarding-Overlay beim ersten Öffnen (alle Kategorien).
        // Standard AN; nur explizit false schaltet es ab.
        show_onboarding: showOnboarding !== false,
        // Deutsche Sprachausgabe-Stimme (gilt nur für Deutsch; andere Sprachen
        // behalten ihre Standardstimme). Default je Kategorie: Anamnese männlich,
        // sonst weiblich (jeweils HD).
        tts_voice: sanitizeVoice(ttsVoice) || defaultTtsVoice(category),
        // Gamification (spürbar motivierender Interview-Modus) — v. a. Anamnese.
        // Default AN; nur explizit false schaltet ab.
        gamification: gamification !== false,
        // Freisprech-Modus (Mikro öffnet automatisch) — alle Produkte. Default AN.
        hands_free: handsFree !== false,
        // Mischform: Mikro öffnet automatisch, aber der Nutzer beendet selbst
        // (keine Sprechpausen-Erkennung). Nur wirksam, wenn hands_free an.
        // Seit 2026-07-22 der STANDARD für neue Bücher — die Sprechpausen-Erkennung
        // schnitt Erzählenden das Wort ab, sobald sie einen Moment nachdachten.
        // Bestehende Bücher behalten ihre Einstellung (NULL wird weiter als „auto"
        // gelesen), damit sich mitten im Interview nichts unter den Füßen ändert.
        mic_manual_stop: micManualStop !== false,
        // Darf der Nutzer den Mikrofon-Modus im Interview selbst umschalten? Default AN.
        mic_mode_switch: micModeSwitch !== false,
        // Live-Sprachgespräch (Azure Voice Live) als zusätzlicher Mikrofon-Modus.
        // Default AUS und **nur vom Superadmin setzbar** (req.auth.admin): Die
        // Strecke ist datenschutzseitig noch nicht freigegeben (eigene
        // Sweden-Central-Ressource, DSFA/Verfahrensverzeichnis stehen aus) und
        // kostet ein Vielfaches von STT→LLM→TTS. Ein Manager darf sie deshalb
        // nicht für sein Buch einschalten können — hier serverseitig verriegelt,
        // nicht bloß im Dashboard ausgeblendet.
        realtime_enabled: req.auth?.admin === true && realtimeEnabled === true,
        // Gastbeiträge (nur Lebenswerk): schon beim Anlegen aktivierbar, damit der
        // Manager Buch-Link und Gast-Link in einem Zug bekommt. Der Gast-Code ist ein
        // EIGENES Geheimnis (der Buch-Code allein öffnet den Endnutzer-Bereich) und
        // wird deshalb gleich hier erzeugt.
        ...(category === LIFEWORK && guestEnabled === true
          ? { guest_enabled: true, guest_code: genCode() }
          : {}),
      }
      let { error } = await supabase.from('memorials').insert(insertRow)
      // Falls image-style.sql / book-layout.sql noch nicht liefen, fehlen die
      // Spalten → ohne sie erneut anlegen (Buch-Anlage darf nie an einer Migration hängen).
      if (error && /image_style|book_layout|show_contributors|text_style|interview_timer_seconds|companion_mode|proof_enabled|proof_max|proof_used|show_onboarding|tts_voice|gamification|hands_free|mic_manual_stop|mic_mode_switch|realtime_enabled|guest_enabled|guest_code|column/i.test(error.message || '')) {
        delete insertRow.image_style
        delete insertRow.book_layout
        delete insertRow.text_style
        delete insertRow.interview_timer_seconds
        delete insertRow.companion_mode
        delete insertRow.gamification
        delete insertRow.hands_free
        delete insertRow.mic_manual_stop
        delete insertRow.mic_mode_switch
        delete insertRow.realtime_enabled
        delete insertRow.show_contributors
        delete insertRow.proof_enabled
        delete insertRow.proof_max
        delete insertRow.proof_used
        delete insertRow.show_onboarding
        delete insertRow.guest_enabled
        delete insertRow.guest_code
        delete insertRow.tts_voice
        ;({ error } = await supabase.from('memorials').insert(insertRow))
      }
      if (error) throw error
      await audit(req, { actor: req.auth, action: 'memorial.create', target: code, detail: { category } })

      // Lebenswerk MIT E-Mail-Adresse: Konto für den Endnutzer anlegen und ihn per
      // Mail einladen. Ein Fehlschlag beim Versand darf das bereits angelegte Buch
      // nicht entwerten — der Admin bekommt stattdessen den Einladungslink zurück.
      // Ohne Adresse bleibt es beim Buch; der Endnutzer kommt dann über den
      // Einladungslink (?code=…) hinein wie ein Beitragender.
      if (!isEnduser || !email) return res.json({ code })

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
        // Keine feste Sprache (Endnutzer wählt selbst) → euLang ist null → die
        // Einladung geht zweisprachig (Deutsch + Englisch) raus.
        await sendAccessMail({ to: email, url: inviteLink(req, invite_token), kind: 'enduser', lang: euLang })
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
      const access = await loadAccessibleMemorial(supabase, req.auth, code, 'id, owner_user, product_category, edit_lock')
      if (access.error) return res.status(access.status).json({ error: access.error })

      const lockNow  = access.memorial?.edit_lock
      const lockLive = !!(lockNow && lockNow.expires && new Date(lockNow.expires).getTime() > Date.now())

      // ── Admin-Bearbeitungs-Lock (Gegenstück zum Endnutzer-Lock, holder='admin') ──
      // Solange der Endnutzer bearbeitet, bekommt der Admin keinen Lock (409) und
      // umgekehrt: hält der Admin den Lock, scheitert die Endnutzer-Acquire (deren
      // Bedingung nur eigenen/abgelaufenen/leeren Lock zulässt).
      if (req.body && req.body.lock) {
        const { action, token: ltok } = req.body.lock
        const TTL = 5 * 60 * 1000   // 5 Min ohne Heartbeat → Lock läuft ab (Heartbeat alle 90 s)
        if (action === 'acquire') {
          const tk = crypto.randomUUID()
          const val = JSON.stringify({ holder: 'admin', token: tk, at: new Date().toISOString(), expires: new Date(Date.now() + TTL).toISOString() })
          const { rows } = await pool().query(
            `update memorials set edit_lock = $2::jsonb
               where id = $1
                 and (edit_lock is null
                      or (edit_lock->>'expires')::timestamptz < now()
                      or edit_lock->>'holder' = 'admin')
             returning edit_lock`, [code, val])
          if (!rows.length) return res.status(409).json({ error: 'Wird gerade vom Endnutzer bearbeitet.' })
          return res.json({ token: tk, expires: rows[0].edit_lock.expires })
        }
        if (action === 'heartbeat') {
          await pool().query(
            `update memorials set edit_lock = jsonb_set(edit_lock, '{expires}', to_jsonb($3::text))
              where id = $1 and edit_lock->>'token' = $2`,
            [code, ltok, new Date(Date.now() + TTL).toISOString()])
          return res.json({ ok: true })
        }
        if (action === 'release') {
          await pool().query(`update memorials set edit_lock = null where id = $1 and edit_lock->>'token' = $2`, [code, ltok])
          return res.json({ ok: true })
        }
        return res.status(400).json({ error: 'Unbekannte Lock-Aktion.' })
      }

      const { field, text, meta, uploadEdit } = req.body || {}

      // Konfliktschutz: Solange der Endnutzer aktiv bearbeitet (Lebenswerk-Lock),
      // darf der Admin das Buch NICHT überschreiben. Die Fern-Freigabe
      // (meta.releaseLock) bleibt erlaubt.
      if (lockLive && lockNow.holder === 'enduser' && !(meta && meta.releaseLock === true)) {
        return res.status(409).json({ error: 'Wird gerade vom Endnutzer bearbeitet – Bearbeitung derzeit gesperrt.' })
      }

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
        // Endnutzer-Kategorien (Lebenswerk + Anamnese): Name und Organisator dürfen
        // leer bleiben — beim Anlegen sind sie dort ausdrücklich optional (der
        // Endnutzer trägt seinen Namen beim ersten Start selbst nach, siehe POST:
        // `if (!name && !isEnduser)`). Bisher prüfte das PATCH nur die Anamnese;
        // ein Lebenswerk OHNE Namen ließ sich deshalb anlegen, aber danach nicht
        // mehr speichern („Name darf nicht leer sein.") — jede spätere Änderung war
        // blockiert, bis jemand einen Namen erfand.
        if (!isEnduserCategory(meta.productCategory)) {
          if (meta.name != null && !String(meta.name).trim()) return res.status(400).json({ error: 'Name darf nicht leer sein.' })
          if (meta.organizer != null && !String(meta.organizer).trim()) return res.status(400).json({ error: 'Organisator darf nicht leer sein.' })
        }

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
          update.languages = sanitizeLangs(meta.languages)
        }
        if ('note' in meta)          update.note = (typeof meta.note === 'string' && meta.note.trim()) ? meta.note.trim() : null
        if ('pickupAddress' in meta) update.pickup_address = sanitizePickupAddress(meta.pickupAddress)
        // Fragebogen: '__free__' = freie Fragen (kein Katalog). Bei der Anamnese
        // bedeutet LEER „Standard-Fragebogen" → auf den geseedeten Katalog auflösen
        // (wie beim Anlegen). Bei anderen Kategorien bleibt leer = kein Katalog.
        if ('catalogId' in meta) {
          if (meta.catalogId === '__free__') update.catalog_id = null
          else if (meta.catalogId) update.catalog_id = meta.catalogId
          else if (meta.productCategory === 'anamnesis') update.catalog_id = await ensureAnamnesisCatalog(supabase)
          else if (meta.productCategory === 'anamnesis_kvsw') update.catalog_id = await ensureAnamnesisKvswCatalog(supabase)
          else update.catalog_id = null
        }
        if ('followups' in meta)     update.followups = sanitizeFollowups(meta.followups)
        // Deutsche Sprachausgabe-Stimme; ungültig → Kategorie-Default.
        if ('ttsVoice' in meta)      update.tts_voice = sanitizeVoice(meta.ttsVoice) || defaultTtsVoice(meta.productCategory)
        if ('imageStyle' in meta)    update.image_style = normalizeStyle(meta.imageStyle) || DEFAULT_STYLE
        if ('bookLayout' in meta)    update.book_layout = normalizeLayout(meta.bookLayout) || DEFAULT_BOOK_LAYOUT
        if ('textStyle' in meta)     update.text_style  = normalizeTextStyle(meta.productCategory || null, meta.textStyle)
        if ('interviewTimerSeconds' in meta) update.interview_timer_seconds = sanitizeTimer(meta.interviewTimerSeconds)
        if ('companionMode' in meta) update.companion_mode = meta.companionMode === true
        if ('gamification' in meta)  update.gamification = meta.gamification !== false
        if ('handsFree' in meta)     update.hands_free = meta.handsFree !== false
        if ('micManualStop' in meta) update.mic_manual_stop = meta.micManualStop === true
        if ('micModeSwitch' in meta) update.mic_mode_switch = meta.micModeSwitch !== false
        // Nur der Superadmin (siehe Anlage oben). Bei allen anderen wird das Feld
        // stillschweigend ignoriert — ein Manager kann das Live-Gespräch weder
        // ein- noch ausschalten.
        if ('realtimeEnabled' in meta && req.auth?.admin === true) update.realtime_enabled = meta.realtimeEnabled === true
        if ('proofEnabled' in meta)  update.proof_enabled = meta.proofEnabled === true
        // Gastbeiträge (nur Lebenswerk): Der Gast-Link ist ein EIGENES Geheimnis.
        // Der Code wird beim ERSTEN Einschalten erzeugt und danach behalten —
        // Ausschalten sperrt den Link, macht aber bereits gedruckte QR-Codes nicht
        // dauerhaft wertlos, weil dasselbe Geheimnis beim Wiedereinschalten gilt.
        if ('guestEnabled' in meta && meta.productCategory === LIFEWORK) {
          const on = meta.guestEnabled === true
          update.guest_enabled = on
          if (on) {
            await ensureLifeworkSchema()
            const { data: cur } = await supabase.from('memorials').select('guest_code').eq('id', code).maybeSingle()
            if (!cur?.guest_code) update.guest_code = genCode()
          }
        }
        if ('proofMax' in meta)      update.proof_max = sanitizeProofMax(meta.proofMax)
        if ('showOnboarding' in meta) update.show_onboarding = meta.showOnboarding !== false
        // Verbrauchte Probedrucke zurücksetzen (Admin gewährt neue Versuche).
        if (meta.resetProofUsed === true) update.proof_used = 0
        // Bearbeitungs-Lock des Endnutzers aus der Ferne lösen (Fern-Freigabe).
        if (meta.releaseLock === true) update.edit_lock = null

        if (Object.keys(update).length === 0) return res.status(400).json({ error: 'Keine Felder zum Aktualisieren.' })

        let { error } = await supabase.from('memorials').update(update).eq('id', code)
        // image_style/book_layout/show_contributors evtl. noch nicht migriert → ohne sie erneut speichern.
        if (error && /image_style|book_layout|text_style|interview_timer_seconds|companion_mode|show_contributors|proof_enabled|proof_max|proof_used|edit_lock|show_onboarding|tts_voice|gamification|hands_free|mic_manual_stop|mic_mode_switch|realtime_enabled|guest_enabled|guest_code|column/i.test(error.message || '')) {
          delete update.guest_enabled
          delete update.guest_code
          delete update.image_style
          delete update.book_layout
          delete update.text_style
          delete update.interview_timer_seconds
          delete update.companion_mode
          delete update.gamification
          delete update.hands_free
          delete update.mic_manual_stop
          delete update.mic_mode_switch
          delete update.realtime_enabled
          delete update.show_contributors
          delete update.proof_enabled
          delete update.proof_max
          delete update.proof_used
          delete update.edit_lock
          delete update.show_onboarding
          delete update.tts_voice
          if (Object.keys(update).length) { ({ error } = await supabase.from('memorials').update(update).eq('id', code)) }
          else error = null
        }
        if (error) throw error
        await audit(req, { actor: req.auth, action: 'memorial.update', target: code, detail: { meta: Object.keys(update) } })
        // Ein frisch erzeugter Gast-Code muss zurück an die Oberfläche, sonst
        // stünde der zweite Link erst nach einem Neuladen zur Verfügung.
        return res.json({ ok: true, ...(update.guest_code ? { guestCode: update.guest_code } : {}) })
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
        const { data: existing } = await supabase.from('memorials')
          .select(`${field}, uploaded_images`).eq('id', code).single()
        const oldPaths = collectImagePaths(existing?.[field])
        const newPaths = new Set(collectImagePaths(text))
        // HOCHGELADENE Originalfotos sind NIE Waisen, auch wenn sie gerade nicht
        // (mehr) im Buch referenziert sind: sie gehoeren dem Nutzer, stehen in
        // memorials.uploaded_images und werden nur ueber den Upload-Endpunkt
        // bzw. die Loeschung des ganzen Buchs entfernt. Ohne diesen Schutz
        // reichte es, ein echtes Foto als Cover zu setzen und das Cover danach
        // zu wechseln — das Original war dann samt Thumbnail unwiederbringlich
        // geloescht (genau so ist es einmal passiert).
        const protectedPaths = new Set()
        for (const u of (Array.isArray(existing?.uploaded_images) ? existing.uploaded_images : [])) {
          if (u?.path) protectedPaths.add(String(u.path).replace(/^\/+/, ''))
          if (u?.thumb_path) protectedPaths.add(String(u.thumb_path).replace(/^\/+/, ''))
        }
        orphanPaths = [...new Set(oldPaths.filter(p => p && !newPaths.has(p) && !protectedPaths.has(String(p).replace(/^\/+/, ''))))]
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
