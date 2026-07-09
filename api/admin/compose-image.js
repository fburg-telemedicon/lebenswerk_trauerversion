// api/admin/compose-image.js
// POST /api/admin/compose-image?code=ABC123
//   { images:[{ path, caption?, orientation? }...] (1..4), template?, variant?,
//     chapterNumber?, chapterHeading? }
//   → { storagePath }
//
// Setzt aus 1..4 hochgeladenen Fotos EIN druckfertiges Landscape-Doppelseiten-
// Bild (1536×1024) zusammen. Ziel: Hochkant-/mehrere/geringqualitative Bilder
// sinnvoll auf der Doppelseite gruppieren, Bildunterschriften einbrennen, Falz-
// (vertikale Mitte) und Beschnitt (Außenkanten) berücksichtigen. Die KI schlägt
// nur die Gruppierung/Template vor – gerendert wird DETERMINISTISCH mit sharp.
//
// Ergebnis wird wie ein generiertes Bild abgelegt (<CODE>/<uuid>.png + _thumb.jpg),
// läuft danach unverändert durch Signierung, DOCX, Druck-PDF und Löschung.

const { createClient } = require('@supabase/supabase-js')
const crypto = require('crypto')
const { checkAuth } = require('../_lib/auth')
const { loadAccessibleMemorial } = require('../_lib/access')
const { IMAGE_BUCKET } = require('../_lib/delete-memorial')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

const W = 1536, H = 1024
const FOLD = W / 2        // vertikale Falzmitte
const EDGE = 40          // Beschnitt-Sicherheitsrand (Außenkanten)
const GAP = 28           // Abstand zwischen Zellen (fällt bei 2er-Layout in den Falz)

async function downloadBuffer(path) {
  const { data, error } = await supabase.storage.from(IMAGE_BUCKET).download(path)
  if (error || !data) throw new Error(`Bild nicht ladbar (${path}): ${error?.message || 'unbekannt'}`)
  return Buffer.from(await data.arrayBuffer())
}

// Zell-Raster je nach Bildanzahl UND Orientierung. Rechtecke innerhalb des
// Beschnitt-Rahmens; Spalten-Layouts legen den Spalt auf die Falzmitte.
// Sind alle Bilder Querformat, wird gestapelt (Reihen) statt nebeneinander
// (Spalten) – so passt die Zellform besser zum Motiv und es entstehen weniger
// leere Passepartout-Flächen. Fotos werden ohnehin vollständig (contain)
// gezeigt, damit bei gemischten Formaten nichts (v. a. keine Gesichter)
// abgeschnitten wird.
function cellsFor(n, oris = []) {
  const x0 = EDGE, y0 = EDGE, w = W - 2 * EDGE, h = H - 2 * EDGE
  const allLandscape = oris.length === n && oris.every(o => o === 'landscape')
  if (n <= 1) return [{ x: x0, y: y0, w, h }]
  if (n === 2) {
    if (allLandscape) {
      const ch = (h - GAP) / 2
      return [{ x: x0, y: y0, w, h: ch }, { x: x0, y: y0 + ch + GAP, w, h: ch }]
    }
    const cw = (w - GAP) / 2
    return [{ x: x0, y: y0, w: cw, h }, { x: x0 + cw + GAP, y: y0, w: cw, h }]
  }
  if (n === 3) {
    if (allLandscape) {
      const ch = (h - 2 * GAP) / 3
      return [0, 1, 2].map(i => ({ x: x0, y: y0 + i * (ch + GAP), w, h: ch }))
    }
    const cw = (w - 2 * GAP) / 3
    return [0, 1, 2].map(i => ({ x: x0 + i * (cw + GAP), y: y0, w: cw, h }))
  }
  // 4 → 2×2
  const cw = (w - GAP) / 2, ch = (h - GAP) / 2
  return [
    { x: x0, y: y0, w: cw, h: ch },
    { x: x0 + cw + GAP, y: y0, w: cw, h: ch },
    { x: x0, y: y0 + ch + GAP, w: cw, h: ch },
    { x: x0 + cw + GAP, y: y0 + ch + GAP, w: cw, h: ch },
  ]
}

const MATTE = '#fbfaf7'          // cremefarbenes Passepartout
const SERIF = 'DejaVu Serif, Georgia, serif'

function escapeXml(s) {
  return String(s || '').replace(/[<>&'"]/g, c =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]))
}

// Sehr grobe Wortumbruch-Heuristik für die eingebrannten Bildunterschriften.
function wrapText(s, maxChars) {
  const words = String(s || '').trim().split(/\s+/)
  const lines = []
  let cur = ''
  for (const w of words) {
    if (!cur) { cur = w; continue }
    if ((cur + ' ' + w).length <= maxChars) cur += ' ' + w
    else { lines.push(cur); cur = w }
  }
  if (cur) lines.push(cur)
  return lines
}

// Cremefarbenes Passepartout um ein Foto → Ergebnis exakt boxW×boxH.
async function mattePhoto(sharp, buf, boxW, boxH, fit) {
  const border = Math.round(Math.min(boxW, boxH) * 0.018) + 8
  const iw = Math.max(1, boxW - 2 * border)
  const ih = Math.max(1, boxH - 2 * border)
  // background = MATTE, damit der bei 'contain' entstehende Leerraum (Letterbox)
  // in Passepartout-Creme statt Schwarz gefüllt wird. 'attention' gilt nur für
  // 'cover' (bei 'contain' ohne Wirkung, aber unschädlich).
  return await sharp(buf)
    .resize(iw, ih, { fit, position: 'attention', background: MATTE })
    .flatten({ background: MATTE })
    .extend({ top: border, bottom: border, left: border, right: border, background: MATTE })
    .png().toBuffer()
}

// Weicher Schlagschatten für eine Box. Liefert { buf, pad } (pad = Rand um die Box).
async function shadowBox(sharp, boxW, boxH) {
  const pad = 34
  const rect = await sharp({ create: { width: boxW, height: boxH, channels: 4, background: { r: 20, g: 16, b: 12, alpha: 0.4 } } }).png().toBuffer()
  const buf = await sharp({ create: { width: boxW + 2 * pad, height: boxH + 2 * pad, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: rect, left: pad, top: pad + 10 }])
    .blur(15).png().toBuffer()
  return { buf, pad }
}

// Foto mit Schatten + Passepartout an Position box platzieren (in overlays).
// Maße werden gerundet – sharp verlangt ganzzahlige Bildabmessungen.
async function placePhoto(sharp, overlays, buf, box, fit) {
  const w = Math.round(box.w), h = Math.round(box.h)
  const { buf: sh, pad } = await shadowBox(sharp, w, h)
  overlays.push({ input: sh, left: Math.round(box.x - pad), top: Math.round(box.y - pad) })
  const matted = await mattePhoto(sharp, buf, w, h, fit)
  overlays.push({ input: matted, left: Math.round(box.x), top: Math.round(box.y) })
}

// Dunkle Vignette für Tiefe über dem Unschärfe-Hintergrund.
function vignetteLayer() {
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><defs><radialGradient id="v" cx="50%" cy="45%" r="72%"><stop offset="52%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity="0.5"/></radialGradient></defs><rect width="${W}" height="${H}" fill="url(#v)"/></svg>`
  return Buffer.from(svg)
}

// Weicher, abgedunkelter Unschärfe-Hintergrund aus dem ersten Bild + Vignette.
async function blurredBase(sharp, buf) {
  const bg = await sharp(buf).resize(W, H, { fit: 'cover' }).blur(34).modulate({ brightness: 0.58 }).toBuffer()
  return sharp(bg)
}

async function composeBuffers(bufs, metas) {
  const sharp = require('sharp')
  const n = Math.min(bufs.length, 4)
  const cap = i => String(metas[i]?.caption || '').trim().slice(0, 90)
  const overlays = []

  // ── 1 Bild ───────────────────────────────────────────────────────
  if (n === 1) {
    const isLandscape = metas[0]?.orientation === 'landscape'
    if (isLandscape) {
      // Vollflächiges Landscape-Motiv (Bild = Spread). Bildunterschrift unten
      // auf weichem Verlauf.
      const base = sharp(await sharp(bufs[0]).resize(W, H, { fit: 'cover' }).toBuffer())
      const c = cap(0)
      if (c) {
        const grad = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0.7" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.6"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#g)"/><text x="${W / 2}" y="${H - 46}" text-anchor="middle" font-family="${SERIF}" font-size="30" fill="#f7f2ea">${escapeXml(wrapText(c, 60)[0])}</text></svg>`
        overlays.push({ input: Buffer.from(grad), left: 0, top: 0 })
      }
      return await base.composite(overlays).png().toBuffer()
    }
    // Einzelnes Hochkant-/Quadrat-Foto: editoriale Doppelseite. Foto auf der
    // rechten Seite (nicht über dem Falz), Bildunterschrift links.
    const base = await blurredBase(sharp, bufs[0])
    overlays.push({ input: vignetteLayer(), left: 0, top: 0 })
    const boxH = Math.round(H * 0.82)
    const meta0 = await sharp(bufs[0]).metadata()
    const ar = (meta0.width && meta0.height) ? meta0.width / meta0.height : 0.75
    let boxW = Math.round(boxH * ar)
    const maxW = Math.round((W - FOLD) - 90)
    if (boxW > maxW) boxW = maxW
    const box = { x: Math.round(FOLD + ((W - FOLD) - boxW) / 2), y: Math.round((H - boxH) / 2), w: boxW, h: boxH }
    await placePhoto(sharp, overlays, bufs[0], box, 'cover')
    const c = cap(0)
    if (c) {
      const F = 34, lh = Math.round(F * 1.4)
      const areaX = 70, areaW = FOLD - 140
      const lines = wrapText(c, Math.max(10, Math.floor(areaW / (F * 0.5)))).slice(0, 5)
      const startY = Math.round(H / 2 - (lines.length * lh) / 2 + F)
      const t = lines.map((ln, i) => `<text x="${areaX + areaW / 2}" y="${startY + i * lh}" text-anchor="middle" font-family="${SERIF}" font-size="${F}" fill="#f7f2ea">${escapeXml(ln)}</text>`).join('')
      overlays.push({ input: Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${t}</svg>`), left: 0, top: 0 })
    }
    return await base.composite(overlays).png().toBuffer()
  }

  // ── 2..4 Bilder: Raster mit Passepartout + Schatten ──────────────
  const base = await blurredBase(sharp, bufs[0])
  overlays.push({ input: vignetteLayer(), left: 0, top: 0 })
  const oris = metas.slice(0, n).map(m => m?.orientation)
  const cells = cellsFor(n, oris)
  const anyCap = metas.slice(0, n).some((_, i) => cap(i))
  const capRoom = anyCap ? 44 : 0
  const capParts = []
  for (let i = 0; i < n; i++) {
    const cl = cells[i]
    const pad = 10
    // Rahmen exakt in der EIGENFORM des Fotos berechnen (größtmöglich in der
    // Zelle). So füllt jedes Foto seinen Rahmen randlos (kein Beschnitt, weil
    // Seitenverhältnis passt) und der atmosphärische Hintergrund zeigt sich
    // ringsum – gemischte Hoch-/Querformate wirken jeweils richtig proportioniert.
    const md = await sharp(bufs[i]).metadata()
    const ar = (md.width && md.height) ? md.width / md.height : (oris[i] === 'landscape' ? 1.5 : 0.72)
    const availW = cl.w - 2 * pad
    const availH = cl.h - capRoom - 2 * pad
    let fw = availW, fh = fw / ar
    if (fh > availH) { fh = availH; fw = fh * ar }
    const box = { x: cl.x + (cl.w - fw) / 2, y: cl.y + pad + (availH - fh) / 2, w: fw, h: fh }
    await placePhoto(sharp, overlays, bufs[i], box, 'cover')
    const c = cap(i)
    if (c) {
      const F = 22
      const line = wrapText(c, Math.max(8, Math.floor(box.w / (F * 0.5))))[0]
      const cy = Math.min(Math.round(box.y + box.h + 34), cl.y + cl.h - 6)
      capParts.push(`<text x="${Math.round(box.x + box.w / 2)}" y="${cy}" text-anchor="middle" font-family="${SERIF}" font-size="${F}" fill="#f4eee4">${escapeXml(line)}</text>`)
    }
  }
  if (capParts.length) overlays.push({ input: Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${capParts.join('')}</svg>`), left: 0, top: 0 })
  return await base.composite(overlays).png().toBuffer()
}

async function compose(images) {
  const n = Math.min(images.length, 4)
  const use = images.slice(0, n)
  const bufs = await Promise.all(use.map(im => downloadBuffer(im.path)))
  return await composeBuffers(bufs, use)
}

module.exports = async function handler(req, res) {
  if (!checkAuth(req, res)) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try {
    const { images, memorialCode } = req.body || {}
    const code = (memorialCode || req.query.code || '').toUpperCase().trim()
    if (!code) return res.status(400).json({ error: 'memorialCode fehlt.' })
    if (!Array.isArray(images) || images.length === 0) {
      return res.status(400).json({ error: 'Keine Bilder zum Zusammensetzen übergeben.' })
    }
    const access = await loadAccessibleMemorial(supabase, req.auth, code)
    if (access.error) return res.status(access.status).json({ error: access.error })

    // Nur Pfade des eigenen Gedenkbuchs zulassen (kein Fremdzugriff über Pfade).
    const clean = images
      .filter(im => im && typeof im.path === 'string' && im.path.startsWith(`${code}/`))
      .slice(0, 4)
    if (clean.length === 0) return res.status(400).json({ error: 'Keine gültigen Bildpfade.' })

    const png = await compose(clean)
    const storagePath = `${code}/${crypto.randomUUID()}.png`
    const { error: upErr } = await supabase.storage.from(IMAGE_BUCKET).upload(storagePath, png, {
      contentType: 'image/png', upsert: false,
    })
    if (upErr) return res.status(500).json({ error: `Storage-Upload fehlgeschlagen: ${upErr.message}` })

    // Thumbnail wie bei generierten Bildern (<pfad>_thumb.jpg).
    try {
      const sharp = require('sharp')
      const thumb = await sharp(png).resize(480, 320, { fit: 'cover' }).jpeg({ quality: 72 }).toBuffer()
      await supabase.storage.from(IMAGE_BUCKET)
        .upload(storagePath.replace(/\.png$/i, '_thumb.jpg'), thumb, { contentType: 'image/jpeg', upsert: true })
    } catch (e) { console.warn('Kompositor-Thumbnail übersprungen:', e.message) }

    return res.json({ storagePath })
  } catch (e) {
    console.error('/api/admin/compose-image:', e)
    res.status(500).json({ error: e.message })
  }
}

// Für lokale Muster-Renderings (Tests). Der HTTP-Handler bleibt der Default-Export.
module.exports.composeBuffers = composeBuffers
