// api/support.js
// POST /api/support  { message, replyEmail, name?, context? }   (öffentlich, rate-limited)
//
// In-App-Support: Nutzer (Endnutzer, Beitragende oder Manager) schicken eine
// Nachricht/Fehlermeldung, die als E-Mail beim Betreiber landet (Reply-To = die
// angegebene Antwort-Adresse, damit direkt geantwortet werden kann). Die Anfrage
// wird ZUSÄTZLICH in der DB abgelegt, damit nichts verloren geht, falls der
// Mailversand hakt. `context` ist ein kleines Diagnose-Objekt (Buch-Code, Ansicht,
// Browser …), das dem Nutzer vor dem Absenden transparent angezeigt wurde.

const { createClient, pool } = require('./_lib/store')
const { enforce } = require('./_lib/ratelimit')
const { sendSupportMail } = require('./_lib/invitemail')
const { checkAuth } = require('./_lib/auth')
const { audit } = require('./_lib/audit')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

let schemaReady = false
async function ensureSupportSchema() {
  if (schemaReady) return
  await pool().query(`
    create table if not exists support_requests (
      id           bigint generated always as identity primary key,
      created_at   timestamptz not null default now(),
      memorial_id  varchar(16),
      name         text,
      reply_email  text,
      message      text not null,
      context      jsonb,
      handled      boolean not null default false
    )
  `)
  schemaReady = true
}

// ── Verwaltung (nur Admin): Tickets lesen / erledigt markieren / löschen ──────
async function handleAdmin(req, res) {
  if (!checkAuth(req, res)) return
  if (!req.auth.admin) return res.status(403).json({ error: 'Nur Administratoren.' })
  await ensureSupportSchema()

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('support_requests')
      .select('id, created_at, memorial_id, name, reply_email, message, context, handled')
      .order('created_at', { ascending: false })
      .limit(500)
    if (error) throw error
    return res.json({ tickets: data || [] })
  }

  if (req.method === 'PATCH') {
    const id = String(req.query.id || '').trim()
    if (!id) return res.status(400).json({ error: 'id fehlt.' })
    const handled = Boolean((req.body || {}).handled)
    const { error } = await supabase.from('support_requests').update({ handled }).eq('id', id)
    if (error) throw error
    await audit(req, { actor: req.auth, action: 'support.update', target: id, detail: { handled } })
    return res.json({ ok: true, handled })
  }

  if (req.method === 'DELETE') {
    const id = String(req.query.id || '').trim()
    if (!id) return res.status(400).json({ error: 'id fehlt.' })
    const { error } = await supabase.from('support_requests').delete().eq('id', id)
    if (error) throw error
    await audit(req, { actor: req.auth, action: 'support.delete', target: id })
    return res.json({ ok: true })
  }

  return res.status(405).end()
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  // Verwaltung (Admin) läuft über GET/PATCH/DELETE; das öffentliche Absenden über POST.
  if (req.method !== 'POST') {
    try { return await handleAdmin(req, res) }
    catch (e) { console.error('/api/support admin:', e); return res.status(500).json({ error: e.message }) }
  }
  try {
    // Jede Anfrage schreibt eine DB-Zeile und verschickt eine Mail → begrenzen.
    if (!(await enforce(req, res, { name: 'support-ip', limit: 10, windowSeconds: 3600 }))) return

    let { message, replyEmail, name, context } = req.body || {}
    message = String(message || '').trim()
    replyEmail = String(replyEmail || '').trim()
    name = String(name || '').trim().slice(0, 120) || null
    if (message.length < 3) return res.status(400).json({ error: 'Bitte beschreiben Sie Ihr Anliegen kurz.' })
    if (message.length > 5000) message = message.slice(0, 5000)
    // Ohne gültige Antwort-Adresse könnten wir nicht antworten → Pflicht.
    if (!EMAIL_RE.test(replyEmail)) return res.status(400).json({ error: 'Bitte eine gültige Antwort-E-Mail-Adresse angeben, damit wir antworten können.' })

    // Zusätzliche Drossel pro Antwort-Adresse (Missbrauch/Spam gegen das Postfach).
    if (!(await enforce(req, res, { name: 'support-email', limit: 6, windowSeconds: 3600, key: replyEmail.toLowerCase() }))) return

    // Kontext defensiv aufnehmen (nur ein flaches Objekt, Größe begrenzt).
    let ctx = null
    if (context && typeof context === 'object' && !Array.isArray(context)) {
      ctx = {}
      for (const [k, v] of Object.entries(context)) {
        if (typeof k !== 'string') continue
        ctx[k.slice(0, 40)] = typeof v === 'string' ? v.slice(0, 500) : v
        if (Object.keys(ctx).length >= 30) break
      }
    }
    const memorialId = ctx && typeof ctx.code === 'string' ? ctx.code.toUpperCase().slice(0, 16) : null

    await ensureSupportSchema()
    // Immer zuerst speichern (verlässlich), dann versenden (best effort).
    let stored = true
    try {
      await supabase.from('support_requests').insert({
        memorial_id: memorialId, name, reply_email: replyEmail, message, context: ctx,
      })
    } catch (e) { console.error('/api/support store:', e); stored = false }

    let email_sent = true
    try {
      await sendSupportMail({ replyTo: replyEmail, name, message, context: ctx })
    } catch (e) { console.error('/api/support mail:', e); email_sent = false }

    if (!stored && !email_sent) {
      // Weder gespeichert noch versendet → dem Nutzer ehrlich einen Fehler melden.
      return res.status(502).json({ error: 'Ihre Nachricht konnte nicht übermittelt werden. Bitte später erneut versuchen oder direkt an support@lebensgeschichten.ai schreiben.' })
    }
    await audit(req, { actor: { name: replyEmail }, action: 'support.submit', target: memorialId, detail: { email_sent, stored } })
    return res.json({ ok: true, email_sent })
  } catch (e) {
    console.error('/api/support error:', e)
    return res.status(500).json({ error: 'Ihre Nachricht konnte nicht übermittelt werden. Bitte später erneut versuchen.' })
  }
}
