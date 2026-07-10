// api/admin/contributions.js
// GET    /api/admin/contributions?code=XXX  →  alle Beiträge (auth required)
// PATCH  /api/admin/contributions?id=YYY    →  messages eines Beitrags ersetzen (auth required)
// DELETE /api/admin/contributions?id=YYY    →  einen Beitrag löschen (auth required)

const { createClient } = require('@supabase/supabase-js')
const { checkAuth } = require('../_lib/auth')
const { loadAccessibleMemorial, loadAccessibleContribution } = require('../_lib/access')
const { audit } = require('../_lib/audit')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

module.exports = async function handler(req, res) {
  if (!checkAuth(req, res)) return
  try {
    if (req.method === 'GET') {
      const code = (req.query.code || '').toUpperCase().trim()
      if (!code) return res.status(400).json({ error: 'code fehlt.' })
      // Nur Beiträge eigener Gedenkbücher (bzw. Admin) lesen.
      const access = await loadAccessibleMemorial(supabase, req.auth, code)
      if (access.error) return res.status(access.status).json({ error: access.error })
      const { data, error } = await supabase
        .from('contributions')
        .select('*')
        .eq('memorial_id', code)
        .order('created_at', { ascending: true })
      if (error) throw error
      return res.json(data || [])
    }

    if (req.method === 'PATCH') {
      const id = (req.query.id || '').trim()
      if (!id) return res.status(400).json({ error: 'id fehlt.' })
      const { messages, transcriptCheckedAt, transcriptCorrections } = req.body || {}
      if (!Array.isArray(messages)) return res.status(400).json({ error: 'messages muss ein Array sein.' })
      // Nur Beiträge eigener Gedenkbücher (bzw. Admin) ändern.
      const access = await loadAccessibleContribution(supabase, req.auth, id)
      if (access.error) return res.status(access.status).json({ error: access.error })
      // Transkript-Prüffelder optional mitschreiben (Migration transcript-check.sql).
      const update = { messages }
      if (transcriptCheckedAt !== undefined) update.transcript_checked_at = transcriptCheckedAt || null
      if (Array.isArray(transcriptCorrections)) update.transcript_corrections = transcriptCorrections
      let { data, error } = await supabase.from('contributions').update(update).eq('id', id).select().single()
      // Spalten evtl. noch nicht migriert → ohne die Transkript-Felder erneut speichern.
      if (error && /transcript_|column/i.test(error.message || '')) {
        delete update.transcript_checked_at
        delete update.transcript_corrections
        ;({ data, error } = await supabase.from('contributions').update(update).eq('id', id).select().single())
      }
      if (error) throw error
      return res.json(data)
    }

    if (req.method === 'DELETE') {
      const id = (req.query.id || '').trim()
      if (!id) return res.status(400).json({ error: 'id fehlt.' })
      // Nur Beiträge eigener Gedenkbücher (bzw. Admin) löschen.
      const access = await loadAccessibleContribution(supabase, req.auth, id)
      if (access.error) return res.status(access.status).json({ error: access.error })
      const { error } = await supabase.from('contributions').delete().eq('id', id)
      if (error) throw error
      await audit(req, { actor: req.auth, action: 'contribution.delete', target: id, detail: { memorial: access.memorial?.id } })
      return res.json({ ok: true })
    }

    return res.status(405).end()
  } catch (e) {
    console.error('/api/admin/contributions:', e)
    res.status(500).json({ error: e.message })
  }
}
