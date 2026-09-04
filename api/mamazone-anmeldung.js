// api/mamazone-anmeldung.js
// POST /api/mamazone-anmeldung  { email, name?, consent }        (öffentlich, rate-limited)
//
// Interessensbekundung von der Seite /mamazone. Bewusst KEIN Support-Ticket:
// Es ist keine Anfrage, auf die jemand antworten muss, sondern eine Anmeldung
// zur nächsten Erprobungsgruppe. Deshalb geht genau EINE E-Mail raus — die
// Bestätigung an die Anmelderin — und das Support-Postfach steht als BCC im
// Verteiler. Die Kopie im Postfach IST damit die Ablage; es wird nichts in der
// Datenbank gespeichert, weil wir für eine Warteliste keinen zweiten Ort
// brauchen, an dem die Adressen einer Brustkrebs-Zielgruppe liegen.
//
// Gesundheitsdaten werden hier NICHT erhoben (das Feld zur Behandlungssituation
// ist aus dem Formular entfernt) — es bleiben Vorname und E-Mail-Adresse.

const { enforce } = require('./_lib/ratelimit')
const { sendMail } = require('./_lib/graphmail')
const { isSuppressed, unsubscribeLink } = require('./_lib/suppress')
const { audit } = require('./_lib/audit')

const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).end()
  try {
    if (!(await enforce(req, res, { name: 'mamazone-ip', limit: 10, windowSeconds: 3600 }))) return

    const email = String((req.body && req.body.email) || '').trim()
    const name = String((req.body && req.body.name) || '').trim().slice(0, 120)
    const consent = Boolean(req.body && req.body.consent)

    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Bitte eine gültige E-Mail-Adresse angeben.' })
    // Die Einwilligung ist die Rechtsgrundlage der Speicherung — ohne sie darf
    // die Adresse gar nicht erst ins Postfach.
    if (!consent) return res.status(400).json({ error: 'Ohne Ihre Einwilligung dürfen wir Ihre Angaben nicht speichern.' })
    if (!(await enforce(req, res, { name: 'mamazone-mail', limit: 3, windowSeconds: 3600, key: email.toLowerCase() }))) return

    // Abgemeldete Adresse: nichts senden, aber der Anmelderin gegenüber nicht
    // verraten, dass sie auf der Sperrliste steht.
    if (await isSuppressed(email)) return res.json({ ok: true })

    const inbox = process.env.SUPPORT_INBOX || 'support@lebensgeschichten.ai'
    const base = process.env.PUBLIC_BASE_URL || 'https://lebensgeschichten.ai'
    const unsubUrl = unsubscribeLink(base, email)
    const anrede = name ? `Hallo ${name},` : 'Hallo,'
    const absaetze = [
      'vielen Dank für Ihr Interesse an der mamazone Edition von Lebensgeschichten.ai.',
      'Wir haben Ihre Anmeldung notiert und melden uns bei Ihnen, sobald die nächste Gruppe startet. Bis dahin passiert nichts weiter — Sie müssen nichts tun.',
      'Wenn Sie Fragen haben, antworten Sie einfach auf diese E-Mail.',
    ]
    const text = `${anrede}\n\n${absaetze.join('\n\n')}\n\nSie können Ihre Anmeldung jederzeit widerrufen: ${unsubUrl}\n\n— Ihr Team von Lebensgeschichten.ai`
    const html = `<!doctype html><html lang="de"><body style="margin:0;background:#fbf9f6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1b1a19;">
<div style="max-width:520px;margin:0 auto;padding:28px 24px;">
<p style="font-size:15px;line-height:1.65;margin:0 0 14px;color:#44403c;">${esc(anrede)}</p>
${absaetze.map(p => `<p style="font-size:15px;line-height:1.65;margin:0 0 14px;color:#44403c;">${esc(p)}</p>`).join('\n')}
<p style="font-size:12px;line-height:1.6;color:#a8a29e;margin:22px 0 0;border-top:1px solid #e7e5e4;padding-top:16px;">
Sie können Ihre Anmeldung jederzeit widerrufen: <a href="${esc(unsubUrl)}" style="color:#a8a29e;">abmelden</a><br>
— Ihr Team von Lebensgeschichten.ai</p>
</div></body></html>`

    // Eine Sendung: an die Anmelderin, Kopie ins Support-Postfach.
    await sendMail({
      from: inbox, to: email, bcc: inbox, replyTo: inbox,
      subject: 'Ihre Anmeldung zur mamazone Edition – Lebensgeschichten.ai',
      text, html,
    })

    await audit(req, { actor: { name: email }, action: 'mamazone.signup', detail: { name: name || null } })
    return res.json({ ok: true })
  } catch (e) {
    console.error('/api/mamazone-anmeldung:', e)
    return res.status(500).json({ error: 'Ihre Anmeldung konnte nicht übermittelt werden. Bitte später erneut versuchen.' })
  }
}
