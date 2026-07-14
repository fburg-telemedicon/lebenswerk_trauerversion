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
  logoFromBottom: 30, // UNTERKANTE des Rückseiten-Logos über der unteren Brutto-Kante
  spineExtra: 2,      // Buchrücken-Farbfläche ist 2 mm breiter als B (Wickel-Toleranz)
  spineLogoFromBottom: 30, // Mitte des Rücken-Logos, gemessen von der unteren Brutto-Kante
  textStartX: 182,    // Titelkasten: linke Textkante (+ B)
  textEndX: 318,      // Titelkasten: spätestens hier umbrechen (+ B)
}

// ── Rückenstärke B nach Seitenzahl ──────────────────────────────────
// Gedruckt werden nur Bücher mit einer durch 4 teilbaren Seitenzahl (Druckbogen);
// downloadPrintPdf füllt dafür am Schluss mit Leerseiten auf. Die Tabelle deckt
// damit LÜCKENLOS jede druckbare Seitenzahl ab: die scheinbaren Lücken (65, 66,
// 67 …) sind keine gültigen Seitenzahlen und können nie auftreten.
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

export const MIN_PAGES = 48
export const MAX_PAGES = 400

export function spineWidthMm(pages) {
  const p = Number(pages)
  if (!Number.isFinite(p) || p <= 0) throw new Error('Seitenzahl unbekannt — bitte zuerst das Druck-PDF erzeugen.')
  if (p % 4 !== 0) {
    // Kann bei einem aus downloadPrintPdf stammenden Wert nicht passieren – wenn
    // doch, ist das Buch nicht druckbar und die Rückenstärke waere geraten.
    throw new Error(`Das Buch hat ${p} Seiten. Druckbar sind nur Seitenzahlen, die durch 4 teilbar sind.`)
  }
  if (p < MIN_PAGES) {
    throw new Error(`Das Buch hat nur ${p} Seiten. Gedruckt werden können erst Bücher ab ${MIN_PAGES} Seiten — bitte den Umfang erhöhen.`)
  }
  if (p > MAX_PAGES) {
    throw new Error(`Das Buch hat ${p} Seiten. Für Bücher über ${MAX_PAGES} Seiten gibt es keine Rückenstärke — bitte den Umfang reduzieren.`)
  }
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

// Das Hintergrundbild GENAU so, wie es auf dem Cover erscheint (cover-fit auf die
// Bruttofläche), in ein Canvas rendern. Damit stimmen Farbanalyse und
// Motiv-Analyse mit dem überein, was am Ende gedruckt wird — und mm lassen sich
// direkt in Pixel umrechnen.
export function renderCoverCanvas(imgEl, wMm, hMm, pxPerMm = 2) {
  const cw = Math.round(wMm * pxPerMm)
  const chh = Math.round(hMm * pxPerMm)
  const cv = document.createElement('canvas')
  cv.width = cw; cv.height = chh
  const ctx = cv.getContext('2d', { willReadFrequently: true })
  const s = Math.max(cw / imgEl.naturalWidth, chh / imgEl.naturalHeight)
  const w = imgEl.naturalWidth * s, h = imgEl.naturalHeight * s
  ctx.drawImage(imgEl, (cw - w) / 2, (chh - h) / 2, w, h)
  return { ctx, pxPerMm, wPx: cw, hPx: chh }
}

// Ruhigstes horizontales Band in einem Ausschnitt finden: Der Kasten soll dort
// liegen, wo im Bild am wenigsten „los ist" (wenig Detail/Kontrast) — also keine
// Gesichter, Kanten oder Motive verdeckt werden.
//
// bottomBias (0…1) bevorzugt zusätzlich eine tiefe Lage: unten ist der typografische
// Normalfall fürs Cover. Ein höher liegendes Band gewinnt nur, wenn es SPÜRBAR
// ruhiger ist — der Zuschlag entspricht `bottomBias × mittlere Detailstärke`.
export function quietestBandY(canvas, { xMm, widthMm, topMm, bottomMm, boxHMm, stepMm = 2, bottomBias = 0.55 }) {
  const { ctx, pxPerMm } = canvas
  const x0 = Math.round(xMm * pxPerMm)
  const w = Math.round(widthMm * pxPerMm)
  const boxH = Math.round(boxHMm * pxPerMm)
  const yTop = Math.round(topMm * pxPerMm)
  const yBot = Math.round(bottomMm * pxPerMm)
  if (w <= 0 || boxH <= 0 || yBot - yTop <= boxH) return topMm

  const img = ctx.getImageData(x0, yTop, w, yBot - yTop)
  const d = img.data
  const rows = yBot - yTop
  // Pro Bildzeile: mittlere Detailstärke (horizontaler Helligkeitsgradient).
  const energy = new Float64Array(rows)
  for (let y = 0; y < rows; y++) {
    let sum = 0
    for (let x = 1; x < w; x++) {
      const i = (y * w + x) * 4, j = (y * w + x - 1) * 4
      const l1 = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
      const l0 = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2]
      sum += Math.abs(l1 - l0)
    }
    energy[y] = sum / Math.max(1, w - 1)
  }
  // Gleitendes Fenster in Kastenhöhe → das ruhigste Fenster gewinnt, mit
  // Zuschlag für Fenster, die weiter oben liegen (siehe bottomBias).
  let mean = 0
  for (let y = 0; y < rows; y++) mean += energy[y]
  mean /= Math.max(1, rows)

  // „+1" ist ein Sockel: ohne ihn wäre der Zuschlag bei einem gleichmäßig ruhigen
  // Bild (mittlere Detailstärke ≈ 0) ebenfalls 0 — die Priorität für unten würde
  // verschwinden und der Kasten landete willkürlich ganz oben.
  const biasScale = bottomBias * (mean + 1)

  const step = Math.max(1, Math.round(stepMm * pxPerMm))
  const lastY = rows - boxH
  let best = lastY, bestScore = Infinity
  for (let y = 0; y <= lastY; y += step) {
    let s = 0
    for (let k = y; k < y + boxH; k++) s += energy[k]
    s /= boxH
    const height = lastY > 0 ? 1 - y / lastY : 0   // 1 = ganz oben, 0 = ganz unten
    const score = s + biasScale * height
    if (score < bestScore) { bestScore = score; best = y }
  }
  return topMm + best / pxPerMm
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
  if (buckets.size === 0) return { bg: [24, 22, 20], fg: [255, 255, 255] }

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

  // Der Kasten bleibt im Farbton des Bildes, wird aber bewusst in ein Extrem
  // gezogen: entweder SEHR hell (schwarze Schrift) oder SEHR dunkel (weiße
  // Schrift). Ein mittelhelles Feld ergäbe zwar formal 4.5:1, wirkt gedruckt
  // aber flau — der Titel soll auf den ersten Blick lesbar sein.
  const light = best.l >= 0.5
  const white = [255, 255, 255]
  const black = [0, 0, 0]
  const fg = light ? black : white
  // Bei einer sehr hellen Fläche muss die Sättigung stark runter, sonst wird der
  // Ton nicht hell, sondern nur pastellig-bunt.
  let s = light ? Math.min(best.s, 0.14) : Math.min(best.s, 0.40)
  let l = light ? 0.94 : 0.10
  let bg = hslToRgb(best.h, s, l)

  // Deutlich über WCAG-AA: erst ab ~12:1 wirkt der Titel wirklich plakativ.
  let guard = 0
  while (contrast(bg, fg) < 12 && guard++ < 30) {
    l = light ? Math.min(0.99, l + 0.02) : Math.max(0.02, l - 0.02)
    s = Math.max(0, s - 0.02)
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


// ── Cover: Vorbereiten → Zeichnen → Speichern ───────────────────────
//
// Vorschau und PDF müssen ZWINGEND dieselbe Geometrie und denselben Zeilenumbruch
// zeigen — sonst wählt der Admin eine Variante und bekommt eine andere. Deshalb
// wird alles EINMAL in prepareCover() gerechnet (inkl. Umbruch über jsPDF, das
// bricht anders um als Canvas) und danach nur noch stumpf gezeichnet: einmal auf
// die PDF-Seite, einmal auf ein Canvas für die Vorschau.

export const BOX_POSITIONS = [
  { key: 'auto',   label: 'Automatisch', hint: 'ruhigste Stelle im Bild' },
  { key: 'top',    label: 'Oben',        hint: '' },
  { key: 'middle', label: 'Mitte',       hint: '' },
  { key: 'bottom', label: 'Unten',       hint: '' },
]

const TITLE_SIZE = 26, SUB_SIZE = 13, TITLE_LH = 10, SUB_LH = 6, BOX_PAD_Y = 7
const PT_TO_MM = 0.3528
const ASC = 0.75, DESC = 0.25   // Ober-/Unterlänge der Standardfonts, in em

// Alles, was Vorschau und PDF gemeinsam brauchen. Lädt die Bilder, rechnet Farben,
// Geometrie und Textumbruch — einmal.
export async function prepareCover({ bgUrl, pages, title, subtitle, layout }) {
  const B = spineWidthMm(pages)
  const W = 2 * COVER.bleed + 2 * COVER.panelW + B   // 338 + B
  const H = COVER.height                              // 245
  const HF = layout?.heading?.pdf || 'times'
  const BF = layout?.body?.pdf || 'times'

  const [bgData, bgImg, logoData, logoImg, spineData, spineImg] = await Promise.all([
    toDataUrl(bgUrl), loadImage(bgUrl),
    toDataUrl('/cover-logo.png'), loadImage('/cover-logo.png'),
    toDataUrl('/cover-logo-spine.png'), loadImage('/cover-logo-spine.png'),
  ])

  const { bg, fg } = pickAccentColor(bgImg)
  const analysis = renderCoverCanvas(bgImg, W, H)

  // Buchrücken: exakt mittig, B + 2 mm breit → beginnt immer bei 168.
  const spineMidX = W / 2
  const spineBandW = B + COVER.spineExtra
  const spineBandX = spineMidX - spineBandW / 2
  const frontX = spineBandX + spineBandW

  // Rückseiten-Logo (quadratisch), Unterkante 30 mm über der Brutto-Kante.
  const lw = COVER.logoWidth
  const lh = lw * (logoImg.naturalHeight / logoImg.naturalWidth)
  const lx = COVER.logoCenterX - lw / 2
  const ly = H - COVER.logoFromBottom - lh

  const netTop = COVER.bleed + COVER.safety
  const netBottom = COVER.bleed + COVER.netH - COVER.safety

  // Rücken-Logo + gedrehter Titel
  const spineLogoW = B
  const spineLogoH = spineLogoW * (spineImg.naturalHeight / spineImg.naturalWidth)
  const spineLogoCY = H - COVER.spineLogoFromBottom
  const spineTextTop = netTop
  const spineTextBottom = spineLogoCY - spineLogoH / 2 - 4
  const spineTextLen = spineTextBottom - spineTextTop

  // Textumbruch + Schriftgrade über eine jsPDF-Instanz messen (identisch zum PDF).
  const m = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [W, H] })
  const textX = COVER.textStartX + B
  const textW = (COVER.textEndX + B) - textX
  m.setFont(HF, 'bold'); m.setFontSize(TITLE_SIZE)
  const titleLines = m.splitTextToSize(String(title || ''), textW)
  m.setFont(BF, 'italic'); m.setFontSize(SUB_SIZE)
  const subLines = subtitle ? m.splitTextToSize(String(subtitle), textW) : []
  const blockH = titleLines.length * TITLE_LH + (subLines.length ? 4 + subLines.length * SUB_LH : 0)
  const boxH = blockH + 2 * BOX_PAD_Y

  // Rückentitel: größter Grad, der in die Rückenbreite B passt, dann so weit
  // verkleinern, bis der Titel der LÄNGE nach hineinpasst (nie kürzen).
  let spineSize = B / PT_TO_MM / (ASC + DESC)
  let spineLine = String(title || '')
  m.setFont(HF, 'bold'); m.setFontSize(spineSize)
  while (spineLine && m.getTextWidth(spineLine) > spineTextLen && spineSize > 3) {
    spineSize -= 0.25
    m.setFontSize(spineSize)
  }
  const spineTextW = spineLine ? m.getTextWidth(spineLine) : 0

  // Die vier Lagen des Titelkastens. „auto" = ruhigstes Band (siehe quietestBandY).
  const bandTop = netTop
  const bandBottom = Math.min(netBottom, ly - 6)     // 6 mm Luft über dem Logo-Streifen
  const clamp = y => Math.max(bandTop, Math.min(bandBottom - boxH, y))
  const boxYByPos = {
    top: clamp(bandTop),
    middle: clamp((bandTop + bandBottom) / 2 - boxH / 2),
    bottom: clamp(bandBottom - boxH),
    auto: clamp(quietestBandY(analysis, {
      xMm: frontX, widthMm: W - frontX, topMm: bandTop, bottomMm: bandBottom, boxHMm: boxH,
    })),
  }

  return {
    B, W, H, HF, BF, bg, fg,
    images: { bgData, bgImg, logoData, logoImg, spineData, spineImg },
    spineMidX, spineBandX, spineBandW, frontX,
    lx, ly, lw, lh,
    spineLogoW, spineLogoH, spineLogoCY,
    spineLine, spineSize, spineTextW, spineTextBottom, spineTextLen,
    textX, textW, titleLines, subLines, boxH,
    boxYByPos,
  }
}

// ── Zeichnen: PDF ───────────────────────────────────────────────────
function drawCoverPdf(doc, p, boxY) {
  const { W, H, bg, fg, HF, BF, images } = p

  // 1) Hintergrund full-bleed
  const fit = coverFit(images.bgImg.naturalWidth, images.bgImg.naturalHeight, W, H)
  doc.addImage(images.bgData, 'PNG', fit.x, fit.y, fit.w, fit.h, undefined, 'FAST')

  // 2) Buchrücken
  doc.setFillColor(bg[0], bg[1], bg[2])
  doc.rect(p.spineBandX, 0, p.spineBandW, H, 'F')
  doc.addImage(images.spineData, 'PNG', p.spineMidX - p.spineLogoW / 2,
    p.spineLogoCY - p.spineLogoH / 2, p.spineLogoW, p.spineLogoH, undefined, 'FAST')

  // 3) Rückentitel, 90° gedreht, von unten nach oben.
  //    Bei angle:90 zeigen die Oberlängen nach links, die Unterlängen nach rechts
  //    der Grundlinie → Grundlinie um (ASC−DESC)/2 versetzen, damit die Zeile
  //    mittig im Rücken sitzt.
  if (p.spineLine && p.spineTextLen > 12) {
    doc.setFont(HF, 'bold'); doc.setFontSize(p.spineSize)
    doc.setTextColor(fg[0], fg[1], fg[2])
    const emMm = p.spineSize * PT_TO_MM
    const baselineX = p.spineMidX + (ASC - DESC) / 2 * emMm
    const startY = p.spineTextBottom - (p.spineTextLen - p.spineTextW) / 2
    doc.text(p.spineLine, baselineX, startY, { angle: 90 })
  }

  // 4) Rückseite: Streifen exakt auf Logohöhe + Logo
  doc.setFillColor(bg[0], bg[1], bg[2])
  doc.rect(0, p.ly, p.spineBandX, p.lh, 'F')
  doc.addImage(images.logoData, 'PNG', p.lx, p.ly, p.lw, p.lh, undefined, 'FAST')

  // 5) Vorderseite: Titelstreifen + Text
  doc.setFillColor(bg[0], bg[1], bg[2])
  doc.rect(p.frontX, boxY, W - p.frontX, p.boxH, 'F')
  doc.setTextColor(fg[0], fg[1], fg[2])
  let ty = boxY + BOX_PAD_Y + TITLE_LH * 0.72
  doc.setFont(HF, 'bold'); doc.setFontSize(TITLE_SIZE)
  for (const ln of p.titleLines) { doc.text(ln, p.textX, ty); ty += TITLE_LH }
  if (p.subLines.length) {
    ty += 4
    doc.setFont(BF, 'italic'); doc.setFontSize(SUB_SIZE)
    for (const ln of p.subLines) { doc.text(ln, p.textX, ty); ty += SUB_LH }
  }
}

// ── Zeichnen: Vorschau auf ein Canvas ───────────────────────────────
// Dieselbe Geometrie, nur skaliert. Der Zeilenumbruch kommt aus prepareCover,
// wird hier also NICHT neu berechnet — die Vorschau zeigt exakt das PDF.
export function drawCoverPreview(canvasEl, p, boxYKey) {
  const boxY = p.boxYByPos[boxYKey] ?? p.boxYByPos.auto
  const s = canvasEl.width / p.W                     // px pro mm
  const ctx = canvasEl.getContext('2d')
  const { bg, fg, images } = p
  const rgb = c => `rgb(${c[0]},${c[1]},${c[2]})`
  const cssFont = (which, style) => {
    const fam = (which === 'H' ? p.HF : p.BF) === 'helvetica' ? 'Helvetica, Arial, sans-serif' : 'Georgia, "Times New Roman", serif'
    return { fam, style }
  }

  ctx.clearRect(0, 0, canvasEl.width, canvasEl.height)

  // Hintergrund
  const fit = coverFit(images.bgImg.naturalWidth, images.bgImg.naturalHeight, p.W, p.H)
  ctx.drawImage(images.bgImg, fit.x * s, fit.y * s, fit.w * s, fit.h * s)

  ctx.fillStyle = rgb(bg)
  ctx.fillRect(p.spineBandX * s, 0, p.spineBandW * s, p.H * s)                 // Rücken
  ctx.fillRect(0, p.ly * s, p.spineBandX * s, p.lh * s)                        // Streifen links
  ctx.fillRect(p.frontX * s, boxY * s, (p.W - p.frontX) * s, p.boxH * s)       // Titelstreifen

  ctx.drawImage(images.spineImg, (p.spineMidX - p.spineLogoW / 2) * s,
    (p.spineLogoCY - p.spineLogoH / 2) * s, p.spineLogoW * s, p.spineLogoH * s)
  ctx.drawImage(images.logoImg, p.lx * s, p.ly * s, p.lw * s, p.lh * s)

  // Rückentitel (gedreht)
  if (p.spineLine && p.spineTextLen > 12) {
    const f = cssFont('H', 'bold')
    ctx.save()
    ctx.fillStyle = rgb(fg)
    ctx.font = `bold ${p.spineSize * PT_TO_MM * s}px ${f.fam}`
    const emMm = p.spineSize * PT_TO_MM
    const baselineX = (p.spineMidX + (ASC - DESC) / 2 * emMm) * s
    const startY = (p.spineTextBottom - (p.spineTextLen - p.spineTextW) / 2) * s
    ctx.translate(baselineX, startY)
    ctx.rotate(-Math.PI / 2)
    ctx.fillText(p.spineLine, 0, 0)
    ctx.restore()
  }

  // Titel + Untertitel
  ctx.fillStyle = rgb(fg)
  let ty = boxY + BOX_PAD_Y + TITLE_LH * 0.72
  const fh = cssFont('H', 'bold')
  ctx.font = `bold ${TITLE_SIZE * PT_TO_MM * s}px ${fh.fam}`
  for (const ln of p.titleLines) { ctx.fillText(ln, p.textX * s, ty * s); ty += TITLE_LH }
  if (p.subLines.length) {
    ty += 4
    const fb = cssFont('B', 'italic')
    ctx.font = `italic ${SUB_SIZE * PT_TO_MM * s}px ${fb.fam}`
    for (const ln of p.subLines) { ctx.fillText(ln, p.textX * s, ty * s); ty += SUB_LH }
  }
}

// ── Speichern ───────────────────────────────────────────────────────
export function downloadCoverPdf(filename, p, boxYKey) {
  const boxY = p.boxYByPos[boxYKey] ?? p.boxYByPos.auto
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [p.W, p.H] })
  drawCoverPdf(doc, p, boxY)
  doc.save(filename)
  return { spineMm: p.B, widthMm: p.W, heightMm: p.H }
}
