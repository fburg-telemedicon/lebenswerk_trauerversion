// api/upload.js
// POST /api/upload?code=ABC123
//   { image (base64/dataURL), caption, description, consent:true, contributionId? }
//   → { image: <uploaded_images-Eintrag ohne interne Pfade sind hier ok> }
//
// Öffentlicher Foto-Upload für BEITRAGENDE (am Ende des Interviews). Kein Login,
// deshalb: gültiger, existierender Code nötig (kein anonymer Storage-Proxy),
// Rate-Limit, und ZWINGEND das Einverständnis (Recht am Bild + KI-Verarbeitung
// aller abgebildeten Personen). Ohne consent → 400.

const { createClient } = require('@supabase/supabase-js')
const { enforce } = require('./_lib/ratelimit')
const { memorialExists } = require('./_lib/access')
const { appendUpload } = require('./_lib/upload-asset')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try {
    const code = (req.query.code || '').toUpperCase().trim()
    if (!code) return res.status(400).json({ error: 'Code fehlt.' })

    // Missbrauchsschutz: begrenzt Uploads pro IP (fail-open).
    if (!(await enforce(req, res, { name: 'upload', limit: 40, windowSeconds: 300 }))) return

    if (!(await memorialExists(supabase, code))) {
      return res.status(404).json({ error: `Code „${code}" nicht gefunden.` })
    }

    const { image, caption, description, consent, contributionId } = req.body || {}
    if (!image) return res.status(400).json({ error: 'Kein Bild übergeben.' })
    if (!consent) return res.status(400).json({ error: 'Ohne Einverständniserklärung ist kein Upload möglich.' })

    const entry = await appendUpload(supabase, code, {
      base64: image,
      caption,
      description,
      source: 'contributor',
      contributionId: contributionId || null,
      consent: true,
    })
    // Interne Pfade nicht nach außen geben (Signierung passiert nur im Admin-GET).
    const { path, thumb_path, ...safe } = entry
    return res.json({ image: safe })
  } catch (e) {
    console.error('/api/upload:', e)
    res.status(500).json({ error: e.message })
  }
}
