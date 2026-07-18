// api/unsubscribe.js
// GET /api/unsubscribe?e=<email>&t=<token>
// Abmelde-/„Nicht ich"-Link aus der ersten E-Mail. Trägt die Adresse in die
// globale Sperrliste ein → keine weiteren E-Mails mehr an diese Adresse (über
// alle Versandpfade). Token-gesichert (HMAC je Adresse), idempotent,
// rate-limited. Antwort = einfache HTML-Seite.

const { enforce } = require('./_lib/ratelimit')
const { addSuppression, verifySuppressToken } = require('./_lib/suppress')
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
    if (!(await enforce(req, res, { name: 'unsubscribe', limit: 30, windowSeconds: 600 }))) return
    const email = String(req.query.e || '').trim().toLowerCase()
    const token = String(req.query.t || '').trim()
    if (!email || !token || !verifySuppressToken(email, token)) {
      return res.status(400).send(page('Link ungültig',
        'Dieser Abmelde-Link ist ungültig oder unvollständig. Bitte verwenden Sie den Link aus der Original-E-Mail.'))
    }
    await addSuppression(email, 'unsubscribe')
    await audit(req, { actor: { name: email }, action: 'email.unsubscribe', target: email })
    return res.status(200).send(page('Abgemeldet',
      `Die Adresse <strong>${esc(email)}</strong> wurde abgemeldet. Sie erhalten von Lebensgeschichten <strong>keine weiteren E-Mails</strong> mehr.<br><br>` +
      `Falls dies ein Versehen war, schreiben Sie an <a href="mailto:support@lebensgeschichten.ai" style="color:#1d4ed8;">support@lebensgeschichten.ai</a>.`))
  } catch (e) {
    console.error('/api/unsubscribe error:', e)
    return res.status(500).send(page('Fehler', 'Es ist ein Fehler aufgetreten. Bitte versuchen Sie es später erneut.'))
  }
}
