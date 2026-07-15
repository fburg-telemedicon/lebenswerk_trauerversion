// api/admin/db-maint.js
// POST /api/admin/db-maint  { action }   (nur Superadmin)
//
// Kontrollierte, einmalige DB-Wartung, die von INNEN laufen muss (die Azure-
// PostgreSQL ist per Firewall nur aus Azure erreichbar). Aktuell: Verbreiterung
// der Code-Spalten von varchar(6) auf varchar(16) als Vorbereitung für längere
// (10-stellige) Zugangscodes. Transaktional (alles-oder-nichts): Blockiert eine
// View o. Ä. das ALTER, wird zurückgerollt und der Fehler zurückgegeben — die DB
// bleibt unverändert.
//
// Bezeichner sind ausschließlich Code-Literale (keine Nutzereingabe).

const { pool } = require('../_lib/store')
const { checkAuth } = require('../_lib/auth')

// Spalten, die den 6-stelligen Code speichern und für 10 Zeichen zu eng sind.
// contributions.id ist bereits breit (14-stellige Session-IDs) und bleibt außen vor.
const TARGETS = [
  { table: 'memorials',     column: 'id' },
  { table: 'contributions', column: 'memorial_id' },
  { table: 'app_users',     column: 'enduser_memorial' },
]
const NEW_LEN = 16

async function inspect(p) {
  const cols = await p.query(
    `select table_name, column_name, data_type, character_maximum_length
       from information_schema.columns
      where (table_name, column_name) in
        (('memorials','id'),('contributions','id'),('contributions','memorial_id'),
         ('app_users','enduser_memorial'),('cost_events','memorial_id'))
      order by table_name, column_name`)
  const views = await p.query(
    `select table_name from information_schema.views where table_schema='public' order by table_name`)
  return { columns: cols.rows, views: views.rows.map(r => r.table_name) }
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (!checkAuth(req, res)) return
  if (!req.auth || !req.auth.admin) return res.status(403).json({ error: 'Nur der Superadmin darf DB-Wartung ausführen.' })
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const action = (req.body && String(req.body.action || '')) || 'inspect'
  const p = pool()
  try {
    if (action === 'inspect') {
      return res.json(await inspect(p))
    }
    if (action === 'widen-codes') {
      const client = await p.connect()
      try {
        await client.query('BEGIN')
        for (const { table, column } of TARGETS) {
          // Verbreitern ist binärkompatibel (kein Table-Rewrite); FK memorials←contributions
          // bleibt gültig, da beide Seiten mitwachsen.
          await client.query(`ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE varchar(${NEW_LEN})`)
        }
        await client.query('COMMIT')
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {})
        client.release()
        return res.status(500).json({ ok: false, error: e.message, hint: 'Rollback ausgeführt — DB unverändert.' })
      }
      client.release()
      return res.json({ ok: true, widened: TARGETS, after: (await inspect(p)).columns })
    }
    return res.status(400).json({ error: 'Unbekannte Aktion.' })
  } catch (e) {
    console.error('/api/admin/db-maint error:', e)
    return res.status(500).json({ error: e.message })
  }
}
