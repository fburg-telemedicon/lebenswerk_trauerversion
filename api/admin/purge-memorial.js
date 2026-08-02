// api/admin/purge-memorial.js
// Aufbewahrung von Hand abschließen — der Knopf hinter dem Hinweis im Dashboard.
//
//   POST /api/admin/purge-memorial  { code }                  → aufräumen + archivieren
//   POST /api/admin/purge-memorial  { code, action:'archive' } → nur archivieren
//   POST /api/admin/purge-memorial  { code, action:'restore' } → aus dem Archiv holen
//
// „Aufräumen" heißt hier genau das, was der Cron bis zum 2026-08-02 automatisch
// getan hat: Beiträge, Roh-Uploads und Änderungsprotokolle werden gelöscht, das
// ERGEBNIS bleibt (Buch, Rede/Exzerpt, komponierte und generierte Bilder,
// Stammbaum, Poster, Betreuungsverfügung, Vorsorgevollmacht). Danach wandert der
// Datensatz ins Archiv, damit die Buchliste nicht zuwächst.
//
// Das Aufräumen ist NICHT umkehrbar — die Rohdaten sind danach weg. Deshalb
// verlangt der Aufruf ein ausdrückliches `confirm: true`; das Archivieren allein
// ist harmlos und lässt sich mit 'restore' zurücknehmen.

const { checkAuth } = require('../_lib/auth')
const { createClient } = require('../_lib/store')
const { loadAccessibleMemorial } = require('../_lib/access')
const { purgeMemorialContributions } = require('../_lib/delete-memorial')
const { ensureLifeworkSchema } = require('../_lib/lifework')
const { audit } = require('../_lib/audit')
const { retentionDaysFor } = require('../_lib/retention')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!checkAuth(req, res)) return

  try {
    const code = String(req.body?.code || '').trim().toUpperCase()
    const action = String(req.body?.action || 'purge').trim()
    if (!code) return res.status(400).json({ error: 'code fehlt.' })

    // IDOR-Wächter: liefert 404 (nie 403) für fremde Bücher, damit Codes sich
    // nicht durchprobieren lassen.
    const m = await loadAccessibleMemorial(supabase, req.auth, code, 'id, name, product_category, owner_user, funeral_date, created_at, purge_info')
    if (!m) return res.status(404).json({ error: 'Buchprojekt nicht gefunden.' })

    await ensureLifeworkSchema()
    const now = new Date().toISOString()

    if (action === 'restore') {
      const { error } = await supabase.from('memorials').update({ archived_at: null }).eq('id', code)
      if (error) throw error
      await audit(req, { actor: req.auth, action: 'memorial.unarchive', target: code })
      return res.json({ ok: true, archived_at: null })
    }

    if (action === 'archive') {
      const { error } = await supabase.from('memorials').update({ archived_at: now }).eq('id', code)
      if (error) throw error
      await audit(req, { actor: req.auth, action: 'memorial.archive', target: code })
      return res.json({ ok: true, archived_at: now })
    }

    // ── Aufräumen (unumkehrbar) ──────────────────────────────────
    if (req.body?.confirm !== true) {
      return res.status(400).json({ error: 'Für das Löschen der Eingangsdaten ist confirm:true erforderlich.' })
    }
    if (m.purge_info?.purged_at) {
      // Schon aufgeräumt — dann nur noch archivieren, statt einen zweiten
      // Protokolleintrag über nicht mehr vorhandene Daten zu schreiben.
      const { error } = await supabase.from('memorials').update({ archived_at: now }).eq('id', code)
      if (error) throw error
      return res.json({ ok: true, already_purged: true, archived_at: now, contributions_deleted: 0 })
    }

    const who = req.auth?.admin ? 'Administrator' : `Benutzer ${req.auth?.uid || '?'}`
    const reason = `Aufbewahrungsfrist (${retentionDaysFor(m)} Tage) — manuell abgeschlossen durch ${who}`
    const { count } = await purgeMemorialContributions(supabase, code, reason)

    const { error: aErr } = await supabase.from('memorials').update({ archived_at: now }).eq('id', code)
    if (aErr) throw aErr

    await audit(req, { actor: req.auth, action: 'memorial.purge', target: code, detail: { contributions_deleted: count, reason } })
    return res.json({ ok: true, contributions_deleted: count, archived_at: now })
  } catch (e) {
    console.error('/api/admin/purge-memorial:', e)
    res.status(500).json({ error: e.message })
  }
}
