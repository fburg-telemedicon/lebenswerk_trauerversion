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
// Zweite Aktion: `mamazone-umstellen`. Die 45 Kongress-Zugaenge und das Musterbuch
// wurden angelegt, BEVOR es die Produktkategorie „mamazone Edition" gab — sie
// laufen als Lebenswerk mit dem mamazone-Fragenkatalog. Die QR-Codes sind gedruckt,
// die Codes duerfen sich also nicht aendern; geaendert wird nur die Spalte
// product_category. Erkannt werden die Buecher an ihrem Katalog, nicht an einer
// Liste von Codes — so kann die Aktion nichts Fremdes erwischen.
//
// Bezeichner sind ausschließlich Code-Literale (keine Nutzereingabe).

const { pool } = require('../_lib/store')
const { checkAuth } = require('../_lib/auth')
const { audit } = require('../_lib/audit')
const { CATALOG_NAME: MAMAZONE_CATALOG_NAME } = require('../_lib/mamazone')

// Spalten, die den 6-stelligen Code speichern und für 10 Zeichen zu eng sind.
// contributions.id ist bereits breit (14-stellige Session-IDs) und bleibt außen vor.
const TARGETS = [
  { table: 'memorials',     column: 'id' },
  { table: 'contributions', column: 'memorial_id' },
  { table: 'app_users',     column: 'enduser_memorial' },
]
const NEW_LEN = 16

// Verwaiste Endnutzer-Konten: is_enduser-Konten, deren enduser_memorial auf KEIN
// (mehr) existierendes Buch zeigt (Buch gelöscht, oder Link durch frühere
// varchar(6)-Kürzung des Codes gebrochen). Solche Konten sind ohne Buch nutzlos.
async function findOrphans(p) {
  const { rows } = await p.query(
    `select u.id, u.username, u.enduser_memorial, u.created_at
       from app_users u
       left join memorials m on m.id = u.enduser_memorial
      where u.is_enduser = true
        and (u.enduser_memorial is null or m.id is null)
      order by u.created_at`)
  return rows
}

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
    if (action === 'orphans') {
      // Nur auflisten (read-only) — E-Mail-Adressen der verwaisten Endnutzer-Konten.
      const orphans = await findOrphans(p)
      return res.json({ count: orphans.length, orphans })
    }
    if (action === 'purge-orphans') {
      // Verwaiste Endnutzer-Konten löschen. Schutz: body.confirm === 'PURGE'.
      if (String(req.body?.confirm || '') !== 'PURGE') {
        return res.status(400).json({ error: "Bestätigung fehlt: confirm='PURGE' senden." })
      }
      const orphans = await findOrphans(p)
      const ids = orphans.map(o => o.id)
      if (!ids.length) return res.json({ ok: true, deleted: 0, orphans: [] })
      await p.query(`delete from app_users where id = any($1::uuid[])`, [ids])
      return res.json({ ok: true, deleted: ids.length, orphans })
    }
    if (action === 'mamazone-umstellen') {
      // Betroffen ist genau, was am mamazone-Fragenkatalog haengt und noch als
      // Lebenswerk gefuehrt wird. Ohne `confirm` nur anzeigen (Trockenlauf).
      const { rows: kat } = await p.query(
        `select id, product_categories from question_catalogs where name = $1`, [MAMAZONE_CATALOG_NAME])
      if (!kat.length) return res.status(404).json({ error: 'mamazone-Fragenkatalog nicht gefunden: ' + MAMAZONE_CATALOG_NAME })
      const katalogId = kat[0].id
      const { rows: buecher } = await p.query(
        `select id, note, project_no, product_category from memorials
          where catalog_id = $1 and product_category = 'lifework' order by project_no nulls last, id`, [katalogId])
      if (String(req.body?.confirm || '') !== 'MAMAZONE') {
        return res.json({ dry_run: true, katalog: { id: katalogId, product_categories: kat[0].product_categories }, count: buecher.length, memorials: buecher })
      }
      const client = await p.connect()
      try {
        await client.query('BEGIN')
        await client.query(`update question_catalogs set product_categories = array['mamazone'] where id = $1`, [katalogId])
        await client.query(`update memorials set product_category = 'mamazone' where catalog_id = $1 and product_category = 'lifework'`, [katalogId])
        await client.query('COMMIT')
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {})
        client.release()
        return res.status(500).json({ ok: false, error: e.message, hint: 'Rollback ausgefuehrt — DB unveraendert.' })
      }
      client.release()
      await audit(req, { actor: req.auth, action: 'db-maint.mamazone', detail: { katalog: katalogId, memorials: buecher.length } })
      return res.json({ ok: true, katalog: katalogId, umgestellt: buecher.length, memorials: buecher.map(b => b.id) })
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
