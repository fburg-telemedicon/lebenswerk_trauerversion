// scripts/migrate-updated-at.js
// ============================================================================
// Einmal-Migration für die Dashboard-Anzeige „zuletzt gearbeitet (Tage)".
//
// Führt idempotent aus:
//   1) contributions.updated_at (timestamptz) anlegen, falls nicht vorhanden
//   2) memorial_contrib_stats() neu bauen, sodass sie last_activity mitliefert
//
// Beides steckt auch in supabase/memorial-stats.sql; dieses Skript ist der Weg,
// die Migration OHNE psql direkt gegen die Azure-Postgres laufen zu lassen.
//
// Aufruf (DATABASE_URL muss gesetzt sein):
//   node scripts/migrate-updated-at.js
//
// Mehrfaches Ausführen ist unschädlich (add column if not exists / create or
// replace).
// ============================================================================

const { Client } = require('pg')

const DDL = `
alter table contributions add column if not exists updated_at timestamptz;

drop function if exists memorial_contrib_stats();

create or replace function memorial_contrib_stats()
returns table (
  memorial_id        text,
  contribution_count bigint,
  answer_count       bigint,
  last_activity      timestamptz
)
language sql
stable
as $$
  select
    c.memorial_id,
    count(*) as contribution_count,
    coalesce(sum((
      select count(*)
      from jsonb_array_elements(
        case when jsonb_typeof(c.messages) = 'array' then c.messages else '[]'::jsonb end
      ) as e
      where e->>'role' = 'user'
    )), 0) as answer_count,
    max(coalesce(c.updated_at, c.created_at)) as last_activity
  from contributions c
  group by c.memorial_id
$$;
`

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('DATABASE_URL nicht gesetzt – Migration abgebrochen.')
    process.exit(2)
  }
  const client = new Client({
    connectionString: url,
    ssl: /sslmode=require/i.test(url) ? { rejectUnauthorized: false } : undefined,
  })
  await client.connect()
  try {
    await client.query('begin')
    await client.query(DDL)
    await client.query('commit')
    // Kurzer Funktionstest: liefert die Funktion jetzt last_activity?
    const { rows } = await client.query('select * from memorial_contrib_stats() limit 1')
    const hasCol = rows.length === 0 || Object.prototype.hasOwnProperty.call(rows[0], 'last_activity')
    console.log(`✓ Migration erfolgreich. memorial_contrib_stats() liefert last_activity: ${hasCol ? 'ja' : 'NEIN (bitte prüfen)'}`)
  } catch (e) {
    try { await client.query('rollback') } catch { /* ignore */ }
    console.error('✗ Migration fehlgeschlagen:', e.message)
    process.exitCode = 1
  } finally {
    await client.end()
  }
}

main().catch((e) => { console.error('✗ Ausnahme:', e); process.exit(1) })
