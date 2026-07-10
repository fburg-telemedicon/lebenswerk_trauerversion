// api/_lib/report-send.js
// Orchestriert den Tagesreport: Kennzahlen sammeln → PDF bauen → E-Mail rendern →
// an die aktiven Empfänger schicken. Von cron/report.js und admin/reports.js genutzt.

const { createClient } = require('@supabase/supabase-js')
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

// opts: { supabase?, now?, recipients?(override), dryRun?, includeData? }
async function buildAndSendReport(opts = {}) {
  const supabase = opts.supabase || client()
  const data = await gatherReport(supabase, { now: opts.now })
  const subject = render.subject(data)

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

  let recipients = (opts.recipients && opts.recipients.length)
    ? [...new Set(opts.recipients.map(e => String(e).trim()).filter(Boolean))]
    : await getActiveRecipients(supabase)
  result.recipients = recipients.length

  if (opts.dryRun) return result
  if (!recipients.length) { result.note = 'keine aktiven Empfänger'; return result }

  const html = render.htmlBody(data)
  const text = render.textBody(data)
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
