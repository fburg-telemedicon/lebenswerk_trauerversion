// api/memorial.js
// GET  /api/memorial?code=ABC123  → memorial data
//
// Die Anlage eines Gedenkbuchs läuft ausschließlich authentifiziert über
// POST /api/admin/memorials (Produktkategorie + Eigentümer werden dort
// serverseitig aus dem Token gesetzt). Ein öffentlicher Anlage-Endpoint
// wäre ein ungeschützter Schreibzugriff und existiert deshalb hier nicht.

const { createClient } = require('./_lib/store')
const { enforce } = require('./_lib/ratelimit')
const { checkAuth } = require('./_lib/auth')
const { normalizeStyle } = require('./_lib/image-styles')
const { normalizeLayout } = require('./_lib/book-layouts')
const { normalizeTextStyle } = require('./_lib/text-styles')
const { LIFEWORK } = require('./_lib/lifework')
const { ALLOWED_LANGS } = require('./_lib/languages')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

// PATCH /api/memorial?code=ABC123  { imageStyle?, bookLayout? }
// Der EINSTELLUNGS-Tab des Endnutzers (Kategorie Lebenswerk): Er darf Grafikstil
// und Buchlayout SEINES eigenen Buchs ändern — mehr nicht. Zwei Wege sind erlaubt:
//  (a) eingeloggter Endnutzer — Token mit `eu`-Claim == code, oder
//  (b) NUR beim Lebenswerk: der Buch-Code allein (ohne Login). Beim Lebenswerk ist
//      die E-Mail/das Login optional; dann ist der Code die einzige Berechtigung —
//      dasselbe Vertrauensmodell wie beim Namen-Nachtragen und beim Absenden von
//      Antworten. Grafikstil/Buchlayout sind risikoarm.
async function handleEnduserPatch(req, res, code) {
  const { data: m } = await supabase
    .from('memorials').select('id, product_category').eq('id', code).maybeSingle()
  if (!m) return res.status(404).json({ error: 'Buch nicht gefunden.' })
  const hasToken = /^Bearer\s/.test(req.headers.authorization || '')
  let ok = false
  if (hasToken) {
    if (!checkAuth(req, res)) return                 // ungültiges Token → 401 (in checkAuth)
    ok = req.auth.eu === code
  } else {
    ok = m.product_category === LIFEWORK             // Code-basiert nur beim Lebenswerk
  }
  if (!ok) return res.status(403).json({ error: 'Kein Zugriff auf dieses Buch.' })
  const { imageStyle, bookLayout, textStyle } = req.body || {}
  const update = {}
  if (imageStyle !== undefined) {
    const s = normalizeStyle(imageStyle)
    if (!s) return res.status(400).json({ error: 'Unbekannter Grafikstil.' })
    update.image_style = s
  }
  if (bookLayout !== undefined) {
    const l = normalizeLayout(bookLayout)
    if (!l) return res.status(400).json({ error: 'Unbekanntes Buchlayout.' })
    update.book_layout = l
  }
  if (textStyle !== undefined) {
    // Auf die für die Kategorie erlaubten Schreibstile beschränkt (Default sonst).
    update.text_style = normalizeTextStyle(m.product_category, textStyle)
  }
  if (Object.keys(update).length === 0) return res.status(400).json({ error: 'Keine Änderung übergeben.' })
  const { error } = await supabase.from('memorials').update(update).eq('id', code)
  if (error) throw error
  return res.json({ ok: true, ...update })
}

// Der Endnutzer trägt beim Start SEINE Stammdaten nach. Beim Lebenswerk sind
// Name/Geschlecht/Anredeform bei der Anlage OPTIONAL — kennt der Manager sie
// nicht, gibt der Endnutzer sie beim Start selbst ein, und sie gehören ans BUCH
// (Titel/Poster/Stammbaum lesen den Namen dort; das Geschlecht steuert die KI-
// Formulierungen), nicht nur an den Beitrag. Deshalb dieser eine schmale
// Schreibpfad ohne Login: NUR beim Lebenswerk, jedes Feld NUR solange es am Buch
// leer ist. Berechtigung ist – wie beim Absenden von Beiträgen – der Buch-Code.
async function handleEnduserStart(req, res, code, body) {
  const { data: m } = await supabase
    .from('memorials').select('id, name, gender, intake, product_category').eq('id', code).maybeSingle()
  if (!m) return res.status(404).json({ error: 'Buch nicht gefunden.' })
  if (m.product_category !== LIFEWORK) return res.status(403).json({ error: 'Kein Zugriff.' })

  const update = {}
  const name = String(body.name || '').trim().slice(0, 120)
  if (name && !String(m.name || '').trim()) { update.name = name; update.organizer = name }
  const gender = String(body.gender || '').trim().slice(0, 40)
  if (gender && !String(m.gender || '').trim()) update.gender = gender
  const address = String(body.address || '').trim().slice(0, 20)
  if (address && !(m.intake && m.intake.address)) {
    update.intake = { ...(m.intake && typeof m.intake === 'object' ? m.intake : {}), address }
  }
  if (Object.keys(update).length === 0) return res.json({ ok: true, unchanged: true })
  const { error } = await supabase.from('memorials').update(update).eq('id', code)
  if (error) throw error
  return res.json({ ok: true, ...update })
}

// Sprachwahl des Endnutzers festschreiben: Beim Lebenswerk erzählt EINE Person.
// Bietet der Manager mehrere Sprachen an („Endnutzer wählt selbst"), wählt der
// Endnutzer die Sprache einmal — danach wird das Buch fest auf diese eine Sprache
// gepinnt (`languages = [wahl]`), damit die Sprachauswahl nicht bei jedem Start
// erneut erscheint (weder beim Endnutzer-Login noch über den `?code=`-Link).
// Berechtigung wie beim Namen-Nachtragen: der Buch-Code genügt, NUR beim Lebenswerk.
async function handleLangPin(req, res, code, lang) {
  const l = String(lang || '').trim()
  if (!ALLOWED_LANGS.includes(l)) return res.status(400).json({ error: 'Unbekannte Sprache.' })
  const { data: m } = await supabase
    .from('memorials').select('id, product_category, languages').eq('id', code).maybeSingle()
  if (!m) return res.status(404).json({ error: 'Buch nicht gefunden.' })
  if (m.product_category !== LIFEWORK) return res.status(403).json({ error: 'Kein Zugriff.' })
  const offered = Array.isArray(m.languages) ? m.languages : []
  if (offered.length === 1) return res.json({ ok: true, languages: offered })   // schon gepinnt
  if (offered.length && !offered.includes(l)) return res.status(400).json({ error: 'Sprache nicht angeboten.' })
  const { error } = await supabase.from('memorials').update({ languages: [l] }).eq('id', code)
  if (error) throw error
  return res.json({ ok: true, languages: [l] })
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()

  try {
    if (req.method === 'PATCH') {
      const code = (req.query.code || '').toUpperCase().trim()
      if (!code) return res.status(400).json({ error: 'Code fehlt.' })
      if (req.body && (req.body.name !== undefined || req.body.gender !== undefined || req.body.address !== undefined)
          && req.body.imageStyle === undefined && req.body.bookLayout === undefined && req.body.language === undefined) {
        if (!(await enforce(req, res, { name: 'memorial-name', limit: 10, windowSeconds: 600 }))) return
        return await handleEnduserStart(req, res, code, req.body)
      }
      if (req.body && req.body.language !== undefined) {
        if (!(await enforce(req, res, { name: 'memorial-lang', limit: 10, windowSeconds: 600 }))) return
        return await handleLangPin(req, res, code, req.body.language)
      }
      return await handleEnduserPatch(req, res, code)
    }

    if (req.method === 'GET') {
      const code = (req.query.code || '').toUpperCase().trim()
      if (!code) return res.status(400).json({ error: 'Code fehlt.' })

      // Schutz vor dem Durchprobieren von Codes (Enumeration): begrenzt die
      // Code-Abfragen pro IP. Großzügig genug für den normalen Beitragenden-
      // Flow; fail-open (sperrt bei Limiter-Ausfall niemanden aus).
      if (!(await enforce(req, res, { name: 'memorial', limit: 60, windowSeconds: 60 }))) return

      // BEWUSST nur die für den Beitragenden-Flow nötigen Felder ausliefern –
      // NICHT die ganze Zeile. Insbesondere die generierten Inhalte
      // (book_v1/book_v2/eulogy_text) enthalten die aggregierten Erinnerungen
      // ALLER Beitragenden und dürfen nicht über den öffentlichen, nur per
      // 6-stelligem Code geschützten Endpunkt nach außen gelangen. Auch
      // intake (kategorie-spezifische Notizen) und owner_user bleiben intern.
      // image_style/book_layout sind für den Einstellungs-Tab des Endnutzers nötig
      // (Kategorie Lebenswerk); sie verraten nichts über die Inhalte des Buchs.
      // `show_onboarding` ist neu — fehlt die Spalte noch (Migration lief noch nicht),
      // wird OHNE sie erneut gelesen, damit der Beitragenden-Flow NIE an einer
      // Migration hängt (analog zum Fallback der Admin-Liste).
      const PUBLIC_FIELDS_BASE =
        'id, name, gender, birth_year, death_year, organizer, product_category, languages, funeral_date, cutoff_days, show_intro_video, show_transcript, photo_upload_tab, owner_user, catalog_id, followups, image_style, book_layout, text_style, interview_timer_seconds, companion_mode, proof_enabled, proof_max, proof_used, edit_lock, interview_closed, book_finalized, intake, created_at'
      let { data, error } = await supabase
        .from('memorials').select(`${PUBLIC_FIELDS_BASE}, show_onboarding`).eq('id', code).single()
      if (error && /show_onboarding|column/i.test(error.message || '')) {
        ;({ data, error } = await supabase.from('memorials').select(PUBLIC_FIELDS_BASE).eq('id', code).single())
      }
      if (error || !data) return res.status(404).json({ error: `Code „${code}" nicht gefunden.` })

      // Lock-Zustand nach außen NUR als Zusammenfassung (Inhaber + Ablauf) — das
      // geheime Lock-Token bleibt intern (es wird nur beim Sperren an den Inhaber
      // zurückgegeben). Abgelaufene Locks gelten als frei.
      const lk = data.edit_lock
      const lockActive = lk && lk.expires && Date.now() < new Date(lk.expires).getTime()
      data.edit_lock = lockActive ? { holder: lk.holder || null, expires: lk.expires } : null

      // Aus `intake` (kategorie-spezifische Notizen des Managers) darf nur EIN Feld
      // nach außen: die Anredeform (Du/Sie) des Lebenswerks. Ist sie gesetzt, fragt
      // der Beitragenden-Flow sie nicht noch einmal ab. Alles andere bleibt intern.
      data.intake = data.intake?.address ? { address: String(data.intake.address) } : null

      // Zugeordneten Fragenkatalog (Name + Kapitel/Fragen) mitliefern, damit der
      // Beitragenden-Flow das Interview daran entlangführen kann. Ohne Katalog
      // bleibt catalog null → die KI überlegt die Fragen wie bisher selbst.
      let catalog = null
      if (data.catalog_id) {
        const { data: cat } = await supabase
          .from('question_catalogs').select('name, chapters').eq('id', data.catalog_id).single()
        if (cat) catalog = { name: cat.name, chapters: Array.isArray(cat.chapters) ? cat.chapters : [] }
      }

      // Firmenlogo des Eigentümers anhängen (für die Anzeige beim Beitragenden).
      // Bei Büchern des Env-Admins (owner_user null) bleibt owner_logo null →
      // der Beitragenden-Flow zeigt dann das Standard-/Demo-Logo.
      let owner_logo = null
      if (data.owner_user) {
        const { data: owner } = await supabase
          .from('app_users').select('logo').eq('id', data.owner_user).single()
        owner_logo = owner?.logo || null
      }
      // owner_user + catalog_id waren nur intern nötig – nicht nach außen geben;
      // der Katalog-Inhalt wird als `catalog` (Name + Kapitel) mitgeschickt.
      const { owner_user, catalog_id, ...publicData } = data
      return res.json({ ...publicData, owner_logo, catalog })
    }

    res.status(405).json({ error: 'Method not allowed' })
  } catch (e) {
    console.error('/api/memorial error:', e)
    res.status(500).json({ error: 'Das Gedenkbuch konnte nicht geladen werden. Bitte später erneut versuchen.' })
  }
}
