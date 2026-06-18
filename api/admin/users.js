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
//   POST   /api/admin/users   { username, password, allowed_categories, is_admin? }
//   PATCH  /api/admin/users?id=…  { username?, allowed_categories?, is_admin?, password? }
//   DELETE /api/admin/users?id=…

const { createClient } = require('@supabase/supabase-js')
const { checkAuth, hashPassword, validatePasswordPolicy } = require('../_lib/auth')
const { isValidCategory } = require('../_lib/categories')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

function sanitizeCategories(input) {
  if (!Array.isArray(input)) return []
  return [...new Set(input.filter(isValidCategory))]
}

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
    const v = validateLogo((req.body || {}).logo)
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

    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('app_users')
        .select('id, username, allowed_categories, is_admin, created_at')
        .order('created_at', { ascending: true })
      if (error) throw error
      return res.json({ users: data || [] })
    }

    if (req.method === 'POST') {
      const { username, password, allowed_categories, is_admin } = req.body || {}
      if (!username || !String(username).trim()) return res.status(400).json({ error: 'Benutzername fehlt.' })
      const pol = validatePasswordPolicy(password)
      if (!pol.ok) return res.status(400).json({ error: pol.error })
      const { hash, salt } = hashPassword(password)
      const { data, error } = await supabase.from('app_users')
        .insert({
          username: String(username).trim(),
          pw_hash: hash, pw_salt: salt,
          allowed_categories: sanitizeCategories(allowed_categories),
          is_admin: Boolean(is_admin),
        })
        .select('id, username, allowed_categories, is_admin, created_at').single()
      if (error) {
        if (error.code === '23505') return res.status(409).json({ error: 'Benutzername bereits vergeben.' })
        throw error
      }
      return res.json(data)
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
      }
      const { error } = await supabase.from('app_users').update(patch).eq('id', id)
      if (error) {
        if (error.code === '23505') return res.status(409).json({ error: 'Benutzername bereits vergeben.' })
        throw error
      }
      return res.json({ ok: true })
    }

    if (req.method === 'DELETE') {
      const id = (req.query.id || '').trim()
      if (!id) return res.status(400).json({ error: 'id fehlt.' })
      const { error } = await supabase.from('app_users').delete().eq('id', id)
      if (error) throw error
      return res.json({ ok: true })
    }

    return res.status(405).end()
  } catch (e) {
    console.error('/api/admin/users:', e)
    res.status(500).json({ error: e.message })
  }
}
