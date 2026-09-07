// src/pdfPages.js
// PDF → Seitenbilder, im Browser.
//
// WOZU: Der Upload-Pfad des Produkts nimmt Bilder an — er dreht nach EXIF,
// skaliert auf eine Kantenlänge, macht ein JPEG und ein Thumbnail. Ein PDF ist
// keine Datei mit einer Kantenlänge, sondern ein Dokument mit n Seiten; sharp
// im Container kann es ohnehin nicht lesen. Ein Zeugnis kommt aber oft genau so
// an: als PDF vom früheren Arbeitgeber.
//
// Deshalb wird das PDF hier, im Browser, in Seitenbilder zerlegt — jede Seite
// wird ein ganz normaler Bild-Upload. Alles dahinter bleibt unverändert:
// Speicherung, Auslesung, Signierung, Löschung, Aufbewahrungsfrist. Der
// Container bekommt kein zusätzliches Binärwerkzeug.
//
// pdf.js wird ERST BEIM BEDARF geladen (dynamischer Import, ~1 MB). Wer nur
// Fotos hochlädt, lädt es nie.

// Auflösung: 150 dpi entspricht ungefähr Faktor 2,08 gegenüber der PDF-Einheit
// (72 dpi). Das reicht für die Texterkennung eines Zeugnisses bequem und hält
// die Seite bei rund 1240 × 1750 Punkten — in derselben Größenordnung wie ein
// Handyfoto, das der Upload ohnehin verarbeitet.
const SCALE = 2.08
const MAX_EDGE = 2400
const QUALITY = 0.85
export const MAX_PDF_PAGES = 20

export function isPdf(file) {
  if (!file) return false
  return String(file.type || '') === 'application/pdf' || /\.pdf$/i.test(file.name || '')
}

let pdfjs = null
async function loadPdfjs() {
  if (pdfjs) return pdfjs
  const lib = await import('pdfjs-dist')
  // Der Worker liegt als eigene Datei im Paket; Vite löst die URL beim Bauen
  // auf und legt sie mit ins Ausgabeverzeichnis.
  lib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href
  pdfjs = lib
  return lib
}

// Gibt ein Array von JPEG-Data-URLs zurück — eine je Seite.
// `onProgress(seite, gesamt)` ist optional; ein mehrseitiges Zeugnis braucht
// spürbar Zeit, und ohne Rückmeldung wirkt die Seite eingefroren.
export async function pdfToPageImages(file, { onProgress, maxPages = MAX_PDF_PAGES } = {}) {
  const lib = await loadPdfjs()
  const buf = await file.arrayBuffer()
  let doc
  try {
    doc = await lib.getDocument({ data: buf, isEvalSupported: false, useSystemFonts: true }).promise
  } catch {
    throw new Error('Diese PDF-Datei konnte nicht gelesen werden. Ist sie mit einem Passwort geschützt?')
  }
  const totalPages = doc.numPages
  const total = Math.min(totalPages, maxPages)
  if (!total) throw new Error('Die PDF-Datei enthält keine Seiten.')

  const pages = []
  for (let i = 1; i <= total; i++) {
    onProgress?.(i, total)
    const page = await doc.getPage(i)
    let viewport = page.getViewport({ scale: SCALE })
    // Sehr große Seiten (A3-Pläne, Poster) auf dieselbe Obergrenze bringen, die
    // auch für Fotos gilt — sonst wird der Upload unnötig schwer.
    const longEdge = Math.max(viewport.width, viewport.height)
    if (longEdge > MAX_EDGE) viewport = page.getViewport({ scale: SCALE * (MAX_EDGE / longEdge) })

    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const ctx = canvas.getContext('2d')
    // Weißer Grund: PDF-Seiten sind transparent, ein JPEG kennt keine
    // Transparenz — ohne Füllung wird die Seite schwarz.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    // `canvas` ist der empfohlene Weg (seit pdf.js 5), `canvasContext` der alte.
    // Beide mitzugeben kostet nichts und ueberlebt den naechsten Versionssprung.
    await page.render({ canvas, canvasContext: ctx, viewport, background: '#ffffff' }).promise
    pages.push(canvas.toDataURL('image/jpeg', QUALITY))
    page.cleanup()
  }
  // Seitenzahl VOR dem Aufraeumen merken — danach ist das Dokument zu.
  try { await doc.destroy() } catch { /* egal */ }
  return { pages, truncated: totalPages > total, totalPages }
}
