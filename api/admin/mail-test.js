// api/admin/mail-test.js
// POST /api/admin/mail-test   { to, subject?, text?, from? }
// Admin-only: verschickt eine Test-Mail über Microsoft Graph, um den server-
// seitigen Versand (Entra-App + Access Policy + Env) End-to-End zu prüfen.
// Reiner Diagnose-Endpoint – kann bleiben oder später entfernt werden.

const { checkAuth } = require('../_lib/auth')
const { sendMail } = require('../_lib/graphmail')

module.exports = async function handler(req, res) {
  if (!checkAuth(req, res)) return
  if (!req.auth?.admin) return res.status(403).json({ error: 'Nur für Administratoren.' })
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try {
    const { to, subject, text, from } = req.body || {}
    if (!to) return res.status(400).json({ error: 'Empfänger (to) fehlt.' })
    await sendMail({
      to,
      from, // optional; Default = GRAPH_MAIL_SENDER (noreply@)
      replyTo: 'support@lebensgeschichten.ai',
      subject: subject || 'Testmail von lebensgeschichten.ai',
      text: text || 'Dies ist eine Testnachricht über Microsoft Graph.\n\nWenn Sie diese Mail erhalten, funktioniert der serverseitige Versand.',
    })
    res.json({ ok: true })
  } catch (e) {
    console.error('/api/admin/mail-test:', e)
    res.status(500).json({ error: e.message })
  }
}
