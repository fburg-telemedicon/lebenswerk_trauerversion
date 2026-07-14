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
const { LIFEWORK } = require('./_lib/lifework')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

// PATCH /api/memorial?code=ABC123  { imageStyle?, bookLayout? }
// Der EINSTELLUNGS-Tab des Endnutzers (Kategorie Lebenswerk): Er darf Grafikstil
// und Buchlayout SEINES eigenen Buchs ändern — mehr nicht. Autorisiert allein der
// `eu`-Claim seines Tokens (der Buch-Code); ein fremder Code wird abgewiesen.
async function handleEnduserPatch(req, res, code) {
  if (!checkAuth(req, res)) return
  if (!req.auth.eu || req.auth.eu !== code) {
    return res.status(403).json({ error: 'Kein Zugriff auf dieses Buch.' })
  }
  const { imageStyle, bookLayout } = req.body || {}
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
  if (Object.keys(update).length === 0) return res.status(400).json({ error: 'Keine Änderung übergeben.' })
  const { error } = await supabase.from('memorials').update(update).eq('id', code)
  if (error) throw error
  return res.json({ ok: true, ...update })
}

// Der Endnutzer trägt seinen Namen nach. Beim Lebenswerk ist der Name bei der
// Anlage OPTIONAL — kennt der Manager ihn nicht, gibt ihn der Endnutzer beim
// Start selbst ein, und er gehört ans Buch (Titel, Poster, Stammbaum), nicht nur
// an den Beitrag. Deshalb dieser eine schmale Schreibpfad ohne Login: Er greift
// NUR bei einem Lebenswerk, NUR solange kein Name gesetzt ist, und schreibt sonst
// nichts. Berechtigung ist – wie beim Absenden von Beiträgen – der Buch-Code.
async function handleNameClaim(req, res, code, name) {
  const clean = String(name || '').trim().slice(0, 120)
  if (!clean) return res.status(400).json({ error: 'Name fehlt.' })
  const { data: m } = await supabase
    .from('memorials').select('id, name, product_category').eq('id', code).maybeSingle()
  if (!m) return res.status(404).json({ error: 'Buch nicht gefunden.' })
  if (m.product_category !== LIFEWORK) return res.status(403).json({ error: 'Kein Zugriff.' })
  if (String(m.name || '').trim()) return res.status(409).json({ error: 'Der Name steht bereits fest.' })
  // Beim Lebenswerk trägt auch die Organisator-Spalte den Namen des Endnutzers.
  const { error } = await supabase.from('memorials').update({ name: clean, organizer: clean }).eq('id', code)
  if (error) throw error
  return res.json({ ok: true, name: clean })
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()

  try {
    if (req.method === 'PATCH') {
      const code = (req.query.code || '').toUpperCase().trim()
      if (!code) return res.status(400).json({ error: 'Code fehlt.' })
      if (req.body && req.body.name !== undefined && req.body.imageStyle === undefined && req.body.bookLayout === undefined) {
        if (!(await enforce(req, res, { name: 'memorial-name', limit: 10, windowSeconds: 600 }))) return
        return await handleNameClaim(req, res, code, req.body.name)
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
      const PUBLIC_FIELDS =
        'id, name, gender, birth_year, death_year, organizer, product_category, languages, funeral_date, cutoff_days, show_intro_video, show_transcript, photo_upload_tab, owner_user, catalog_id, followups, image_style, book_layout, intake, created_at'
      const { data, error } = await supabase
        .from('memorials').select(PUBLIC_FIELDS).eq('id', code).single()
      if (error || !data) return res.status(404).json({ error: `Code „${code}" nicht gefunden.` })

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
