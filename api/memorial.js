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
const { isEnduserCategory, isAnamnesisCategory } = require('./_lib/categories')
const { resolvePublicCode } = require('./_lib/access')

// Endnutzer-Kategorien (Lebenswerk, Anamnese, Anamnese KVSW): EIN Endnutzer/Patient
// spricht selbst und darf über den Buch-Code (ohne Login) seine eigenen Stammdaten/
// Sprache nachtragen. Prädikat zentral in api/_lib/categories.js.

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
  if (!isEnduserCategory(m.product_category)) return res.status(403).json({ error: 'Kein Zugriff.' })

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

// Anamnesebogen des Patienten speichern/bestätigen (Kategorie „anamnesis", Step 2).
// Der Patient prüft/bearbeitet den aus seinem Gespräch erzeugten Bogen im
// Beitragenden-Flow und bestätigt ihn am Ende („ok"). Gespeichert wird der KANONISCH
// deutsche Bogen als `eulogy_text` (den lädt der Manager im Dashboard herunter); die
// Bestätigung als Zeitstempel in `intake.bogen_confirmed_at` (kein Schema-Umbau nötig).
// Berechtigung: eingeloggter Endnutzer (Token eu==code) ODER — wie beim Absenden von
// Beiträgen — der Buch-Code allein; der Patient bearbeitet seine EIGENEN Angaben.
async function handleAnamneseBogen(req, res, code, payload) {
  const { data: m } = await supabase
    .from('memorials').select('id, product_category, intake').eq('id', code).maybeSingle()
  if (!m) return res.status(404).json({ error: 'Buch nicht gefunden.' })
  if (!isAnamnesisCategory(m.product_category)) return res.status(403).json({ error: 'Kein Zugriff.' })
  const hasToken = /^Bearer\s/.test(req.headers.authorization || '')
  if (hasToken) {
    if (!checkAuth(req, res)) return                 // ungültiges Token → 401 (in checkAuth)
    if (req.auth.eu !== code) return res.status(403).json({ error: 'Kein Zugriff auf diesen Bogen.' })
  }
  const text = typeof payload?.text === 'string' ? payload.text : ''
  if (!text.trim()) return res.status(400).json({ error: 'Kein Bogentext übergeben.' })
  const confirmed = payload.confirmed === true
  const intake = (m.intake && typeof m.intake === 'object') ? { ...m.intake } : {}
  if (confirmed) intake.bogen_confirmed_at = new Date().toISOString()
  const { error } = await supabase.from('memorials')
    .update({ eulogy_text: text.slice(0, 60000), intake }).eq('id', code)
  if (error) throw error
  return res.json({ ok: true, confirmed, bogen_confirmed_at: intake.bogen_confirmed_at || null })
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
  if (!isEnduserCategory(m.product_category)) return res.status(403).json({ error: 'Kein Zugriff.' })
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
      if (req.body && req.body.anamneseBogen !== undefined) {
        if (!(await enforce(req, res, { name: 'anamnese-bogen', limit: 30, windowSeconds: 600 }))) return
        return await handleAnamneseBogen(req, res, code, req.body.anamneseBogen)
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

      // Buch-Code ODER Gast-Code (Gastbeiträge zum Lebenswerk). Gelesen wird das
      // echte Buch; nach außen bleibt aber der GESCHICKTE Code stehen (siehe unten),
      // damit der Buch-Code — beim Lebenswerk die volle Berechtigung des Endnutzers —
      // den Gast-Browser nie erreicht.
      const target = await resolvePublicCode(supabase, code)
      if (!target) return res.status(404).json({ error: `Code „${code}" nicht gefunden.` })

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
      // show_onboarding + tts_voice sind neu — fehlt eine der Spalten noch, wird OHNE
      // sie erneut gelesen (Beitragenden-Flow darf NIE an einer Migration hängen).
      let { data, error } = await supabase
        .from('memorials').select(`${PUBLIC_FIELDS_BASE}, show_onboarding, tts_voice, gamification, hands_free, mic_manual_stop, mic_mode_switch`).eq('id', target.id).single()
      if (error && /show_onboarding|tts_voice|gamification|hands_free|mic_manual_stop|mic_mode_switch|column/i.test(error.message || '')) {
        ;({ data, error } = await supabase.from('memorials').select(PUBLIC_FIELDS_BASE).eq('id', target.id).single())
      }
      if (error || !data) return res.status(404).json({ error: `Code „${code}" nicht gefunden.` })

      // Lock-Zustand nach außen NUR als Zusammenfassung (Inhaber + Ablauf) — das
      // geheime Lock-Token bleibt intern (es wird nur beim Sperren an den Inhaber
      // zurückgegeben). Abgelaufene Locks gelten als frei.
      const lk = data.edit_lock
      const lockActive = lk && lk.expires && Date.now() < new Date(lk.expires).getTime()
      data.edit_lock = lockActive ? { holder: lk.holder || null, expires: lk.expires } : null

      // Aus `intake` (kategorie-spezifische Notizen des Managers) darf nur wenig
      // nach außen: die Anredeform (Du/Sie). Beim Anamnesebogen zusätzlich die
      // administrativen Bogen-Kopf-Felder (Indikation/Kostenträger/Zugang/Reha-Beginn/
      // Standort — der Patient kennt sie ohnehin und braucht sie für den Bogen-Kopf)
      // sowie der Bestätigungs-Zeitstempel des Patienten-Reviews. Alles andere bleibt
      // intern (insbesondere KEIN generierter Bogentext — der steht in eulogy_text und
      // wird hier nie ausgeliefert).
      // Am Buch hinterlegte Kontakt-E-Mail (z. B. aus einem früheren Support-Ticket)
      // nach außen als top-level Feld — dient dem Vorbelegen des Support-Formulars.
      const contactEmail = (data.intake && typeof data.intake === 'object' && data.intake.contact_email)
        ? String(data.intake.contact_email) : null
      if (isAnamnesisCategory(data.product_category) && data.intake && typeof data.intake === 'object') {
        const src = data.intake
        const pub = {}
        if (src.address) pub.address = String(src.address)
        for (const k of ['indication', 'payer', 'access', 'rehaStart', 'location']) {
          if (src[k]) pub[k] = String(src[k])
        }
        if (src.bogen_confirmed_at) pub.bogen_confirmed_at = String(src.bogen_confirmed_at)
        data.intake = Object.keys(pub).length ? pub : null
      } else {
        data.intake = data.intake?.address ? { address: String(data.intake.address) } : null
      }
      data.contact_email = contactEmail

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
      // Gast: Der Client soll WEITER mit seinem Gast-Code arbeiten (er hängt an
      // jedem Folge-Aufruf). Würde hier die echte id ausgeliefert, hätte der Gast
      // den Buch-Code — und damit beim Lebenswerk Einstellungen, Korrekturabzug
      // und Buchbearbeitung. `guest: true` schaltet den Beitragenden-Modus frei.
      if (target.guest) {
        publicData.id = target.code
        publicData.guest = true
        // Die Kontakt-E-Mail gehört dem Buchinhaber, nicht dem Gast.
        publicData.contact_email = null
      }
      // Der Lebenswerk-Fragenkatalog führt durch das EIGENE Leben („Welche
      // Erinnerungen aus deiner Kindheit …") – für einen Gast, der über einen
      // anderen Menschen erzählt, wäre er sinnlos. Gäste interviewt die KI frei.
      if (target.guest) catalog = null
      return res.json({ ...publicData, owner_logo, catalog })
    }

    res.status(405).json({ error: 'Method not allowed' })
  } catch (e) {
    console.error('/api/memorial error:', e)
    res.status(500).json({ error: 'Das Gedenkbuch konnte nicht geladen werden. Bitte später erneut versuchen.' })
  }
}
