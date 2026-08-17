// api/_lib/audiobook.js
// Die Gesamtdatei eines Hörbuchs auf dem Server erzeugen und ablegen.
//
// Warum serverseitig? Die Kapitelspuren liegen schon im Blob-Storage. Würde der
// Browser die Sammeldatei hochladen, gingen ~90 MB durch die Leitung, die der
// Server bereits hat. Zusammengesetzt wird binär: Azure liefert reine MPEG-Frames
// ohne ID3, das Aneinanderhängen ergibt eine gültige MP3 (am Lutherhof-Hörbuch
// belegt) — deshalb braucht es hier kein ffmpeg.
//
// Zwei Aufrufer: der Worker direkt nach dem Sprechen (wenn beim Erzeugen
// „auf Server ablegen" angekreuzt war) und api/admin/store-audiobook.js
// (Knopf an der Buchkarte — damit ein Link nicht erneut Sprachkosten auslöst).

const crypto = require('crypto')
const { IMAGE_BUCKET } = require('./delete-memorial')

// Legt <CODE>/audio/full-<variant>.mp3 an und liefert den Eintrag, der unter
// memorials.audiobooks[variant].full gespeichert wird. `prevSlug` erhält einen
// bereits geteilten Link über ein Neu-Ablegen hinweg.
async function storeFullAudiobook(supabase, code, variant, tracks, opts = {}) {
  const list = (tracks || []).filter(t => t?.path).slice().sort((a, b) => a.index - b.index)
  if (!list.length) throw new Error('Es liegen keine Tonspuren vor.')

  const parts = []
  for (const t of list) {
    const { data, error } = await supabase.storage.from(IMAGE_BUCKET).download(t.path)
    if (error || !data) throw new Error(`Tonspur ${t.index} konnte nicht geladen werden: ${error?.message || 'unbekannt'}`)
    parts.push(Buffer.isBuffer(data) ? data : Buffer.from(await data.arrayBuffer()))
  }
  const buf = Buffer.concat(parts)

  const path = `${code}/audio/full-${variant}.mp3`
  const { error: upErr } = await supabase.storage.from(IMAGE_BUCKET)
    .upload(path, buf, { contentType: 'audio/mpeg', upsert: true })
  if (upErr) throw new Error(`Ablage im Storage fehlgeschlagen: ${upErr.message}`)

  return {
    path,
    // Nicht erratbare Berechtigung für die kurze Domain-URL (/api/audio) — genau
    // wie beim abgelegten Druck-PDF.
    slug: opts.prevSlug || crypto.randomBytes(12).toString('base64url'),
    filename: String(opts.filename || `Hoerbuch_${variant}.mp3`).slice(0, 160),
    size: buf.length,
    at: new Date().toISOString(),
  }
}

module.exports = { storeFullAudiobook }
