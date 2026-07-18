// api/admin/login.js
// POST /api/admin/login  { username, password }  →  { token, admin, cats }
//
// Zwei Login-Wege:
//   1. Env-Admin (ADMIN_USERNAME/PASSWORD)  → Superuser, sieht alle Kategorien.
//   2. app_users-Benutzer → sieht nur die für ihn freigeschalteten Kategorien
//      (allowed_categories).
// Zugangsdaten-/Token-Logik liegt zentral in ../_lib/auth.js.

const { createClient } = require('../_lib/store')
const { verifyCredentials, issueToken, isConfigured, verifyPassword, hashPassword, validatePasswordPolicy, generateInviteToken, INVITE_TTL_MS } = require('../_lib/auth')
const { enforce, allow } = require('../_lib/ratelimit')
const { audit } = require('../_lib/audit')
const { sendAccessMail, inviteLink, baseUrl } = require('../_lib/invitemail')
const { ensureLifeworkSchema } = require('../_lib/lifework')
const { ALLOWED_LANGS } = require('../_lib/languages')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

// Antwort-Nutzlast eines erfolgreichen Logins. Endnutzer (Kategorie Lebenswerk)
// bekommen zusätzlich ihren Buch-Code + die vom Admin gesetzte Sprache: Das
// Frontend zeigt ihnen daraufhin kein Dashboard, sondern direkt ihr Interview.
function sessionFor(user, remember = false) {
  const cats = Array.isArray(user.allowed_categories) ? user.allowed_categories : []
  const eu = user.is_enduser ? (user.enduser_memorial || null) : null
  return {
    token: issueToken({ uid: user.id, admin: Boolean(user.is_admin), cats, eu }, { remember }),
    admin: Boolean(user.is_admin),
    cats: user.is_admin ? '*' : cats,
    uid: user.id,
    username: user.username,
    enduser: Boolean(user.is_enduser),
    code: eu,
    lang: user.lang || null,
  }
}

const USER_COLS = 'id, username, allowed_categories, is_admin, is_enduser, enduser_memorial, lang'

// Passwort-Reset anfordern (öffentlich): POST /api/admin/login { reset: "<email>" }.
// Aus Datenschutz-/Sicherheitsgründen IMMER generische Erfolgsmeldung – egal ob die
// Adresse existiert (kein Rückschluss auf vorhandene Konten). Existiert das Konto,
// wird ein frischer Einladungs-/Reset-Token erzeugt und der Link per Mail geschickt
// (derselbe ?invite=-Flow setzt dann das neue Passwort).
async function handleResetRequest(req, res, rawEmail) {
  const email = String(rawEmail || '').trim()
  if (!(await enforce(req, res, { name: 'reset-ip', limit: 5, windowSeconds: 600 }))) return
  const generic = { ok: true }
  if (!email) return res.json(generic)
  // Missbrauchsschutz: pro Zieladresse begrenzen, damit ein bestehendes Konto
  // nicht mit Reset-Mails zugespammt werden kann. `allow` (kein 429) statt
  // `enforce`, damit die Antwort GENERISCH bleibt (kein Rückschluss auf das Konto).
  if (!(await allow(req, { name: 'reset-email', limit: 3, windowSeconds: 3600, key: email.toLowerCase() }))) {
    return res.json(generic)
  }
  try {
    const { data: user } = await supabase
      .from('app_users').select('id, username').ilike('username', email).maybeSingle()
    if (user) {
      const tok = generateInviteToken()
      const exp = new Date(Date.now() + INVITE_TTL_MS).toISOString()
      // Reset entwertet ein evtl. vorhandenes Passwort erst beim Einlösen NICHT –
      // das Konto bleibt bis zum Setzen des neuen Passworts nutzbar. Token genügt.
      await supabase.from('app_users').update({ invite_token: tok, invite_expires: exp }).eq('id', user.id)
      try {
        await sendAccessMail({ to: user.username, url: inviteLink(req, tok), kind: 'reset' })
        await audit(req, { actor: { name: user.username }, action: 'user.reset_requested', target: user.id })
      } catch (e) {
        console.error('/api/admin/login reset mail:', e)
      }
    }
  } catch (e) {
    console.error('/api/admin/login reset lookup:', e)
  }
  return res.json(generic)
}

// Einladungslink einlösen (Self-Onboarding). Bewusst hier im öffentlichen
// Login-Endpunkt eingebettet (kein checkAuth, da der Benutzer noch kein Passwort
// hat) und ohne eigene Serverless-Function (Vercel-Hobby-Limit von 12).
//   GET  /api/admin/login?invite=TOKEN            → { username }   (Link prüfen)
//   POST /api/admin/login  { invite, password }   → setzt Passwort + loggt ein
async function handleInvite(req, res, tok) {
  if (!isConfigured()) {
    return res.status(503).json({ error: 'Server nicht konfiguriert (Admin-Zugangsdaten fehlen).' })
  }
  // Bremse gegen das Durchprobieren von Tokens.
  if (!(await enforce(req, res, { name: 'invite-ip', limit: 20, windowSeconds: 300 }))) return

  await ensureLifeworkSchema()
  const { data: user } = await supabase
    .from('app_users')
    .select(`${USER_COLS}, invite_token, invite_expires`)
    .eq('invite_token', tok)
    .maybeSingle()

  const valid = user && user.invite_token === tok &&
    (!user.invite_expires || Date.now() < new Date(user.invite_expires).getTime())
  if (!valid) {
    return res.status(410).json({ error: 'Dieser Einladungslink ist ungültig oder abgelaufen. Bitte einen neuen Link anfordern.' })
  }

  if (req.method === 'GET') {
    // Für den Endnutzer: die angebotenen Sprachen seines Lebenswerks mitgeben,
    // damit die Sprachwahl VOR der Passwortvergabe erfolgen kann. Ist das Buch
    // bereits auf eine Sprache gepinnt (oder der Admin hat eine gesetzt), steht
    // `lang` fest und die Wahl entfällt.
    let langs = [], lang = user.lang || null
    if (user.is_enduser && user.enduser_memorial) {
      const { data: mem } = await supabase
        .from('memorials').select('languages').eq('id', user.enduser_memorial).maybeSingle()
      langs = (mem?.languages && mem.languages.length) ? mem.languages : ['de']
      if (langs.length === 1) lang = langs[0]
    }
    return res.json({ username: user.username, enduser: Boolean(user.is_enduser), langs, lang })
  }
  if (req.method === 'POST') {
    const { password, lang } = req.body || {}
    const pol = validatePasswordPolicy(password)
    if (!pol.ok) return res.status(400).json({ error: pol.error })
    const { hash, salt } = hashPassword(password)
    const { error } = await supabase
      .from('app_users')
      .update({ pw_hash: hash, pw_salt: salt, invite_token: null, invite_expires: null })
      .eq('id', user.id)
    if (error) {
      console.error('/api/admin/login invite redeem error:', error)
      return res.status(500).json({ error: error.message })
    }
    // Endnutzer: die (vor der Passwortvergabe) getroffene Sprachwahl festschreiben —
    // am Konto UND am Buch (Pin auf eine Sprache), damit die Sprachauswahl nicht bei
    // jedem Start erneut kommt. Danach steht die Sprache auch für die Bestätigungsmail.
    let confirmLang = user.lang || 'de'
    if (user.is_enduser && user.enduser_memorial) {
      const chosen = ALLOWED_LANGS.includes(String(lang)) ? String(lang) : (user.lang || null)
      if (chosen) {
        await supabase.from('app_users').update({ lang: chosen }).eq('id', user.id)
        await supabase.from('memorials').update({ languages: [chosen] }).eq('id', user.enduser_memorial)
        confirmLang = chosen
        user.lang = chosen
      }
    }
    await audit(req, { actor: { uid: user.id, name: user.username, admin: Boolean(user.is_admin) }, action: 'user.invite_redeem' })
    // Bestätigungsmail: dem Nutzer bestätigen, dass sein Konto eingerichtet ist,
    // mit Link zum Login-Screen (BCC an den Betreiber). Ein Fehlschlag darf das
    // erfolgreiche Einlösen nicht kippen.
    try {
      // Login-Link trägt die gewählte Sprache (?lang=…), damit das Login-Fenster
      // beim nächsten Besuch direkt in der richtigen Sprache erscheint.
      const loginUrl = `${baseUrl(req)}/?lang=${encodeURIComponent(confirmLang)}`
      await sendAccessMail({ to: user.username, url: loginUrl, kind: 'confirm', lang: confirmLang })
      await audit(req, { actor: { uid: user.id, name: user.username, admin: Boolean(user.is_admin) }, action: 'user.confirm_sent', detail: { to: user.username } })
    } catch (e) {
      console.error('/api/admin/login confirm mail:', e)
    }
    // Frisch eingerichtetes Konto auf eigenem Gerät (v. a. Endnutzer/Handy):
    // standardmäßig „angemeldet bleiben" (langer Token).
    return res.json(sessionFor(user, true))
  }
  return res.status(405).end()
}

module.exports = async function handler(req, res) {
  // Einladungs-Token (per Query bei GET, im Body bei POST) zuerst behandeln –
  // dieser Pfad braucht keine Admin-Zugangsdaten im Request.
  const inviteTok = (req.query.invite || (req.body && req.body.invite) || '').toString().trim()
  if (inviteTok) return handleInvite(req, res, inviteTok)

  // Passwort-Reset anfordern (öffentlich): { reset: "<email>" }.
  if (req.method === 'POST' && req.body && typeof req.body.reset === 'string') {
    return handleResetRequest(req, res, req.body.reset)
  }

  if (req.method !== 'POST') return res.status(405).end()
  if (!isConfigured()) {
    return res.status(503).json({ error: 'Server nicht konfiguriert (Admin-Zugangsdaten fehlen).' })
  }

  // Brute-Force-Bremse: max. 10 Login-Versuche pro 5 Minuten – einmal pro IP
  // und einmal pro Benutzername (fängt verteilte Angriffe auf EIN Konto ab).
  const { username, password } = req.body || {}
  const remember = Boolean(req.body && req.body.remember)  // „Angemeldet bleiben" → langer Token
  if (!(await enforce(req, res, { name: 'login-ip', limit: 10, windowSeconds: 300 }))) return
  if (username && !(await enforce(req, res, {
    name: 'login-user', limit: 10, windowSeconds: 300,
    key: String(username).toLowerCase().trim(),
  }))) return

  // 1. Env-Admin (Superuser)
  if (verifyCredentials(username, password)) {
    await audit(req, { actor: { uid: null, name: String(username), admin: true }, action: 'login.success', detail: { kind: 'env-admin' } })
    return res.json({ token: issueToken({ admin: true }, { remember }), admin: true, cats: '*', uid: null, username: String(username) })
  }

  // 2. Benutzer aus app_users (Manager ODER Endnutzer)
  try {
    await ensureLifeworkSchema()
    const { data: user } = await supabase
      .from('app_users')
      .select(`${USER_COLS}, pw_hash, pw_salt`)
      .eq('username', username || '')
      .single()

    if (user && verifyPassword(password, user.pw_hash, user.pw_salt)) {
      await audit(req, { actor: { uid: user.id, name: user.username, admin: Boolean(user.is_admin) }, action: 'login.success' })
      return res.json(sessionFor(user, remember))
    }
  } catch (e) {
    console.error('/api/admin/login lookup error:', e)
  }

  // Fehlversuch protokollieren (versuchter Benutzername, kein Passwort).
  await audit(req, { actor: { name: username ? String(username) : null }, action: 'login.failure' })
  return res.status(401).json({ error: 'Ungültige Zugangsdaten.' })
}
