// api/admin/login.js
// POST /api/admin/login  { username, password }  →  { token }

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '1234'
const ADMIN_TOKEN    = process.env.ADMIN_TOKEN    || 'lebenswerk-admin-secret'

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const { username, password } = req.body || {}
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    return res.json({ token: ADMIN_TOKEN })
  }
  return res.status(401).json({ error: 'Ungültige Zugangsdaten.' })
}
