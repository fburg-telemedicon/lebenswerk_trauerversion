// api/admin/login.js
// POST /api/admin/login  { username, password }  →  { token, admin, cats }
//
// Zwei Login-Wege:
//   1. Env-Admin (ADMIN_USERNAME/PASSWORD)  → Superuser, sieht alle Kategorien.
//   2. app_users-Benutzer einer Kundengruppe → sieht nur erlaubte Kategorien.
// Zugangsdaten-/Token-Logik liegt zentral in ../_lib/auth.js.

const { createClient } = require('@supabase/supabase-js')
const { verifyCredentials, issueToken, isConfigured, verifyPassword } = require('../_lib/auth')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  if (!isConfigured()) {
    return res.status(503).json({ error: 'Server nicht konfiguriert (Admin-Zugangsdaten fehlen).' })
  }
  const { username, password } = req.body || {}

  // 1. Env-Admin (Superuser)
  if (verifyCredentials(username, password)) {
    return res.json({ token: issueToken({ admin: true }), admin: true, cats: '*' })
  }

  // 2. Kundengruppen-Benutzer
  try {
    const { data: user } = await supabase
      .from('app_users')
      .select('id, pw_hash, pw_salt, group_id, is_admin')
      .eq('username', username || '')
      .single()

    if (user && verifyPassword(password, user.pw_hash, user.pw_salt)) {
      let cats = []
      if (user.group_id) {
        const { data: group } = await supabase
          .from('customer_groups')
          .select('allowed_categories')
          .eq('id', user.group_id)
          .single()
        cats = Array.isArray(group?.allowed_categories) ? group.allowed_categories : []
      }
      const token = issueToken({
        uid: user.id,
        admin: Boolean(user.is_admin),
        cats,
        group: user.group_id || null,
      })
      return res.json({ token, admin: Boolean(user.is_admin), cats: user.is_admin ? '*' : cats })
    }
  } catch (e) {
    console.error('/api/admin/login lookup error:', e)
  }

  return res.status(401).json({ error: 'Ungültige Zugangsdaten.' })
}
