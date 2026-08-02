// api/_lib/faircodes.js
// MESSE-CODES: Karten zum Verteilen, die ohne E-Mail direkt in ein Interview führen.
//
// Warum eine eigene Tabelle und nicht einfach vorab angelegte Bücher: Ein Stapel
// von 200 leeren Buchprojekten würde das Dashboard zumüllen — genau das, was der
// Archiv-Umbau gerade beseitigt hat. Ein Messe-Code ist deshalb nur ein Eintrag
// hier; das Buchprojekt entsteht erst, wenn jemand die Karte wirklich scannt.
//
// ABLAUF
//   1. Admin erzeugt eine Charge (z. B. 250 Codes für „Altenpflegemesse Nürnberg").
//   2. Aus dem Dashboard entsteht ein A4-Druckbogen mit QR, Code, Logo, URL und
//      Support-Adresse (src/fairSheet.js).
//   3. Wer den QR scannt, landet auf /?messe=CODE, wählt seine Sprache und ist im
//      Interview — ohne Registrierung, ohne Mail, ohne Passwort.
//
// DIE KARTE IST DER ZUGANG. Beim Einlösen entsteht genau EIN Buchprojekt, und der
// Code merkt es sich. Wer dieselbe Karte morgen noch einmal scannt, landet wieder
// in DEMSELBEN Interview und erzählt weiter — deshalb steht auf der Karte, dass
// man sie aufbewahren soll. Das Einlösen ist also idempotent, nicht einmalig.
//
// Abgrenzung zu den Freischaltcodes (api/_lib/unlockcodes.js): Die HEBEN das
// Zeitlimit eines bestehenden Testkontos auf (verkaufte Gutscheine). Messe-Codes
// LEGEN ein Testprojekt an. Beides greift ineinander — wer die 5 Minuten
// verbraucht hat, kauft einen Freischaltcode und erzählt weiter.

const { pool } = require('./store')
const { ALPHABET } = require('./codes')
const crypto = require('crypto')

const FAIR_LEN = 10                 // wie der Buch-Code: 32^10 ≈ 10^15
const DEFAULT_TIMER_SECONDS = 300   // 5 Minuten, wie bei der Selbstregistrierung
const MAX_BATCH = 2000              // Schutz vor Vertippern beim Anlegen

function genFairCode(len = FAIR_LEN) {
  let out = ''
  for (let i = 0; i < len; i++) out += ALPHABET[crypto.randomInt(ALPHABET.length)]
  return out
}

// Anzeige-/Druckform: 3-4-3, wie formatCode() im Frontend für Buch-Codes.
function formatFairCode(raw) {
  const c = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  return c.length === 10 ? `${c.slice(0, 3)}-${c.slice(3, 7)}-${c.slice(7)}` : c
}

const normalizeFairCode = v => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16)

// Idempotente Schema-Anlage (das Projekt kennt keine Migrationsläufe).
let schemaReady = false
async function ensureFairSchema() {
  if (schemaReady) return
  await pool().query(`
    create table if not exists fair_codes (
      code              varchar(16) primary key,
      batch             text,
      timer_seconds     integer not null default ${DEFAULT_TIMER_SECONDS},
      note              text,
      created_at        timestamptz not null default now(),
      created_by        text,
      redeemed_at       timestamptz,
      redeemed_memorial varchar(16)
    )
  `)
  await pool().query(`create index if not exists fair_codes_batch_idx on fair_codes (batch)`).catch(() => {})
  schemaReady = true
}

// Eine Charge anlegen. Gibt die erzeugten Codes zurück (Rohform).
async function createBatch({ count, batch, timerSeconds, note, createdBy }) {
  const n = Math.max(1, Math.min(parseInt(count, 10) || 0, MAX_BATCH))
  const timer = Math.max(0, Math.min(parseInt(timerSeconds, 10) || DEFAULT_TIMER_SECONDS, 24 * 3600))
  await ensureFairSchema()

  const codes = []
  // Kollisionen sind bei 10^15 praktisch ausgeschlossen; trotzdem sauber
  // behandeln, statt die ganze Charge an einem Zufall scheitern zu lassen.
  for (let i = 0; i < n; i++) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = genFairCode()
      const { rowCount } = await pool().query(
        `insert into fair_codes (code, batch, timer_seconds, note, created_by)
         values ($1,$2,$3,$4,$5) on conflict (code) do nothing`,
        [code, batch || null, timer, note || null, createdBy || null])
      if (rowCount === 1) { codes.push(code); break }
    }
  }
  return codes
}

// Einlösen — IDEMPOTENT. Ist der Code schon eingelöst, kommt dasselbe Buch
// zurück; nur beim ersten Mal wird eines angelegt (createMemorial-Callback).
// Der Callback bekommt { timerSeconds, batch } und muss den Buch-Code liefern.
async function redeem(rawCode, createMemorial) {
  await ensureFairSchema()
  const code = normalizeFairCode(rawCode)
  if (!code) return { error: 'invalid' }

  const { rows } = await pool().query('select * from fair_codes where code = $1', [code])
  const row = rows[0]
  if (!row) return { error: 'unknown' }

  if (row.redeemed_memorial) {
    // Zeigt der Code noch auf ein existierendes Buch? Wurde das Projekt
    // zwischenzeitlich gelöscht (Aufbewahrung, Löschung von Hand), liefe der
    // Gast beim nächsten Scan sonst in eine tote Seite. Dann wird die Karte
    // wieder frei und legt ein neues Gespräch an — sie bleibt brauchbar.
    const { rows: mem } = await pool().query('select 1 from memorials where id = $1', [row.redeemed_memorial])
    if (mem.length) return { memorialCode: row.redeemed_memorial, reused: true }
    await pool().query(
      'update fair_codes set redeemed_at = null, redeemed_memorial = null where code = $1', [code])
  }

  const memorialCode = await createMemorial({ timerSeconds: row.timer_seconds, batch: row.batch })

  // Nur setzen, wenn noch frei — zwei gleichzeitige Scans derselben Karte
  // dürfen nicht zwei Bücher hinterlassen, von denen eines verwaist.
  const { rows: upd } = await pool().query(
    `update fair_codes set redeemed_at = now(), redeemed_memorial = $2
      where code = $1 and redeemed_memorial is null
      returning redeemed_memorial`, [code, memorialCode])
  if (upd.length === 0) {
    const { rows: again } = await pool().query('select redeemed_memorial from fair_codes where code = $1', [code])
    return { memorialCode: again[0]?.redeemed_memorial || memorialCode, reused: true, raced: true }
  }
  return { memorialCode, reused: false }
}

module.exports = {
  FAIR_LEN, DEFAULT_TIMER_SECONDS, MAX_BATCH,
  ensureFairSchema, genFairCode, formatFairCode, normalizeFairCode, createBatch, redeem,
}
