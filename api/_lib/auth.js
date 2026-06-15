// api/_lib/auth.js
// Gemeinsamer Admin-Login für alle /api/admin/* Endpunkte.
//
// Sicherheitsmerkmale gegenüber der alten Lösung:
//  - KEINE unsicheren Standardwerte mehr. Sind die Env-Variablen nicht gesetzt,
//    verweigert das System jeden Login (statt admin/1234 zuzulassen).
//  - Passwortvergleich zeitkonstant (gegen Timing-Angriffe).
//  - Login gibt einen SIGNIERTEN Token mit Ablaufdatum zurück (Standard 12 h)
//    statt eines festen, ewig gültigen Strings.
//
// Benötigte Env-Variablen (in Vercel für Production UND Preview setzen):
//  - ADMIN_USERNAME      Benutzername
//  - ADMIN_PASSWORD      starkes Passwort
//  - ADMIN_TOKEN_SECRET  langer zufälliger String zum Signieren der Tokens

const crypto = require('crypto')

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000 // 12 Stunden

function getConfig() {
  return {
    username: process.env.ADMIN_USERNAME,
    password: process.env.ADMIN_PASSWORD,
    secret: process.env.ADMIN_TOKEN_SECRET,
  }
}

// True nur, wenn alle drei Variablen gesetzt sind. Sonst läuft nichts.
function isConfigured() {
  const c = getConfig()
  return Boolean(c.username && c.password && c.secret)
}

// Zeitkonstanter Vergleich zweier Strings (über sha256-Digest gleicher Länge).
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest()
  const hb = crypto.createHash('sha256').update(String(b)).digest()
  return crypto.timingSafeEqual(ha, hb)
}

function base64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function sign(payloadStr, secret) {
  return base64url(crypto.createHmac('sha256', secret).update(payloadStr).digest())
}

// Prüft Zugangsdaten zeitkonstant. Gibt true/false zurück.
function verifyCredentials(username, password) {
  if (!isConfigured()) return false
  const c = getConfig()
  // Beide Vergleiche immer ausführen (kein frühes return), damit die Laufzeit
  // nicht verrät, ob der Benutzername stimmte.
  const userOk = safeEqual(username || '', c.username)
  const passOk = safeEqual(password || '', c.password)
  return userOk && passOk
}

// Erzeugt einen signierten Token mit Ablaufdatum.
function issueToken() {
  const c = getConfig()
  const payload = base64url(JSON.stringify({ exp: Date.now() + TOKEN_TTL_MS }))
  const sig = sign(payload, c.secret)
  return `${payload}.${sig}`
}

// Prüft einen Token (Signatur + Ablauf). Gibt true/false zurück.
function verifyToken(token) {
  if (!isConfigured() || !token) return false
  const parts = token.split('.')
  if (parts.length !== 2) return false
  const [payload, sig] = parts
  const expected = sign(payload, getConfig().secret)
  // Längen sind bei korrektem Format identisch; timingSafeEqual braucht das.
  if (sig.length !== expected.length) return false
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false
  try {
    const { exp } = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString())
    return typeof exp === 'number' && Date.now() < exp
  } catch {
    return false
  }
}

// Bequemer Wächter für Handler: prüft den Bearer-Token, antwortet bei Fehler
// selbst mit 401/503 und gibt false zurück.
function checkAuth(req, res) {
  if (!isConfigured()) {
    res.status(503).json({ error: 'Server nicht konfiguriert (Admin-Zugangsdaten fehlen).' })
    return false
  }
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim()
  if (!verifyToken(token)) {
    res.status(401).json({ error: 'Nicht autorisiert.' })
    return false
  }
  return true
}

module.exports = { checkAuth, verifyCredentials, issueToken, verifyToken, isConfigured }
