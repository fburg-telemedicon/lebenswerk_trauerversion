// api/admin/users.js
// Verwaltung von Kundengruppen und Login-Benutzern. NUR für Admins.
//
// GET    /api/admin/users                       → { groups: [...], users: [...] }
// POST   /api/admin/users   { type:'group', name, allowed_categories }
// POST   /api/admin/users   { type:'user',  username, password, group_id, is_admin? }
// PATCH  /api/admin/users?id=…  { type:'group', name?, allowed_categories? }
// PATCH  /api/admin/users?id=…  { type:'user',  username?, group_id?, is_admin?, password? }
// DELETE /api/admin/users?type=group|user&id=…

const { createClient } = require('@supabase/supabase-js')
const { checkAuth, hashPassword } = require('../_lib/auth')
const { isValidCategory } = require('../_lib/categories')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

function sanitizeCategories(input) {
  if (!Array.isArray(input)) return []
  return [...new Set(input.filter(isValidCategory))]
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (!checkAuth(req, res)) return
  if (!req.auth.admin) return res.status(403).json({ error: 'Nur Administratoren.' })

  try {
    if (req.method === 'GET') {
      const [{ data: groups, error: gErr }, { data: users, error: uErr }] = await Promise.all([
        supabase.from('customer_groups').select('id, name, allowed_categories, created_at').order('created_at', { ascending: true }),
        supabase.from('app_users').select('id, username, group_id, is_admin, created_at').order('created_at', { ascending: true }),
      ])
      if (gErr) throw gErr
      if (uErr) throw uErr
      return res.json({ groups: groups || [], users: users || [] })
    }

    if (req.method === 'POST') {
      const { type } = req.body || {}
      if (type === 'group') {
        const { name, allowed_categories } = req.body
        if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name fehlt.' })
        const { data, error } = await supabase.from('customer_groups')
          .insert({ name: String(name).trim(), allowed_categories: sanitizeCategories(allowed_categories) })
          .select('id, name, allowed_categories, created_at').single()
        if (error) throw error
        return res.json(data)
      }
      if (type === 'user') {
        const { username, password, group_id, is_admin } = req.body
        if (!username || !String(username).trim()) return res.status(400).json({ error: 'Benutzername fehlt.' })
        if (!password || String(password).length < 6) return res.status(400).json({ error: 'Passwort muss mindestens 6 Zeichen haben.' })
        const { hash, salt } = hashPassword(password)
        const { data, error } = await supabase.from('app_users')
          .insert({
            username: String(username).trim(),
            pw_hash: hash, pw_salt: salt,
            group_id: group_id || null,
            is_admin: Boolean(is_admin),
          })
          .select('id, username, group_id, is_admin, created_at').single()
        if (error) {
          if (error.code === '23505') return res.status(409).json({ error: 'Benutzername bereits vergeben.' })
          throw error
        }
        return res.json(data)
      }
      return res.status(400).json({ error: 'Unbekannter type.' })
    }

    if (req.method === 'PATCH') {
      const id = (req.query.id || '').trim()
      if (!id) return res.status(400).json({ error: 'id fehlt.' })
      const { type } = req.body || {}
      if (type === 'group') {
        const patch = {}
        if (req.body.name !== undefined) patch.name = String(req.body.name).trim()
        if (req.body.allowed_categories !== undefined) patch.allowed_categories = sanitizeCategories(req.body.allowed_categories)
        const { error } = await supabase.from('customer_groups').update(patch).eq('id', id)
        if (error) throw error
        return res.json({ ok: true })
      }
      if (type === 'user') {
        const patch = {}
        if (req.body.username !== undefined) patch.username = String(req.body.username).trim()
        if (req.body.group_id !== undefined) patch.group_id = req.body.group_id || null
        if (req.body.is_admin !== undefined) patch.is_admin = Boolean(req.body.is_admin)
        if (req.body.password) {
          if (String(req.body.password).length < 6) return res.status(400).json({ error: 'Passwort muss mindestens 6 Zeichen haben.' })
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
      return res.status(400).json({ error: 'Unbekannter type.' })
    }

    if (req.method === 'DELETE') {
      const id = (req.query.id || '').trim()
      const type = (req.query.type || '').trim()
      if (!id) return res.status(400).json({ error: 'id fehlt.' })
      const table = type === 'group' ? 'customer_groups' : type === 'user' ? 'app_users' : null
      if (!table) return res.status(400).json({ error: 'Unbekannter type.' })
      const { error } = await supabase.from(table).delete().eq('id', id)
      if (error) throw error
      return res.json({ ok: true })
    }

    return res.status(405).end()
  } catch (e) {
    console.error('/api/admin/users:', e)
    res.status(500).json({ error: e.message })
  }
}
