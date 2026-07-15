// api/pdf.js
// GET /api/pdf?code=ABC123&v=book_v2&s=<slug>
//
// Kurze, dauerhafte Download-URL auf der EIGENEN Domain für ein auf dem Server
// abgelegtes Druck-PDF (siehe api/admin/store-pdf.js). Der Endpunkt sucht das
// PDF, signiert intern eine FRISCHE SAS-URL (die im Blob-Storage nach 1 h abläuft),
// lädt die Bytes und STREAMT sie selbst aus — so bleibt in der Browser-Adressleiste
// die kurze `/api/pdf?…`-URL stehen (keine 302-Umleitung auf die lange SAS-URL).
//
// Öffentlich (der Manager teilt ihn bewusst). Berechtigung ist der zufällige,
// nicht erratbare `slug` (12 Zufallsbytes) – ein Rate-Limit bremst Durchprobieren.

const { createClient } = require('./_lib/store')
const { enforce } = require('./_lib/ratelimit')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const IMAGE_BUCKET = 'memorial-images'
const SIGNED_URL_TTL = 60 * 60

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).send('Method not allowed')
  try {
    if (!(await enforce(req, res, { name: 'pdf-share', limit: 60, windowSeconds: 60 }))) return
    const code = (req.query.code || '').toUpperCase().trim()
    const v    = String(req.query.v || '').trim()
    const s    = String(req.query.s || '').trim()
    if (!code || !v || !s) return res.status(400).send('Fehlende Parameter.')

    const { data: m } = await supabase
      .from('memorials').select('stored_pdfs').eq('id', code).maybeSingle()
    const entry = m?.stored_pdfs?.[v]
    if (!entry || !entry.path || entry.slug !== s) return res.status(404).send('PDF nicht gefunden.')

    const { data: signed } = await supabase.storage.from(IMAGE_BUCKET).createSignedUrls([entry.path], SIGNED_URL_TTL)
    const url = signed?.[0]?.signedUrl
    if (!url) return res.status(502).send('Link konnte nicht erstellt werden.')

    // PDF-Bytes serverseitig holen und selbst ausliefern → kurze URL bleibt sichtbar.
    const upstream = await fetch(url)
    if (!upstream.ok) return res.status(502).send('PDF konnte nicht geladen werden.')
    const buf = Buffer.from(await upstream.arrayBuffer())

    const fname = `${code}-${v.replace(/[^a-z0-9_]/gi, '')}.pdf`
    res.status(200)
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Length', buf.length)
    res.setHeader('Content-Disposition', `inline; filename="${fname}"`)
    res.setHeader('Cache-Control', 'public, max-age=300')
    return res.end(buf)
  } catch (e) {
    console.error('/api/pdf error:', e)
    return res.status(500).send('Fehler beim Laden des PDFs.')
  }
}
