// api/cron/purge.js
// Automatische Löschung nach Aufbewahrungsfrist (DSGVO Art. 5 Abs. 1 e / Art. 17).
// Wird von einem Vercel Cron Job täglich aufgerufen (siehe vercel.json).
//
// Lösch-Stichtag pro Gedenkbuch: funeral_date + RETENTION_DAYS (Standard 90).
// Hat ein Gedenkbuch kein funeral_date, gilt created_at + RETENTION_DAYS als
// Sicherheitsnetz, damit nichts unbegrenzt liegen bleibt.
//
// Schutz: Der Endpunkt verlangt den Header `Authorization: Bearer <CRON_SECRET>`.
// Vercel setzt diesen Header bei Cron-Aufrufen automatisch, wenn die Env-Variable
// CRON_SECRET gesetzt ist. Ohne gesetztes CRON_SECRET wird jede Anfrage abgelehnt.
//
// Test ohne zu löschen:  GET /api/cron/purge?dry=1  (mit Bearer-Secret)

const { createClient } = require('@supabase/supabase-js')
const { deleteMemorialCompletely } = require('../_lib/delete-memorial')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const RETENTION_DAYS = parseInt(process.env.RETENTION_DAYS || '90', 10)
const DAY_MS = 24 * 60 * 60 * 1000

function authorized(req) {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return req.headers.authorization === `Bearer ${secret}`
}

module.exports = async function handler(req, res) {
  if (!authorized(req)) return res.status(401).json({ error: 'Nicht autorisiert.' })
  const dryRun = req.query?.dry === '1' || req.query?.dry === 'true'
  try {
    const { data: rows, error } = await supabase
      .from('memorials')
      .select('id, name, funeral_date, created_at')
    if (error) throw error

    const now = Date.now()
    const due = (rows || []).filter(m => {
      const anchor = m.funeral_date ? new Date(m.funeral_date) : new Date(m.created_at)
      return anchor.getTime() + RETENTION_DAYS * DAY_MS < now
    })

    if (dryRun) {
      return res.json({
        dry_run: true,
        retention_days: RETENTION_DAYS,
        checked: rows?.length || 0,
        due: due.map(m => ({ code: m.id, name: m.name, funeral_date: m.funeral_date, created_at: m.created_at })),
      })
    }

    const results = []
    for (const m of due) {
      try {
        const warnings = await deleteMemorialCompletely(supabase, m.id)
        results.push({ code: m.id, ok: true, ...(warnings.length ? { warnings } : {}) })
      } catch (e) {
        results.push({ code: m.id, ok: false, error: e.message })
      }
    }
    console.log(`[purge] geprüft ${rows?.length || 0}, fällig ${due.length}, gelöscht ${results.filter(r => r.ok).length}`)
    return res.json({ retention_days: RETENTION_DAYS, checked: rows?.length || 0, deleted: results.length, results })
  } catch (e) {
    console.error('/api/cron/purge:', e)
    res.status(500).json({ error: e.message })
  }
}
