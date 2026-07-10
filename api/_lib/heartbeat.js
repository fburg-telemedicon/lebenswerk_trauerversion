// api/_lib/heartbeat.js
// Schreibt den "letzter Lauf"-Zeitstempel eines geplanten Jobs in job_heartbeats.
// Der Tagesreport liest daraus den Systemstatus. Vollständig fehlertolerant:
// scheitert der Schreibvorgang (z. B. Tabelle fehlt), darf der Job trotzdem
// erfolgreich sein.
async function recordHeartbeat(supabase, job, status = 'ok', detail = null) {
  try {
    const now = new Date().toISOString()
    await supabase.from('job_heartbeats').upsert(
      { job, last_run_at: now, last_status: status, detail, updated_at: now },
      { onConflict: 'job' }
    )
  } catch (e) {
    console.warn(`[heartbeat] ${job} nicht gespeichert:`, e.message)
  }
}
module.exports = { recordHeartbeat }
