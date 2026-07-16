// api/redeem.js
// POST /api/redeem  { memorial: "<BUCH-CODE>", code: "XXXX-XXXX-XXXX" }   (öffentlich, rate-limited)
//
// Ein Endnutzer mit zeitlich begrenztem Testkonto löst hier einen Freischaltcode
// ein, um das Zeitlimit seines Buchs aufzuheben (interview_timer_seconds → 0 =
// unbegrenzt). Der Code ist EINMALIG und generisch (nicht vorab an ein Konto
// gebunden) — er wird beim Einlösen an genau dieses Buch gebunden und verbraucht.
//
// Berechtigung: der Buch-Code (dasselbe Vertrauensmodell wie beim Namen-Nachtragen
// und beim Absenden von Antworten). Gegen das Durchprobieren von Freischaltcodes
// drosselt der Endpunkt streng pro IP; der 12-stellige Code (32^12 ≈ 10^18) ist
// ohnehin nicht sinnvoll zu erraten.

const { createClient } = require('./_lib/store')
const { enforce } = require('./_lib/ratelimit')
const { ensureUnlockSchema, normalizeUnlockCode, formatUnlockCode } = require('./_lib/unlockcodes')
const { audit } = require('./_lib/audit')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try {
    // Streng drosseln (Code-Rätselraten verhindern) — großzügig genug für Tippfehler.
    if (!(await enforce(req, res, { name: 'redeem-ip', limit: 20, windowSeconds: 600 }))) return

    const memorialCode = String((req.body && req.body.memorial) || '').toUpperCase().trim()
    const raw = normalizeUnlockCode((req.body && req.body.code) || '')
    if (!memorialCode) return res.status(400).json({ error: 'Buch-Code fehlt.' })
    if (!raw) return res.status(400).json({ error: 'Bitte einen Freischaltcode eingeben.' })

    await ensureUnlockSchema()

    // Buch muss existieren und tatsächlich ein Zeitlimit haben — sonst gibt es
    // nichts aufzuheben, und der Code wird NICHT verbraucht.
    const { data: m } = await supabase
      .from('memorials').select('id, interview_timer_seconds').eq('id', memorialCode).maybeSingle()
    if (!m) return res.status(404).json({ error: 'Buch nicht gefunden.' })
    const timer = parseInt(m.interview_timer_seconds, 10) || 0
    if (timer <= 0) {
      // Schon unbegrenzt — freundlich melden, Code bleibt gültig (nicht verbraucht).
      return res.json({ ok: true, already: true })
    }

    // Code prüfen. Existiert nicht ODER schon eingelöst → bewusst dieselbe,
    // unspezifische Meldung (keine Hinweise fürs Rätselraten).
    const { data: uc } = await supabase
      .from('unlock_codes').select('code, redeemed_at').eq('code', raw).maybeSingle()
    if (!uc || uc.redeemed_at) {
      return res.status(400).json({ error: 'Dieser Freischaltcode ist ungültig oder wurde bereits eingelöst.' })
    }

    // Einlösen: Code an dieses Buch binden + verbrauchen. Der Guard
    // `is('redeemed_at', null)` verhindert die doppelte Einlösung bei gleichzeitigen
    // Anfragen (nur EINE Aktualisierung trifft die noch offene Zeile).
    const nowIso = new Date().toISOString()
    const { data: claimed, error: claimErr } = await supabase
      .from('unlock_codes')
      .update({ redeemed_at: nowIso, redeemed_memorial: memorialCode })
      .eq('code', raw).is('redeemed_at', null)
      .select('code').maybeSingle()
    if (claimErr) throw claimErr
    if (!claimed) {
      return res.status(400).json({ error: 'Dieser Freischaltcode ist ungültig oder wurde bereits eingelöst.' })
    }

    // Zeitlimit des Buchs aufheben (0 = unbegrenzt).
    const { error: upErr } = await supabase
      .from('memorials').update({ interview_timer_seconds: 0 }).eq('id', memorialCode)
    if (upErr) throw upErr

    await audit(req, { actor: { name: memorialCode }, action: 'unlock.redeem', target: raw, detail: { memorial: memorialCode, code: formatUnlockCode(raw) } })
    return res.json({ ok: true })
  } catch (e) {
    console.error('/api/redeem error:', e)
    return res.status(500).json({ error: 'Der Freischaltcode konnte nicht eingelöst werden. Bitte später erneut versuchen.' })
  }
}
