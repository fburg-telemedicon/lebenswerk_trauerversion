// api/_lib/report-send.js
// Orchestriert den Tagesreport: Kennzahlen sammeln → PDF bauen → E-Mail rendern →
// an die aktiven Empfänger schicken. Von cron/report.js und admin/reports.js genutzt.

const { createClient } = require('./store')
const { gatherReport } = require('./report-data')
const { buildReportPdf } = require('./report-pdf')
const render = require('./report-render')
const { sendMail } = require('./graphmail')

function client() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
}

async function getActiveRecipients(supabase) {
  const { data, error } = await supabase.from('report_recipients').select('email').eq('active', true)
  if (error) throw error
  return [...new Set((data || []).map(r => String(r.email || '').trim()).filter(Boolean))]
}

// opts: { supabase?, now?, recipients?(override), dryRun?, includeData?, note? }
// note: optionaler Hinweistext (z. B. Korrektur) – erscheint als Banner oben in
// Betreff/HTML/Text. Nur für manuelle Nachversände.
async function buildAndSendReport(opts = {}) {
  const supabase = opts.supabase || client()
  const note = opts.note ? String(opts.note).trim().slice(0, 500) : ''
  const data = await gatherReport(supabase, { now: opts.now })
  const subject = render.subject(data, note)

  // PDF bauen (fehlertolerant: scheitert die Rasterung, geht die Mail trotzdem raus).
  let pdf = null, pdfError = null
  try { pdf = await buildReportPdf(data) }
  catch (e) { pdfError = e.message; console.error('[report] PDF-Bau fehlgeschlagen:', e.message) }

  const result = {
    date: data.date, subject,
    recipients: 0, sent: 0, errors: [],
    pdfBytes: pdf ? pdf.buffer.length : 0, pdfError,
    ...(opts.includeData ? { data } : {}),
  }

  let recipients
  if (opts.recipients && opts.recipients.length) {
    recipients = [...new Set(opts.recipients.map(e => String(e).trim()).filter(Boolean))]
  } else {
    // Empfängerliste ist unkritisch für Vorschau/PDF: fehlt die Tabelle (Migration
    // report.sql noch nicht ausgeführt) oder ist sie leer, geht der Report an
    // niemanden statt zu crashen.
    try { recipients = await getActiveRecipients(supabase) }
    catch (e) { recipients = []; result.recipientsError = e.message }
  }
  result.recipients = recipients.length

  if (opts.dryRun) return result
  if (!recipients.length) { result.note = 'keine aktiven Empfänger'; return result }

  const html = render.htmlBody(data, note)
  const text = render.textBody(data, note)
  const attachments = pdf ? [{ filename: pdf.filename, contentBytes: pdf.base64, contentType: 'application/pdf' }] : undefined

  // Einzeln senden, damit Empfänger sich nicht gegenseitig sehen.
  for (const to of recipients) {
    try {
      await sendMail({ to, subject, html, text, replyTo: 'support@lebensgeschichten.ai', attachments })
      result.sent++
    } catch (e) {
      result.errors.push({ to, error: e.message })
    }
  }
  return result
}

module.exports = { buildAndSendReport, getActiveRecipients }
