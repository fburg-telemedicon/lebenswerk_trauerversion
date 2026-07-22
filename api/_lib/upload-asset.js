// api/_lib/upload-asset.js
// Gemeinsame Logik für den Foto-Upload (Beitragende via api/upload.js und
// Manager via api/admin/upload-image.js). Validiert das Bild, liest Maße/
// Orientierung/Qualität via sharp, erzeugt ein Thumbnail, legt beides FLACH im
// privaten Bucket "memorial-images" unter <CODE>/up-<uuid>.jpg (+ _thumb.jpg)
// ab und hängt die Metadaten (inkl. Einverständnis) an memorials.uploaded_images.
//
// FLACHE Ablage ist Absicht: die ordnerweite Art.-17-Löschung in
// api/_lib/delete-memorial.js listet nur <CODE>/ (nicht rekursiv). Unterordner
// würden beim Löschen übersehen.

const crypto = require('crypto')
const { IMAGE_BUCKET } = require('./delete-memorial')

// Aktuelle Version des Einwilligungstextes (Beitragende). Wird pro Upload
// mitgespeichert, damit nachvollziehbar bleibt, WELCHER Text zugestimmt wurde.
// Bei Textänderung hochzählen.
const CONSENT_VERSION = '2026-07-09'

const MAX_BYTES = 15 * 1024 * 1024   // 15 MB dekodiert (Client skaliert vorab herunter)
const MAX_IMAGES_PER_MEMORIAL = 60
// Unter dieser Auflösung (längste Kante) gilt ein Bild als „low" → der
// Kompositor bevorzugt dann eine schonende Platzierung statt Vollflächen-Zoom.
const LOW_QUALITY_MAX_EDGE = 900
// Zielobergrenze für die gespeicherte Vollversion (Druckqualität, kontrollierte
// Dateigröße). EXIF-Rotation wird angewandt, Ergebnis als JPEG q90.
const STORE_MAX_EDGE = 3000

function stripDataUrl(s) {
  const str = String(s || '')
  const m = str.match(/^data:[^;,]+;base64,(.*)$/s)
  return m ? m[1] : str
}

function classifyOrientation(w, h) {
  if (!w || !h) return 'square'
  const r = w / h
  if (r >= 1.1) return 'landscape'
  if (r <= 0.91) return 'portrait'
  return 'square'
}

// Validiert + speichert EIN Bild und gibt den fertigen uploaded_images-Eintrag
// zurück (ohne ihn zu persistieren – das macht appUpload()).
async function storeUpload(supabase, code, { base64, caption, description, source, contributionId, consent }) {
  const sharp = require('sharp')
  const raw = stripDataUrl(base64)
  if (!raw) throw new Error('Kein Bild übergeben.')
  let input
  try { input = Buffer.from(raw, 'base64') } catch { throw new Error('Bilddaten nicht lesbar.') }
  if (!input.length) throw new Error('Bilddaten leer.')
  if (input.length > MAX_BYTES) throw new Error('Bild ist zu groß (max. 15 MB).')

  let meta
  try { meta = await sharp(input).metadata() } catch { throw new Error('Bildformat nicht unterstützt.') }
  if (!meta.width || !meta.height) throw new Error('Bild konnte nicht gelesen werden.')

  // EXIF-Orientierung anwenden (.rotate()) und auf Speicher-Obergrenze bringen.
  const pipeline = sharp(input).rotate()
  const full = await pipeline
    .resize({ width: STORE_MAX_EDGE, height: STORE_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 90 })
    .toBuffer({ resolveWithObject: true })

  const width = full.info.width
  const height = full.info.height
  const orientation = classifyOrientation(width, height)
  const longEdge = Math.max(meta.width, meta.height)
  const quality_flag = longEdge < LOW_QUALITY_MAX_EDGE ? 'low' : 'ok'

  const id = crypto.randomUUID()
  const path = `${code}/up-${id}.jpg`
  const thumb_path = `${code}/up-${id}_thumb.jpg`

  const { error: upErr } = await supabase.storage.from(IMAGE_BUCKET).upload(path, full.data, {
    contentType: 'image/jpeg', upsert: false,
  })
  if (upErr) throw new Error(`Upload fehlgeschlagen: ${upErr.message}`)

  // Thumbnail (best effort – nicht kritisch).
  try {
    const thumb = await sharp(full.data).resize(480, 320, { fit: 'cover' }).jpeg({ quality: 72 }).toBuffer()
    await supabase.storage.from(IMAGE_BUCKET).upload(thumb_path, thumb, { contentType: 'image/jpeg', upsert: true })
  } catch (e) { console.warn('Thumbnail übersprungen:', e.message) }

  return {
    id,
    path,
    thumb_path,
    caption: String(caption || '').trim().slice(0, 300),
    description: String(description || '').trim().slice(0, 1000),
    orientation,
    width,
    height,
    quality_flag,
    // 'guest' = über den Gast-Link hochgeladen (Gastbeiträge zum Lebenswerk);
    // technisch ein Beitragenden-Upload, aber der Manager soll die Herkunft sehen.
    source: source === 'manager' ? 'manager' : (source === 'guest' ? 'guest' : 'contributor'),
    contribution_id: contributionId || null,
    consent: {
      granted: Boolean(consent),
      version: CONSENT_VERSION,
      at: new Date().toISOString(),
    },
    uploaded_at: new Date().toISOString(),
  }
}

// Lädt hoch UND persistiert: liest die aktuelle uploaded_images-Liste, prüft das
// Limit, speichert das Bild und schreibt den erweiterten Array zurück.
// Rückgabe: der neue Eintrag. Wirft bei Fehlern.
async function appendUpload(supabase, code, opts) {
  const c = String(code || '').toUpperCase().trim()
  const { data: m, error } = await supabase
    .from('memorials').select('uploaded_images').eq('id', c).maybeSingle()
  if (error) throw new Error(error.message)
  if (!m) throw new Error('Gedenkbuch nicht gefunden.')
  const list = Array.isArray(m.uploaded_images) ? m.uploaded_images : []
  if (list.length >= MAX_IMAGES_PER_MEMORIAL) {
    throw new Error(`Maximale Anzahl Bilder erreicht (${MAX_IMAGES_PER_MEMORIAL}).`)
  }
  const entry = await storeUpload(supabase, c, opts)
  const { error: updErr } = await supabase
    .from('memorials').update({ uploaded_images: [...list, entry] }).eq('id', c)
  if (updErr) {
    // Verwaiste Datei best effort wieder entfernen, damit kein Datenmüll bleibt.
    try { await supabase.storage.from(IMAGE_BUCKET).remove([entry.path, entry.thumb_path]) } catch {}
    throw new Error(updErr.message)
  }
  return entry
}

// Entfernt einen Upload-Eintrag (Metadaten + Storage-Datei + Thumbnail).
async function removeUpload(supabase, code, imageId) {
  const c = String(code || '').toUpperCase().trim()
  const { data: m, error } = await supabase
    .from('memorials').select('uploaded_images').eq('id', c).maybeSingle()
  if (error) throw new Error(error.message)
  if (!m) throw new Error('Gedenkbuch nicht gefunden.')
  const list = Array.isArray(m.uploaded_images) ? m.uploaded_images : []
  const entry = list.find(x => x?.id === imageId)
  if (!entry) return { removed: false }
  const rest = list.filter(x => x?.id !== imageId)
  const { error: updErr } = await supabase
    .from('memorials').update({ uploaded_images: rest }).eq('id', c)
  if (updErr) throw new Error(updErr.message)
  const paths = [entry.path, entry.thumb_path].filter(Boolean)
  if (paths.length) { try { await supabase.storage.from(IMAGE_BUCKET).remove(paths) } catch (e) { console.warn('Storage-Löschung Upload:', e.message) } }
  return { removed: true }
}

module.exports = {
  CONSENT_VERSION,
  MAX_IMAGES_PER_MEMORIAL,
  storeUpload,
  appendUpload,
  removeUpload,
  classifyOrientation,
}
