// api/admin/upload-image.js
// POST   /api/admin/upload-image?code=ABC123  { image, caption, description }
//        → Manager lädt ein eigenes Foto zum Gedenkbuch hoch.
// DELETE /api/admin/upload-image?code=ABC123&imageId=UUID
//        → entfernt einen Upload (Metadaten + Storage-Datei + Thumbnail).
//
// Auth + Eigentumsprüfung wie alle Admin-Endpunkte. Der Manager verantwortet
// bei eigenen Uploads die Rechte selbst (source='manager').

const { createClient } = require('@supabase/supabase-js')
const { checkAuth } = require('../_lib/auth')
const { loadAccessibleMemorial } = require('../_lib/access')
const { appendUpload, removeUpload } = require('../_lib/upload-asset')
const { IMAGE_BUCKET } = require('../_lib/delete-memorial')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const SIGNED_URL_TTL = 3600

module.exports = async function handler(req, res) {
  if (!checkAuth(req, res)) return
  try {
    const code = (req.query.code || '').toUpperCase().trim()
    if (!code) return res.status(400).json({ error: 'code fehlt.' })
    const access = await loadAccessibleMemorial(supabase, req.auth, code)
    if (access.error) return res.status(access.status).json({ error: access.error })

    if (req.method === 'POST') {
      const { image, caption, description } = req.body || {}
      if (!image) return res.status(400).json({ error: 'Kein Bild übergeben.' })
      const entry = await appendUpload(supabase, code, {
        base64: image, caption, description, source: 'manager', consent: true,
      })
      // Signierte URLs mitgeben, damit das Admin-UI das Bild sofort anzeigen kann.
      let image_url = null, image_thumb_url = null
      try {
        const { data } = await supabase.storage.from(IMAGE_BUCKET)
          .createSignedUrls([entry.path, entry.thumb_path], SIGNED_URL_TTL)
        if (Array.isArray(data)) {
          for (const d of data) {
            if (d?.error || !d?.signedUrl) continue
            if (d.path.replace(/^\/+/, '') === entry.path) image_url = d.signedUrl
            if (d.path.replace(/^\/+/, '') === entry.thumb_path) image_thumb_url = d.signedUrl
          }
        }
      } catch {}
      return res.json({ image: { ...entry, image_url, image_thumb_url } })
    }

    if (req.method === 'DELETE') {
      const imageId = (req.query.imageId || '').trim()
      if (!imageId) return res.status(400).json({ error: 'imageId fehlt.' })
      const { removed } = await removeUpload(supabase, code, imageId)
      return res.json({ removed })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (e) {
    console.error('/api/admin/upload-image:', e)
    res.status(500).json({ error: e.message })
  }
}
