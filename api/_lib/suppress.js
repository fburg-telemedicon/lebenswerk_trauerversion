// api/_lib/suppress.js
// Globale Abmelde-/„Nicht ich"-Liste. Einmal gesperrte Adressen erhalten KEINE
// weiteren E-Mails mehr (Einladungen, Zugangs-, Freischaltcode-Mails). Gefüllt
// über den Abmelde-Link in der ersten Mail (api/unsubscribe.js). So kann sich
// jemand, der eine unerwünschte/fremd angestoßene Mail bekommt, dauerhaft und
// über alle Versandpfade hinweg abmelden.
//
// Kein PostgREST auf Azure → keine RLS nötig (Tabelle nur serverseitig genutzt,
// analog zu support_requests / ratelimit).

const crypto = require('crypto')
const { createClient, pool } = require('./store')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

const norm = e => String(e || '').trim().toLowerCase()

let schemaReady = false
async function ensureSuppressionSchema() {
  if (schemaReady) return
  await pool().query(`
    create table if not exists email_suppression (
      email      text primary key,
      reason     text,
      created_at timestamptz not null default now()
    )
  `)
  schemaReady = true
}

// HMAC-Token je Adresse: stabil, ohne Secret nicht erratbar, kein DB-Lookup nötig.
// So kann der Abmelde-Link niemand für fremde Adressen fälschen/enumerieren.
function suppressToken(email) {
  const secret = process.env.ADMIN_TOKEN_SECRET || ''
  return crypto.createHmac('sha256', secret).update(`unsub:${norm(email)}`).digest('hex').slice(0, 32)
}
function verifySuppressToken(email, token) {
  const a = Buffer.from(String(token || ''))
  const b = Buffer.from(suppressToken(email))
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

// Abmelde-Link für eine Adresse (Basis-URL vom Aufrufer, z. B. Origin der Mail).
function unsubscribeLink(baseUrl, email) {
  const e = norm(email)
  return `${String(baseUrl || '').replace(/\/+$/, '')}/api/unsubscribe?e=${encodeURIComponent(e)}&t=${suppressToken(e)}`
}

// Ist die Adresse gesperrt? Fail-open: ein DB-Fehler darf den Versand nicht
// dauerhaft blockieren (lieber einmal zu viel senden als alle Mails stoppen).
async function isSuppressed(email) {
  const e = norm(email)
  if (!e) return false
  try {
    await ensureSuppressionSchema()
    const { data } = await supabase.from('email_suppression').select('email').eq('email', e).maybeSingle()
    return !!data
  } catch (err) { console.warn('isSuppressed:', err.message); return false }
}

// Adresse dauerhaft sperren (idempotent).
async function addSuppression(email, reason) {
  const e = norm(email)
  if (!e) return
  await ensureSuppressionSchema()
  await pool().query(
    `insert into email_suppression (email, reason) values ($1, $2) on conflict (email) do nothing`,
    [e, reason || null],
  )
}

// ── Double-Opt-in: bestätigte Adressen ───────────────────────────────────────
// Adressen, die per Bestätigungslink zugestimmt haben, an sie E-Mails zu senden.
// Bis eine Adresse bestätigt ist, bekommt sie nur EINE Opt-in-Mail (bestätigen
// ODER abmelden) — kein weiterer automatischer Versand. Schützt davor, dass jemand
// mit einer fremden Adresse Mails auslöst.
let confirmSchemaReady = false
async function ensureConfirmSchema() {
  if (confirmSchemaReady) return
  await pool().query(`
    create table if not exists confirmed_emails (
      email      text primary key,
      created_at timestamptz not null default now()
    )
  `)
  confirmSchemaReady = true
}
function confirmToken(email) {
  const secret = process.env.ADMIN_TOKEN_SECRET || ''
  return crypto.createHmac('sha256', secret).update(`confirm:${norm(email)}`).digest('hex').slice(0, 32)
}
function verifyConfirmToken(email, token) {
  const a = Buffer.from(String(token || ''))
  const b = Buffer.from(confirmToken(email))
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}
function confirmLink(baseUrl, email) {
  const e = norm(email)
  return `${String(baseUrl || '').replace(/\/+$/, '')}/api/confirm-email?e=${encodeURIComponent(e)}&t=${confirmToken(e)}`
}
// Ist die Adresse bestätigt? Fail-CLOSED: bei DB-Fehler „nicht bestätigt" (false) —
// dann geht nur die Opt-in-Mail raus, nie ungewollt der reguläre Versand.
async function isConfirmed(email) {
  const e = norm(email)
  if (!e) return false
  try {
    await ensureConfirmSchema()
    const { data } = await supabase.from('confirmed_emails').select('email').eq('email', e).maybeSingle()
    return !!data
  } catch (err) { console.warn('isConfirmed:', err.message); return false }
}
async function addConfirmed(email) {
  const e = norm(email)
  if (!e) return
  await ensureConfirmSchema()
  await pool().query(`insert into confirmed_emails (email) values ($1) on conflict (email) do nothing`, [e])
}

module.exports = {
  ensureSuppressionSchema, isSuppressed, addSuppression, suppressToken, verifySuppressToken, unsubscribeLink,
  ensureConfirmSchema, isConfirmed, addConfirmed, confirmToken, verifyConfirmToken, confirmLink,
}
