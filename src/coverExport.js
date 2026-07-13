// src/coverExport.js
// Druckfertiges Buch-Cover als eigenes PDF (Rückseite + Buchrücken + Vorderseite
// auf EINER Seite, randlos/full-bleed).
//
// ── Geometrie (alle Maße in mm, Ursprung oben links der BRUTTO-Seite) ────────
//
//        15 |<-------- 154 -------->|  B  |<-------- 154 -------->| 15
//      ┌────┬───────────────────────┬─────┬───────────────────────┬────┐
//   15 │                     B E S C H N I T T                         │
//      ├────┼───────────────────────┼─────┼───────────────────────┼────┤
//      │    │      Rückseite        │Rück-│      Vorderseite      │    │
//  215 │    │      (Logo)           │ en  │      (Titelkasten)    │    │
//      ├────┼───────────────────────┼─────┼───────────────────────┼────┤
//   15 │                     B E S C H N I T T                         │
//      └────┴───────────────────────┴─────┴───────────────────────┴────┘
//
// Höhe  = 15 + 215 + 15                 = 245
// Breite= 15 + 154 + B + 154 + 15       = 338 + B
// Innerhalb der 215 mm Nutzhöhe liegen oben/unten je 5 mm Sicherheitsabstand,
// es bleiben 205 mm bedruckbarer Bereich. Links/rechts ebenso je 5 mm.
//
// B (Rückenstärke) hängt an der SEITENZAHL des Druck-PDFs — das Cover kann
// deshalb erst erzeugt werden, wenn das Druck-PDF einmal gebaut wurde
// (book.print_pages, gesetzt von downloadPrintPdf).

import { jsPDF } from 'jspdf'

// ── Maße ────────────────────────────────────────────────────────────
export const COVER = {
  bleed: 15,          // Beschnitt rundum
  safety: 5,          // Sicherheitsabstand innerhalb des Nettoformats
  panelW: 154,        // Breite einer Buchseite (Rück-/Vorderseite)
  netH: 215,          // Nettohöhe (Beschnitt abgezogen)
  height: 245,        // Bruttohöhe
  logoCenterX: 98,    // Horizontale Mitte des Rückseiten-Logos (von der Brutto-Kante)
  logoWidth: 40,      // Breite des Rückseiten-Logos
  spineStartX: 169,   // Buchrücken beginnt hier (= bleed + panelW)
  spineExtra: 2,      // Buchrücken-Farbfläche ist 2 mm breiter als B (Wickel-Toleranz)
  spineLogoFromBottom: 30, // Mitte des Rücken-Logos, gemessen von der unteren Brutto-Kante
  spineMargin: 1,     // seitlicher Freiraum im Rücken (je Seite), damit nichts anschneidet
  textStartX: 182,    // Titelkasten: linke Textkante (+ B)
  textEndX: 232,      // Titelkasten: spätestens hier umbrechen (+ B)
}

// ── Rückenstärke B nach Seitenzahl ──────────────────────────────────
// Vom Nutzer vorgegebene Tabelle. Zwischen den Bereichen liegen Lücken
// (z. B. 65–67); dort wird auf den nächsthöheren Bereich aufgerundet, weil
// die Rückenstärke sonst zu knapp wäre.
export const SPINE_TABLE = [
  { min: 48,  max: 64,  b: 5 },
  { min: 68,  max: 84,  b: 6 },
  { min: 88,  max: 104, b: 7 },
  { min: 108, max: 124, b: 8 },
  { min: 128, max: 144, b: 9 },
  { min: 148, max: 164, b: 10 },
  { min: 168, max: 184, b: 11 },
  { min: 188, max: 204, b: 12 },
  { min: 208, max: 224, b: 13 },
  { min: 228, max: 244, b: 14 },
  { min: 248, max: 264, b: 15 },
  { min: 268, max: 284, b: 16 },
  { min: 288, max: 304, b: 17 },
  { min: 308, max: 324, b: 18 },
  { min: 328, max: 344, b: 19 },
  { min: 348, max: 364, b: 20 },
  { min: 368, max: 384, b: 21 },
  { min: 388, max: 400, b: 22 },
]

export const MAX_PAGES = 400

export function spineWidthMm(pages) {
  const p = Number(pages)
  if (!Number.isFinite(p) || p <= 0) throw new Error('Seitenzahl unbekannt — bitte zuerst das Druck-PDF erzeugen.')
  if (p > MAX_PAGES) {
    throw new Error(`Das Buch hat ${p} Seiten. Für Bücher über ${MAX_PAGES} Seiten gibt es keine Rückenstärke — bitte den Umfang reduzieren.`)
  }
  // Erster Bereich, dessen Obergrenze die Seitenzahl abdeckt (deckt auch die
  // Lücken zwischen den Bereichen ab und Bücher unter 48 Seiten → 5 mm).
  const row = SPINE_TABLE.find(r => p <= r.max)
  return row.b
}

// ── Farbe: eine häufige, nicht zu grelle Farbe aus dem Hintergrund ──
// Vorgehen: Bild verkleinert auf ein Canvas, Pixel in grobe Farb-Eimer
// einsortieren, Eimer nach Häufigkeit gewichten — aber grelle (sehr gesättigte)
// und extrem helle/dunkle Farben abwerten, damit ein ruhiger Ton gewinnt.
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else h = ((r - g) / d + 4) / 6
  return [h, s, l]
}

function hslToRgb(h, s, l) {
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v] }
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ]
}

// Relative Luminanz + Kontrastverhältnis nach WCAG — damit die Schrift auf dem
// Kasten garantiert lesbar ist.
function luminance([r, g, b]) {
  const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
function contrast(a, b) {
  const la = luminance(a), lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

export function pickAccentColor(imgEl) {
  const W = 160, H = 110
  const cv = document.createElement('canvas')
  cv.width = W; cv.height = H
  const ctx = cv.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(imgEl, 0, 0, W, H)
  const { data } = ctx.getImageData(0, 0, W, H)

  const buckets = new Map()
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue
    const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2])
    // Nahezu weiße/schwarze Pixel tragen keine Farbinformation.
    if (l > 0.93 || l < 0.07) continue
    const key = `${Math.round(h * 18)}|${Math.round(s * 5)}|${Math.round(l * 5)}`
    const cur = buckets.get(key) || { n: 0, h: 0, s: 0, l: 0 }
    cur.n++; cur.h += h; cur.s += s; cur.l += l
    buckets.set(key, cur)
  }
  if (buckets.size === 0) return { bg: [61, 56, 51], fg: [255, 255, 255] }

  let best = null, bestScore = -1
  for (const c of buckets.values()) {
    const h = c.h / c.n, s = c.s / c.n, l = c.l / c.n
    // Häufigkeit zählt, aber grelle Farben (s hoch) und Extremhelligkeiten
    // werden abgewertet — gesucht ist ein satter, ruhiger Ton.
    const garish = s > 0.65 ? (s - 0.65) * 2.5 : 0
    const extreme = Math.abs(l - 0.45) * 1.2
    const score = c.n * Math.max(0.05, 1 - garish - extreme)
    if (score > bestScore) { bestScore = score; best = { h, s, l } }
  }

  // Ton in einen druckfreundlichen Bereich ziehen: kräftig genug, um als Fläche
  // zu wirken, dunkel genug für weiße Schrift.
  let s = Math.min(best.s, 0.55)
  let l = Math.min(Math.max(best.l, 0.20), 0.42)
  let bg = hslToRgb(best.h, s, l)

  // Schriftfarbe: Weiß oder sehr dunkles Braun — je nach Kontrast.
  const white = [255, 255, 255]
  const dark = [28, 25, 23]
  let fg = contrast(bg, white) >= contrast(bg, dark) ? white : dark
  // Notfalls den Kasten nachdunkeln/aufhellen, bis WCAG-AA (4.5:1) sicher steht.
  let guard = 0
  while (contrast(bg, fg) < 4.5 && guard++ < 20) {
    l = fg === white ? Math.max(0.08, l - 0.03) : Math.min(0.92, l + 0.03)
    bg = hslToRgb(best.h, s, l)
  }
  return { bg, fg }
}

// ── Hilfen ──────────────────────────────────────────────────────────
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const im = new Image()
    im.crossOrigin = 'anonymous'   // Blob-CORS ist gesetzt (siehe infra/provision.sh)
    im.onload = () => resolve(im)
    im.onerror = () => reject(new Error('Bild konnte nicht geladen werden.'))
    im.src = src
  })
}

// Bild formatfüllend (cover) auf die Brutto-Seite rechnen: nie verzerren,
// Überstand wird beschnitten.
function coverFit(imgW, imgH, boxW, boxH) {
  const scale = Math.max(boxW / imgW, boxH / imgH)
  const w = imgW * scale, h = imgH * scale
  return { x: (boxW - w) / 2, y: (boxH - h) / 2, w, h }
}

// PNG/JPEG als DataURL (jsPDF braucht eine DataURL, kein <img>).
async function toDataUrl(src) {
  const r = await fetch(src)
  if (!r.ok) throw new Error(`Bild konnte nicht geladen werden (HTTP ${r.status}).`)
  const blob = await r.blob()
  return await new Promise((res, rej) => {
    const fr = new FileReader()
    fr.onload = () => res(fr.result)
    fr.onerror = () => rej(new Error('Bild konnte nicht gelesen werden.'))
    fr.readAsDataURL(blob)
  })
}

// ── Cover bauen ─────────────────────────────────────────────────────
// bgUrl    : URL des generierten Hintergrundbilds (Blob-SAS-URL)
// pages    : Seitenzahl des Druck-PDFs → bestimmt B
// title/subtitle : Buchtitel + Untertitel
export async function downloadCoverPdf(filename, { bgUrl, pages, title, subtitle, layout }) {
  const B = spineWidthMm(pages)
  const W = 2 * COVER.bleed + 2 * COVER.panelW + B   // 338 + B
  const H = COVER.height                              // 245

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [W, H] })
  const HF = layout?.heading?.pdf || 'times'
  const BF = layout?.body?.pdf || 'times'

  // 1) Hintergrund über die GESAMTE Brutto-Fläche (full bleed)
  const [bgData, bgImg] = await Promise.all([toDataUrl(bgUrl), loadImage(bgUrl)])
  const fit = coverFit(bgImg.naturalWidth, bgImg.naturalHeight, W, H)
  doc.addImage(bgData, 'PNG', fit.x, fit.y, fit.w, fit.h, undefined, 'FAST')

  // 2) Akzentfarbe aus dem Hintergrund ziehen
  const { bg, fg } = pickAccentColor(bgImg)

  // 3) Buchrücken einfärben: volle Höhe, beginnt bei 169 mm, Breite 2 + B
  doc.setFillColor(bg[0], bg[1], bg[2])
  doc.rect(COVER.spineStartX, 0, COVER.spineExtra + B, H, 'F')

  // 3a) Rücken-Logo (quadratisch, ohne Schriftzug): mittig im Band 169…169+B,
  //     Mitte 30 mm über der unteren Brutto-Kante.
  const spineMidX = COVER.spineStartX + B / 2
  const spineLogoW = Math.max(2, B - 2 * COVER.spineMargin)
  const spineLogoData = await toDataUrl('/cover-logo-spine.png')
  const spineLogoImg = await loadImage('/cover-logo-spine.png')
  const spineLogoH = spineLogoW * (spineLogoImg.naturalHeight / spineLogoImg.naturalWidth)
  const spineLogoCY = H - COVER.spineLogoFromBottom
  doc.addImage(spineLogoData, 'PNG', spineMidX - spineLogoW / 2, spineLogoCY - spineLogoH / 2,
    spineLogoW, spineLogoH, undefined, 'FAST')

  // 3b) Buchtitel um 90° gedreht im Rücken (liest sich von oben nach unten, wie
  //     im deutschen Buchhandel üblich). Die Schriftgröße wird so gewählt, dass
  //     die Zeile in die Rückenbreite B passt; passt der Titel der Länge nach
  //     nicht in den Rücken, wird er gekürzt.
  const spineTextTop = COVER.bleed + COVER.safety                       // 20
  const spineTextBottom = spineLogoCY - spineLogoH / 2 - 4              // 4 mm Luft über dem Logo
  const spineTextLen = spineTextBottom - spineTextTop
  if (spineTextLen > 12 && title) {
    const PT_TO_MM = 0.3528
    // Höhe einer Zeile ≈ 0,72 × Schriftgrad; sie muss in B minus Rand passen.
    const usableW = Math.max(1.5, B - 2 * COVER.spineMargin)
    const size = Math.max(6, Math.min(22, (usableW / PT_TO_MM) / 0.72))
    doc.setFont(HF, 'bold'); doc.setFontSize(size)
    doc.setTextColor(fg[0], fg[1], fg[2])
    let line = String(title)
    while (doc.getTextWidth(line) > spineTextLen && line.length > 4) {
      line = line.slice(0, -2)
    }
    if (line !== String(title)) line = line.trimEnd() + '…'
    // Bei angle:-90 läuft die Schrift nach UNTEN, die Glyphen stehen links der
    // Grundlinie → Grundlinie um die halbe Zeilenhöhe nach rechts versetzen.
    const capMm = size * PT_TO_MM * 0.72
    const baselineX = spineMidX + capMm / 2
    const startY = spineTextTop + (spineTextLen - doc.getTextWidth(line)) / 2
    doc.text(line, baselineX, startY, { angle: -90 })
  }

  // 4) Rückseite: farbiger Kasten (gleiche Farbe wie Titelkasten und Rücken) mit
  //    dem freigestellten Logo darauf. Unteres Drittel, Mitte bei x = 98 mm.
  //    Ist der Kasten dunkel, wird die helle Logo-Variante genommen — sonst
  //    verschwände der dunkelgraue Schriftzug „Lebenswerk" darin.
  const isDarkBox = fg[0] === 255
  const logoSrc = isDarkBox ? '/cover-logo-light.png' : '/cover-logo.png'
  const logoData = await toDataUrl(logoSrc)
  const logoImg = await loadImage(logoSrc)
  const lw = COVER.logoWidth
  const lh = lw * (logoImg.naturalHeight / logoImg.naturalWidth)
  const lx = COVER.logoCenterX - lw / 2
  // Unteres Drittel des Nutzbereichs, mit Abstand zum Sicherheitsrand.
  const netTop = COVER.bleed + COVER.safety
  const netBottom = COVER.bleed + COVER.netH - COVER.safety
  const ly = netTop + (netBottom - netTop) * 0.72 - lh / 2

  const logoPad = 5
  doc.setFillColor(bg[0], bg[1], bg[2])
  doc.rect(lx - logoPad, ly - logoPad, lw + 2 * logoPad, lh + 2 * logoPad, 'F')
  doc.addImage(logoData, 'PNG', lx, ly, lw, lh, undefined, 'FAST')

  // 5) Titelkasten auf der Vorderseite
  const textX = COVER.textStartX + B
  const textMaxX = COVER.textEndX + B
  const textW = textMaxX - textX          // 50 mm
  const padX = 5, padY = 5

  doc.setFont(HF, 'bold'); doc.setFontSize(26)
  const titleLines = doc.splitTextToSize(String(title || ''), textW)
  doc.setFont(BF, 'italic'); doc.setFontSize(13)
  const subLines = subtitle ? doc.splitTextToSize(String(subtitle), textW) : []

  const titleLH = 10, subLH = 6
  const blockH = titleLines.length * titleLH + (subLines.length ? 4 + subLines.length * subLH : 0)
  const boxH = blockH + 2 * padY
  const boxW = textW + 2 * padX

  // Vertikal im oberen Drittel: dort verdeckt der Kasten die Bildmitte nicht,
  // in der die Bild-KI ihre Hauptmotive platziert (siehe SPREAD_DIRECTIVE).
  const boxY = netTop + (netBottom - netTop) * 0.16
  doc.setFillColor(bg[0], bg[1], bg[2])
  doc.rect(textX - padX, boxY, boxW, boxH, 'F')

  doc.setTextColor(fg[0], fg[1], fg[2])
  let ty = boxY + padY + titleLH * 0.72
  doc.setFont(HF, 'bold'); doc.setFontSize(26)
  for (const ln of titleLines) { doc.text(ln, textX, ty); ty += titleLH }
  if (subLines.length) {
    ty += 4
    doc.setFont(BF, 'italic'); doc.setFontSize(13)
    for (const ln of subLines) { doc.text(ln, textX, ty); ty += subLH }
  }

  doc.save(filename)
  return { spineMm: B, widthMm: W, heightMm: H }
}
