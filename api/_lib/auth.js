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

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000 // 12 Stunden (Standard)
const REMEMBER_TTL_MS = 90 * 24 * 60 * 60 * 1000 // 90 Tage („Angemeldet bleiben")
const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000 // Einladungslink 14 Tage gültig

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

// Erzeugt einen signierten Token mit Ablaufdatum und Berechtigungs-Claims.
//   claims = { uid, admin, cats, eu }
//     uid   : app_users.id (null beim Env-Admin)
//     admin : true => Superuser (sieht alle Kategorien)
//     cats  : '*' (alle) ODER string[] der erlaubten Kategorie-Slugs
//     eu    : Buch-Code eines ENDNUTZERS (Kategorie Lebenswerk) — ein solches
//             Konto hat kein Dashboard, sondern nur Zugriff auf genau dieses
//             eine Buch (sein eigenes). Bei allen anderen Konten null.
function issueToken(claims = {}, opts = {}) {
  const c = getConfig()
  const payload = base64url(JSON.stringify({
    exp:   Date.now() + (opts.remember ? REMEMBER_TTL_MS : TOKEN_TTL_MS),
    uid:   claims.uid ?? null,
    admin: Boolean(claims.admin),
    cats:  claims.admin ? '*' : (Array.isArray(claims.cats) ? claims.cats : []),
    eu:    claims.eu || null,
  }))
  const sig = sign(payload, c.secret)
  return `${payload}.${sig}`
}

// Prüft einen Token (Signatur + Ablauf). Gibt bei Erfolg die Claims zurück,
// sonst null.
function verifyToken(token) {
  if (!isConfigured() || !token) return null
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [payload, sig] = parts
  const expected = sign(payload, getConfig().secret)
  // Längen sind bei korrektem Format identisch; timingSafeEqual braucht das.
  if (sig.length !== expected.length) return null
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
  try {
    const data = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString())
    if (typeof data.exp !== 'number' || Date.now() >= data.exp) return null
    return {
      uid:   data.uid ?? null,
      admin: Boolean(data.admin),
      cats:  data.cats === '*' ? '*' : (Array.isArray(data.cats) ? data.cats : []),
      eu:    data.eu || null,
    }
  } catch {
    return null
  }
}

// Bequemer Wächter für Handler: prüft den Bearer-Token, antwortet bei Fehler
// selbst mit 401/503 und gibt false zurück. Bei Erfolg hängt er die Claims
// als req.auth an und gibt true zurück.
function checkAuth(req, res) {
  if (!isConfigured()) {
    res.status(503).json({ error: 'Server nicht konfiguriert (Admin-Zugangsdaten fehlen).' })
    return false
  }
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim()
  const claims = verifyToken(token)
  if (!claims) {
    res.status(401).json({ error: 'Nicht autorisiert.' })
    return false
  }
  req.auth = claims
  return true
}

// Darf der eingeloggte Benutzer (Claims aus checkAuth) auf diese Kategorie?
function canAccessCategory(auth, category) {
  if (!auth) return false
  if (auth.admin || auth.cats === '*') return true
  return Array.isArray(auth.cats) && auth.cats.includes(category)
}

// ── Passwortrichtlinie ────────────────────────────────────────────
// Bewusst moderat: mind. 8 Zeichen, mind. 1 Ziffer, mind. 1 Sonderzeichen
// (alles, was weder Buchstabe noch Ziffer ist). Gibt { ok } oder
// { ok:false, error } zurück. Wird im Backend (users.js) UND im Frontend
// (App.jsx) verwendet, damit Anzeige und Prüfung identisch sind.
const PASSWORD_RULES_TEXT = 'Mindestens 8 Zeichen, davon mindestens eine Ziffer und ein Sonderzeichen.'

function validatePasswordPolicy(password) {
  const p = String(password ?? '')
  if (p.length < 8) return { ok: false, error: 'Passwort muss mindestens 8 Zeichen haben.' }
  if (!/[0-9]/.test(p)) return { ok: false, error: 'Passwort muss mindestens eine Ziffer enthalten.' }
  if (!/[^A-Za-z0-9]/.test(p)) return { ok: false, error: 'Passwort muss mindestens ein Sonderzeichen enthalten.' }
  return { ok: true }
}

// ── Einladungs-Token (Self-Onboarding) ────────────────────────────
// Kryptografisch zufälliger, URL-sicherer Token. Wird bei der Neuanlage eines
// Benutzers (ohne Passwort) erzeugt und in app_users.invite_token gespeichert;
// der Benutzer vergibt sich darüber (?invite=TOKEN) sein Passwort.
function generateInviteToken() {
  return base64url(crypto.randomBytes(24))
}

// ── Passwort-Hashing (scrypt, ohne externe Abhängigkeit) ──────────
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex')
  return { hash, salt }
}

function verifyPassword(password, hash, salt) {
  if (!hash || !salt) return false
  const candidate = crypto.scryptSync(String(password), salt, 64)
  const expected = Buffer.from(hash, 'hex')
  if (candidate.length !== expected.length) return false
  return crypto.timingSafeEqual(candidate, expected)
}

module.exports = {
  checkAuth, verifyCredentials, issueToken, verifyToken, isConfigured,
  canAccessCategory, hashPassword, verifyPassword,
  validatePasswordPolicy, PASSWORD_RULES_TEXT,
  generateInviteToken, INVITE_TTL_MS,
}
