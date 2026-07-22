// api/send-resume.js
// POST /api/send-resume  { memorialCode, session, email, subject, body }
// Öffentlich (Beitragenden-Flow, kein Login): schickt dem Beitragenden seinen
// persönlichen Wiederaufnahme-Link per E-Mail AUS DER APP heraus — statt die externe
// Mail-App (mailto:) zu öffnen.
//
// Missbrauchsschutz:
//  • Rate-Limit pro IP.
//  • Die Session-ID (contribId) ist ein geheimes Zufallstoken und muss zu diesem
//    Buch-Code gehören (Capability) — nur ein echter Beitragender kann also senden.
//  • Abgemeldete Adressen (Suppression-Liste) bekommen nichts.
//  • Betreff/Text kommen aus der App in der Sprache des Beitragenden; der Text muss
//    den echten Wiederaufnahme-Link (session=…) enthalten, damit kein beliebiger
//    Inhalt an fremde Adressen verschickt werden kann.

const { createClient } = require('./_lib/store')
const { resolvePublicCode } = require('./_lib/access')
const { enforce } = require('./_lib/ratelimit')
const { sendMail } = require('./_lib/graphmail')
const { isSuppressed } = require('./_lib/suppress')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!(await enforce(req, res, { name: 'send-resume', limit: 8, windowSeconds: 3600 }))) return
  try {
    const { memorialCode, session, email, subject, body } = req.body || {}
    const code = String(memorialCode || '').toUpperCase().trim()
    const sess = String(session || '').trim()
    const to   = String(email || '').trim()
    const subj = String(subject || '').trim().slice(0, 300)
    const text = String(body || '').trim().slice(0, 4000)
    if (!code || !sess) return res.status(400).json({ error: 'Code/Session fehlt.' })
    if (!EMAIL_RE.test(to)) return res.status(400).json({ error: 'Bitte eine gültige E-Mail-Adresse angeben.' })
    if (!subj || !text) return res.status(400).json({ error: 'Betreff/Text fehlt.' })
    // Der Text MUSS den echten Wiederaufnahme-Link (session=…) enthalten.
    if (!text.includes('session=' + sess)) return res.status(400).json({ error: 'Ungültiger Wiederaufnahme-Link.' })
    // Buch-Code ODER Gast-Code (Gastbeiträge zum Lebenswerk). Der Wiederaufnahme-
    // Link, den der Gast bekommt, trägt seinen eigenen Code — geprüft wird gegen
    // das echte Buch dahinter.
    const target = await resolvePublicCode(supabase, code)
    if (!target) return res.status(403).json({ error: 'Ungültiger Code.' })
    // Session-Capability prüfen: der Beitrag muss existieren und zu diesem Buch gehören.
    const { data: contrib } = await supabase
      .from('contributions').select('id').eq('id', sess).eq('memorial_id', target.id).maybeSingle()
    if (!contrib) return res.status(403).json({ error: 'Ungültige Sitzung.' })
    // Abgemeldete Adressen bekommen nichts (still „ok" zurück, kein Info-Leak).
    if (await isSuppressed(to)) return res.json({ ok: true, suppressed: true })
    await sendMail({ to, subject: subj, text })
    return res.json({ ok: true })
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Senden fehlgeschlagen.' })
  }
}
