// src/bookExport.js
// Aus App.jsx ausgelagerte, ZUSTANDSLOSE Export-/Download-Helfer (TXT/DOCX/PDF).
// Reine Modul-Funktionen ohne React-State/Hooks - 1:1 aus App.jsx verschoben.

import { Document, Packer, Paragraph, HeadingLevel, AlignmentType, ImageRun, TextRun, Footer, PageNumber, SectionType } from 'docx'
import jsPDF from 'jspdf'
import { getCategory } from './categories.js'
import { getBookLayout } from './bookLayouts.js'
import { uiText } from './i18n.js'

// Disclaimer zur Entstehung & Haftung – wird ans Ende jedes Buchs/jeder Rede
// gesetzt (HTML-Ansicht + DOCX) und im Impressum/Datenschutz referenziert.
export const BOOK_DISCLAIMER_TITLE = 'Hinweis zur Entstehung dieses Buches'
export const BOOK_DISCLAIMER =
  'Dieses Buch wurde auf Grundlage von Interviews mit nahestehenden Personen mithilfe von künstlicher Intelligenz erstellt. Es gibt persönliche Erinnerungen und Schilderungen der Beitragenden wieder. Ihre inhaltliche Richtigkeit, Vollständigkeit und Aktualität können wir nicht überprüfen; eine Haftung hierfür ist – soweit gesetzlich zulässig – ausgeschlossen.'

export function formatContribution(memorial, c) {
  const noun = getCategory(memorial?.product_category).nounBook
  const loc = uiText(memorial?.languages?.[0] || 'de').locale
  const lines = [
    `${noun.toUpperCase()}: ${memorial.name}`,
    `Organisator: ${memorial.organizer}`,
    '',
    `Beitrag von: ${c.contributor_name}`,
    `Beziehung:   ${c.relationship}`,
    `Datum:       ${new Date(c.created_at).toLocaleDateString(loc)}`,
    '',
    '─'.repeat(50),
    '',
  ]
  for (let i = 0; i < c.messages.length; i++) {
    const m = c.messages[i]
    if (m.role === 'assistant') {
      lines.push(`Frage:   ${m.content}`)
    } else {
      lines.push(`Antwort: ${m.content}`, '')
    }
  }
  return lines.join('\n')
}

export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

export function downloadFile(filename, content) {
  downloadBlob(filename, new Blob([content], { type: 'text/plain;charset=utf-8' }))
}

export function safeName(s) { return s.replace(/[^a-zA-Z0-9äöüÄÖÜß\s-]/g, '').trim().replace(/\s+/g, '_') }

// Wandelt den messages-Array eines Beitrags in Frage/Antwort-Paare um.
function contributionQAPairs(messages = []) {
  const pairs = []
  for (let j = 0; j < messages.length; j++) {
    if (messages[j].role === 'assistant') {
      const hasAnswer = messages[j + 1]?.role === 'user'
      pairs.push({ q: messages[j].content, a: hasAnswer ? messages[j + 1].content : null })
      if (hasAnswer) j++
    } else {
      pairs.push({ q: null, a: messages[j].content })
    }
  }
  return pairs
}

// Baut ein gut lesbares PDF mit den Daten EINES Beitragenden (DSGVO Art. 15).
// Gibt einen Blob zurück.
export function buildContributionPdf(c, memorial) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const margin = 20
  const maxW = pageW - margin * 2
  let y = margin

  const lineHeight = size => size * 0.3528 * 1.32 // pt → mm, mit Zeilenabstand

  const loc = uiText(memorial?.languages?.[0] || 'de').locale
  const ensure = h => { if (y + h > pageH - margin) { doc.addPage(); y = margin } }

  function write(text, { size = 11, style = 'normal', color = [40, 40, 40], indent = 0, gapAfter = 2 } = {}) {
    doc.setFont('helvetica', style)
    doc.setFontSize(size)
    doc.setTextColor(color[0], color[1], color[2])
    const lh = lineHeight(size)
    const lines = doc.splitTextToSize(String(text ?? ''), maxW - indent)
    for (const line of lines) { ensure(lh); doc.text(line, margin + indent, y); y += lh }
    y += gapAfter
  }
  function rule() { ensure(4); doc.setDrawColor(210); doc.line(margin, y, pageW - margin, y); y += 5 }

  write('Datenauskunft', { size: 20, style: 'bold', color: [30, 30, 30], gapAfter: 1 })
  write('gemäß DSGVO Art. 15 (Auskunft) und Art. 20 (Datenübertragbarkeit)', { size: 10, color: [120, 120, 120], gapAfter: 3 })
  write(`${getCategory(memorial?.product_category).nounBook}: ${memorial.name}  (Code ${memorial.id})`, { size: 10, color: [90, 90, 90], gapAfter: 1 })
  write(`Erstellt am: ${new Date().toLocaleString(loc)}`, { size: 10, color: [90, 90, 90], gapAfter: 3 })
  rule()

  write('Angaben zur Person', { size: 14, style: 'bold', gapAfter: 2.5 })
  const fields = [
    ['Name', c.contributor_name],
    ['Beziehung zur Person', c.relationship],
    ['Geschlecht', c.contributor_gender],
    ['Anrede', c.contributor_address],
    ['Beitrag erstellt am', c.created_at ? new Date(c.created_at).toLocaleString(loc) : null],
  ]
  for (const [label, value] of fields) {
    if (!value) continue
    write(`${label}:`, { size: 10, style: 'bold', color: [110, 110, 110], gapAfter: 0.5 })
    write(String(value), { size: 11, indent: 2, gapAfter: 2 })
  }
  y += 2
  rule()

  write('Interview-Verlauf', { size: 14, style: 'bold', gapAfter: 3 })
  const pairs = contributionQAPairs(c.messages)
  if (pairs.length === 0) {
    write('Dieser Beitrag enthält keine Inhalte.', { size: 11, color: [120, 120, 120] })
  } else {
    pairs.forEach((p, i) => {
      if (p.q) write(`Frage ${i + 1}: ${p.q}`, { size: 11, style: 'bold', color: [60, 60, 60], gapAfter: 1 })
      write(p.a || '(keine Antwort)', { size: 11, indent: 3, gapAfter: 4 })
    })
  }

  return doc.output('blob')
}

async function fetchImageBuffer(url) {
  try {
    const r = await fetch(url)
    if (!r.ok) return null
    return await r.arrayBuffer()
  } catch { return null }
}

// Beitragende mit exakt gleichem Namen UND gleicher Beziehung nur einmal listen.
export function dedupeContributors(list) {
  const seen = new Set()
  const out = []
  for (const c of (list || [])) {
    const key = `${(c.contributor_name || '').trim()} ${(c.relationship || '').trim()}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(c)
  }
  return out
}

// Druckfertiges DOCX: DIN A5 hochkant inkl. 3 mm Beschnitt (Datenformat
// 15,4 × 21,6 cm), Serifenschrift 12 pt, Seitenzahl unten mittig. Jedes
// Kapitel ist eine eigene Sektion: zuerst eine Bildseite, dann beginnt der
// Kapiteltext per „gerade Seite" links (Word fügt ggf. eine Leerseite ein).
const DOCX_FONT = 'Georgia'
const tw = cm => Math.round(cm * 567) // cm → twips (1 cm = 567 twips)
const DOCX_PAGE = {
  size: { width: tw(15.4), height: tw(21.6) },
  margin: { top: tw(1.6), bottom: tw(1.6), left: tw(1.6), right: tw(1.6) },
}
function docxFooter() {
  return new Footer({ children: [ new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [ new TextRun({ children: [PageNumber.CURRENT], font: DOCX_FONT, size: 20 }) ],
  }) ] })
}
const docxSection = (children, type) => ({
  properties: { page: DOCX_PAGE, ...(type ? { type } : {}) },
  footers: { default: docxFooter() },
  children,
})

// Wandelt eine Data-URL (data:image/…;base64,…) in rohe Bytes (für docx ImageRun).
function dataUrlToUint8(dataUrl) {
  const bin = atob(String(dataUrl).slice(String(dataUrl).indexOf(',') + 1))
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return arr
}
// Bildtyp aus einer Data-URL (png, jpeg, gif, webp, svg+xml …).
function imageKindOf(dataUrl) {
  const m = /^data:image\/([a-z0-9.+-]+)/i.exec(dataUrl || '')
  return (m ? m[1] : '').toLowerCase()
}
// Lädt eine Logo-Data-URL und liefert Typ + natürliche Maße (für Export-Skalierung).
// null, wenn keine (gültige) Bild-Data-URL.
async function prepareLogoForExport(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return null
  const dim = await new Promise(res => {
    const im = new Image()
    im.onload = () => res({ w: im.naturalWidth || 0, h: im.naturalHeight || 0 })
    im.onerror = () => res(null)
    im.src = dataUrl
  })
  if (!dim || !dim.w || !dim.h) return null
  return { dataUrl, kind: imageKindOf(dataUrl), w: dim.w, h: dim.h }
}

// opts.showContributors: Namensliste der Beitragenden am Buchende drucken (Default an).
// Die contributors-Liste wird unabhängig davon weiter gebraucht — aus ihr stammt
// auch der Name unter der Kapitelüberschrift (Buch V1).
export async function downloadStructuredDocx(filename, book, contributors = [], logoDataUrl = null, layout = getBookLayout(), opts = {}) {
  const showContributors = opts.showContributors !== false
  const bt = uiText(book.language)
  const HF = layout.heading.docx, BF = layout.body.docx
  const up = s => layout.heading.upper ? String(s || '').toUpperCase() : (s || '')
  const sections = []

  // Titelseite
  sections.push(docxSection([
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: tw(4), after: 240 },
      children: [new TextRun({ text: up(book.title), font: HF, size: 48, bold: true })] }),
    ...(book.subtitle ? [new Paragraph({ alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: book.subtitle, font: BF, size: 28, italics: true, color: '78716c' })] })] : []),
  ]))

  for (const ch of (book.chapters || [])) {
    // Bildseite vor dem Kapitel (eigene Seite). Hinweis: ein echtes
    // Doppelseiten-Motiv (über zwei Seiten) ist im Druck-Layout zu setzen.
    let imgPara = null
    if (ch.image_url) {
      const buf = await fetchImageBuffer(ch.image_url)
      if (buf) imgPara = new Paragraph({
        alignment: AlignmentType.CENTER, spacing: { before: tw(4) },
        children: [new ImageRun({ data: buf, transformation: { width: 460, height: 307 } })], // 3:2, volle Satzbreite A5
      })
    }
    if (imgPara) sections.push(docxSection([imgPara], SectionType.NEXT_PAGE))

    // V1: Name + Beziehung des Beitragenden (Fallback über contribution_id).
    const chSrc = ch.contributor_name ? ch : (contributors || []).find(c => c.id === ch.contribution_id)
    const chName = ch.contributor_name || chSrc?.contributor_name
    const chRel  = ch.relationship    || chSrc?.relationship

    // Kapiteltext beginnt auf der linken (geraden) Seite.
    const content = [
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: tw(2), after: 100 },
        children: [new TextRun({ text: `${bt.chapterLabel} ${ch.number}`, font: HF, size: 20, color: 'a8a29e' })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: chName ? 100 : 300 },
        children: [new TextRun({ text: up(ch.heading), font: HF, size: 36, bold: true })] }),
      ...(chName ? [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 300 },
        children: [new TextRun({ text: chRel ? `${chName} – ${chRel}` : chName, font: BF, size: 24, italics: true, color: '78716c' })] })] : []),
      ...String(ch.body || '').split('\n\n').map(r => r.trim()).filter(Boolean).map(chunk =>
        new Paragraph({ alignment: AlignmentType.JUSTIFIED, spacing: { after: 200 }, children: [new TextRun({ text: chunk, font: BF, size: 24 })] })),
    ]
    sections.push(docxSection(content, SectionType.EVEN_PAGE))
  }

  // Mitwirkende + Disclaimer (eigene Seite am Ende)
  const endChildren = []
  if (showContributors && contributors && contributors.length) {
    endChildren.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 300 },
      children: [new TextRun({ text: up(bt.contributorsHeading), font: HF, size: 36, bold: true })] }))
    for (const c of dedupeContributors(contributors)) {
      const rel = c.relationship ? ` — ${c.relationship}` : ''
      endChildren.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [
        new TextRun({ text: c.contributor_name || '', font: BF, bold: true, size: 24 }),
        new TextRun({ text: rel, font: BF, color: '78716c', size: 24 }),
      ] }))
    }
  }
  endChildren.push(new Paragraph({ spacing: { before: tw(2), after: 120 },
    children: [new TextRun({ text: bt.aiDisclaimerTitle, font: BF, size: 20, bold: true, color: '78716c' })] }))
  // Logo des Buch-Inhabers zwischen Hinweis-Titel und Hinweis-Text. Nur Raster-
  // formate (docx ImageRun kann kein SVG/WebP) – sonst still überspringen.
  const docxLogo = await prepareLogoForExport(logoDataUrl)
  if (docxLogo && /^(png|jpe?g|gif)$/.test(docxLogo.kind)) {
    const w = Math.min(150, docxLogo.w)
    const h = Math.round(w * docxLogo.h / docxLogo.w)
    try {
      endChildren.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 80, after: 140 },
        children: [new ImageRun({ data: dataUrlToUint8(docxLogo.dataUrl), transformation: { width: w, height: h } })] }))
    } catch { /* defektes Logo darf den Export nicht abbrechen */ }
  }
  endChildren.push(new Paragraph({ spacing: { after: 200 },
    children: [new TextRun({ text: bt.aiDisclaimer, font: BF, size: 18, italics: true, color: '78716c' })] }))
  sections.push(docxSection(endChildren, SectionType.NEXT_PAGE))

  const doc = new Document({
    creator: 'Lebenswerk', title: book.title || '',
    styles: { default: { document: { run: { font: BF, size: 24 } } } },
    sections,
  })
  downloadBlob(filename, await Packer.toBlob(doc))
}

// Lädt ein Bild als Data-URL inkl. natürlicher Pixelmaße (für die randlose
// „Cover"-Platzierung im Druck-PDF). Gibt null zurück, wenn nicht ladbar.
async function fetchImageForPdf(url) {
  try {
    const r = await fetch(url)
    if (!r.ok) return null
    const blob = await r.blob()
    const dataUrl = await new Promise((res, rej) => {
      const fr = new FileReader()
      fr.onload = () => res(fr.result)
      fr.onerror = rej
      fr.readAsDataURL(blob)
    })
    const dim = await new Promise((res) => {
      const im = new Image()
      im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight })
      im.onerror = () => res(null)
      im.src = dataUrl
    })
    return { dataUrl, w: dim?.w || 3, h: dim?.h || 2 }
  } catch { return null }
}

// Druckfertiges PDF (einseitige Seiten, exakte Platzierung). Endformat je
// Einzelseite 15,4 × 21,6 cm = DIN A5 (14,8 × 21,0) + 3 mm Beschnitt ringsum.
// Layout-Regeln:
//  • Titelseite auf der ersten RECHTEN Seite (recto).
//  • Pro Kapitel: doppelseitiges Bild (linke Hälfte auf der LINKEN Seite,
//    rechte Hälfte auf der RECHTEN Seite), danach eine LEERE Seite, danach
//    beginnt die Kapitelüberschrift auf der nächsten RECHTEN Seite.
//  • Das Bild wird auf die Doppelseite 30,8 × 21,6 cm „gecovert" (randlos
//    füllend, mittiger Beschnitt, ohne Verzerrung) und exakt in der Mitte
//    vertikal geteilt.
const PDF_PAGE_W = 154   // mm – Einzelseite inkl. Beschnitt
const PDF_PAGE_H = 216   // mm
const PDF_SPREAD_W = PDF_PAGE_W * 2 // 308 mm – Doppelseite

export async function downloadPrintPdf(filename, book, contributors = [], logoDataUrl = null, layout = getBookLayout(), opts = {}) {
  const showContributors = opts.showContributors !== false
  const bt = uiText(book.language)
  let HF = layout.heading.pdf, BF = layout.body.pdf
  const up = s => layout.heading.upper ? String(s || '').toUpperCase() : (s || '')
  const doc = new jsPDF({ unit: 'mm', format: [PDF_PAGE_W, PDF_PAGE_H] })

  // jsPDF-Standardfonts (times/helvetica) können nur Latin-1 – polnische u. a.
  // Sonderzeichen (ł, ż, ś, ć, ą, ę, ź) fehlen → falsche Breite/Umbruch (Text läuft
  // über den Rand) und falsche Glyphen. Enthält der Buchtext solche Zeichen, laden
  // wir lazy einen eingebetteten Unicode-Serif (DejaVu) und nutzen ihn durchgängig.
  const allText = [book.title, book.subtitle,
    ...((book.chapters || []).flatMap(c => [c?.heading, c?.body])),
    ...((contributors || []).flatMap(c => [c?.contributor_name, c?.relationship]))].join(' ')
  // Latin Extended-A/B (u. a. polnische Sonderzeichen) -> jsPDF-Standardfonts
  // koennen sie nicht. Deutsch (Umlaute/ss) und Typo-Zeichen sind in WinAnsi.
  if (/[Ā-ɏ]/.test(allText)) {
    const f = await import('./fonts/dejavuSerif.js')
    doc.addFileToVFS('DejaVuSerif.ttf', f.DEJAVU_SERIF)
    doc.addFont('DejaVuSerif.ttf', 'DejaVuSerif', 'normal')
    doc.addFont('DejaVuSerif.ttf', 'DejaVuSerif', 'italic')
    doc.addFileToVFS('DejaVuSerif-Bold.ttf', f.DEJAVU_SERIF_BOLD)
    doc.addFont('DejaVuSerif-Bold.ttf', 'DejaVuSerif', 'bold')
    doc.addFont('DejaVuSerif-Bold.ttf', 'DejaVuSerif', 'bolditalic')
    HF = 'DejaVuSerif'; BF = 'DejaVuSerif'
  }
  let page = 1 // jsPDF hat Seite 1 bereits angelegt; recto = ungerade
  // Seitenklassifizierung für die Seitenzahlen: Bild- und Leerseiten bekommen
  // KEINE Nummer; alle übrigen (Text-)Seiten schon. Nummern werden am Ende gesetzt.
  const pageImage = new Set()
  const pageEmpty = new Set()

  const newPage = () => { doc.addPage([PDF_PAGE_W, PDF_PAGE_H]); page++ }
  const isRecto = p => p % 2 === 1
  // Auf die nächste rechte Seite springen (ggf. eine leere linke Seite davor).
  const startRecto = () => { newPage(); if (!isRecto(page)) { pageEmpty.add(page); newPage() } }
  // Auf die nächste linke Seite springen (für die linke Bildhälfte).
  const startVerso = () => { newPage(); if (isRecto(page)) { pageEmpty.add(page); newPage() } }

  // Eine Hälfte des Cover-skalierten Doppelseiten-Bildes randlos setzen.
  // side: 'left' zeigt Doppelseiten-Bereich 0…154, 'right' zeigt 154…308.
  const drawHalf = (img, side) => {
    const r = img.w / img.h
    let dw, dh
    if (r > PDF_SPREAD_W / PDF_PAGE_H) { dh = PDF_PAGE_H; dw = PDF_PAGE_H * r } // breiter → Höhe füllen
    else                              { dw = PDF_SPREAD_W; dh = PDF_SPREAD_W / r } // höher → Breite füllen
    const offX = (PDF_SPREAD_W - dw) / 2
    const offY = (PDF_PAGE_H - dh) / 2
    const baseX = side === 'left' ? offX : offX - PDF_PAGE_W
    doc.addImage(img.dataUrl, 'PNG', baseX, offY, dw, dh)
    pageImage.add(page)
  }

  // Textsatz mit y-Cursor und automatischem Seitenumbruch (Fortsetzungsseiten
  // brauchen keine Paritätskorrektur).
  const ML = 18, MR = 18, MT = 22, MB = 20
  const maxW = PDF_PAGE_W - ML - MR
  const lh = pt => pt * 0.3528 * 1.5
  let y = MT
  const flow = (chunk, { size = 12, style = 'normal', color = [40, 40, 40], gapAfter = 1, indent = 0, justify = false } = {}) => {
    doc.setFont(BF, style); doc.setFontSize(size); doc.setTextColor(...color)
    const lineH = lh(size)
    const width = maxW - indent
    const lines = doc.splitTextToSize(String(chunk ?? ''), width)
    lines.forEach((line, i) => {
      if (y > PDF_PAGE_H - MB) { newPage(); y = MT }
      const words = line.split(' ').filter(Boolean)
      // Blocksatz: alle Zeilen außer der letzten eines Absatzes strecken; der
      // Zusatzabstand wird gleichmäßig auf die Wortlücken verteilt (nicht bei
      // sehr kurzen/letzten Zeilen, um klaffende Lücken zu vermeiden).
      if (justify && i < lines.length - 1 && words.length > 1) {
        const extra = width - doc.getTextWidth(line)
        if (extra > 0 && extra < width * 0.28) {
          const gap = extra / (words.length - 1)
          const spaceW = doc.getTextWidth(' ')
          let x = ML + indent
          for (const w of words) { doc.text(w, x, y); x += doc.getTextWidth(w) + spaceW + gap }
        } else { doc.text(line, ML + indent, y) }
      } else {
        doc.text(line, ML + indent, y)
      }
      y += lineH
    })
    y += gapAfter * lineH
  }

  // ── Titelseite (recto) ──
  doc.setFont(HF, 'bold'); doc.setFontSize(28); doc.setTextColor(30, 30, 30)
  let ty = 90
  for (const line of doc.splitTextToSize(up(book.title), PDF_PAGE_W - 40)) { doc.text(line, PDF_PAGE_W / 2, ty, { align: 'center' }); ty += 12 }
  if (book.subtitle) {
    doc.setFont(BF, 'italic'); doc.setFontSize(15); doc.setTextColor(120, 113, 108); ty += 4
    for (const line of doc.splitTextToSize(book.subtitle, PDF_PAGE_W - 50)) { doc.text(line, PDF_PAGE_W / 2, ty, { align: 'center' }); ty += 8 }
  }

  // ── Kapitel ──
  for (const ch of (book.chapters || [])) {
    const img = ch.image_url ? await fetchImageForPdf(ch.image_url) : null
    if (img) {
      startVerso(); drawHalf(img, 'left')   // linke Seite: linke Bildhälfte
      newPage();    drawHalf(img, 'right')  // rechte Seite: rechte Bildhälfte
      newPage(); pageEmpty.add(page)        // leere linke Seite
      newPage()                             // rechte Seite: Kapitelbeginn
    } else {
      startRecto()                          // ohne Bild trotzdem rechts beginnen
    }
    // Kapitellabel + Überschrift (zentriert), dann Fließtext
    doc.setFont(HF, 'normal'); doc.setFontSize(11); doc.setTextColor(150, 150, 150)
    doc.text(`${bt.chapterLabel} ${ch.number || ''}`.trim(), PDF_PAGE_W / 2, 34, { align: 'center' })
    doc.setFont(HF, 'bold'); doc.setFontSize(20); doc.setTextColor(30, 30, 30)
    let hy = 46
    for (const line of doc.splitTextToSize(up(ch.heading), maxW)) { doc.text(line, PDF_PAGE_W / 2, hy, { align: 'center' }); hy += 9 }
    // V1: Name + Beziehung des Beitragenden unter die Überschrift (Fallback über contribution_id).
    {
      const src = ch.contributor_name ? ch : (contributors || []).find(c => c.id === ch.contribution_id)
      const nm = ch.contributor_name || src?.contributor_name
      const rel = ch.relationship || src?.relationship
      if (nm) {
        doc.setFont(BF, 'italic'); doc.setFontSize(12); doc.setTextColor(120, 113, 108)
        doc.text(rel ? `${nm} – ${rel}` : nm, PDF_PAGE_W / 2, hy + 2, { align: 'center' })
      }
    }
    // Seitenumbruch nach der Kapitelüberschrift: der Fließtext beginnt auf
    // einer neuen Seite (Überschriftenseite bleibt für sich).
    newPage(); y = MT
    for (const para of String(ch.body || '').split('\n\n').map(s => s.trim()).filter(Boolean)) {
      flow(para, { size: 12, gapAfter: 0.6, justify: true })
    }
  }

  // ── Mitwirkende + Disclaimer (neue Seite) ──
  newPage(); y = MT
  if (showContributors && contributors && contributors.length) {
    doc.setFont(HF, 'bold'); doc.setFontSize(20); doc.setTextColor(30, 30, 30)
    doc.text(up(bt.contributorsHeading), PDF_PAGE_W / 2, y, { align: 'center' }); y += 14
    doc.setFontSize(12)
    for (const c of dedupeContributors(contributors)) {
      if (y > PDF_PAGE_H - MB) { newPage(); y = MT }
      const rel = c.relationship ? `  —  ${c.relationship}` : ''
      doc.setFont(BF, 'bold'); doc.setTextColor(40, 40, 40)
      const nameW = doc.getTextWidth(c.contributor_name || '')
      const relW = doc.getTextWidth(rel)
      const startX = (PDF_PAGE_W - nameW - relW) / 2
      doc.text(c.contributor_name || '', startX, y)
      doc.setFont(BF, 'normal'); doc.setTextColor(120, 113, 108)
      doc.text(rel, startX + nameW, y)
      y += 7
    }
    y += 8
  }
  flow(bt.aiDisclaimerTitle, { size: 11, style: 'bold', color: [120, 113, 108], gapAfter: 0.5 })
  // Logo des Buch-Inhabers zwischen Hinweis-Titel und Hinweis-Text (zentriert).
  // jsPDF kann nur PNG/JPEG – andere Formate still überspringen.
  const pdfLogo = await prepareLogoForExport(logoDataUrl)
  if (pdfLogo && /^(png|jpe?g)$/.test(pdfLogo.kind)) {
    const wmm = 40
    const hmm = wmm * pdfLogo.h / pdfLogo.w
    if (y + hmm > PDF_PAGE_H - MB) { newPage(); y = MT }
    try {
      doc.addImage(pdfLogo.dataUrl, pdfLogo.kind === 'png' ? 'PNG' : 'JPEG', (PDF_PAGE_W - wmm) / 2, y, wmm, hmm)
      y += hmm + 4
    } catch { /* defektes Logo darf den Export nicht abbrechen */ }
  }
  flow(bt.aiDisclaimer, { size: 10, style: 'italic', color: [120, 113, 108], gapAfter: 0 })

  // ── Auf ein Vielfaches von 4 auffüllen (Druckbogen/Signaturen) ──
  // Buchbindung setzt Seiten in 4er-Bögen; die Gesamtseitenzahl muss durch 4
  // teilbar sein. Fehlende Seiten werden als LEERE Seiten OHNE Seitenzahl am
  // Schluss ergänzt (als pageEmpty markiert → die Nummerierung unten überspringt sie).
  while (doc.getNumberOfPages() % 4 !== 0) { newPage(); pageEmpty.add(page) }

  // ── Seitenzahlen unten mittig – ohne Titel-, Bild- und Leerseiten ──
  // Seite 1 ist immer die (innere) Titelseite und bleibt klassisch ohne Nummer.
  const totalPages = doc.getNumberOfPages()
  for (let i = 2; i <= totalPages; i++) {
    if (pageImage.has(i) || pageEmpty.has(i)) continue
    doc.setPage(i)
    doc.setFont(BF, 'normal'); doc.setFontSize(10); doc.setTextColor(120, 113, 108)
    doc.text(String(i), PDF_PAGE_W / 2, PDF_PAGE_H - 10, { align: 'center' })
  }

  downloadBlob(filename, doc.output('blob'))
  // Seitenzahl zurückgeben: sie bestimmt die Rückenstärke des Covers
  // (src/coverExport.js) und wird deshalb am Buch gespeichert.
  return { pages: totalPages }
}

export async function downloadAsDocx(filename, title, text, lang = 'de') {
  const bt = uiText(lang)
  const children = [
    new Paragraph({
      text: title,
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
    }),
  ]
  for (const raw of text.split('\n\n')) {
    const chunk = raw.trim()
    if (!chunk) continue
    if (chunk.startsWith('## ')) {
      children.push(new Paragraph({ text: chunk.slice(3), heading: HeadingLevel.HEADING_2, spacing: { before: 300, after: 120 } }))
    } else if (chunk.startsWith('# ')) {
      children.push(new Paragraph({ text: chunk.slice(2), heading: HeadingLevel.HEADING_1, spacing: { before: 300, after: 120 } }))
    } else {
      children.push(new Paragraph({ text: chunk, spacing: { after: 200 } }))
    }
  }
  children.push(new Paragraph({
    children: [new TextRun({ text: bt.aiDisclaimerTitle, size: 20, bold: true, color: '78716c' })],
    spacing: { before: 500, after: 120 },
  }))
  children.push(new Paragraph({
    children: [new TextRun({ text: bt.aiDisclaimer, size: 18, italics: true, color: '78716c' })],
    spacing: { after: 200 },
  }))
  const doc = new Document({
    creator: 'Lebenswerk', title,
    styles: { default: { document: { run: { font: DOCX_FONT, size: 24 } } } },
    sections: [docxSection(children)],
  })
  downloadBlob(filename, await Packer.toBlob(doc))
}
