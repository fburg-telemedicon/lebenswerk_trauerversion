// api/_lib/tombstone.js
// „Grabstein" für Projekte, die nach Ablauf der Aufbewahrungsfrist AUTOMATISCH
// vollständig gelöscht wurden (heute nur die Anamnese-Kategorien, 14 Tage —
// siehe api/_lib/retention.js).
//
// WARUM ÜBERHAUPT ETWAS ZURÜCKBLEIBT
// Ohne diesen Rest sieht der Patient nach der Löschung Meldungen, die schlicht
// falsch sind: über den Link „Code nicht gefunden" (klingt nach Tippfehler) und
// beim eigenen Login „Ungültige Zugangsdaten" (klingt nach falschem Passwort).
// Beides führt in die Support-Schleife, obwohl alles genau nach Plan gelaufen
// ist. Der Grabstein erlaubt die wahre Auskunft: „wurde am … nach Fristablauf
// gelöscht".
//
// WAS HIER STEHT — UND WAS AUSDRÜCKLICH NICHT
// Gespeichert wird NUR: der Buch-Code (ein Zufallstoken, keine Personendaten),
// die Kategorie, die Frist und der Löschzeitpunkt. Vom Login-Namen (E-Mail)
// bleibt ausschließlich ein HMAC-SHA256 mit ADMIN_TOKEN_SECRET — nicht
// rückrechenbar, nie ausgegeben, nur verglichen. Kein Name, keine Antwort, kein
// Bogen, keine Indikation. Der Grabstein selbst verfällt nach
// PURGE_TOMBSTONE_DAYS (Standard 180) und wird vom selben Cron aufgeräumt.
//
// ABWÄGUNG BEIM LOGIN (bewusst getroffen, nicht übersehen)
// Die Auskunft am Login-Formular verrät einem Fremden, der eine Adresse errät,
// dass es zu ihr einmal ein Konto gab. Der Passwort-Reset in api/admin/login.js
// vermeidet genau das ("immer generische Meldung"). Hier ist die Abwägung anders
// ausgefallen, weil die betroffene Person sonst KEINE Chance hat zu verstehen,
// was passiert ist, und die Meldung weder Produkt noch Kategorie noch Inhalt
// nennt. Wer das nicht will, setzt PURGE_LOGIN_HINT=0 — dann bleibt es beim
// generischen 401, der Link-Weg (api/memorial.js) funktioniert unverändert.

const crypto = require('crypto')
const { pool } = require('./store')

// Wie lange der Grabstein steht. Lange genug, dass jemand, der seinen Zugang ein
// halbes Jahr nicht benutzt hat, noch eine echte Antwort bekommt; danach ist auch
// diese Spur weg.
const TOMBSTONE_DAYS = parseInt(process.env.PURGE_TOMBSTONE_DAYS || '180', 10)

// Auskunft am Login-Formular (siehe Abwägung oben). Standard: an.
const LOGIN_HINT = !/^(0|false|off|no)$/i.test(String(process.env.PURGE_LOGIN_HINT ?? '1').trim())

let schemaReady = false
async function ensureTombstoneSchema() {
  if (schemaReady) return
  await pool().query(`
    create table if not exists purged_memorials (
      code             varchar(16) primary key,
      product_category text,
      retention_days   integer,
      login_hashes     text[]      not null default '{}',
      purged_at        timestamptz not null default now(),
      forget_after     timestamptz not null
    )
  `)
  await pool().query(`create index if not exists purged_memorials_forget_idx on purged_memorials(forget_after)`)
  await pool().query(`create index if not exists purged_memorials_login_idx  on purged_memorials using gin(login_hashes)`)
  schemaReady = true
}

// HMAC statt Klartext: gleiche Adresse → gleicher Wert (vergleichbar), ohne das
// Secret aber nicht rückrechenbar. Gleiche Normalisierung wie beim Login-Lookup
// (getrimmt, klein) — sonst findet der Vergleich nichts.
function loginHash(username) {
  const u = String(username || '').trim().toLowerCase()
  if (!u) return null
  const secret = process.env.ADMIN_TOKEN_SECRET || ''
  return crypto.createHmac('sha256', secret).update(`purged:${u}`).digest('hex')
}

// Grabstein setzen. Best effort: ein Fehler hier darf die Löschung NIE kippen
// (die Daten sind zu dem Zeitpunkt bereits weg). Rückgabe: Fehlertext oder null.
async function recordPurgedMemorial({ code, productCategory, retentionDays, logins = [] }) {
  const c = String(code || '').toUpperCase().trim()
  if (!c) return null
  try {
    await ensureTombstoneSchema()
    const hashes = [...new Set(logins.map(loginHash).filter(Boolean))]
    const forget = new Date(Date.now() + TOMBSTONE_DAYS * 24 * 60 * 60 * 1000).toISOString()
    await pool().query(
      `insert into purged_memorials (code, product_category, retention_days, login_hashes, purged_at, forget_after)
       values ($1, $2, $3, $4, now(), $5)
       on conflict (code) do update set
         product_category = excluded.product_category,
         retention_days   = excluded.retention_days,
         login_hashes     = excluded.login_hashes,
         purged_at        = excluded.purged_at,
         forget_after     = excluded.forget_after`,
      [c, productCategory || null, Number.isFinite(retentionDays) ? retentionDays : null, hashes, forget]
    )
    return null
  } catch (e) {
    console.warn('recordPurgedMemorial:', e.message)
    return `Grabstein-Eintrag fehlgeschlagen: ${e.message}`
  }
}

// Abgelaufene Grabsteine löschen (vom Purge-Cron mitgenommen).
async function prunePurgedTombstones() {
  await ensureTombstoneSchema()
  const { rowCount } = await pool().query(`delete from purged_memorials where forget_after < now()`)
  return rowCount
}

// Fehlt die Tabelle noch (Migration nicht gelaufen) oder klemmt die DB, gilt:
// „kein Grabstein" → der Aufrufer bleibt bei seiner bisherigen Meldung.
// Nie werfen, das ist überall ein Nebenpfad.
async function findPurged(where, params) {
  try {
    await ensureTombstoneSchema()
    const { rows } = await pool().query(
      `select code, product_category, retention_days, purged_at
         from purged_memorials
        where ${where} and forget_after > now()
        limit 1`,
      params
    )
    return rows[0] || null
  } catch (e) {
    console.warn('findPurged:', e.message)
    return null
  }
}

// Wurde GENAU DIESES Buch nach Fristablauf gelöscht? (Link-/QR-Weg.)
async function findPurgedByCode(code) {
  const c = String(code || '').toUpperCase().trim()
  if (!c) return null
  return findPurged('code = $1', [c])
}

// Gehörte dieser Login zu einem nach Fristablauf gelöschten Projekt?
// Gibt null zurück, wenn die Auskunft abgeschaltet ist (PURGE_LOGIN_HINT=0).
async function findPurgedByLogin(username) {
  if (!LOGIN_HINT) return null
  const h = loginHash(username)
  if (!h) return null
  return findPurged('$1 = any(login_hashes)', [h])
}

// Einheitlicher Klartext für beide Wege. Bewusst OHNE Produkt-/Kategoriename und
// ohne jeden Inhalt — die Meldung erscheint auch dann, wenn jemand nur eine
// Adresse geraten hat.
function purgedMessage(row) {
  const tag = row?.purged_at ? new Date(row.purged_at).toLocaleDateString('de-DE') : null
  const frist = Number.isFinite(row?.retention_days) ? row.retention_days : null
  return [
    'Dieser Zugang wurde',
    tag ? ` am ${tag}` : '',
    ' nach Ablauf der Aufbewahrungsfrist',
    frist ? ` (${frist} Tage)` : '',
    ' automatisch gelöscht — zusammen mit allen erfassten Angaben. ',
    'Das ist so vorgesehen und lässt sich nicht rückgängig machen. ',
    'Bitte wenden Sie sich an Ihre Ansprechpartnerin oder Ihren Ansprechpartner, wenn Sie erneut teilnehmen möchten.',
  ].join('')
}

module.exports = {
  TOMBSTONE_DAYS, LOGIN_HINT,
  ensureTombstoneSchema, recordPurgedMemorial, prunePurgedTombstones,
  findPurgedByCode, findPurgedByLogin, purgedMessage,
}
