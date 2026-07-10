// api/_lib/graphmail.js
// Serverseitiger E-Mail-Versand über Microsoft Graph (Client-Credentials-Flow).
//
// Hintergrund: Die Entra-App "lebensgeschichten-mailer" (Single-Tenant) besitzt
// die Graph-ANWENDUNGSberechtigung Mail.Send (mit Adminzustimmung) und ist über
// eine Exchange Application Access Policy (RestrictAccess) auf die Absender
// noreply@ / support@lebensgeschichten.ai eingeschränkt. Ein Versuch, als ein
// anderes Postfach zu senden, wird von Exchange abgelehnt (ErrorAccessDenied).
//
// Benötigte Env-Variablen (in Vercel Production UND Preview setzen):
//   GRAPH_TENANT_ID      319a48ef-65d7-46f7-af85-584f0a59edbd
//   GRAPH_CLIENT_ID      5dc60222-77b0-425c-9100-e08773048526
//   GRAPH_CLIENT_SECRET  <Client-Secret der App>  (NIE ins Repo/Chat)
//   GRAPH_MAIL_SENDER    noreply@lebensgeschichten.ai   (Standard-Absender)
//
// Kein Fallback: sind die Variablen nicht gesetzt, wirft sendMail einen Fehler.

const TOKEN_HOST = 'https://login.microsoftonline.com'
const GRAPH = 'https://graph.microsoft.com/v1.0'

// App-only-Token wird prozessweit zwischengespeichert (gilt ~1 h). Wir erneuern
// ~1 Min vor Ablauf, um Grenzfälle zu vermeiden.
let cachedToken = null // { token, exp }

async function getToken() {
  const now = Date.now()
  if (cachedToken && cachedToken.exp > now + 60_000) return cachedToken.token
  const tenant = process.env.GRAPH_TENANT_ID
  const clientId = process.env.GRAPH_CLIENT_ID
  const secret = process.env.GRAPH_CLIENT_SECRET
  if (!tenant || !clientId || !secret) {
    throw new Error('Graph-Mail nicht konfiguriert (GRAPH_TENANT_ID / GRAPH_CLIENT_ID / GRAPH_CLIENT_SECRET fehlen).')
  }
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: secret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  })
  const r = await fetch(`${TOKEN_HOST}/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || !j.access_token) {
    throw new Error(`Graph-Token fehlgeschlagen (${r.status}): ${j.error_description || j.error || 'unbekannt'}`)
  }
  cachedToken = { token: j.access_token, exp: now + (j.expires_in || 3600) * 1000 }
  return cachedToken.token
}

// Wandelt "a@x, b@y" oder ["a@x","b@y"] in das Graph-Empfängerformat.
function toRecipients(v) {
  if (!v) return []
  const list = Array.isArray(v) ? v : String(v).split(',')
  return list
    .map(s => String(s).trim())
    .filter(Boolean)
    .map(address => ({ emailAddress: { address } }))
}

// Versendet eine E-Mail über Graph. Gibt bei Erfolg { ok:true } zurück, sonst
// wirft es (mit sprechender Fehlermeldung).
//   opts = { to, subject, text?, html?, from?, replyTo?, cc?, bcc?, saveToSentItems? }
//     to        Empfänger (String, kommagetrennt, oder Array) – Pflicht
//     subject   Betreff
//     text/html Textkörper – html hat Vorrang, sonst text (Plaintext)
//     from      Absender-Postfach; Default = GRAPH_MAIL_SENDER. MUSS von der
//               Access Policy gedeckt sein (noreply@ / support@).
//     replyTo   Antwort-an (z. B. support@), optional
//     attachments [{ filename, contentBytes(base64), contentType? }] – optional
async function sendMail({ to, subject, text, html, from, replyTo, cc, bcc, attachments, saveToSentItems = false } = {}) {
  const sender = String(from || process.env.GRAPH_MAIL_SENDER || '').trim()
  if (!sender) throw new Error('Kein Absender gesetzt (GRAPH_MAIL_SENDER oder from).')
  const toRec = toRecipients(to)
  if (!toRec.length) throw new Error('Kein Empfänger (to) angegeben.')

  const message = {
    subject: subject || '',
    body: html
      ? { contentType: 'HTML', content: html }
      : { contentType: 'Text', content: text || '' },
    toRecipients: toRec,
  }
  const ccRec = toRecipients(cc)
  const bccRec = toRecipients(bcc)
  const replyRec = toRecipients(replyTo)
  if (ccRec.length) message.ccRecipients = ccRec
  if (bccRec.length) message.bccRecipients = bccRec
  if (replyRec.length) message.replyTo = replyRec

  if (Array.isArray(attachments) && attachments.length) {
    message.attachments = attachments
      .filter(a => a && a.contentBytes)
      .map(a => ({
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: a.filename || 'anhang',
        contentType: a.contentType || 'application/octet-stream',
        contentBytes: a.contentBytes,
      }))
  }

  const token = await getToken()
  const r = await fetch(`${GRAPH}/users/${encodeURIComponent(sender)}/sendMail`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, saveToSentItems: Boolean(saveToSentItems) }),
  })
  if (r.status === 202) return { ok: true }
  const j = await r.json().catch(() => ({}))
  throw new Error(`Graph sendMail fehlgeschlagen (${r.status}): ${j.error?.message || j.error?.code || 'unbekannt'}`)
}

module.exports = { sendMail, getToken }
