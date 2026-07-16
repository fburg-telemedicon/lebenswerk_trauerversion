// api/admin/unlock-codes.js
// Verwaltung der Freischaltcodes (NUR für Admins).
//
//   GET    /api/admin/unlock-codes                 → { codes: [...] }
//   POST   /api/admin/unlock-codes                 { recipient_name?, recipient_email?, note?, send? }
//            → erzeugt einen neuen (einmaligen, generischen) Code; mit send:true und
//              Empfänger-Adresse wird er zusätzlich per E-Mail verschickt.
//   PATCH  /api/admin/unlock-codes?code=…          { action:'send' }        → E-Mail (erneut) senden
//                                                  { recipient_name?, recipient_email?, note? } → Notiz-Felder ändern
//   DELETE /api/admin/unlock-codes?code=…          → Code löschen
//
// Ein Freischaltcode hebt das Zeitlimit (interview_timer_seconds) des Buchs auf,
// in dem er eingelöst wird — siehe api/redeem.js. Der Code ist bei der Erzeugung an
// KEIN Konto gebunden (generisch) und einmalig einlösbar.

const { createClient } = require('../_lib/store')
const { checkAuth } = require('../_lib/auth')
const { ensureUnlockSchema, genUnlockCode, formatUnlockCode } = require('../_lib/unlockcodes')
const { sendUnlockCodeMail } = require('../_lib/invitemail')
const { audit } = require('../_lib/audit')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// DB-Zeile → Frontend-Objekt (Code zusätzlich hübsch formatiert).
function toPublic(row) {
  return {
    code: row.code,
    code_display: formatUnlockCode(row.code),
    recipient_name: row.recipient_name || '',
    recipient_email: row.recipient_email || '',
    note: row.note || '',
    created_at: row.created_at,
    redeemed_at: row.redeemed_at,
    redeemed_memorial: row.redeemed_memorial,
    redeemed_name: row.redeemed_name || '',
    redeemed_owner: row.redeemed_owner || '',
    email_sent_at: row.email_sent_at,
  }
}

// Spaltenliste für alle Abfragen (Anzeige-Objekt siehe toPublic).
const COLS = 'code, recipient_name, recipient_email, note, created_at, redeemed_at, redeemed_memorial, redeemed_name, redeemed_owner, email_sent_at'

// Einen garantiert freien Rohcode würfeln (Kollisionen sind extrem unwahrscheinlich,
// aber der Primärschlüssel-Konflikt würde sonst als 500 durchschlagen).
async function freshCode() {
  for (let i = 0; i < 6; i++) {
    const c = genUnlockCode()
    const { data } = await supabase.from('unlock_codes').select('code').eq('code', c).maybeSingle()
    if (!data) return c
  }
  throw new Error('Konnte keinen freien Freischaltcode erzeugen.')
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (!checkAuth(req, res)) return

  try {
    if (!req.auth.admin) return res.status(403).json({ error: 'Nur Administratoren.' })
    await ensureUnlockSchema()

    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('unlock_codes')
        .select(COLS)
        .order('created_at', { ascending: false })
      if (error) throw error
      return res.json({ codes: (data || []).map(toPublic) })
    }

    if (req.method === 'POST') {
      const body = req.body || {}
      const recipient_name = String(body.recipient_name || '').trim().slice(0, 120) || null
      const recipient_email = String(body.recipient_email || '').trim().slice(0, 200) || null
      const note = String(body.note || '').trim().slice(0, 500) || null
      if (recipient_email && !EMAIL_RE.test(recipient_email)) {
        return res.status(400).json({ error: 'Bitte eine gültige E-Mail-Adresse angeben (oder das Feld leer lassen).' })
      }
      const code = await freshCode()
      const { data, error } = await supabase.from('unlock_codes')
        .insert({ code, recipient_name, recipient_email, note, created_by: req.auth.uid || null })
        .select(COLS).single()
      if (error) throw error
      await audit(req, { actor: req.auth, action: 'unlock.create', target: code, detail: { recipient_email } })

      const out = toPublic(data)
      // Optional direkt versenden (nur wenn eine Adresse angegeben wurde).
      if (body.send && recipient_email) {
        try {
          await sendUnlockCodeMail({ to: recipient_email, code: out.code_display, name: recipient_name })
          const nowIso = new Date().toISOString()
          await supabase.from('unlock_codes').update({ email_sent_at: nowIso }).eq('code', code)
          out.email_sent_at = nowIso
          out.email_sent = true
          await audit(req, { actor: req.auth, action: 'unlock.send', target: code, detail: { to: recipient_email } })
        } catch (e) {
          console.error('/api/admin/unlock-codes send:', e)
          out.email_sent = false
          out.email_error = e.message
        }
      }
      return res.json(out)
    }

    if (req.method === 'PATCH') {
      const code = String(req.query.code || '').trim()
      if (!code) return res.status(400).json({ error: 'code fehlt.' })
      const { data: row } = await supabase
        .from('unlock_codes').select('code, recipient_name, recipient_email').eq('code', code).maybeSingle()
      if (!row) return res.status(404).json({ error: 'Freischaltcode nicht gefunden.' })
      const body = req.body || {}

      // E-Mail (erneut) versenden.
      if (body.action === 'send') {
        const to = String(body.recipient_email || row.recipient_email || '').trim()
        if (!EMAIL_RE.test(to)) return res.status(400).json({ error: 'Für diesen Code ist keine gültige E-Mail-Adresse hinterlegt.' })
        try {
          await sendUnlockCodeMail({ to, code: formatUnlockCode(code), name: row.recipient_name || null })
          const nowIso = new Date().toISOString()
          const patch = { email_sent_at: nowIso }
          if (to !== row.recipient_email) patch.recipient_email = to
          await supabase.from('unlock_codes').update(patch).eq('code', code)
          await audit(req, { actor: req.auth, action: 'unlock.send', target: code, detail: { to } })
          return res.json({ ok: true, email_sent: true, email_sent_at: nowIso })
        } catch (e) {
          console.error('/api/admin/unlock-codes resend:', e)
          return res.status(502).json({ error: `E-Mail konnte nicht gesendet werden: ${e.message}` })
        }
      }

      // Notiz-Felder ändern.
      const patch = {}
      if (body.recipient_name !== undefined) patch.recipient_name = String(body.recipient_name || '').trim().slice(0, 120) || null
      if (body.recipient_email !== undefined) {
        const em = String(body.recipient_email || '').trim().slice(0, 200)
        if (em && !EMAIL_RE.test(em)) return res.status(400).json({ error: 'Bitte eine gültige E-Mail-Adresse angeben (oder das Feld leer lassen).' })
        patch.recipient_email = em || null
      }
      if (body.note !== undefined) patch.note = String(body.note || '').trim().slice(0, 500) || null
      if (!Object.keys(patch).length) return res.status(400).json({ error: 'Keine Änderung übergeben.' })
      const { error } = await supabase.from('unlock_codes').update(patch).eq('code', code)
      if (error) throw error
      await audit(req, { actor: req.auth, action: 'unlock.update', target: code, detail: { changed: Object.keys(patch) } })
      return res.json({ ok: true })
    }

    if (req.method === 'DELETE') {
      const code = String(req.query.code || '').trim()
      if (!code) return res.status(400).json({ error: 'code fehlt.' })
      const { error } = await supabase.from('unlock_codes').delete().eq('code', code)
      if (error) throw error
      await audit(req, { actor: req.auth, action: 'unlock.delete', target: code })
      return res.json({ ok: true })
    }

    return res.status(405).end()
  } catch (e) {
    console.error('/api/admin/unlock-codes:', e)
    res.status(500).json({ error: e.message })
  }
}
