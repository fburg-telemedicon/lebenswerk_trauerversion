// api/admin/store-pdf.js
// POST /api/admin/store-pdf?code=ABC123&variant=book_v2&filename=…
//   Body: das PDF ROH (Content-Type: application/pdf) — so kommen auch große
//   Druck-PDFs an. Base64-JSON ({ variant, filename, dataBase64 }) wird weiter
//   akzeptiert, ist aber nur noch der Altweg: +33 % Volumen und das JSON-Limit
//   von server.js (50 MB) killte damit jedes Buch mit vollen Druck-PNGs.
//
// Legt eine Kopie des im Browser erzeugten Druck-PDFs im Blob-Storage ab
// (memorial-images/<CODE>/print-<variant>.pdf, upsert) und verweist am Buch
// darauf (memorials.stored_pdfs). Beim Löschen des Buchs wird der ganze
// <CODE>/-Ordner im Bilder-Bucket mitgelöscht (delete-memorial.js) → die
// abgelegte Kopie verschwindet automatisch, kein zusätzlicher Cleanup nötig.
//
// Zugriff: nur eingeloggte Manager auf EIGENE Bücher (loadAccessibleMemorial).

const { createClient } = require('../_lib/store')
const { checkAuth } = require('../_lib/auth')
const { loadAccessibleMemorial } = require('../_lib/access')
const { ensureLifeworkSchema } = require('../_lib/lifework')
const crypto = require('crypto')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

const IMAGE_BUCKET = 'memorial-images'
const SIGNED_URL_TTL = 60 * 60
const ALLOWED_VARIANTS = new Set(['book_v1', 'book_v2', 'eulogy', 'ebook_book_v1', 'ebook_book_v2'])
// Muss zum Roh-Limit in server.js passen (PDF_LIMIT, Standard 200 MB).
const MAX_BYTES = Number(process.env.PDF_MAX_MB || 200) * 1024 * 1024

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (!checkAuth(req, res)) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try {
    const code = (req.query.code || '').toUpperCase().trim()
    const access = await loadAccessibleMemorial(supabase, req.auth, code, 'id, stored_pdfs')
    if (access.error) return res.status(access.status).json({ error: access.error })

    // Roher Blob (Normalfall) oder Base64-JSON (Altweg).
    const raw = Buffer.isBuffer(req.body) ? req.body : null
    let variant, filename, buf
    if (raw) {
      variant = String(req.query.variant || '').trim()
      filename = req.query.filename
      buf = raw
    } else {
      ({ variant, filename } = req.body || {})
      variant = String(variant || '').trim()
      const dataBase64 = (req.body || {}).dataBase64
      if (!dataBase64 || typeof dataBase64 !== 'string') return res.status(400).json({ error: 'PDF-Daten fehlen.' })
      buf = Buffer.from(dataBase64.replace(/^data:[^,]*,/, ''), 'base64')
    }
    if (!ALLOWED_VARIANTS.has(variant)) return res.status(400).json({ error: 'Ungültige Variante.' })
    if (!buf || !buf.length) return res.status(400).json({ error: 'PDF ist leer.' })
    if (buf.length > MAX_BYTES) {
      return res.status(413).json({ error: `PDF ist zu groß (${Math.round(buf.length / 1048576)} MB, erlaubt sind ${Math.round(MAX_BYTES / 1048576)} MB).` })
    }

    await ensureLifeworkSchema()   // stellt u. a. die stored_pdfs-Spalte sicher

    const path = `${code}/print-${variant}.pdf`
    const { error: upErr } = await supabase.storage
      .from(IMAGE_BUCKET).upload(path, buf, { contentType: 'application/pdf', upsert: true })
    if (upErr) return res.status(502).json({ error: 'Ablage im Storage fehlgeschlagen: ' + upErr.message })

    const cur = (access.memorial.stored_pdfs && typeof access.memorial.stored_pdfs === 'object') ? { ...access.memorial.stored_pdfs } : {}
    // Unrats-Capability für die Kurz-Domain-URL (/api/pdf). Bei erneutem Upload
    // bleibt der Slug stabil, damit ein bereits geteilter Link weiter funktioniert.
    const slug = cur[variant]?.slug || crypto.randomBytes(12).toString('base64url')
    cur[variant] = {
      path,
      slug,
      filename: String(filename || `Buch_${variant}.pdf`).slice(0, 160),
      at: new Date().toISOString(),
      size: buf.length,
    }
    const { error: updErr } = await supabase.from('memorials').update({ stored_pdfs: cur }).eq('id', code)
    if (updErr) return res.status(500).json({ error: updErr.message })

    const { data: signed } = await supabase.storage.from(IMAGE_BUCKET).createSignedUrls([path], SIGNED_URL_TTL)
    return res.json({ ok: true, variant, url: signed?.[0]?.signedUrl || null, stored_pdfs: cur })
  } catch (e) {
    console.error('/api/admin/store-pdf error:', e)
    return res.status(500).json({ error: 'Die PDF-Kopie konnte nicht abgelegt werden.' })
  }
}
