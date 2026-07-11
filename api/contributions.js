// api/contributions.js
// GET  /api/contributions?id=YYY[&code=ABC123]  → EIN Beitrag (zum Fortsetzen)
// POST /api/contributions                        → add contribution
//
// Der GET liefert bewusst NUR den per (geheimer) Beitrags-ID adressierten
// Eintrag, nicht die ganze Liste eines Gedenkbuchs. Die ID ist ein langes
// Zufallstoken aus der Session-URL des Beitragenden und wirkt damit als
// Capability. So kann niemand über den (allen Beitragenden bekannten)
// 6-stelligen Gedenkbuch-Code fremde Beiträge auslesen. Die vollständige
// Liste gibt es nur authentifiziert über /api/admin/contributions.

const { createClient } = require('@supabase/supabase-js')
const { genCode } = require('./_lib/codes')
const { enforce } = require('./_lib/ratelimit')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()

  // Schutz vor Massen-Zugriff über durchprobierte Codes (Lesen fremder Beiträge
  // ist ohnehin nur mit der geheimen Beitrags-ID möglich; das Limit bremst v.a.
  // das Einschleusen von Beiträgen über erratene Gedenkbuch-Codes). Großzügig
  // für den normalen Flow; fail-open.
  if (!(await enforce(req, res, { name: 'contributions', limit: 60, windowSeconds: 60 }))) return

  try {
    if (req.method === 'GET') {
      const id = (req.query.id || '').trim()
      const code = (req.query.code || '').toUpperCase().trim()
      if (!id) return res.status(400).json({ error: 'Beitrags-ID fehlt.' })

      // Nur die zum Fortsetzen nötigen Felder herausgeben (Datenminimierung) –
      // interne Prüf-/Verwaltungsfelder (transcript_corrections, Prüfstempel …)
      // gehören nicht in den öffentlichen Beitragenden-Flow.
      const RESUME_FIELDS = 'id, contributor_name, relationship, messages, contributor_gender, contributor_address, consent_at, consent_version'
      let q = supabase.from('contributions').select(RESUME_FIELDS).eq('id', id)
      // Wenn ein Code mitgegeben wird, muss er zum Beitrag passen – sonst
      // wird nichts geliefert (defense in depth; die ID allein genügt schon).
      if (code) q = q.eq('memorial_id', code)
      const { data, error } = await q.maybeSingle()
      if (error) throw error
      return res.json(data || null)
    }

    if (req.method === 'POST') {
      const { contributionId, memorialCode, contributorName, relationship, messages, contributorGender, contributorAddress, consentAt, consentVersion } = req.body
      if (!memorialCode || !contributorName || !relationship || !Array.isArray(messages)) {
        return res.status(400).json({ error: 'Pflichtfelder fehlen.' })
      }
      const id = (contributionId && String(contributionId).trim()) || genCode()
      const row = {
        id,
        memorial_id: memorialCode.toUpperCase(),
        contributor_name: contributorName,
        relationship,
        messages,
        contributor_gender: contributorGender || null,
        contributor_address: contributorAddress || null,
      }
      // Einwilligung nur setzen, wenn übergeben – so überschreibt ein späterer
      // Speichervorgang (z.B. nach Resume ohne Consent im State) den einmal
      // protokollierten Zeitpunkt nicht.
      if (consentAt) row.consent_at = consentAt
      if (consentVersion) row.consent_version = consentVersion
      const { error } = await supabase.from('contributions').upsert(row, { onConflict: 'id' })
      if (error) throw error
      return res.json({ id })
    }

    res.status(405).json({ error: 'Method not allowed' })
  } catch (e) {
    console.error('/api/contributions error:', e)
    res.status(500).json({ error: 'Der Beitrag konnte nicht geladen oder gespeichert werden. Bitte später erneut versuchen.' })
  }
}
