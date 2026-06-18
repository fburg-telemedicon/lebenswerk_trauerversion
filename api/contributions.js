// api/contributions.js
// GET  /api/contributions?code=ABC123  → array of contributions
// POST /api/contributions              → add contribution

const { createClient } = require('@supabase/supabase-js')
const { genCode } = require('./_lib/codes')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()

  try {
    if (req.method === 'GET') {
      const code = (req.query.code || '').toUpperCase().trim()
      if (!code) return res.status(400).json({ error: 'Code fehlt.' })

      const { data, error } = await supabase
        .from('contributions')
        .select('*')
        .eq('memorial_id', code)
        .order('created_at', { ascending: true })
      if (error) throw error
      return res.json(data || [])
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
    res.status(500).json({ error: e.message })
  }
}
