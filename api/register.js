// api/register.js
// POST /api/register  { name?, email, lang?, consent }   (öffentlich, rate-limited)
//
// Self-Service-Registrierung: Ein Interessent legt sich SELBST einen Endnutzer-
// Zugang für ein Lebenswerk (Autobiographie) an — ohne dass ein Manager ihn zuvor
// einlädt. Es entsteht ein Lebenswerk-Buch mit Default-Werten inkl. 5-Minuten-
// Testlimit, dazu das Endnutzer-Konto; die Zugangs-Mail (Passwort setzen & starten)
// geht an den Interessenten mit Blindkopie an den Betreiber (invitemail.js).
//
// Diese Bücher gehören keinem Manager (owner_user = null) → sie erscheinen im
// Dashboard des Superadmins (der alle Bücher sieht) und tragen die Notiz
// „Selbstregistrierung", damit Test-Anmeldungen erkennbar sind.

const { createClient } = require('./_lib/store')
const { enforce } = require('./_lib/ratelimit')
const { genCode } = require('./_lib/codes')
const { generateInviteToken, INVITE_TTL_MS } = require('./_lib/auth')
const { sendAccessMail, inviteLink } = require('./_lib/invitemail')
const { ensureLifeworkSchema, ensureLifeworkCatalog } = require('./_lib/lifework')
const { ALLOWED_LANGS } = require('./_lib/languages')
const { audit } = require('./_lib/audit')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

const TRIAL_TIMER_SECONDS = 300   // 5-Minuten-Testlimit für Selbstregistrierungen
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try {
    // Streng begrenzen: jede Anfrage legt DB-Zeilen an und verschickt eine Mail.
    if (!(await enforce(req, res, { name: 'register-ip', limit: 5, windowSeconds: 3600 }))) return

    let { name, email, lang, consent } = req.body || {}
    email = String(email || '').trim()
    name = String(name || '').trim().slice(0, 120)
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Bitte eine gültige E-Mail-Adresse angeben.' })
    if (consent !== true) return res.status(400).json({ error: 'Bitte der Verarbeitung Ihrer Angaben zustimmen.' })
    // Missbrauchsschutz (E-Mail-Bombing gegen Fremde): pro Zieladresse eng
    // begrenzen — ergänzend zum Duplikat-Konto-Check (jede Adresse bekommt
    // ohnehin nur EINE Zugangsmail, solange ihr Konto besteht).
    if (!(await enforce(req, res, { name: 'register-email', limit: 2, windowSeconds: 86400, key: email.toLowerCase() }))) return
    const chosen = ALLOWED_LANGS.includes(String(lang)) ? String(lang) : 'de'

    await ensureLifeworkSchema()
    const catalog = await ensureLifeworkCatalog(supabase)

    const code = genCode()
    // Lebenswerk-Default-Werte (analog zur Anlage durch einen Manager), aber
    // besitzerlos, mit 5-Minuten-Testlimit und Erkennungs-Notiz.
    const insertRow = {
      id: code,
      name,                 // darf leer sein → Anzeige „Name folgt" (Endnutzer trägt ihn beim Start nach)
      organizer: '',        // organizer ist NOT NULL → Leerstring
      gender: null,
      book_variant: 2,      // Lebenswerk = durchkomponierte Autobiographie
      funeral_date: null,
      cutoff_days: 0,
      show_intro_video: false,
      show_transcript: true,
      show_contributors: false,
      photo_upload_tab: true,
      product_category: 'lifework',
      owner_user: null,     // erscheint im Superadmin-Dashboard
      intake: null,
      languages: [chosen],
      note: 'Selbstregistrierung (Test · 5 Min.)',
      pickup_address: null,
      catalog_id: catalog,
      followups: null,
      interview_timer_seconds: TRIAL_TIMER_SECONDS,
      companion_mode: false,
    }
    let { error } = await supabase.from('memorials').insert(insertRow)
    // Falls einzelne (später ergänzte) Spalten in dieser DB noch fehlen: ohne sie
    // erneut anlegen — eine fehlende Migration darf die Registrierung nicht kippen.
    if (error && /interview_timer_seconds|companion_mode|show_contributors|catalog_id|followups|column/i.test(error.message || '')) {
      delete insertRow.interview_timer_seconds
      delete insertRow.companion_mode
      delete insertRow.show_contributors
      ;({ error } = await supabase.from('memorials').insert(insertRow))
    }
    if (error) throw error

    // Endnutzer-Konto (ohne Passwort — wird über den Einladungslink gesetzt).
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
        lang: chosen,
      })
      .select('id').single()
    if (euErr) {
      // Konto nicht anlegbar (z. B. Adresse schon vergeben) → Buch wieder entfernen.
      await supabase.from('memorials').delete().eq('id', code)
      if (euErr.code === '23505' || /duplicate key|app_users_username_key/i.test(euErr.message || '')) {
        return res.status(409).json({ error: 'Für diese E-Mail-Adresse besteht bereits ein Zugang. Bitte melden Sie sich an oder setzen Sie Ihr Passwort über „Passwort vergessen" neu.' })
      }
      throw euErr
    }
    await audit(req, { actor: { name: email }, action: 'enduser.self_register', target: eu.id, detail: { code, lang: chosen } })

    // Zugangs-Mail (Passwort setzen & starten) — BCC an den Betreiber ist in
    // invitemail.js fest verdrahtet. Ein Fehlschlag darf die Anlage nicht kippen.
    let email_sent = true
    try {
      await sendAccessMail({ to: email, url: inviteLink(req, invite_token), kind: 'enduser', lang: chosen })
      await audit(req, { actor: { name: email }, action: 'enduser.invite_sent', target: eu.id, detail: { to: email, self: true } })
    } catch (e) {
      console.error('/api/register mail:', e)
      email_sent = false
    }
    return res.json({ ok: true, email_sent })
  } catch (e) {
    console.error('/api/register error:', e)
    return res.status(500).json({ error: 'Die Registrierung ist fehlgeschlagen. Bitte später erneut versuchen.', _debug: String(e && e.message || e).slice(0, 300) })
  }
}
