// api/cron/report.js
// Täglicher E-Mail-Report (Vercel Cron, siehe vercel.json). Baut die Kennzahlen
// des Vortags + PDF-Anhang und verschickt sie an alle aktiven report_recipients.
//
// Schutz wie beim Purge-Cron: Header `Authorization: Bearer <CRON_SECRET>`. Vercel
// setzt ihn bei Cron-Aufrufen automatisch. Ohne gesetztes CRON_SECRET → 401.
//
// Test ohne Versand:  GET /api/cron/report?dry=1   (mit Bearer-Secret)

const { buildAndSendReport } = require('../_lib/report-send')

function authorized(req) {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return req.headers.authorization === `Bearer ${secret}`
}

module.exports = async function handler(req, res) {
  if (!authorized(req)) return res.status(401).json({ error: 'Nicht autorisiert.' })
  try {
    const dry = req.query?.dry === '1' || req.query?.dry === 'true'
    const result = await buildAndSendReport({ dryRun: dry })
    console.log('[cron/report]', JSON.stringify(result))
    return res.json({ ok: true, ...result })
  } catch (e) {
    console.error('/api/cron/report:', e)
    res.status(500).json({ error: e.message })
  }
}
