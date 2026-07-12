// api/feedback.js
// POST /api/feedback  { contributionId, memorialCode, rating (1..5), text? }
// Öffentlich (Beitragenden-Flow, kein Login): speichert die Interview-Bewertung
// auf dem eigenen Beitrag. Die Beitrags-ID ist ein geheimes Zufallstoken und
// wirkt als Capability; zusätzlich muss der Gedenkbuch-Code passen.

const { createClient } = require('./_lib/store')
const { memorialExists } = require('./_lib/access')
const { enforce } = require('./_lib/ratelimit')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!(await enforce(req, res, { name: 'feedback', limit: 20, windowSeconds: 300 }))) return
  try {
    const { contributionId, memorialCode, rating, text } = req.body || {}
    const code = String(memorialCode || '').toUpperCase().trim()
    const id = String(contributionId || '').trim()
    if (!id || !code) return res.status(400).json({ error: 'contributionId/memorialCode fehlt.' })
    const r = parseInt(rating, 10)
    if (!Number.isInteger(r) || r < 1 || r > 5) return res.status(400).json({ error: 'Ungültige Bewertung.' })
    if (!(await memorialExists(supabase, code))) return res.status(403).json({ error: 'Ungültiger Code.' })

    const { data, error } = await supabase.from('contributions')
      .update({
        feedback_rating: r,
        feedback_text: String(text || '').trim().slice(0, 2000) || null,
        feedback_at: new Date().toISOString(),
      })
      .eq('id', id).eq('memorial_id', code)
      .select('id').maybeSingle()
    if (error) {
      // Spalten evtl. noch nicht migriert (supabase/feedback.sql) → still ignorieren.
      if (/feedback_|column/i.test(error.message || '')) return res.json({ ok: true, skipped: true })
      throw error
    }
    if (!data) return res.status(404).json({ error: 'Beitrag nicht gefunden.' })
    return res.json({ ok: true })
  } catch (e) {
    console.error('/api/feedback:', e)
    res.status(500).json({ error: 'Das Feedback konnte nicht gespeichert werden. Bitte später erneut versuchen.' })
  }
}
