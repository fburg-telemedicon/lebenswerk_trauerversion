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
const EDGE = 40          // Beschnitt-Sicherheitsrand (Außenkanten)
const GAP = 28           // Abstand zwischen Zellen (fällt bei 2er-Layout in den Falz)

async function downloadBuffer(path) {
  const { data, error } = await supabase.storage.from(IMAGE_BUCKET).download(path)
  if (error || !data) throw new Error(`Bild nicht ladbar (${path}): ${error?.message || 'unbekannt'}`)
  return Buffer.from(await data.arrayBuffer())
}

// Zell-Raster je nach Bildanzahl. Rechtecke innerhalb des Beschnitt-Rahmens;
// bei 2 Bildern liegt der Spalt genau auf der Falzmitte (falzsicher).
function cellsFor(n) {
  const x0 = EDGE, y0 = EDGE, w = W - 2 * EDGE, h = H - 2 * EDGE
  const cx = x0 + (w - GAP) / 2
  if (n <= 1) return [{ x: x0, y: y0, w, h }]
  if (n === 2) return [
    { x: x0, y: y0, w: (w - GAP) / 2, h },
    { x: cx + GAP, y: y0, w: (w - GAP) / 2, h },
  ]
  if (n === 3) {
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

function escapeXml(s) {
  return String(s || '').replace(/[<>&'"]/g, c =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]))
}

// Bildunterschrift als eingebrannte SVG-Zeile (dunkler, halbtransparenter
// Balken + heller Text) am unteren Rand einer Zelle.
function captionSvgLayer(cells, images) {
  const parts = []
  cells.forEach((c, i) => {
    const raw = images[i]?.caption
    if (!raw) return
    const text = escapeXml(String(raw).trim().slice(0, 80))
    if (!text) return
    const barH = 52
    const by = c.y + c.h - barH - 10
    const bx = c.x + 10
    const bw = c.w - 20
    parts.push(
      `<rect x="${bx}" y="${by}" width="${bw}" height="${barH}" rx="8" fill="rgba(20,16,12,0.55)"/>` +
      `<text x="${bx + 18}" y="${by + barH / 2 + 8}" font-family="DejaVu Sans, Arial, sans-serif" ` +
      `font-size="24" fill="#f5efe6">${text}</text>`
    )
  })
  if (!parts.length) return null
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>`
  return Buffer.from(svg)
}

async function compose(images) {
  const sharp = require('sharp')
  const n = Math.min(images.length, 4)
  const use = images.slice(0, n)
  const bufs = await Promise.all(use.map(im => downloadBuffer(im.path)))

  const single = n === 1
  const landscapeSingle = single && (use[0].orientation === 'landscape')

  // Hintergrund: bei Vollflächen-Landscape-Einzelbild wird das Bild selbst zum
  // Spread; sonst ein weich gezoomter, abgedunkelter Hintergrund aus dem ersten
  // Bild, damit Ränder/Zwischenräume atmosphärisch gefüllt sind (statt hart).
  let base
  if (landscapeSingle) {
    base = sharp(await sharp(bufs[0]).resize(W, H, { fit: 'cover' }).toBuffer())
  } else {
    const bg = await sharp(bufs[0])
      .resize(W, H, { fit: 'cover' })
      .blur(28)
      .modulate({ brightness: 0.72 })
      .toBuffer()
    base = sharp(bg)
  }

  const overlays = []
  if (!landscapeSingle) {
    const cells = cellsFor(n)
    // Einzelnes Hochkant-/Quadrat-Bild: GANZ zeigen (contain) über dem weichen
    // Hintergrund. Mehrere Bilder: Zelle formatfüllend (cover), motivbewusst.
    const single = n === 1
    for (let i = 0; i < n; i++) {
      const c = cells[i]
      const pad = 16
      const tw = Math.round(c.w - 2 * pad)
      const th = Math.round(c.h - 2 * pad)
      const tile = single
        ? await sharp(bufs[i])
            .resize(tw, th, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .png().toBuffer()
        : await sharp(bufs[i])
            .resize(tw, th, { fit: 'cover', position: 'attention' })
            .png().toBuffer()
      overlays.push({ input: tile, left: Math.round(c.x + pad), top: Math.round(c.y + pad) })
    }
    const capLayer = captionSvgLayer(cells, use)
    if (capLayer) overlays.push({ input: capLayer, left: 0, top: 0 })
  } else {
    // Einzelnes Landscape-Vollbild: nur die Bildunterschrift einbrennen.
    const capLayer = captionSvgLayer([{ x: 0, y: 0, w: W, h: H }], use)
    if (capLayer) overlays.push({ input: capLayer, left: 0, top: 0 })
  }

  const composed = overlays.length ? base.composite(overlays) : base
  return await composed.png().toBuffer()
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
