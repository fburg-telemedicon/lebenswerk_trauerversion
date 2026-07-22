// api/admin/contributions.js
// GET    /api/admin/contributions?code=XXX  →  alle Beiträge (auth required)
// PATCH  /api/admin/contributions?id=YYY    →  messages eines Beitrags ersetzen (auth required)
// DELETE /api/admin/contributions?id=YYY    →  einen Beitrag löschen (auth required)

const { createClient } = require('../_lib/store')
const { checkAuth } = require('../_lib/auth')
const { loadAccessibleMemorial, loadAccessibleContribution } = require('../_lib/access')
const { audit } = require('../_lib/audit')
const { ensureLifeworkSchema } = require('../_lib/lifework')

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
      const { messages, transcriptCheckedAt, transcriptCorrections, contributorName, relationship, guestStatus } = req.body || {}
      // Es darf entweder messages (Inhalte), Stammdaten (Name/Beziehung) oder die
      // Kuratierungs-Entscheidung geändert werden – oder mehreres. Mindestens
      // eines muss vorliegen.
      const hasStammdaten = contributorName !== undefined || relationship !== undefined
      // Kuratierung der Gastbeiträge (Lebenswerk): nur diese drei Werte.
      const GUEST_STATUS = ['pending', 'approved', 'rejected']
      if (guestStatus !== undefined && !GUEST_STATUS.includes(guestStatus)) {
        return res.status(400).json({ error: 'Unbekannter Status.' })
      }
      if (messages !== undefined && !Array.isArray(messages)) return res.status(400).json({ error: 'messages muss ein Array sein.' })
      if (messages === undefined && !hasStammdaten && guestStatus === undefined) return res.status(400).json({ error: 'Nichts zu ändern.' })
      // Nur Beiträge eigener Gedenkbücher (bzw. Admin) ändern.
      const access = await loadAccessibleContribution(supabase, req.auth, id)
      if (access.error) return res.status(access.status).json({ error: access.error })
      // Kuratierung: Spalte sicherstellen (idempotent, pro Container einmal).
      if (guestStatus !== undefined) await ensureLifeworkSchema().catch(() => {})
      // Transkript-Prüffelder optional mitschreiben (Migration transcript-check.sql).
      const update = {}
      if (Array.isArray(messages)) update.messages = messages
      if (contributorName !== undefined) update.contributor_name = String(contributorName || '').trim() || null
      if (relationship !== undefined) update.relationship = String(relationship || '').trim() || null
      if (transcriptCheckedAt !== undefined) update.transcript_checked_at = transcriptCheckedAt || null
      if (Array.isArray(transcriptCorrections)) update.transcript_corrections = transcriptCorrections
      if (guestStatus !== undefined) update.guest_status = guestStatus
      let { data, error } = await supabase.from('contributions').update(update).eq('id', id).select().single()
      // Spalten evtl. noch nicht migriert → ohne die Transkript-Felder erneut speichern.
      if (error && /transcript_|guest_status|column/i.test(error.message || '')) {
        delete update.transcript_checked_at
        delete update.transcript_corrections
        // guest_status NICHT stillschweigend fallen lassen: Wer freigibt oder
        // ablehnt, muss wissen, ob die Entscheidung angekommen ist. Ohne die
        // Spalte gibt es keine Kuratierung — dann ein ehrlicher Fehler.
        if (update.guest_status !== undefined) {
          return res.status(503).json({ error: 'Die Kuratierung ist auf diesem Server noch nicht eingerichtet.' })
        }
        ;({ data, error } = await supabase.from('contributions').update(update).eq('id', id).select().single())
      }
      if (error) throw error
      if (guestStatus !== undefined) {
        await audit(req, { actor: req.auth, action: 'contribution.guest_status', target: id, detail: { status: guestStatus, memorial: access.memorial?.id } })
      }
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
