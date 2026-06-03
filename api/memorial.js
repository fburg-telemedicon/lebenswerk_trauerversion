// api/memorial.js
// GET  /api/memorial?code=ABC123  → memorial data
// POST /api/memorial              → create memorial, returns { code }

const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

function genCode() {
  return Array.from({ length: 6 }, () =>
    'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]
  ).join('')
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()

  try {
    if (req.method === 'POST') {
      const { name, organizer, gender, bookVariant, funeralDate, cutoffDays, showIntroVideo } = req.body
      if (!name || !organizer) return res.status(400).json({ error: 'Name und Organisator sind Pflichtfelder.' })

      const code = genCode()
      const variant = (bookVariant === 2 || bookVariant === '2') ? 2 : 1
      let days = parseInt(cutoffDays, 10)
      if (!Number.isFinite(days) || days < 0) days = 7
      const { error } = await supabase.from('memorials').insert({
        id: code, name, organizer, gender: gender || null, book_variant: variant,
        funeral_date: funeralDate || null,
        cutoff_days: days,
        show_intro_video: showIntroVideo !== false,
      })
      if (error) throw error
      return res.json({ code })
    }

    if (req.method === 'GET') {
      const code = (req.query.code || '').toUpperCase().trim()
      if (!code) return res.status(400).json({ error: 'Code fehlt.' })

      const { data, error } = await supabase
        .from('memorials').select('*').eq('id', code).single()
      if (error || !data) return res.status(404).json({ error: `Code „${code}" nicht gefunden.` })
      return res.json(data)
    }

    res.status(405).json({ error: 'Method not allowed' })
  } catch (e) {
    console.error('/api/memorial error:', e)
    res.status(500).json({ error: e.message })
  }
}
