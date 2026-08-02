// api/admin/fair-codes.js
// Verwaltung der Messe-Codes (NUR für Admins) — die Karten zum Verteilen.
//
//   GET    /api/admin/fair-codes                 → { codes: [...], batches: [...] }
//   GET    /api/admin/fair-codes?batch=NAME      → nur diese Charge (für den Druckbogen)
//   POST   /api/admin/fair-codes                 { count, batch?, timerSeconds?, note? }
//            → legt eine Charge an, gibt die neuen Codes zurück
//   DELETE /api/admin/fair-codes?code=…          → einzelnen Code löschen
//   DELETE /api/admin/fair-codes?batch=NAME      → ganze Charge löschen (nur UNEINGELÖSTE)
//
// Eingelöste Codes werden NICHT gelöscht: An ihnen hängt ein Buchprojekt, und
// die Karte in fremder Hand soll weiter dorthin führen. Das Buchprojekt selbst
// löscht man regulär über die Buchliste.
//
// AUSNAHME: Ist das Buchprojekt bereits gelöscht (Aufbewahrung, Löschung von
// Hand), ist der Code verwaist — er führt ins Leere und darf weg. Gescannt wird
// eine solche Karte ohnehin wieder frei (siehe redeem() in _lib/faircodes.js).

const { createClient } = require('../_lib/store')
const { checkAuth } = require('../_lib/auth')
const { ensureFairSchema, createBatch, formatFairCode, normalizeFairCode, MAX_BATCH, DEFAULT_TIMER_SECONDS } = require('../_lib/faircodes')
const { pool } = require('../_lib/store')
const { audit } = require('../_lib/audit')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

const toPublic = r => ({
  code: r.code,
  display: formatFairCode(r.code),
  batch: r.batch || '',
  timer_seconds: r.timer_seconds,
  note: r.note || '',
  created_at: r.created_at,
  redeemed_at: r.redeemed_at,
  redeemed_memorial: r.redeemed_memorial,
})

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (!checkAuth(req, res)) return
  // Messe-Codes legen besitzerlose Buchprojekte an — das bleibt beim Betreiber.
  if (!req.auth?.admin) return res.status(403).json({ error: 'Nur für Administratoren.' })

  try {
    await ensureFairSchema()

    if (req.method === 'GET') {
      const batch = String(req.query?.batch || '').trim()
      const { rows } = batch
        ? await pool().query('select * from fair_codes where batch = $1 order by created_at, code', [batch])
        : await pool().query('select * from fair_codes order by created_at desc, code limit 5000')
      // Chargenübersicht: das ist die Ebene, auf der man arbeitet (drucken,
      // nachbestellen, Erfolg messen) — nicht die Einzelkarte.
      const { rows: bs } = await pool().query(`
        select coalesce(batch, '') as batch,
               count(*)::int                                        as total,
               count(redeemed_memorial)::int                        as redeemed,
               min(created_at)                                      as created_at,
               max(timer_seconds)                                   as timer_seconds
          from fair_codes group by coalesce(batch, '') order by min(created_at) desc`)
      return res.json({ codes: rows.map(toPublic), batches: bs })
    }

    if (req.method === 'POST') {
      const count = parseInt(req.body?.count, 10) || 0
      if (count < 1 || count > MAX_BATCH) {
        return res.status(400).json({ error: `Anzahl muss zwischen 1 und ${MAX_BATCH} liegen.` })
      }
      const codes = await createBatch({
        count,
        batch: String(req.body?.batch || '').trim().slice(0, 120),
        timerSeconds: req.body?.timerSeconds ?? DEFAULT_TIMER_SECONDS,
        note: String(req.body?.note || '').trim().slice(0, 500),
        createdBy: req.auth?.admin ? 'admin' : (req.auth?.uid || null),
      })
      await audit(req, { actor: req.auth, action: 'faircodes.create', detail: { count: codes.length, batch: req.body?.batch || null } })
      return res.json({ codes: codes.map(c => ({ code: c, display: formatFairCode(c) })) })
    }

    if (req.method === 'DELETE') {
      const code = normalizeFairCode(req.query?.code || '')
      const batch = String(req.query?.batch || '').trim()
      if (code) {
        const { rowCount } = await pool().query(`delete from fair_codes
            where code = $1
              and (redeemed_memorial is null
                   or not exists (select 1 from memorials m where m.id = fair_codes.redeemed_memorial))`, [code])
        if (!rowCount) return res.status(409).json({ error: 'Code ist eingelöst und führt zu einem bestehenden Buchprojekt — er wird nicht gelöscht.' })
        await audit(req, { actor: req.auth, action: 'faircodes.delete', target: code })
        return res.json({ ok: true, deleted: rowCount })
      }
      if (batch) {
        // Eingelöste Karten bleiben — an ihnen hängt ein Buchprojekt. Verwaiste
        // (Buch gelöscht) werden mitgenommen, sie führen ohnehin ins Leere.
        const { rowCount } = await pool().query(`delete from fair_codes
            where batch = $1
              and (redeemed_memorial is null
                   or not exists (select 1 from memorials m where m.id = fair_codes.redeemed_memorial))`, [batch])
        await audit(req, { actor: req.auth, action: 'faircodes.delete_batch', detail: { batch, deleted: rowCount } })
        return res.json({ ok: true, deleted: rowCount })
      }
      return res.status(400).json({ error: 'code oder batch erforderlich.' })
    }

    return res.status(405).end()
  } catch (e) {
    console.error('/api/admin/fair-codes:', e)
    res.status(500).json({ error: e.message })
  }
}
