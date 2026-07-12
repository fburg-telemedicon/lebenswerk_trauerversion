// api/admin/users.js
// Verwaltung von Login-Benutzern (NUR für Admins) UND die eigenen
// Konto-Einstellungen (?self=1, für jeden eingeloggten Benutzer).
//
// Eigene Einstellungen (Firmenlogo), kein Admin-Recht nötig:
//   GET   /api/admin/users?self=1           → { logo }
//   PATCH /api/admin/users?self=1  { logo }  → { ok }   (logo = Data-URL oder null)
//
// Benutzerverwaltung (nur Admin):
//   GET    /api/admin/users                       → { users: [...] }
//   POST   /api/admin/users   { username, allowed_categories, is_admin? }
//            → legt den Benutzer OHNE Passwort an und gibt einen Einladungs-Token
//              zurück (invite_token). Der Benutzer vergibt sich das Passwort selbst
//              über ?invite=TOKEN (eingelöst in api/admin/login.js).
//   PATCH  /api/admin/users?id=…  { username?, allowed_categories?, is_admin?, password?, regenerate_invite? }
//   DELETE /api/admin/users?id=…

const { createClient } = require('../_lib/store')
const { checkAuth, hashPassword, validatePasswordPolicy, verifyPassword, generateInviteToken, INVITE_TTL_MS } = require('../_lib/auth')
const { isValidCategory } = require('../_lib/categories')
const { audit } = require('../_lib/audit')
const { seedDemoData } = require('../_lib/demo-seed')
const { sendAccessMail, inviteLink } = require('../_lib/invitemail')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

function sanitizeCategories(input) {
  if (!Array.isArray(input)) return []
  return [...new Set(input.filter(isValidCategory))]
}

// Benutzername = E-Mail-Adresse (Login-Kennung). Einfache, bewusst tolerante Prüfung.
function isEmail(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim()) }

// Erlaubte Bildtypen + Größenobergrenze für das als Data-URL gespeicherte Logo.
const ALLOWED_LOGO_MIME = ['png', 'jpeg', 'jpg', 'gif', 'webp', 'svg+xml']
const MAX_LOGO_CHARS = 2_000_000 // ~1,4 MB Bild als Base64

function validateLogo(logo) {
  if (logo === null || logo === '') return { value: null }
  if (typeof logo !== 'string') return { error: 'Ungültiges Logo-Format.' }
  const m = /^data:image\/([a-z0-9.+-]+);base64,/i.exec(logo)
  if (!m) return { error: 'Logo muss ein Bild (Data-URL) sein.' }
  if (!ALLOWED_LOGO_MIME.includes(m[1].toLowerCase())) return { error: 'Nicht unterstütztes Bildformat.' }
  if (logo.length > MAX_LOGO_CHARS) return { error: 'Logo ist zu groß (max. ca. 1,4 MB).' }
  return { value: logo }
}

// Eigene Konto-Einstellungen (Firmenlogo) des eingeloggten Benutzers.
// Nur echte app_users-Konten haben eine uid; der Env-Superadmin (uid null)
// behält bewusst das Demo-Logo.
async function handleSelf(req, res) {
  if (!req.auth.uid) {
    return res.status(400).json({ error: 'Einstellungen sind nur für Benutzerkonten verfügbar (der Administrator nutzt das Standard-Logo).' })
  }
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('app_users').select('username, logo').eq('id', req.auth.uid).single()
    if (error) throw error
    return res.json({ username: data?.username ?? null, logo: data?.logo ?? null })
  }
  if (req.method === 'PATCH' || req.method === 'PUT') {
    const body = req.body || {}

    // Eigenes Passwort ändern: { currentPassword, newPassword }. Das aktuelle
    // Passwort muss stimmen (auch wenn der Token schon authentifiziert ist –
    // verhindert Missbrauch einer offen liegenden Sitzung).
    if (body.currentPassword !== undefined || body.newPassword !== undefined) {
      const { currentPassword, newPassword } = body
      if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: 'Aktuelles und neues Passwort sind erforderlich.' })
      }
      const pol = validatePasswordPolicy(newPassword)
      if (!pol.ok) return res.status(400).json({ error: pol.error })
      const { data: user, error: selErr } = await supabase
        .from('app_users').select('pw_hash, pw_salt').eq('id', req.auth.uid).single()
      if (selErr) throw selErr
      if (!user || !verifyPassword(currentPassword, user.pw_hash, user.pw_salt)) {
        return res.status(403).json({ error: 'Das aktuelle Passwort ist nicht korrekt.' })
      }
      const { hash, salt } = hashPassword(newPassword)
      const { error } = await supabase
        .from('app_users').update({ pw_hash: hash, pw_salt: salt }).eq('id', req.auth.uid)
      if (error) throw error
      await audit(req, { actor: req.auth, action: 'user.password_change', target: req.auth.uid, detail: { self: true } })
      return res.json({ ok: true })
    }

    // Sonst: Firmenlogo speichern/entfernen.
    const v = validateLogo(body.logo)
    if (v.error) return res.status(400).json({ error: v.error })
    const { error } = await supabase
      .from('app_users').update({ logo: v.value }).eq('id', req.auth.uid)
    if (error) throw error
    return res.json({ ok: true })
  }
  return res.status(405).end()
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (!checkAuth(req, res)) return

  try {
    // Eigene Einstellungen – vor der Admin-Schranke, für jeden eingeloggten Benutzer.
    if (req.query.self) return await handleSelf(req, res)

    if (!req.auth.admin) return res.status(403).json({ error: 'Nur Administratoren.' })

    // Audit-Log lesen (?audit=1). Bewusst hier eingebettet statt als eigene
    // Function – das Vercel-Hobby-Limit von 12 Functions ist bereits erreicht.
    if (req.query.audit) {
      if (req.method !== 'GET') return res.status(405).end()
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500)
      let q = supabase.from('audit_log')
        .select('id, created_at, actor_uid, actor_name, is_admin, action, target, ip, detail')
        .order('created_at', { ascending: false })
        .limit(limit)
      if (req.query.action) q = q.eq('action', String(req.query.action))
      const { data, error } = await q
      if (error) throw error
      return res.json({ entries: data || [] })
    }

    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('app_users')
        .select('id, username, allowed_categories, is_admin, created_at, pw_hash, invite_token, invite_expires')
        .order('created_at', { ascending: true })
      if (error) throw error
      // Passwort-Hash NIE ausliefern; stattdessen nur ableiten, ob schon ein
      // Passwort gesetzt ist. Der Einladungs-Token wird nur für noch offene
      // (passwortlose) Einladungen mitgegeben, damit der Admin den Link erneut
      // kopieren kann.
      const users = (data || []).map(u => ({
        id: u.id,
        username: u.username,
        allowed_categories: u.allowed_categories,
        is_admin: u.is_admin,
        created_at: u.created_at,
        has_password: Boolean(u.pw_hash),
        invite_token: u.pw_hash ? null : u.invite_token,
        invite_expires: u.pw_hash ? null : u.invite_expires,
      }))
      return res.json({ users })
    }

    if (req.method === 'POST') {
      const { username, allowed_categories, is_admin, demo } = req.body || {}
      const email = String(username || '').trim()
      if (!email) return res.status(400).json({ error: 'E-Mail-Adresse fehlt.' })
      // Benutzername = E-Mail: als gültige Adresse verlangen (Login + Einladung/Reset).
      if (!isEmail(email)) return res.status(400).json({ error: 'Bitte eine gültige E-Mail-Adresse angeben.' })
      // Kein Passwort bei der Anlage: Es wird ein Einladungs-Token erzeugt, über
      // den sich der Benutzer beim ersten Aufruf selbst ein Passwort vergibt.
      const invite_token = generateInviteToken()
      const invite_expires = new Date(Date.now() + INVITE_TTL_MS).toISOString()
      const cats = sanitizeCategories(allowed_categories)
      const { data, error } = await supabase.from('app_users')
        .insert({
          username: email,
          pw_hash: null, pw_salt: null,
          invite_token, invite_expires,
          allowed_categories: cats,
          is_admin: Boolean(is_admin),
        })
        .select('id, username, allowed_categories, is_admin, created_at, invite_token, invite_expires').single()
      if (error) {
        if (error.code === '23505') return res.status(409).json({ error: 'Benutzername bereits vergeben.' })
        throw error
      }
      await audit(req, { actor: req.auth, action: 'user.create', target: data.id, detail: { username: data.username, is_admin: data.is_admin } })

      // Demo-Daten anreichern (Default: ja). Bücher unter einer Kategorie, die
      // der Benutzer auch sieht – bevorzugt 'memorial' (Trauerbuch). Ein
      // Fehler beim Seeden darf die Benutzeranlage NICHT scheitern lassen.
      const result = { ...data }
      if (demo !== false) {
        const seedCat = cats.includes('memorial') ? 'memorial' : (cats[0] || 'memorial')
        try {
          result.demo = await seedDemoData(supabase, data.id, seedCat)
          await audit(req, { actor: req.auth, action: 'user.demo_seed', target: data.id, detail: result.demo })
        } catch (e) {
          console.error('/api/admin/users demo-seed:', e)
          result.demo_error = e.message
        }
      }

      // Einladungs-E-Mail an den neuen Benutzer (best effort; Fehler soll die
      // Anlage NICHT scheitern lassen – der Admin kann den Link zusätzlich kopieren).
      try {
        await sendAccessMail({ to: data.username, url: inviteLink(req, invite_token), kind: 'invite' })
        result.email_sent = true
        await audit(req, { actor: req.auth, action: 'user.invite_sent', target: data.id, detail: { to: data.username } })
      } catch (e) {
        console.error('/api/admin/users invite mail:', e)
        result.email_sent = false
        result.email_error = e.message
      }
      return res.json(result) // enthält invite_token + email_sent + ggf. demo-Ergebnis
    }

    if (req.method === 'PATCH') {
      const id = (req.query.id || '').trim()
      if (!id) return res.status(400).json({ error: 'id fehlt.' })
      const patch = {}
      if (req.body.username !== undefined) patch.username = String(req.body.username).trim()
      if (req.body.allowed_categories !== undefined) patch.allowed_categories = sanitizeCategories(req.body.allowed_categories)
      if (req.body.is_admin !== undefined) patch.is_admin = Boolean(req.body.is_admin)
      if (req.body.password) {
        const pol = validatePasswordPolicy(req.body.password)
        if (!pol.ok) return res.status(400).json({ error: pol.error })
        const { hash, salt } = hashPassword(req.body.password)
        patch.pw_hash = hash; patch.pw_salt = salt
        // Mit gesetztem Passwort wird eine noch offene Einladung entwertet.
        patch.invite_token = null; patch.invite_expires = null
      }
      // Neuen Einladungslink erzeugen (z. B. wenn der alte abgelaufen ist). Setzt
      // das Konto wieder in den passwortlosen Einladungszustand zurück.
      if (req.body.regenerate_invite) {
        patch.invite_token = generateInviteToken()
        patch.invite_expires = new Date(Date.now() + INVITE_TTL_MS).toISOString()
        patch.pw_hash = null; patch.pw_salt = null
      }
      const { error } = await supabase.from('app_users').update(patch).eq('id', id)
      if (error) {
        if (error.code === '23505') return res.status(409).json({ error: 'Benutzername bereits vergeben.' })
        throw error
      }
      // Geänderte Felder protokollieren – aber NIE Passwort-/Token-Material.
      const changed = Object.keys(patch).filter(k => !['pw_hash', 'pw_salt', 'invite_token', 'invite_expires'].includes(k))
      if (patch.pw_hash) changed.push('password')
      if (req.body.regenerate_invite) changed.push('invite')
      await audit(req, { actor: req.auth, action: 'user.update', target: id, detail: { changed } })
      // Bei neu erzeugter Einladung den Token zurückgeben (Admin kann den Link
      // zusätzlich kopieren) UND die Einladungs-E-Mail erneut versenden.
      if (req.body.regenerate_invite) {
        const out = { ok: true, invite_token: patch.invite_token, invite_expires: patch.invite_expires }
        try {
          const { data: u } = await supabase.from('app_users').select('username').eq('id', id).single()
          if (u?.username) {
            await sendAccessMail({ to: u.username, url: inviteLink(req, patch.invite_token), kind: 'invite' })
            out.email_sent = true
            await audit(req, { actor: req.auth, action: 'user.invite_sent', target: id, detail: { to: u.username } })
          }
        } catch (e) {
          console.error('/api/admin/users regenerate mail:', e)
          out.email_sent = false; out.email_error = e.message
        }
        return res.json(out)
      }
      return res.json({ ok: true })
    }

    if (req.method === 'DELETE') {
      const id = (req.query.id || '').trim()
      if (!id) return res.status(400).json({ error: 'id fehlt.' })
      const { error } = await supabase.from('app_users').delete().eq('id', id)
      if (error) throw error
      await audit(req, { actor: req.auth, action: 'user.delete', target: id })
      return res.json({ ok: true })
    }

    return res.status(405).end()
  } catch (e) {
    console.error('/api/admin/users:', e)
    res.status(500).json({ error: e.message })
  }
}
