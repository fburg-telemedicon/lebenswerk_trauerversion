// api/admin/store-audiobook.js
// POST /api/admin/store-audiobook  { code, variant, filename? }
//
// Legt die HÖRBUCH-GESAMTDATEI auf dem Server ab und liefert die kurze,
// dauerhafte Download-URL (/api/audio?…) zurück — dasselbe Muster wie beim
// abgelegten Druck-PDF (api/admin/store-pdf.js + api/pdf.js).
//
// Anders als dort schickt der Browser NICHTS hoch: die Kapitelspuren liegen
// bereits im Blob-Storage, der Server setzt sie zusammen (siehe _lib/audiobook.js).
// Deshalb ist dieser Knopf auch der Weg, einen Link NACHzurüsten, ohne das
// Hörbuch erneut sprechen zu lassen — das würde echte Sprachkosten auslösen.
//
// Zugriff: nur eingeloggte Manager auf EIGENE Bücher (loadAccessibleMemorial).

const { createClient } = require('../_lib/store')
const { checkAuth } = require('../_lib/auth')
const { loadAccessibleMemorial } = require('../_lib/access')
const { storeFullAudiobook } = require('../_lib/audiobook')
const { ensureLifeworkSchema } = require('../_lib/lifework')
const { IMAGE_BUCKET } = require('../_lib/delete-memorial')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const SIGNED_URL_TTL = 60 * 60
const ALLOWED_VARIANTS = new Set(['book_v1', 'book_v2'])

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (!checkAuth(req, res)) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try {
    const code = String(req.body?.code || '').toUpperCase().trim()
    const variant = String(req.body?.variant || '').trim()
    if (!ALLOWED_VARIANTS.has(variant)) return res.status(400).json({ error: 'Ungültige Variante.' })

    await ensureLifeworkSchema()   // stellt u. a. die audiobooks-Spalte sicher
    const access = await loadAccessibleMemorial(supabase, req.auth, code, 'id, audiobooks')
    if (access.error) return res.status(access.status).json({ error: access.error })

    const all = (access.memorial.audiobooks && typeof access.memorial.audiobooks === 'object') ? { ...access.memorial.audiobooks } : {}
    const rec = all[variant]
    if (!rec || !(rec.tracks || []).length) {
      return res.status(400).json({ error: 'Für diese Buchfassung gibt es noch kein Hörbuch.' })
    }

    let full
    try {
      full = await storeFullAudiobook(supabase, code, variant, rec.tracks, {
        prevSlug: rec.full?.slug,
        filename: req.body?.filename,
      })
    } catch (e) {
      return res.status(502).json({ error: e.message })
    }

    all[variant] = { ...rec, full, full_error: null }
    const { error: updErr } = await supabase.from('memorials').update({ audiobooks: all }).eq('id', code)
    if (updErr) return res.status(500).json({ error: updErr.message })

    const { data: signed } = await supabase.storage.from(IMAGE_BUCKET).createSignedUrls([full.path], SIGNED_URL_TTL)
    return res.json({ ok: true, variant, full: { ...full, url: signed?.[0]?.signedUrl || null } })
  } catch (e) {
    console.error('/api/admin/store-audiobook error:', e)
    return res.status(500).json({ error: 'Die Hörbuch-Datei konnte nicht abgelegt werden.' })
  }
}
