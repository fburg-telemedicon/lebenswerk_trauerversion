// api/memorial.js
// GET  /api/memorial?code=ABC123  → memorial data
//
// Die Anlage eines Gedenkbuchs läuft ausschließlich authentifiziert über
// POST /api/admin/memorials (Produktkategorie + Eigentümer werden dort
// serverseitig aus dem Token gesetzt). Ein öffentlicher Anlage-Endpoint
// wäre ein ungeschützter Schreibzugriff und existiert deshalb hier nicht.

const { createClient } = require('@supabase/supabase-js')

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
        .from('memorials').select('*').eq('id', code).single()
      if (error || !data) return res.status(404).json({ error: `Code „${code}" nicht gefunden.` })

      // Firmenlogo des Eigentümers anhängen (für die Anzeige beim Beitragenden).
      // Bei Büchern des Env-Admins (owner_user null) bleibt owner_logo null →
      // der Beitragenden-Flow zeigt dann das Standard-/Demo-Logo.
      let owner_logo = null
      if (data.owner_user) {
        const { data: owner } = await supabase
          .from('app_users').select('logo').eq('id', data.owner_user).single()
        owner_logo = owner?.logo || null
      }
      return res.json({ ...data, owner_logo })
    }

    res.status(405).json({ error: 'Method not allowed' })
  } catch (e) {
    console.error('/api/memorial error:', e)
    res.status(500).json({ error: e.message })
  }
}
