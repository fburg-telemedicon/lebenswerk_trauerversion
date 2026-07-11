// api/_lib/ratelimit.js
// Einfaches, Supabase-gestütztes Rate-Limiting für die öffentlichen Endpunkte
// (KI-Proxies + Login). Zählt Anfragen pro „Eimer" (i.d.R. Endpunkt + IP) in
// einem festen Zeitfenster über die Postgres-Funktion rate_limit_hit
// (siehe supabase/ratelimit.sql).
//
// WICHTIG – Fail-open: Schlägt der Limiter selbst fehl (z.B. DB nicht
// erreichbar oder Funktion/Tabelle noch nicht angelegt), wird die Anfrage
// NICHT blockiert. Der Schutz vor Missbrauch darf niemals legitime
// (trauernde!) Nutzer aussperren – Verfügbarkeit geht vor.

const crypto = require('crypto')
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

// Beste verfügbare Client-IP. Vercel setzt x-forwarded-for (erste Adresse =
// ursprünglicher Client). Fallbacks für lokale Entwicklung.
function clientIp(req) {
  const xff = req.headers['x-forwarded-for']
  if (xff) return String(xff).split(',')[0].trim()
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown'
}

// Pseudonymisiert eine Kennung (IP oder Benutzername) per HMAC-SHA256, gekürzt.
// DSGVO-Datenminimierung: In Rate-Limit-Eimern und im Audit-Log liegen dadurch
// KEINE Klartext-IPs/-Namen, aber gleiche Kennungen ergeben denselben Hash
// (Zählen/Korrelieren bleibt möglich, Rückrechnen auf die IP nicht). Secret aus
// IP_HASH_SECRET bzw. ADMIN_TOKEN_SECRET (immer gesetzt); statischer Notnagel nur
// für unkonfigurierte Umgebungen.
const IP_HASH_SECRET = process.env.IP_HASH_SECRET || process.env.ADMIN_TOKEN_SECRET || 'lw-static-ip-salt'
function hashId(value) {
  return crypto.createHmac('sha256', IP_HASH_SECRET).update(String(value ?? '')).digest('hex').slice(0, 24)
}

// Liefert true, wenn die Anfrage erlaubt ist (unter dem Limit), sonst false.
//   name          : Endpunkt-Kennung (z.B. 'ask')
//   limit         : max. Anfragen pro Fenster
//   windowSeconds : Fensterlänge in Sekunden
//   key           : optionaler eigener Schlüssel (Standard: Client-IP)
async function allow(req, { name, limit, windowSeconds, key }) {
  try {
    // Kennung pseudonymisieren (kein Klartext in der DB).
    const bucket = `${name}:${hashId(key || clientIp(req))}`
    const { data, error } = await supabase.rpc('rate_limit_hit', {
      p_bucket: bucket,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    })
    if (error) {
      console.error('rate_limit_hit error (fail-open):', error.message)
      return true
    }
    return data === true
  } catch (e) {
    console.error('ratelimit exception (fail-open):', e.message)
    return true
  }
}

// Bequemer Wächter: blockt bei Überschreitung selbst mit 429 und gibt false
// zurück; sonst true. Im Handler: `if (!(await enforce(...))) return`.
async function enforce(req, res, opts) {
  const ok = await allow(req, opts)
  if (!ok) {
    res.status(429).json({ error: 'Zu viele Anfragen. Bitte einen Moment warten und erneut versuchen.' })
    return false
  }
  return true
}

module.exports = { allow, enforce, clientIp, hashId }
