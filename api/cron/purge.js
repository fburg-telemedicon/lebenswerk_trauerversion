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
const { purgeMemorialContributions } = require('../_lib/delete-memorial')
const { recordHeartbeat } = require('../_lib/heartbeat')

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
      .select('id, name, funeral_date, created_at, purge_info')
    if (error) throw error

    const now = Date.now()
    // Fällig = Frist abgelaufen UND noch nicht bereinigt (purge_info.purged_at).
    const due = (rows || []).filter(m => {
      if (m.purge_info?.purged_at) return false
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

    const reason = `Automatische Löschung nach Aufbewahrungsfrist (${RETENTION_DAYS} Tage)`
    const results = []
    for (const m of due) {
      try {
        // Nur Beiträge + Protokoll löschen; Buch/Rede/Eintrag bleiben erhalten.
        const { count } = await purgeMemorialContributions(supabase, m.id, reason)
        results.push({ code: m.id, ok: true, contributions_deleted: count })
      } catch (e) {
        results.push({ code: m.id, ok: false, error: e.message })
      }
    }
    const purgedOk = results.filter(r => r.ok).length
    console.log(`[purge] geprüft ${rows?.length || 0}, fällig ${due.length}, bereinigt ${purgedOk}`)

    // Heartbeat für den Systemstatus im Tagesreport (nur echte Läufe, kein Dry-Run).
    await recordHeartbeat(supabase, 'purge', results.some(r => !r.ok) ? 'partial' : 'ok', {
      checked: rows?.length || 0, due: due.length, purged: purgedOk,
    })

    // Best-effort Haushaltspflege (darf den Purge nie scheitern lassen):
    // abgelaufene Rate-Limit-Eimer und alte Audit-Logs (> 365 Tage) entfernen.
    const housekeeping = {}
    if (!dryRun) {
      try {
        const rlCutoff = new Date(now - DAY_MS).toISOString()
        const { count: rl } = await supabase.from('rate_limits')
          .delete({ count: 'exact' }).lt('reset_at', rlCutoff)
        housekeeping.rate_limits_removed = rl ?? null
      } catch (e) { housekeeping.rate_limits_error = e.message }
      try {
        const auditCutoff = new Date(now - 365 * DAY_MS).toISOString()
        const { count: al } = await supabase.from('audit_log')
          .delete({ count: 'exact' }).lt('created_at', auditCutoff)
        housekeeping.audit_log_removed = al ?? null
      } catch (e) { housekeeping.audit_log_error = e.message }
    }

    return res.json({ retention_days: RETENTION_DAYS, checked: rows?.length || 0, purged: results.length, results, housekeeping })
  } catch (e) {
    console.error('/api/cron/purge:', e)
    res.status(500).json({ error: e.message })
  }
}
