// api/audio.js
// GET /api/audio?code=ABC123&v=book_v2&s=<slug>        → im Browser ABSPIELEN
// GET /api/audio?code=ABC123&v=book_v2&s=<slug>&dl=1   → MP3 HERUNTERLADEN
//
// Ein Blob, zwei Verhaltensweisen: Die Content-Disposition wird in die SAS-URL
// hineinsigniert (rscd), Azure gibt sie als Antwort-Header aus. Es liegt also
// weiterhin nur EINE Datei im Storage.
//
// Kurze, dauerhafte Download-URL auf der EIGENEN Domain für eine auf dem Server
// abgelegte Hörbuch-Gesamtdatei (siehe api/admin/store-audiobook.js). Gegenstück
// zu api/pdf.js für PDFs.
//
// Unterschied zu /api/pdf: Hier wird auf die frisch signierte SAS-URL UMGELEITET,
// statt die Bytes selbst auszuliefern. Eine Hörbuchdatei ist leicht 90 MB groß —
// die durch den Node-Prozess zu puffern kostet für jeden Abruf denselben Speicher,
// und Handy-Player brauchen Bereichsanfragen (Range) zum Spulen, die Azure Blob
// von Haus aus beantwortet und dieser Endpunkt nicht könnte.
//
// Öffentlich (der Manager teilt ihn bewusst). Berechtigung ist der zufällige,
// nicht erratbare `slug` (12 Zufallsbytes) – ein Rate-Limit bremst Durchprobieren.

const { createClient } = require('./_lib/store')
const { enforce } = require('./_lib/ratelimit')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const IMAGE_BUCKET = 'memorial-images'
const SIGNED_URL_TTL = 60 * 60
const BAD_IN_HEADER = /[\r\n"\\]/g
const NON_ASCII = /[^\x20-\x7E]/g

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).send('Method not allowed')
  try {
    if (!(await enforce(req, res, { name: 'audio-share', limit: 60, windowSeconds: 60 }))) return
    const code = (req.query.code || '').toUpperCase().trim()
    const v    = String(req.query.v || '').trim()
    const s    = String(req.query.s || '').trim()
    if (!code || !v || !s) return res.status(400).send('Fehlende Parameter.')

    const { data: m } = await supabase
      .from('memorials').select('audiobooks').eq('id', code).maybeSingle()
    const full = m?.audiobooks?.[v]?.full
    if (!full || !full.path || full.slug !== s) return res.status(404).send('Hörbuch nicht gefunden.')

    // Dateiname für den Speichern-Dialog. `filename*` (RFC 5987) trägt Umlaute
    // korrekt, das schlichte `filename` bleibt als ASCII-Rückfall daneben stehen.
    const name = String(full.filename || 'Hoerbuch.mp3').replace(BAD_IN_HEADER, '').slice(0, 160)
    const ascii = name.replace(NON_ASCII, '_')
    const download = req.query.dl !== undefined && String(req.query.dl) !== '0'
    const disposition = download
      ? `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`
      : `inline; filename="${ascii}"`

    const { data: signed } = await supabase.storage.from(IMAGE_BUCKET)
      .createSignedUrls([full.path], SIGNED_URL_TTL, { contentDisposition: disposition, contentType: 'audio/mpeg' })
    const url = signed?.[0]?.signedUrl
    if (!url) return res.status(502).send('Link konnte nicht erstellt werden.')

    res.setHeader('Cache-Control', 'no-store')
    return res.redirect(302, url)
  } catch (e) {
    console.error('/api/audio error:', e)
    return res.status(500).send('Fehler beim Laden des Hörbuchs.')
  }
}
