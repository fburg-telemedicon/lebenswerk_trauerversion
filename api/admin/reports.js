// api/admin/reports.js  (Admin-only)
// Verwaltung der Tagesreport-Empfänger + On-Demand-Versand/Vorschau.
//
//   GET    /api/admin/reports              → { recipients:[{id,email,name,active,created_at}] }
//   POST   /api/admin/reports  {email,name?}         → Empfänger anlegen
//   PATCH  /api/admin/reports?id=…  {active?,name?}  → ändern
//   DELETE /api/admin/reports?id=…                   → löschen
//   POST   /api/admin/reports?send=1  {to?, note?}   → Report JETZT bauen & senden
//                                                      (to = String/Array override; sonst aktive Empfänger)
//                                                      (note = optionaler Korrektur-Hinweis oben im Report)
//   GET    /api/admin/reports?preview=1              → Kennzahlen sammeln, NICHT senden (Kontrolle)

const { createClient } = require('../_lib/store')
const { checkAuth } = require('../_lib/auth')
const { buildAndSendReport } = require('../_lib/report-send')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

module.exports = async function handler(req, res) {
  if (!checkAuth(req, res)) return
  if (!req.auth?.admin) return res.status(403).json({ error: 'Nur für Administratoren.' })
  try {
    // On-Demand-Versand (zum Testen / manuell auslösen).
    if (req.method === 'POST' && (req.query.send === '1' || req.query.send === 'true')) {
      const to = req.body?.to
      const note = req.body?.note ? String(req.body.note) : undefined
      const recipients = Array.isArray(to) ? to : (to ? [to] : null)
      const result = await buildAndSendReport({ recipients: recipients || undefined, note })
      return res.json({ ok: true, ...result })
    }
    // Vorschau der Kennzahlen ohne Versand.
    if (req.method === 'GET' && (req.query.preview === '1' || req.query.preview === 'true')) {
      const result = await buildAndSendReport({ dryRun: true, includeData: true })
      return res.json({ ok: true, ...result })
    }

    if (req.method === 'GET') {
      const { data, error } = await supabase.from('report_recipients')
        .select('id, email, name, active, created_at').order('created_at', { ascending: true })
      if (error) throw error
      return res.json({ recipients: data || [] })
    }

    if (req.method === 'POST') {
      const email = String(req.body?.email || '').trim().toLowerCase()
      const name = req.body?.name ? String(req.body.name).trim().slice(0, 120) : null
      if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Ungültige E-Mail-Adresse.' })
      const { data, error } = await supabase.from('report_recipients')
        .insert({ email, name }).select('id, email, name, active, created_at').single()
      if (error) {
        if (error.code === '23505') return res.status(409).json({ error: 'Diese Adresse ist bereits eingetragen.' })
        throw error
      }
      return res.json({ recipient: data })
    }

    if (req.method === 'PATCH') {
      const id = String(req.query.id || '').trim()
      if (!id) return res.status(400).json({ error: 'id fehlt.' })
      const patch = {}
      if ('active' in (req.body || {})) patch.active = Boolean(req.body.active)
      if ('name' in (req.body || {})) patch.name = req.body.name ? String(req.body.name).trim().slice(0, 120) : null
      if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'Keine Felder zum Ändern.' })
      const { error } = await supabase.from('report_recipients').update(patch).eq('id', id)
      if (error) throw error
      return res.json({ ok: true })
    }

    if (req.method === 'DELETE') {
      const id = String(req.query.id || '').trim()
      if (!id) return res.status(400).json({ error: 'id fehlt.' })
      const { error } = await supabase.from('report_recipients').delete().eq('id', id)
      if (error) throw error
      return res.json({ ok: true })
    }

    return res.status(405).end()
  } catch (e) {
    console.error('/api/admin/reports:', e)
    res.status(500).json({ error: e.message })
  }
}
