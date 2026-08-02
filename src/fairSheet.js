// src/fairSheet.js
// Druckbogen für MESSE-KARTEN: DIN A4, frei einstellbares Raster (Spalten ×
// Zeilen), je Zelle eine Karte mit QR-Code, Klartext-Code, Logo, URL und
// Support-Adresse.
//
// Das Raster ist einstellbar, weil vorgestanzte Bögen gekauft werden — und deren
// Aufteilung gibt der Hersteller vor, nicht wir. Deshalb sind Spalten, Zeilen,
// Seitenrand und Zellabstand Parameter und keine Konstanten. Die Karte skaliert
// mit der Zellgröße: QR und Schriftgrade werden aus der Zellhöhe abgeleitet,
// damit 2×4 (große Postkarten) genauso funktioniert wie 4×10 (Visitenkarten).
//
// Schnittmarken sind abschaltbar: Auf vorgestanztem Papier stören sie, auf
// weißem Papier braucht man sie.

import { jsPDF } from 'jspdf'
import { qrCodeDataUrl } from './shared.js'

const PW = 210, PH = 297

export const SHEET_DEFAULTS = {
  cols: 2,
  rows: 5,
  marginX: 10,      // Seitenrand links/rechts in mm
  marginY: 12,      // Seitenrand oben/unten in mm
  gutterX: 0,       // Abstand zwischen den Spalten
  gutterY: 0,       // Abstand zwischen den Zeilen
  cutMarks: true,
}

// Ein Feld auf mehrere Zeilen umbrechen und mittig setzen; gibt die verbrauchte
// Höhe zurück. Läuft der Text über, wird er gekürzt statt aus der Karte zu ragen.
function centeredText(doc, str, cx, y, maxW, size, color, style = 'normal', maxLines = 1) {
  doc.setFont('helvetica', style); doc.setFontSize(size); doc.setTextColor(...color)
  const lines = doc.splitTextToSize(String(str ?? ''), maxW).slice(0, maxLines)
  const lh = size * 0.3528 * 1.2
  lines.forEach((ln, i) => doc.text(ln, cx, y + i * lh, { align: 'center' }))
  return lines.length * lh
}

// Eine Karte in ihre Zelle zeichnen.
function drawCard(doc, { x, y, w, h }, card, opts) {
  const cx = x + w / 2
  const pad = Math.min(4, h * 0.06)
  const inner = w - 2 * pad

  // Schriftgrade aus der Zellhöhe ableiten, damit große und kleine Raster
  // gleichermaßen lesbar bleiben.
  const sTitle = Math.max(7.5, Math.min(11, h * 0.075))
  const sCode  = Math.max(8, Math.min(13, h * 0.085))
  const sSmall = Math.max(5.5, Math.min(7.5, h * 0.05))

  let cursor = y + pad

  // Logo oben (optional): in das Rechteck (maxW × maxH) einpassen, Seiten-
  // verhältnis erhalten, mittig setzen.
  if (opts.logo?.dataUrl && opts.logo.w > 0 && opts.logo.h > 0) {
    const maxH = Math.min(h * 0.14, 9)
    const maxW = inner * 0.6
    const scale = Math.min(maxW / opts.logo.w, maxH / opts.logo.h)
    const lw = opts.logo.w * scale
    const lh = opts.logo.h * scale
    try { doc.addImage(opts.logo.dataUrl, opts.logo.kind || 'PNG', cx - lw / 2, cursor, lw, lh) } catch {}
    cursor += lh + 1.5
  }

  // Werbezeile
  if (opts.headline) cursor += centeredText(doc, opts.headline, cx, cursor + sTitle * 0.35, inner, sTitle, [25, 25, 25], 'bold', 2) + 1
  if (opts.subline)  cursor += centeredText(doc, opts.subline, cx, cursor + sSmall * 0.35, inner, sSmall, [110, 110, 110], 'normal', 2) + 1

  // Platz, den der Fuß (Code + URL + Support + Hinweis) braucht.
  const footLines = 3 + (opts.keepNote ? 1 : 0)
  const footH = sCode * 0.3528 * 1.35 + footLines * (sSmall * 0.3528 * 1.35) + 2
  const qrTop = cursor + 1
  const qrMax = Math.max(8, (y + h - pad - footH) - qrTop)
  const qrSize = Math.min(qrMax, inner * 0.62)

  if (card.qr && qrSize > 6) {
    try { doc.addImage(card.qr, 'PNG', cx - qrSize / 2, qrTop, qrSize, qrSize) } catch {}
  }

  // Fuß: Code groß, darunter die Kleingedruckten.
  let fy = qrTop + Math.max(qrSize, 0) + sCode * 0.3528 * 1.05
  fy += centeredText(doc, card.display || card.code, cx, fy, inner, sCode, [15, 15, 15], 'bold')
  if (opts.keepNote) fy += centeredText(doc, opts.keepNote, cx, fy + 0.4, inner, sSmall, [130, 130, 130], 'italic', 1)
  fy += centeredText(doc, opts.url, cx, fy + 0.4, inner, sSmall, [60, 60, 60], 'normal')
  centeredText(doc, opts.supportEmail, cx, fy + 0.4, inner, sSmall, [130, 130, 130], 'normal')
}

// Schnittmarken: kurze Striche AUSSERHALB der Zelle, damit sie beim Schneiden
// verschwinden und nicht auf der Karte landen.
function cutMarks(doc, cells) {
  doc.setDrawColor(190); doc.setLineWidth(0.15)
  const m = 2.5
  for (const c of cells) {
    doc.line(c.x, c.y - m, c.x, c.y)                       // oben links, senkrecht
    doc.line(c.x - m, c.y, c.x, c.y)                       // oben links, waagerecht
    doc.line(c.x + c.w, c.y - m, c.x + c.w, c.y)
    doc.line(c.x + c.w, c.y, c.x + c.w + m, c.y)
    doc.line(c.x, c.y + c.h, c.x, c.y + c.h + m)
    doc.line(c.x - m, c.y + c.h, c.x, c.y + c.h)
    doc.line(c.x + c.w, c.y + c.h, c.x + c.w, c.y + c.h + m)
    doc.line(c.x + c.w, c.y + c.h, c.x + c.w + m, c.y + c.h)
  }
}

// codes: [{ code, display }] — QR-Codes werden hier erzeugt (Browser, kein
// fremder Dienst; siehe qrCodeDataUrl in shared.js).
export async function buildFairSheetPdf(codes, opts = {}) {
  const o = { ...SHEET_DEFAULTS, ...opts }
  const cols = Math.max(1, Math.min(parseInt(o.cols, 10) || 1, 8))
  const rows = Math.max(1, Math.min(parseInt(o.rows, 10) || 1, 12))
  const perPage = cols * rows

  const cellW = (PW - 2 * o.marginX - (cols - 1) * o.gutterX) / cols
  const cellH = (PH - 2 * o.marginY - (rows - 1) * o.gutterY) / rows

  const baseUrl = (o.baseUrl || 'https://lebensgeschichten.ai').replace(/\/+$/, '')
  const cardOpts = {
    logo: o.logo || null,
    headline: o.headline ?? 'Erzählen Sie Ihr Leben.',
    subline: o.subline ?? 'Scannen und sofort loslegen — ohne Anmeldung.',
    keepNote: o.keepNote ?? 'Bitte aufbewahren: Diese Karte ist Ihr Zugang.',
    url: o.urlLabel || baseUrl.replace(/^https?:\/\//, ''),
    supportEmail: o.supportEmail || 'support@lebensgeschichten.ai',
  }

  // QR-Größe an der Zelle ausrichten (Pixel), damit er scharf bleibt.
  const qrPx = Math.max(240, Math.round(cellW * 12))
  const withQr = []
  for (const c of codes) {
    const url = `${baseUrl}/?messe=${encodeURIComponent(c.code)}`
    let qr = null
    try { qr = await qrCodeDataUrl(url, qrPx) } catch {}
    withQr.push({ ...c, qr })
  }

  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  for (let i = 0; i < withQr.length; i++) {
    const posOnPage = i % perPage
    if (i > 0 && posOnPage === 0) doc.addPage()
    if (posOnPage === 0 && o.cutMarks) {
      const cells = []
      for (let k = 0; k < perPage && i + k < withQr.length; k++) {
        cells.push({
          x: o.marginX + (k % cols) * (cellW + o.gutterX),
          y: o.marginY + Math.floor(k / cols) * (cellH + o.gutterY),
          w: cellW, h: cellH,
        })
      }
      cutMarks(doc, cells)
    }
    const cell = {
      x: o.marginX + (posOnPage % cols) * (cellW + o.gutterX),
      y: o.marginY + Math.floor(posOnPage / cols) * (cellH + o.gutterY),
      w: cellW, h: cellH,
    }
    drawCard(doc, cell, withQr[i], cardOpts)
  }
  return { doc, pages: doc.getNumberOfPages(), perPage, cellW, cellH }
}

export async function downloadFairSheetPdf(filename, codes, opts = {}) {
  const { doc, pages } = await buildFairSheetPdf(codes, opts)
  doc.save(filename)
  return pages
}
