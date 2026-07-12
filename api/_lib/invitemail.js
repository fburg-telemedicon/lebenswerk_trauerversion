// api/_lib/invitemail.js
// Versendet Einladungs- und Passwort-Reset-Mails über den Graph-Mailer
// (noreply@, Reply-To support@) und setzt eine Blindkopie an die Betreiber-Adresse.
//
// Beides nutzt denselben Link `?invite=TOKEN`: Das Einlösen setzt ein (neues)
// Passwort – für die Erst-Einladung wie für den Reset identisch.

const { sendMail } = require('./graphmail')

// Blindkopie-Empfänger (Betreiber). Per Env überschreibbar.
const BCC = process.env.INVITE_BCC || 'florian.burg@lebensgeschichten.ai'
const REPLY_TO = process.env.INVITE_REPLY_TO || 'support@lebensgeschichten.ai'

// Basis-URL für Links aus dem Request ableiten (bzw. PUBLIC_BASE_URL).
function baseUrl(req) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/+$/, '')
  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0]
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'lebensgeschichten.ai'
  return `${proto}://${host}`
}
function inviteLink(req, tok) { return `${baseUrl(req)}/?invite=${encodeURIComponent(tok)}` }

function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
}

function buildHtml({ heading, intro, url }) {
  const safeUrl = esc(url)
  return `<!doctype html><html lang="de"><body style="margin:0;background:#fafaf9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1c1917;">
  <div style="max-width:520px;margin:0 auto;padding:28px 24px;">
    <h1 style="font-size:20px;font-weight:700;margin:0 0 14px;">${esc(heading)}</h1>
    <p style="font-size:15px;line-height:1.6;margin:0 0 20px;color:#44403c;">${esc(intro)}</p>
    <p style="margin:0 0 24px;"><a href="${safeUrl}" style="display:inline-block;background:#1c1917;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-size:15px;">Passwort festlegen</a></p>
    <p style="font-size:12px;line-height:1.6;color:#78716c;margin:0 0 6px;">Falls der Button nicht funktioniert, kopieren Sie diesen Link in Ihren Browser:</p>
    <p style="font-size:12px;line-height:1.6;word-break:break-all;margin:0 0 24px;"><a href="${safeUrl}" style="color:#57534e;">${safeUrl}</a></p>
    <p style="font-size:12px;line-height:1.6;color:#a8a29e;margin:0;border-top:1px solid #e7e5e4;padding-top:16px;">Der Link ist zeitlich begrenzt gültig. Falls Sie dies nicht angefordert haben, können Sie diese E-Mail ignorieren.<br>— Lebensgeschichten</p>
  </div></body></html>`
}

// kind: 'invite' (Erst-Einladung) | 'reset' (Passwort zurücksetzen)
async function sendAccessMail({ to, url, kind = 'invite' }) {
  const isReset = kind === 'reset'
  const subject = isReset ? 'Passwort zurücksetzen – Lebensgeschichten' : 'Ihr Zugang zu Lebensgeschichten'
  const heading = isReset ? 'Passwort zurücksetzen' : 'Willkommen bei Lebensgeschichten'
  const intro = isReset
    ? 'Sie haben angefordert, Ihr Passwort zurückzusetzen. Über den folgenden Link vergeben Sie ein neues Passwort:'
    : 'Für Sie wurde ein Zugang zum Lebensgeschichten-Dashboard angelegt. Über den folgenden Link vergeben Sie Ihr Passwort und schließen die Einrichtung ab:'
  const text = `${heading}\n\n${intro}\n\n${url}\n\nDer Link ist zeitlich begrenzt gültig. Falls Sie dies nicht angefordert haben, ignorieren Sie diese E-Mail.\n\n— Lebensgeschichten`
  const html = buildHtml({ heading, intro, url })
  return sendMail({ to, subject, text, html, replyTo: REPLY_TO, bcc: BCC })
}

module.exports = { sendAccessMail, baseUrl, inviteLink }
