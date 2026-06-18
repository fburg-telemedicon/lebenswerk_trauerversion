// api/admin/settings.js
// Eigene Konto-Einstellungen des eingeloggten Benutzers (kein Admin-Recht nötig,
// aber ein echtes app_users-Konto: der Env-Superadmin hat keine uid und behält
// das Demo-Logo).
//
// GET   /api/admin/settings           → { logo }            (eigenes Logo)
// PATCH /api/admin/settings  { logo }  → { ok: true }        (logo = Data-URL oder null zum Entfernen)

const { createClient } = require('@supabase/supabase-js')
const { checkAuth } = require('../_lib/auth')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

// Erlaubte Bildtypen + Größenobergrenze für das als Data-URL gespeicherte Logo.
const ALLOWED_MIME = ['png', 'jpeg', 'jpg', 'gif', 'webp', 'svg+xml']
const MAX_LOGO_CHARS = 2_000_000 // ~1,4 MB Bild als Base64

function validateLogo(logo) {
  if (logo === null || logo === '') return { value: null }
  if (typeof logo !== 'string') return { error: 'Ungültiges Logo-Format.' }
  const m = /^data:image\/([a-z0-9.+-]+);base64,/i.exec(logo)
  if (!m) return { error: 'Logo muss ein Bild (Data-URL) sein.' }
  if (!ALLOWED_MIME.includes(m[1].toLowerCase())) return { error: 'Nicht unterstütztes Bildformat.' }
  if (logo.length > MAX_LOGO_CHARS) return { error: 'Logo ist zu groß (max. ca. 1,4 MB).' }
  return { value: logo }
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (!checkAuth(req, res)) return

  // Nur echte Benutzerkonten haben eine uid. Der Env-Superadmin (uid null)
  // behält bewusst das Demo-Logo und kann hier nichts hinterlegen.
  if (!req.auth.uid) {
    return res.status(400).json({ error: 'Einstellungen sind nur für Benutzerkonten verfügbar (der Administrator nutzt das Standard-Logo).' })
  }

  try {
    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('app_users').select('logo').eq('id', req.auth.uid).single()
      if (error) throw error
      return res.json({ logo: data?.logo ?? null })
    }

    if (req.method === 'PATCH' || req.method === 'PUT') {
      const { logo } = req.body || {}
      const v = validateLogo(logo)
      if (v.error) return res.status(400).json({ error: v.error })
      const { error } = await supabase
        .from('app_users').update({ logo: v.value }).eq('id', req.auth.uid)
      if (error) throw error
      return res.json({ ok: true })
    }

    return res.status(405).end()
  } catch (e) {
    console.error('/api/admin/settings:', e)
    res.status(500).json({ error: e.message })
  }
}
