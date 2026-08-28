// api/cron/purge.js
// Automatische Löschung nach Aufbewahrungsfrist (DSGVO Art. 5 Abs. 1 e / Art. 17).
// Wird von einem Vercel Cron Job täglich aufgerufen (siehe vercel.json).
//
// ZWEI REGIME (siehe api/_lib/retention.js):
//   Anamnese      → 14 Tage nach Anlage VOLLSTAENDIGE Loeschung (medizinische Daten).
//   Alle uebrigen → RETENTION_DAYS (90) nach ENDE DER NUTZUNGSDAUER werden die
//     EINGANGSDATEN geloescht (Beitraege, Roh-Uploads, Protokolle); Buch, Rede und
//     die uebrigen Endprodukte bleiben. Das entspricht der vertraglichen Zusage.
//     Nutzungsdauer = funeral_date, sonst created_at + LICENSE_MONTHS (6) — die
//     Lizenz laeuft ein halbes Jahr, vorher zu loeschen wuerde sie entwerten.
//
// Am 2026-08-02 war die automatische Loeschung kurzzeitig durch Hinweis + Knopf
// ersetzt und am selben Tag zurueckgebaut: Die AGB sagen den Kunden eine Loeschung
// nach Frist zu, das darf nicht davon abhaengen, ob jemand klickt. Der Knopf im
// Dashboard bleibt zusaetzlich bestehen (frueher loeschen), ebenso das Archiv.
//
// Loesch-Stichtag: siehe api/_lib/retention.js — dort steht die Rechnung EINMAL.
//
// Schutz: Der Endpunkt verlangt den Header `Authorization: Bearer <CRON_SECRET>`.
// Vercel setzt diesen Header bei Cron-Aufrufen automatisch, wenn die Env-Variable
// CRON_SECRET gesetzt ist. Ohne gesetztes CRON_SECRET wird jede Anfrage abgelehnt.
//
// Test ohne zu löschen:  GET /api/cron/purge?dry=1  (mit Bearer-Secret)

const { createClient } = require('../_lib/store')
const { purgeMemorialContributions, deleteMemorialCompletely, enduserLoginsFor } = require('../_lib/delete-memorial')
const { recordHeartbeat } = require('../_lib/heartbeat')
const { isAnamnesisCategory } = require('../_lib/categories')
const { recordPurgedMemorial, prunePurgedTombstones } = require('../_lib/tombstone')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const { RETENTION_DAYS, ANAMNESIS_RETENTION_DAYS, DAY_MS, retentionDaysFor, isPurgeDue } = require('../_lib/retention')


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
      .select('id, name, product_category, funeral_date, created_at, purge_info')
    if (error) throw error

    const now = Date.now()
    // Fällig = Frist abgelaufen UND noch nicht bereinigt (purge_info.purged_at).
    // Frist je Kategorie: Anamnese 14 Tage, sonst RETENTION_DAYS (Standard 90).
    const due = (rows || []).filter(m => isPurgeDue(m, now))

    if (dryRun) {
      return res.json({
        dry_run: true,
        retention_days: RETENTION_DAYS,
        anamnesis_retention_days: ANAMNESIS_RETENTION_DAYS,
        checked: rows?.length || 0,
        due: due.map(m => ({ code: m.id, name: m.name, product_category: m.product_category, retention_days: retentionDaysFor(m) })),
      })
    }

    const results = []
    for (const m of due) {
      try {
        const days = retentionDaysFor(m)
        if (isAnamnesisCategory(m.product_category)) {
          // Anamnese (Reha + KVSW): nach der Frist ALLES löschen — Rohdaten UND den Bogen
          // (medizinische Daten, maximale Datensparsamkeit). Der Datensatz verschwindet
          // vollständig (Storage, cost_events, Beiträge, memorial-Zeile, Endnutzer-Konto).
          //
          // Die Login-Namen der Endnutzer-Konten VOR der Löschung holen: danach sind
          // sie weg, und ohne sie kann ein späterer Login-Versuch nicht erfahren, dass
          // hier fristgerecht gelöscht wurde (statt „Ungültige Zugangsdaten").
          const logins = await enduserLoginsFor(supabase, m.id)
          const warnings = await deleteMemorialCompletely(supabase, m.id)
          // Grabstein: nur Code, Kategorie, Frist, Datum und ein HMAC des Logins —
          // siehe api/_lib/tombstone.js. Best effort, kippt die Löschung nie.
          const tsWarn = await recordPurgedMemorial({
            code: m.id, productCategory: m.product_category, retentionDays: days, logins,
          })
          if (tsWarn) warnings.push(tsWarn)
          results.push({ code: m.id, ok: true, retention_days: days, deleted: 'complete', warnings })
        } else {
          // Übrige Kategorien: Eingangsdaten (Beiträge, Roh-Uploads, Protokolle) weg,
          // das fertige Werk bleibt. Genau das, was der Kunde vertraglich zugesagt
          // bekommt — deshalb läuft es automatisch und nicht auf Knopfdruck.
          const reason = `Automatische Löschung nach Aufbewahrungsfrist (${days} Tage)`
          const { count } = await purgeMemorialContributions(supabase, m.id, reason)
          results.push({ code: m.id, ok: true, retention_days: days, contributions_deleted: count })
        }
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
      try {
        // Grabsteine gelöschter Projekte verfallen ihrerseits (PURGE_TOMBSTONE_DAYS).
        housekeeping.tombstones_removed = await prunePurgedTombstones()
      } catch (e) { housekeeping.tombstones_error = e.message }
    }

    return res.json({
      retention_days: RETENTION_DAYS,
      checked: rows?.length || 0,
      purged: results.length,
      results,
      housekeeping,
    })
  } catch (e) {
    console.error('/api/cron/purge:', e)
    res.status(500).json({ error: e.message })
  }
}
