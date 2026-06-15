// api/admin/login.js
// POST /api/admin/login  { username, password }  →  { token }
// Zugangsdaten und Token-Logik liegen zentral in ../_lib/auth.js.

const { verifyCredentials, issueToken, isConfigured } = require('../_lib/auth')

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  if (!isConfigured()) {
    return res.status(503).json({ error: 'Server nicht konfiguriert (Admin-Zugangsdaten fehlen).' })
  }
  const { username, password } = req.body || {}
  if (verifyCredentials(username, password)) {
    return res.json({ token: issueToken() })
  }
  return res.status(401).json({ error: 'Ungültige Zugangsdaten.' })
}
