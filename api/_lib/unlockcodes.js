// api/_lib/unlockcodes.js
// Freischaltcodes ("Unlock-Codes"): Ein Endnutzer mit zeitlich begrenztem
// Testkonto (interview_timer_seconds > 0, z. B. Selbstregistrierung mit 5-Min-
// Limit) kann einen Code der Form XXXX-XXXX-XXXX eingeben, um das Zeitlimit
// dauerhaft aufzuheben (Timer → 0 = unbegrenzt).
//
// Modell (mit dem Betreiber abgestimmt):
//   • EINMALIG: jeder Code wird beim Einlösen verbraucht.
//   • GENERISCH: ein Code ist bei der Erzeugung an KEIN Konto gebunden — er hebt
//     das Limit desjenigen Buchs auf, in dem er eingelöst wird, und merkt sich
//     danach dieses Buch (redeemed_memorial) + den Zeitpunkt.
//
// Der Code nutzt dasselbe verwechslungsarme Alphabet wie der Buch-Code
// (ohne 0/O, 1/I). 12 Zeichen (32^12 ≈ 10^18) → nicht sinnvoll zu erraten;
// zusätzlich drosselt der Redeem-Endpunkt die Versuche pro IP.

const { pool } = require('./store')
const { ALPHABET } = require('./codes')
const crypto = require('crypto')

const UNLOCK_LEN = 12   // 3 Gruppen à 4 Zeichen (XXXX-XXXX-XXXX)

// Rohcode (12 Zeichen, ohne Bindestriche) — so liegt er in der DB.
function genUnlockCode(len = UNLOCK_LEN) {
  let out = ''
  for (let i = 0; i < len; i++) out += ALPHABET[crypto.randomInt(ALPHABET.length)]
  return out
}

// Anzeige-/Versandform: XXXX-XXXX-XXXX.
function formatUnlockCode(raw) {
  const s = String(raw || '').toUpperCase().replace(/[^A-Z2-9]/g, '')
  return s.replace(/(.{4})(?=.)/g, '$1-')
}

// Eingabe des Endnutzers säubern: Bindestriche/Leerzeichen weg, Großschreibung.
// Das Code-Alphabet meidet bewusst 0/O und 1/I (siehe codes.js) — ein echter Code
// enthält diese also nie; wir strippen einfach alles außerhalb der Buchstaben/Ziffern
// und lassen den Abgleich exakt gegen den gespeicherten Rohcode laufen.
function normalizeUnlockCode(input) {
  return String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

// Idempotente Schema-Anlage (das Projekt kennt keine Migrationsläufe — vgl.
// ensureLifeworkSchema). Im warmen Container wird das Ergebnis gemerkt.
let schemaReady = false
async function ensureUnlockSchema() {
  if (schemaReady) return
  await pool().query(`
    create table if not exists unlock_codes (
      code              varchar(12) primary key,
      recipient_name    text,
      recipient_email   text,
      note              text,
      created_by        uuid,
      created_at        timestamptz not null default now(),
      redeemed_at       timestamptz,
      redeemed_memorial varchar(16),
      email_sent_at     timestamptz
    )
  `)
  // Nachträglich ergänzt: Wer den Code eingelöst hat. Beides ist eine MOMENTAUFNAHME
  // aus dem Buch (Name) bzw. dem zugehörigen Konto (Inhaber) zum Zeitpunkt des
  // Einlösens — bewusst kopiert statt gejoint, damit die Zuordnung erhalten bleibt,
  // wenn das Buch später gelöscht oder umbenannt wird.
  await pool().query(`
    alter table unlock_codes
      add column if not exists redeemed_name  text,
      add column if not exists redeemed_owner text
  `)
  // Bruttopreis (inkl. MwSt.) des verkauften Gutscheins, in CENT — ganzzahlig, damit
  // keine Rundungsfehler entstehen. Reine Kaufmanns-Notiz beim Code (wie `note`);
  // das Einlösen prüft den Preis nicht.
  await pool().query(`
    alter table unlock_codes
      add column if not exists gross_price_cents integer
  `)
  schemaReady = true
}

// Preiseingabe des Admins ("49,90", "49.90", "49 €") → Cent (ganzzahlig).
// Rückgabe: null für leer, NaN für ungültig (der Aufrufer meldet das dem Admin).
function parsePriceCents(input) {
  if (input === null || input === undefined) return null
  const s = String(input).replace(/[€\s]/g, '').replace(',', '.').trim()
  if (!s) return null
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN
  return Math.round(parseFloat(s) * 100)
}

module.exports = {
  UNLOCK_LEN,
  genUnlockCode,
  formatUnlockCode,
  normalizeUnlockCode,
  parsePriceCents,
  ensureUnlockSchema,
}
