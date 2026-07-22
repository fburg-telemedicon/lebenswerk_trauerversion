// api/support.js
// POST /api/support  { message, replyEmail?, replyPhone?, preferredChannel?, name?, context? }
//                                                              (öffentlich, rate-limited)
//
// In-App-Support: Nutzer (Endnutzer, Beitragende oder Manager) schicken eine
// Nachricht/Fehlermeldung, die als E-Mail beim Betreiber landet (Reply-To = die
// angegebene Antwort-Adresse, damit direkt geantwortet werden kann). Als
// Rückkanal genügt WAHLWEISE eine E-Mail-Adresse ODER eine Telefonnummer —
// mindestens eines von beidem muss da sein, sonst könnten wir nicht antworten.
// `preferredChannel` ('email' | 'phone') ist der Wunsch des Nutzers, wie er
// kontaktiert werden möchte; ohne Angabe entscheidet der Support. Die Anfrage
// wird ZUSÄTZLICH in der DB abgelegt, damit nichts verloren geht, falls der
// Mailversand hakt. `context` ist ein kleines Diagnose-Objekt (Buch-Code, Ansicht,
// Browser …), das dem Nutzer vor dem Absenden transparent angezeigt wurde.

const { createClient, pool } = require('./_lib/store')
const { enforce } = require('./_lib/ratelimit')
const { sendSupportMail } = require('./_lib/invitemail')
const { sendMail } = require('./_lib/graphmail')
const { callAzure } = require('./_lib/llm')
const { isEnduserCategory } = require('./_lib/categories')
const { costLLM, recordCost } = require('./_lib/cost')
const { isSuppressed, isConfirmed, confirmLink, unsubscribeLink } = require('./_lib/suppress')
const { checkAuth } = require('./_lib/auth')
const { audit } = require('./_lib/audit')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))])

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// Telefonnummern bewusst nur grob prüfen: Ziffern, Leerzeichen, +, /, -, (), mind.
// 6 Ziffern. Strenger wäre hier falsch — internationale Schreibweisen sind zu
// vielfältig, und eine abgewiesene Nummer kostet uns eine echte Support-Anfrage.
const PHONE_RE = /^[+()/\-.\s\d]{6,}$/
const CHANNELS = ['email', 'phone']

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
  // Nachträglich ergänzt: Telefon als alternativer Rückkanal + Kontaktwunsch.
  // `reply_email` ist damit nicht mehr Pflicht (nur noch E-Mail ODER Telefon).
  await pool().query(`
    alter table support_requests
      add column if not exists reply_phone       text,
      add column if not exists preferred_channel text
  `)
  // KI-Assistenz: editierbarer Antwort-Entwurf + optionaler Reparatur-Prompt,
  // sowie Zeitpunkt einer versendeten Antwort.
  await pool().query(`
    alter table support_requests
      add column if not exists reply_draft   text,
      add column if not exists repair_prompt text,
      add column if not exists reply_sent_at timestamptz
  `)
  schemaReady = true
}

// ── KI-Assistenz zu einem Ticket ─────────────────────────────────────────────
// Erzeugt einen editierbaren Antwort-Entwurf und – falls sinnvoll – einen
// fertigen Reparatur-Prompt fürs KI-System. Best effort: der Aufrufer schluckt
// Fehler, das Ticket ist wichtiger als der Vorschlag.
const LANG_NAME = { de: 'Deutsch', en: 'Englisch', pl: 'Polnisch', fr: 'Französisch', es: 'Spanisch', it: 'Italienisch', tr: 'Türkisch', ru: 'Russisch', ar: 'Arabisch', he: 'Hebräisch', uk: 'Ukrainisch', nl: 'Niederländisch', pt: 'Portugiesisch' }

function parseAssist(text) {
  if (!text) return null
  let s = String(text).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const a = s.indexOf('{'), b = s.lastIndexOf('}')
  if (a >= 0 && b > a) s = s.slice(a, b + 1)
  try {
    const o = JSON.parse(s)
    return { reply: String(o.reply || '').trim(), repair_prompt: String(o.repair_prompt || '').trim() }
  } catch { return null }
}

// Erzeugt Vorschläge für ein gespeichertes Ticket (row) und schreibt sie zurück.
// Gibt { reply_draft, repair_prompt } zurück oder null (bei Fehlschlag).
async function assistForTicket(row) {
  if (!row || row.id == null) return null
  const ctx = row.context && typeof row.context === 'object' ? row.context : {}
  const lang = LANG_NAME[String(ctx.lang || '').toLowerCase()] || 'Deutsch'
  const diag = Object.entries(ctx)
    .filter(([, v]) => v !== undefined && v !== null && String(v) !== '')
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join('\n')
  const system =
    'Du bist der Support-Assistent von „Lebensgeschichten", einer KI-gestützten App für ' +
    'Biografie- und Gedenkbücher (Interviews per Sprache oder Text, die KI erzeugt daraus ' +
    'Buch, Bilder und Trauerrede). Zu einer eingegangenen Support-Anfrage erstellst du zwei Dinge:\n' +
    `1) "reply": einen freundlichen, konkreten, sofort absendbaren Antwort-Entwurf an die anfragende ` +
    `Person, in höflicher Sie-Form, auf ${lang}. Gehe auf das geschilderte Problem ein und nenne – wenn ` +
    'möglich – einen konkreten Lösungsweg oder die nächsten Schritte. Erfinde keine Fakten und sage keine ' +
    'Fristen zu. Schließe mit „Ihr Lebensgeschichten-Team".\n' +
    '2) "repair_prompt": NUR wenn das Problem inhaltlich über eine korrigierende Anweisung an das KI-System ' +
    'lösbar erscheint (z. B. fehlerhaftes Interview, falsches Buchkapitel, unpassend erzeugter Text/Bild), ' +
    'formuliere einen fertigen deutschen Anweisungs-Prompt, den das Team dem KI-System geben kann, um genau ' +
    'dieses Problem zu beheben. Andernfalls ein leerer String "".\n' +
    'Antworte AUSSCHLIESSLICH als kompaktes JSON ohne Markdown: {"reply":"…","repair_prompt":"…"}'
  const user =
    `Absender: ${row.name || '—'}${row.reply_email ? ` <${row.reply_email}>` : ''}\n\n` +
    `Nachricht:\n${row.message || ''}\n\n` +
    `Diagnose-Angaben:\n${diag || '(keine)'}`
  const result = await callAzure({ system, messages: [{ role: 'user', content: user }], maxTokens: 1200 })
  if (result.inT || result.outT) {
    try {
      await recordCost({
        memorial_id: row.memorial_id || null,
        kind: 'support-assist',
        provider: result.provider,
        model: result.model,
        input_tokens: result.inT,
        output_tokens: result.outT,
        cost_usd: costLLM(result.model, result.inT, result.outT),
      })
    } catch (e) { console.warn('/api/support cost:', e.message) }
  }
  const parsed = parseAssist(result.text)
  if (!parsed) return null
  const patch = { reply_draft: parsed.reply || null, repair_prompt: parsed.repair_prompt || null }
  try { await supabase.from('support_requests').update(patch).eq('id', row.id) }
  catch (e) { console.warn('/api/support assist store:', e.message) }
  return patch
}

// ── Verwaltung (nur Admin): Tickets lesen / erledigt markieren / löschen ──────
async function handleAdmin(req, res) {
  if (!checkAuth(req, res)) return
  if (!req.auth.admin) return res.status(403).json({ error: 'Nur Administratoren.' })
  await ensureSupportSchema()

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('support_requests')
      .select('id, created_at, memorial_id, name, reply_email, reply_phone, preferred_channel, message, context, handled, reply_draft, repair_prompt, reply_sent_at')
      .order('created_at', { ascending: false })
      .limit(500)
    if (error) throw error
    return res.json({ tickets: data || [] })
  }

  if (req.method === 'PATCH') {
    const id = String(req.query.id || '').trim()
    if (!id) return res.status(400).json({ error: 'id fehlt.' })
    const body = req.body || {}

    // (a) KI-Antwortvorschlag (neu) generieren – v. a. für ältere Tickets ohne Vorschlag.
    if (body.generate === true) {
      const { data: row, error } = await supabase
        .from('support_requests')
        .select('id, memorial_id, name, reply_email, message, context')
        .eq('id', id).single()
      if (error) throw error
      const patch = await assistForTicket(row)
      if (!patch) return res.status(502).json({ error: 'Vorschlag konnte nicht erstellt werden. Bitte erneut versuchen.' })
      await audit(req, { actor: req.auth, action: 'support.assist', target: id })
      return res.json({ ok: true, ...patch })
    }

    // (b) Antwort per E-Mail an den Absender senden (BCC ins Support-Postfach).
    if (typeof body.send_reply === 'string') {
      const text = body.send_reply.trim()
      if (text.length < 2) return res.status(400).json({ error: 'Antworttext fehlt.' })
      const { data: row, error } = await supabase
        .from('support_requests')
        .select('id, reply_email')
        .eq('id', id).single()
      if (error) throw error
      if (!row.reply_email) return res.status(400).json({ error: 'Keine E-Mail-Adresse hinterlegt – Antwort kann nicht per E-Mail gesendet werden.' })
      const inbox = process.env.SUPPORT_INBOX || 'support@lebensgeschichten.ai'
      const html = `<!doctype html><html lang="de"><body style="margin:0;background:#fafaf9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1c1917;"><div style="max-width:560px;margin:0 auto;padding:24px;white-space:pre-wrap;font-size:15px;line-height:1.6;">${esc(text)}</div></body></html>`
      // Absender = support@ (Antworten des Nutzers landen wieder dort), BCC = support@
      // für den Postfach-Verlauf. Reply-To ebenfalls support@.
      await sendMail({
        from: inbox, to: row.reply_email, bcc: inbox, replyTo: inbox,
        subject: `Re: Ihre Support-Anfrage #${row.id} – Lebensgeschichten`,
        text, html,
      })
      const sentAt = new Date().toISOString()
      await supabase.from('support_requests').update({ handled: true, reply_draft: text, reply_sent_at: sentAt }).eq('id', id)
      await audit(req, { actor: req.auth, action: 'support.reply_sent', target: id, detail: { to: row.reply_email } })
      return res.json({ ok: true, sent_to: row.reply_email, reply_sent_at: sentAt, handled: true })
    }

    // (c) Nur den Antwort-Entwurf speichern (ohne zu senden).
    if (typeof body.reply_draft === 'string') {
      const { error } = await supabase.from('support_requests').update({ reply_draft: body.reply_draft }).eq('id', id)
      if (error) throw error
      return res.json({ ok: true })
    }

    // (d) Erledigt-Status umschalten (Standard).
    const handled = Boolean(body.handled)
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

    let { message, replyEmail, replyPhone, preferredChannel, name, context } = req.body || {}
    message = String(message || '').trim()
    replyEmail = String(replyEmail || '').trim()
    replyPhone = String(replyPhone || '').trim().slice(0, 40)
    name = String(name || '').trim().slice(0, 120) || null
    if (message.length < 3) return res.status(400).json({ error: 'Bitte beschreiben Sie Ihr Anliegen kurz.' })
    if (message.length > 5000) message = message.slice(0, 5000)

    // Rückkanal: E-Mail ODER Telefon genügt, aber ohne beides könnten wir nicht antworten.
    if (!replyEmail && !replyPhone) {
      return res.status(400).json({ error: 'Bitte eine E-Mail-Adresse oder eine Telefonnummer angeben, damit wir antworten können.' })
    }
    if (replyEmail && !EMAIL_RE.test(replyEmail)) {
      return res.status(400).json({ error: 'Bitte eine gültige Antwort-E-Mail-Adresse angeben (oder das Feld leer lassen).' })
    }
    if (replyPhone && !PHONE_RE.test(replyPhone)) {
      return res.status(400).json({ error: 'Bitte eine gültige Telefonnummer angeben (oder das Feld leer lassen).' })
    }
    // Kontaktwunsch nur übernehmen, wenn der gewünschte Kanal auch hinterlegt ist —
    // sonst stünde im Ticket „am liebsten telefonisch" ohne Nummer.
    preferredChannel = CHANNELS.includes(preferredChannel) ? preferredChannel : null
    if (preferredChannel === 'email' && !replyEmail) preferredChannel = null
    if (preferredChannel === 'phone' && !replyPhone) preferredChannel = null

    // Zusätzliche Drossel pro Rückkanal (Missbrauch/Spam gegen das Postfach).
    const rlKey = (replyEmail || replyPhone).toLowerCase()
    if (!(await enforce(req, res, { name: 'support-email', limit: 6, windowSeconds: 3600, key: rlKey }))) return

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
    let stored = true, ticketId = null
    try {
      const { data: ins } = await supabase.from('support_requests').insert({
        memorial_id: memorialId, name, reply_email: replyEmail || null, reply_phone: replyPhone || null,
        preferred_channel: preferredChannel, message, context: ctx,
      }).select('id').single()
      ticketId = ins?.id ?? null
    } catch (e) { console.error('/api/support store:', e); stored = false }

    // Kontakt-E-Mail am zugehörigen Buch hinterlegen — aber NUR, wenn dort noch keine
    // gespeichert ist (weder eine frühere Kontakt-Mail im intake NOCH ein Endnutzer-
    // Konto mit E-Mail). So kann ein Patient mit reinem Code-Zugang später kontaktiert
    // werden und muss die Adresse nicht erneut angeben. Best effort.
    //
    // NUR bei den Endnutzer-Kategorien (Lebenswerk, Anamnese): Dort gehört das Buch
    // genau EINER Person, ihre Adresse ist die Adresse des Buchs. Bei den geteilten
    // Büchern (Gedenkbuch, Geburtstag, Jubiläum …) schreiben dagegen viele
    // Beitragende — dort landete sonst die Privatadresse desjenigen am Buch, der
    // zufällig als Erster den Support anschreibt. Sie war für die Antwort auf seine
    // Anfrage gedacht, nicht als Kontakt des Projekts (Zweckbindung), und im
    // Dashboard sieht sie aus wie die Adresse des Organisators.
    if (memorialId && replyEmail) {
      try {
        const { data: mem } = await supabase.from('memorials').select('intake, product_category').eq('id', memorialId).maybeSingle()
        if (mem && isEnduserCategory(mem.product_category)) {
          const intake = (mem.intake && typeof mem.intake === 'object') ? mem.intake : {}
          if (!intake.contact_email) {
            const { data: acct } = await supabase
              .from('app_users').select('id').eq('enduser_memorial', memorialId).eq('is_enduser', true).maybeSingle()
            if (!acct) {
              await supabase.from('memorials').update({ intake: { ...intake, contact_email: replyEmail } }).eq('id', memorialId)
            }
          }
        }
      } catch (e) { console.warn('/api/support memorial email:', e.message) }
    }

    let email_sent = true
    try {
      // Ohne Antwort-Adresse bleibt Reply-To der Standard (siehe invitemail.js) —
      // die Mail geht trotzdem raus, Telefonnummer + Kontaktwunsch stehen darin.
      await sendSupportMail({ ticketId, replyTo: replyEmail || null, phone: replyPhone || null, preferredChannel, name, message, context: ctx })
    } catch (e) { console.error('/api/support mail:', e); email_sent = false }

    // Bestätigungsmail an den Ticket-Ersteller — mit DOUBLE-OPT-IN-Schutz:
    //  • Abgemeldete Adresse (Sperrliste) → gar nichts.
    //  • Noch NICHT bestätigte Adresse → einmalige Opt-in-Mail (bestätigen ODER
    //    abmelden). KEIN weiterer automatischer Versand, bis sie bestätigt ist —
    //    so kann niemand mit einer fremden Adresse Mails auslösen.
    //  • Bereits bestätigte Adresse → normale Eingangsbestätigung.
    // Absender/Reply-To = support@; zusätzlich durch die Ratenlimits (6/h) gedeckelt.
    if (ticketId != null && replyEmail && !(await isSuppressed(replyEmail))) {
      try {
        const inbox = process.env.SUPPORT_INBOX || 'support@lebensgeschichten.ai'
        const base = process.env.PUBLIC_BASE_URL || 'https://lebensgeschichten.ai'
        const de = !ctx || !ctx.lang || String(ctx.lang).toLowerCase().startsWith('de')
        const greeting = name ? (de ? `Hallo ${name},` : `Hi ${name},`) : (de ? 'Hallo,' : 'Hi,')
        const shell = (inner) => `<!doctype html><html lang="${de ? 'de' : 'en'}"><body style="margin:0;background:#fafaf9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1c1917;"><div style="max-width:520px;margin:0 auto;padding:28px 24px;">${inner}</div></body></html>`
        if (await isConfirmed(replyEmail)) {
          const subject = de ? `Ihre Support-Anfrage ist eingegangen (Ticket #${ticketId})` : `We received your support request (ticket #${ticketId})`
          const body = de
            ? `vielen Dank für Ihre Nachricht. Wir haben Ihre Support-Anfrage erhalten (Ticket #${ticketId}) und melden uns so bald wie möglich. Sie können direkt auf diese E-Mail antworten.`
            : `thank you for your message. We have received your support request (ticket #${ticketId}) and will get back to you as soon as possible. You can simply reply to this email.`
          const text = `${greeting}\n\n${body}\n\n— Lebensgeschichten`
          const html = shell(`<p style="font-size:15px;line-height:1.6;margin:0 0 8px;color:#44403c;">${esc(greeting)}</p><p style="font-size:15px;line-height:1.6;margin:0 0 18px;color:#44403c;">${esc(body)}</p><p style="font-size:12px;line-height:1.6;color:#a8a29e;margin:0;border-top:1px solid #e7e5e4;padding-top:16px;">— Lebensgeschichten</p>`)
          await sendMail({ from: inbox, to: replyEmail, replyTo: inbox, subject, text, html })
        } else {
          const confirmUrl = confirmLink(base, replyEmail)
          const unsubUrl = unsubscribeLink(base, replyEmail)
          const subject = de ? 'Bitte bestätigen Sie Ihre Support-Anfrage – Lebensgeschichten' : 'Please confirm your support request – Lebensgeschichten'
          const body = de
            ? `mit Ihrer E-Mail-Adresse wurde bei Lebensgeschichten eine Support-Anfrage abgeschickt (Ticket #${ticketId}). Bevor wir Ihnen an diese Adresse antworten, bestätigen Sie bitte kurz, dass die Anfrage von Ihnen stammt.`
            : `a support request was submitted at Lebensgeschichten using your email address (ticket #${ticketId}). Before we reply to this address, please confirm that the request is really from you.`
          const cLabel = de ? 'Anfrage bestätigen' : 'Confirm request'
          const uLabel = de ? 'Das war ich nicht / abmelden' : 'This wasn’t me / unsubscribe'
          const foot = de
            ? 'Wenn Sie diese Anfrage nicht kennen, ignorieren Sie diese E-Mail einfach — ohne Bestätigung senden wir Ihnen nichts weiter.'
            : 'If you don’t recognise this request, simply ignore this email — without confirmation we won’t send you anything else.'
          const text = `${greeting}\n\n${body}\n\n${cLabel}: ${confirmUrl}\n\n${uLabel}: ${unsubUrl}\n\n${foot}\n\n— Lebensgeschichten`
          const html = shell(`<p style="font-size:15px;line-height:1.6;margin:0 0 8px;color:#44403c;">${esc(greeting)}</p><p style="font-size:15px;line-height:1.6;margin:0 0 18px;color:#44403c;">${esc(body)}</p><p style="margin:0 0 14px;"><a href="${esc(confirmUrl)}" style="display:inline-block;background:#1c1917;color:#fff;padding:12px 22px;border-radius:8px;font-size:15px;font-weight:600;text-decoration:none;">${esc(cLabel)}</a></p><p style="font-size:13px;margin:0 0 18px;"><a href="${esc(unsubUrl)}" style="color:#a8a29e;">${esc(uLabel)}</a></p><p style="font-size:12px;line-height:1.6;color:#a8a29e;margin:0;border-top:1px solid #e7e5e4;padding-top:16px;">${esc(foot)}<br>— Lebensgeschichten</p>`)
          await sendMail({ from: inbox, to: replyEmail, replyTo: inbox, subject, text, html })
        }
      } catch (e) { console.warn('/api/support confirm:', e.message) }
    }

    // KI-Antwortvorschlag + Reparatur-Prompt sofort erzeugen, solange das Ticket
    // frisch ist — so liegen sie im Dashboard bereit, sobald es geöffnet wird.
    // NACH der Betreiber-Benachrichtigung, damit ein langsamer/fehlschlagender
    // KI-Aufruf weder die Mail noch das Absenden blockiert. Best effort + Timeout;
    // das Ticket ist bereits gespeichert.
    if (ticketId != null) {
      try {
        await withTimeout(
          assistForTicket({ id: ticketId, name, reply_email: replyEmail || null, message, context: ctx, memorial_id: memorialId }),
          25000,
        )
      } catch (e) { console.warn('/api/support assist:', e.message) }
    }

    if (!stored && !email_sent) {
      // Weder gespeichert noch versendet → dem Nutzer ehrlich einen Fehler melden.
      return res.status(502).json({ error: 'Ihre Nachricht konnte nicht übermittelt werden. Bitte später erneut versuchen oder direkt an support@lebensgeschichten.ai schreiben.' })
    }
    await audit(req, { actor: { name: replyEmail || replyPhone }, action: 'support.submit', target: memorialId, detail: { email_sent, stored } })
    return res.json({ ok: true, email_sent })
  } catch (e) {
    console.error('/api/support error:', e)
    return res.status(500).json({ error: 'Ihre Nachricht konnte nicht übermittelt werden. Bitte später erneut versuchen.' })
  }
}
