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

module.exports = { ensureSuppressionSchema, isSuppressed, addSuppression, suppressToken, verifySuppressToken, unsubscribeLink }
