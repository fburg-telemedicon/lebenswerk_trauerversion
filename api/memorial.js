// api/memorial.js
// GET  /api/memorial?code=ABC123  → memorial data
//
// Die Anlage eines Gedenkbuchs läuft ausschließlich authentifiziert über
// POST /api/admin/memorials (Produktkategorie + Eigentümer werden dort
// serverseitig aus dem Token gesetzt). Ein öffentlicher Anlage-Endpoint
// wäre ein ungeschützter Schreibzugriff und existiert deshalb hier nicht.

const { createClient } = require('@supabase/supabase-js')
const { enforce } = require('./_lib/ratelimit')

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

      // Schutz vor dem Durchprobieren von Codes (Enumeration): begrenzt die
      // Code-Abfragen pro IP. Großzügig genug für den normalen Beitragenden-
      // Flow; fail-open (sperrt bei Limiter-Ausfall niemanden aus).
      if (!(await enforce(req, res, { name: 'memorial', limit: 60, windowSeconds: 60 }))) return

      // BEWUSST nur die für den Beitragenden-Flow nötigen Felder ausliefern –
      // NICHT die ganze Zeile. Insbesondere die generierten Inhalte
      // (book_v1/book_v2/eulogy_text) enthalten die aggregierten Erinnerungen
      // ALLER Beitragenden und dürfen nicht über den öffentlichen, nur per
      // 6-stelligem Code geschützten Endpunkt nach außen gelangen. Auch
      // intake (kategorie-spezifische Notizen) und owner_user bleiben intern.
      const PUBLIC_FIELDS =
        'id, name, gender, birth_year, death_year, organizer, product_category, languages, funeral_date, cutoff_days, show_intro_video, owner_user, created_at'
      const { data, error } = await supabase
        .from('memorials').select(PUBLIC_FIELDS).eq('id', code).single()
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
      // owner_user war nur für die Logo-Abfrage nötig – nicht nach außen geben.
      const { owner_user, ...publicData } = data
      return res.json({ ...publicData, owner_logo })
    }

    res.status(405).json({ error: 'Method not allowed' })
  } catch (e) {
    console.error('/api/memorial error:', e)
    res.status(500).json({ error: e.message })
  }
}
