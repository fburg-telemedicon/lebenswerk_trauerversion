// api/confirm-email.js
// GET /api/confirm-email?e=<email>&t=<token>
// Double-Opt-in-Bestätigung: Wer eine Support-Anfrage mit seiner Adresse
// ausgelöst hat, bestätigt hier, dass wir ihm an diese Adresse antworten dürfen.
// Erst danach gehen reguläre Bestätigungs-/Antwortmails an die Adresse. Token-
// gesichert (HMAC je Adresse), idempotent, rate-limited. Der Gegenweg (Abmelden)
// ist api/unsubscribe.js.

const { enforce } = require('./_lib/ratelimit')
const { addConfirmed, verifyConfirmToken, unsubscribeLink } = require('./_lib/suppress')
const { audit } = require('./_lib/audit')

const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

function page(title, body) {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} · Lebensgeschichten</title></head>
  <body style="margin:0;background:#fafaf9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1c1917;">
    <div style="max-width:520px;margin:12vh auto;padding:28px 24px;background:#fff;border:1px solid #e7e5e4;border-radius:12px;">
      <h1 style="font-size:20px;font-weight:700;margin:0 0 12px;">${title}</h1>
      <div style="font-size:15px;line-height:1.6;color:#44403c;">${body}</div>
      <p style="font-size:12px;color:#a8a29e;margin:24px 0 0;border-top:1px solid #e7e5e4;padding-top:14px;">— Lebensgeschichten</p>
    </div>
  </body></html>`
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  try {
    if (!(await enforce(req, res, { name: 'confirm-email', limit: 30, windowSeconds: 600 }))) return
    const email = String(req.query.e || '').trim().toLowerCase()
    const token = String(req.query.t || '').trim()
    if (!email || !token || !verifyConfirmToken(email, token)) {
      const unsub = email ? unsubscribeLink(process.env.PUBLIC_BASE_URL || 'https://lebensgeschichten.ai', email) : null
      return res.status(400).send(page('Link ungültig',
        `Dieser Bestätigungslink ist ungültig oder unvollständig. Bitte verwenden Sie den Link aus der E-Mail.` +
        (unsub ? `<br><br>Sie möchten keine E-Mails? <a href="${esc(unsub)}" style="color:#1d4ed8;">Hier abmelden</a>.` : '')))
    }
    await addConfirmed(email)
    await audit(req, { actor: { name: email }, action: 'email.confirmed', target: email })
    return res.status(200).send(page('E-Mail bestätigt',
      `Danke – die Adresse <strong>${esc(email)}</strong> ist bestätigt. Der Support kümmert sich um Ihre Anfrage und darf Ihnen an diese Adresse antworten.`))
  } catch (e) {
    console.error('/api/confirm-email error:', e)
    return res.status(500).send(page('Fehler', 'Es ist ein Fehler aufgetreten. Bitte versuchen Sie es später erneut.'))
  }
}
