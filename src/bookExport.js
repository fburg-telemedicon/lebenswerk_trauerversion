// src/bookExport.js
// Aus App.jsx ausgelagerte, ZUSTANDSLOSE Export-/Download-Helfer (TXT/DOCX/PDF).
// Reine Modul-Funktionen ohne React-State/Hooks - 1:1 aus App.jsx verschoben.

import { Document, Packer, Paragraph, HeadingLevel, AlignmentType, ImageRun, TextRun, Footer, PageNumber, SectionType, BorderStyle } from 'docx'
import jsPDF from 'jspdf'
import { getCategory, chapterVoices } from './categories.js'
import { getBookLayout } from './bookLayouts.js'
import { uiText, bookDisclaimer, imageFacts, isRTL } from './i18n.js'
import { prepareEbookCoverPage, drawEbookCoverPage } from './coverExport.js'

// Disclaimer zur Entstehung & Haftung – wird ans Ende jedes Buchs/jeder Rede
// gesetzt (HTML-Ansicht + DOCX) und im Impressum/Datenschutz referenziert.
export const BOOK_DISCLAIMER_TITLE = 'Hinweis zur Entstehung dieses Buches'
export const BOOK_DISCLAIMER =
  'Dieses Buch wurde auf Grundlage von Interviews mit nahestehenden Personen mithilfe von künstlicher Intelligenz erstellt. Es gibt persönliche Erinnerungen und Schilderungen der Beitragenden wieder. Ihre inhaltliche Richtigkeit, Vollständigkeit und Aktualität können wir nicht überprüfen; eine Haftung hierfür ist – soweit gesetzlich zulässig – ausgeschlossen.'

// Derselbe Hinweis für Dokumente, die KEIN Buch sind (Anamnesebogen): der
// Buch-Hinweis passt dort weder in der Überschrift noch im Text.
export const FORM_DISCLAIMER_TITLE = 'Hinweis zur Entstehung dieses Bogens'
export const FORM_DISCLAIMER =
  'Dieser Anamnesebogen wurde aus einem KI-geführten Gespräch mit der Patientin/dem Patienten erstellt und gibt ausschließlich deren/dessen Selbstauskunft wieder. Er ist nicht ärztlich validiert, enthält keine Diagnosen und ersetzt weder die ärztliche Anamnese noch eine Untersuchung. Die inhaltliche Richtigkeit und Vollständigkeit der Angaben können wir nicht überprüfen; eine Haftung hierfür ist – soweit gesetzlich zulässig – ausgeschlossen.'

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
  // Rechts-nach-links (Hebräisch/Arabisch): Word setzt die Absätze rechtsläufig,
  // sobald `bidirectional` gesetzt ist — die Buchstabenverbindungen formt Word
  // selbst (deshalb geht DOCX, wo das Druck-PDF passen muss).
  const rtl = isRTL(book.language)
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
        new Paragraph({ alignment: AlignmentType.JUSTIFIED, bidirectional: rtl, spacing: { after: 200 }, children: [new TextRun({ text: chunk, font: BF, size: 24 })] })),
      // Stimmen-Kästen: was ANDERE über diesen Lebensabschnitt erzählen. Bewusst
      // abgesetzt (eingerückt, kursiv, mit Rahmen links) — sie stehen neben der
      // Ich-Erzählung, nicht in ihr.
      ...chapterVoices(ch).flatMap((v, vi) => [
        ...(vi === 0 ? [new Paragraph({ spacing: { before: 300, after: 120 },
          children: [new TextRun({ text: bt.voicesHeading, font: HF, size: 22, bold: true, color: '78716c' })] })] : []),
        new Paragraph({
          bidirectional: rtl, indent: { left: 340 }, spacing: { after: 60 },
          border: { left: { style: BorderStyle.SINGLE, size: 12, space: 10, color: 'd6d3d1' } },
          children: [new TextRun({ text: String(v.text).trim(), font: BF, size: 22, italics: true, color: '44403c' })],
        }),
        new Paragraph({
          bidirectional: rtl, indent: { left: 340 }, spacing: { after: 200 },
          border: { left: { style: BorderStyle.SINGLE, size: 12, space: 10, color: 'd6d3d1' } },
          children: [new TextRun({ text: `— ${[v.name, v.relationship].filter(Boolean).join(', ')}`, font: BF, size: 20, color: '78716c' })],
        }),
      ]),
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
  endChildren.push(new Paragraph({ spacing: { after: 200 }, bidirectional: rtl,
    children: [new TextRun({ text: bookDisclaimer(book.language || 'de', { ...imageFacts(book), selfNarrated: opts.selfNarrated === true }), font: BF, size: 18, italics: true, color: '78716c' })] }))
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

// Ein per fetchImageForPdf geladenes Bild auf Bildschirmauflösung verkleinern und
// als JPEG neu kodieren (fürs E-Book — Druck-PNGs sind für E-Mail zu groß). Gibt
// { dataUrl, w, h } zurück; bei Fehler das Original unverändert.
async function downscaleToJpeg(img, maxPx, quality) {
  try {
    const scale = Math.min(1, maxPx / Math.max(img.w, img.h))
    // Schon klein UND bereits JPEG → nichts zu tun. Ein großes PNG wird auch bei
    // scale≈1 neu als JPEG kodiert (spart am meisten).
    if (scale >= 1 && /^data:image\/jpe?g/i.test(img.dataUrl)) return img
    const el = await new Promise((res, rej) => {
      const im = new Image()
      im.onload = () => res(im); im.onerror = () => rej(new Error('Bild'))
      im.src = img.dataUrl
    })
    const w = Math.max(1, Math.round(img.w * scale))
    const h = Math.max(1, Math.round(img.h * scale))
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h
    cv.getContext('2d').drawImage(el, 0, 0, w, h)
    return { dataUrl: cv.toDataURL('image/jpeg', quality), w, h }
  } catch { return img }
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

// ── Silbentrennung ─────────────────────────────────────────────────────────
// Der Satzspiegel ist nur 118 mm breit. Ohne Trennung reißen lange Komposita
// („Arbeitsaufkommen") Löcher: die Zeile davor bleibt weit offen, der Blocksatz
// müsste sie über wenige Wortlücken strecken — deshalb blieb sie bisher linksbündig
// stehen (sichtbarer Bruch im Satzbild). Mit Trennmustern bricht das Wort selbst um.
// Die Muster (Sprache einzeln, ~700 kB für Deutsch) werden LAZY geladen und landen
// in einem eigenen Chunk — sie kosten nur beim PDF-Export, nicht beim Seitenaufruf.
const HYPHEN_LOADERS = {
  de:      () => import('hyphen/de'),
  'de-CH': () => import('hyphen/de-ch-1901'),
  en:      () => import('hyphen/en-gb'),
  es:      () => import('hyphen/es'),
  eu:      () => import('hyphen/eu'),
  fr:      () => import('hyphen/fr'),
  it:      () => import('hyphen/it'),
  pl:      () => import('hyphen/pl'),
  ro:      () => import('hyphen/ro'),
  tr:      () => import('hyphen/tr'),
  ru:      () => import('hyphen/ru'),
  uk:      () => import('hyphen/uk'),
  // he/ar: keine Trennmuster (und RTL) → ohne Trennung wie bisher.
}
const SOFT = '­'

// Liefert eine Funktion Wort → Liste möglicher Trennstellen (Index im Wort),
// oder null, wenn die Sprache keine Trennung kennt bzw. das Laden scheitert.
async function loadHyphenator(lang) {
  const load = HYPHEN_LOADERS[lang] || HYPHEN_LOADERS[String(lang || '').slice(0, 2)]
  if (!load) return null
  try {
    const mod = await load()
    const hyphenateSync = mod.hyphenateSync || mod.default?.hyphenateSync
    if (typeof hyphenateSync !== 'function') return null
    const cache = new Map()
    return word => {
      if (cache.has(word)) return cache.get(word)
      let points = []
      try {
        const marked = hyphenateSync(word, { hyphenChar: SOFT })
        let idx = 0
        for (const part of marked.split(SOFT)) { idx += part.length; points.push(idx) }
        points.pop()   // hinter dem letzten Teil ist keine Trennstelle
      } catch { points = [] }
      cache.set(word, points)
      return points
    }
  } catch { return null }   // fehlende Muster dürfen den Export nie stoppen
}

// Zeilenumbruch mit Silbentrennung. Ersetzt doc.splitTextToSize für Fließtext:
// baut die Zeile wortweise auf und trennt das erste nicht mehr passende Wort an
// der spätesten erlaubten Stelle. Ohne Trenner (hyph = null) ist das Ergebnis
// identisch zu splitTextToSize.
function wrapWithHyphens(doc, text, width, hyph) {
  const src = String(text ?? '')
  if (!hyph) return doc.splitTextToSize(src, width)
  const out = []
  const spaceW = doc.getTextWidth(' ')
  // Mindestlängen: kein „A-rbeit" und kein einzeln hängendes „-en".
  const MIN_HEAD = 3, MIN_TAIL = 3, MIN_WORD = 7
  // Nicht mehr als zwei Trennungen hintereinander (typografische Faustregel).
  let inRow = 0

  const breakWord = (word, avail) => {
    const letters = word.replace(/[^\p{L}]/gu, '')
    if (letters.length < MIN_WORD || inRow >= 2) return null
    const points = hyph(word)
    let best = null
    for (const p of points) {
      if (p < MIN_HEAD || word.length - p < MIN_TAIL) continue
      if (word[p - 1] === '-') continue           // nicht direkt hinter einem echten Bindestrich
      const head = word.slice(0, p) + '-'
      if (doc.getTextWidth(head) <= avail) best = { head, tail: word.slice(p) }
      else break                                   // Trennstellen sind aufsteigend
    }
    return best
  }

  for (const para of src.split('\n')) {
    let line = ''
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const cand = line ? `${line} ${word}` : word
      if (doc.getTextWidth(cand) <= width) { line = cand; continue }
      const avail = width - (line ? doc.getTextWidth(line) + spaceW : 0)
      const split = breakWord(word, avail)
      if (split) {
        out.push(line ? `${line} ${split.head}` : split.head)
        inRow++
        // Rest kann selbst noch zu lang sein (sehr lange Komposita) → weiter trennen.
        let rest = split.tail
        let next
        while (doc.getTextWidth(rest) > width && (next = breakWord(rest, width))) {
          out.push(next.head); inRow++; rest = next.tail
        }
        line = rest
        continue
      }
      if (line) { out.push(line); inRow = 0; line = '' }
      // Wort passt auch allein nicht in die Zeile → hart umbrechen wie bisher.
      if (doc.getTextWidth(word) > width) {
        const hard = doc.splitTextToSize(word, width)
        out.push(...hard.slice(0, -1)); inRow = 0
        line = hard[hard.length - 1]
      } else {
        line = word
      }
    }
    out.push(line)   // auch leere Zeile: ein „\n" im Text bleibt ein Umbruch
  }
  return out
}

// Baut das druckfertige Innenteil (ohne Cover) und gibt das jsPDF-Dokument + die
// Seitenzahl zurück, OHNE herunterzuladen. downloadPrintPdf (Druck) und
// downloadEbookPdf (E-Book, mit Cover-Seiten drumherum) bauen darauf auf.
// opts.pad4 (Default true): auf ein Vielfaches von 4 auffüllen (nur fürs Drucken
// nötig — beim E-Book aus, sonst lägen Leerseiten vor der Cover-Rückseite).
export async function buildInteriorPdf(book, contributors = [], logoDataUrl = null, layout = getBookLayout(), opts = {}) {
  const showContributors = opts.showContributors !== false
  const bt = uiText(book.language)
  let HF = layout.heading.pdf, BF = layout.body.pdf
  const up = s => layout.heading.upper ? String(s || '').toUpperCase() : (s || '')
  // opts.compress: PDF-Streams deflaten (fürs E-Book an → kleinere Datei; fürs
  // Druck-PDF aus → unverändert). opts.imageMaxPx/imageQuality: Kapitelbilder auf
  // Bildschirmauflösung verkleinern + als JPEG einbetten (nur E-Book).
  const doc = new jsPDF({ unit: 'mm', format: [PDF_PAGE_W, PDF_PAGE_H], compress: opts.compress === true })

  // jsPDF-Standardfonts (times/helvetica) können nur Latin-1 – polnische u. a.
  // Sonderzeichen (ł, ż, ś, ć, ą, ę, ź) fehlen → falsche Breite/Umbruch (Text läuft
  // über den Rand) und falsche Glyphen. Enthält der Buchtext solche Zeichen, laden
  // wir lazy einen eingebetteten Unicode-Serif (DejaVu) und nutzen ihn durchgängig.
  const allText = [book.title, book.subtitle,
    // Die Gaststimmen gehören mit in die Zeichenprüfung — sonst wählt ein Buch,
    // dessen Sonderzeichen NUR in einem Stimmen-Kasten vorkommen, den falschen
    // Font und setzt dort Platzhalter.
    ...((book.chapters || []).flatMap(c => [c?.heading, c?.body, ...chapterVoices(c).flatMap(v => [v.text, v.name, v.relationship])])),
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
  // opts.parity (Default true): Kapitel rechts beginnen lassen und dafür ggf. eine
  // LEERE Seite einschieben. Das ist reine Drucklogik (im gebundenen Buch ist die
  // Parität sichtbar). Im E-Book gibt es keine linke/rechte Seite — dort wirken
  // die Leerseiten wie ein Fehler, deshalb `parity: false`.
  const parity = opts.parity !== false
  // Auf die nächste rechte Seite springen (ggf. eine leere linke Seite davor).
  const startRecto = () => { newPage(); if (parity && !isRecto(page)) { pageEmpty.add(page); newPage() } }
  // Auf die nächste linke Seite springen (für die linke Bildhälfte).
  const startVerso = () => { newPage(); if (parity && isRecto(page)) { pageEmpty.add(page); newPage() } }

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
    const fmt = /^data:image\/jpe?g/i.test(img.dataUrl) ? 'JPEG' : 'PNG'
    doc.addImage(img.dataUrl, fmt, baseX, offY, dw, dh)
    pageImage.add(page)
  }

  // Textsatz mit y-Cursor und automatischem Seitenumbruch (Fortsetzungsseiten
  // brauchen keine Paritätskorrektur).
  const ML = 18, MR = 18, MT = 22, MB = 20
  const maxW = PDF_PAGE_W - ML - MR
  // Trennmuster der Buchsprache (null = keine Trennung, dann bricht flow() wie bisher um).
  const hyph = await loadHyphenator(book.language || 'de')
  const lh = pt => pt * 0.3528 * 1.5
  let y = MT
  const flow = (chunk, { size = 12, style = 'normal', color = [40, 40, 40], gapAfter = 1, indent = 0, justify = false } = {}) => {
    doc.setFont(BF, style); doc.setFontSize(size); doc.setTextColor(...color)
    const lineH = lh(size)
    const width = maxW - indent
    const lines = wrapWithHyphens(doc, chunk, width, hyph)
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
    let img = ch.image_url ? await fetchImageForPdf(ch.image_url) : null
    if (img && opts.imageMaxPx) img = await downscaleToJpeg(img, opts.imageMaxPx, opts.imageQuality || 0.72)
    if (img) {
      startVerso(); drawHalf(img, 'left')   // linke Seite: linke Bildhälfte
      newPage();    drawHalf(img, 'right')  // rechte Seite: rechte Bildhälfte
      newPage()                             // Kapitelbeginn …
      // … im Druck erst nach einer leeren linken Seite, damit das Kapitel rechts
      // anfängt. Im E-Book (parity:false) folgt der Text direkt aufs Bild.
      if (parity) { pageEmpty.add(page); newPage() }
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
    // Stimmen-Kästen ans Kapitelende: was ANDERE über diesen Lebensabschnitt
    // erzählen. Kein gezeichneter Rahmen — er würde über einen Seitenumbruch
    // hinweg zerreißen. Einrückung, Kursive und die Zuschreibung setzen den
    // Block deutlich genug von der Ich-Erzählung ab.
    const voices = chapterVoices(ch)
    if (voices.length) {
      if (y > PDF_PAGE_H - MB - 30) { newPage(); y = MT }   // nicht als Waise ans Seitenende
      y += 4
      flow(bt.voicesHeading, { size: 11, style: 'bold', color: [120, 113, 108], gapAfter: 0.4 })
      for (const v of voices) {
        flow(`„${String(v.text).trim()}"`, { size: 11, style: 'italic', color: [68, 64, 60], indent: 10, gapAfter: 0.2 })
        const by = [v.name, v.relationship].filter(Boolean).join(', ')
        if (by) flow(`— ${by}`, { size: 10, color: [120, 113, 108], indent: 10, gapAfter: 0.7 })
      }
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
  flow(bookDisclaimer(book.language || 'de', { ...imageFacts(book), selfNarrated: opts.selfNarrated === true }), { size: 10, style: 'italic', color: [120, 113, 108], gapAfter: 0 })

  // ── Auf ein Vielfaches von 4 auffüllen (Druckbogen/Signaturen) ──
  // Buchbindung setzt Seiten in 4er-Bögen; die Gesamtseitenzahl muss durch 4
  // teilbar sein. Fehlende Seiten werden als LEERE Seiten OHNE Seitenzahl am
  // Schluss ergänzt (als pageEmpty markiert → die Nummerierung unten überspringt sie).
  // Beim E-Book (opts.pad4 === false) entfällt das — Leerseiten vor der
  // Cover-Rückseite wären dort sinnlos.
  if (opts.pad4 !== false) { while (doc.getNumberOfPages() % 4 !== 0) { newPage(); pageEmpty.add(page) } }

  // ── Seitenzahlen unten mittig – ohne Titel-, Bild- und Leerseiten ──
  // Seite 1 ist immer die (innere) Titelseite und bleibt klassisch ohne Nummer.
  const totalPages = doc.getNumberOfPages()
  for (let i = 2; i <= totalPages; i++) {
    if (pageImage.has(i) || pageEmpty.has(i)) continue
    doc.setPage(i)
    doc.setFont(BF, 'normal'); doc.setFontSize(10); doc.setTextColor(120, 113, 108)
    doc.text(String(i), PDF_PAGE_W / 2, PDF_PAGE_H - 10, { align: 'center' })
  }

  // Seitenzahl bestimmt die Rückenstärke des Druck-Covers und wird am Buch
  // gespeichert; das Dokument wird von den Aufrufern ausgegeben/erweitert.
  return { doc, pages: totalPages }
}

// Druckfertiges Innenteil-PDF herunterladen. Endformat je Einzelseite 15,4 × 21,6 cm.
export async function downloadPrintPdf(filename, book, contributors = [], logoDataUrl = null, layout = getBookLayout(), opts = {}) {
  const { doc, pages } = await buildInteriorPdf(book, contributors, logoDataUrl, layout, opts)
  const blob = doc.output('blob')
  downloadBlob(filename, blob)
  // `blob` für die optionale Server-Ablage (Checkbox in der Detailansicht).
  return { pages, blob }
}

// E-Book-PDF: dasselbe Innenteil, aber eingefasst zwischen zwei Cover-Seiten —
// vorne die Vorderseite (rechte Bildhälfte + Titel), hinten die Rückseite (linke
// Bildhälfte + Logo). Kein Buchrücken, keine Druck-Auffüllung. Braucht denselben
// Cover-Hintergrund wie das Druck-Cover (opts.coverBgUrl).
export async function downloadEbookPdf(filename, book, contributors = [], logoDataUrl = null, layout = getBookLayout(), opts = {}) {
  if (!opts.coverBgUrl) throw new Error('Cover-Hintergrund fehlt.')
  // E-Mail-freundlich: Bilder auf Bildschirmauflösung (JPEG) + PDF-Streams deflaten.
  const imgMaxPx = opts.imageMaxPx || 1500
  const imgQuality = opts.imageQuality || 0.72
  // Cover-Seiten VOR den Seitenmanipulationen laden (async), damit das Einfügen/
  // Anhängen danach rein synchron abläuft.
  const [front, back] = await Promise.all([
    prepareEbookCoverPage({ bgUrl: opts.coverBgUrl, side: 'front', title: opts.coverTitle || book.title || '', subtitle: opts.coverSubtitle || book.subtitle || '', layout, boxPos: opts.coverBoxPos, maxPx: imgMaxPx, quality: imgQuality }),
    prepareEbookCoverPage({ bgUrl: opts.coverBgUrl, side: 'back', layout, boxPos: opts.coverBoxPos, maxPx: imgMaxPx, quality: imgQuality }),
  ])

  // Innenteil wie beim Druck, aber ohne die reine Drucklogik: keine 4er-Auffüllung
  // (pad4) und keine Leerseiten für den rechts beginnenden Kapitelanfang (parity).
  // Dazu verkleinerte JPEG-Bilder und komprimierte PDF-Streams.
  const { doc } = await buildInteriorPdf(book, contributors, logoDataUrl, layout, { ...opts, pad4: false, parity: false, compress: true, imageMaxPx: imgMaxPx, imageQuality: imgQuality })

  // Rückseite hinten anhängen (nach der Nummerierung → bekommt keine Seitenzahl).
  doc.addPage([PDF_PAGE_W, PDF_PAGE_H])
  drawEbookCoverPage(doc, back)
  // Vorderseite ganz vorne einfügen; insertPage(1) setzt den Cursor auf die neue
  // Seite 1. Die bereits gesetzten Seitenzahlen wandern mit ihren Seiten mit.
  doc.insertPage(1)
  drawEbookCoverPage(doc, front)

  const blob = doc.output('blob')
  downloadBlob(filename, blob)
  return { blob }
}

// Einheitliches Aufzählungszeichen: ein kleiner Kreis. Die KI liefert je nach
// Abschnitt „• ", „- ", „– " oder „* " – im PDF wird daraus immer dasselbe Zeichen.
const BULLET = '•'
const BULLET_RE = /^[•●○◦·∙*\-–—]\s+(.*)$/

// Eine Textzeile in fette/normale Stücke zerlegen — dieselbe Logik für PDF und
// DOCX, damit beide Dateien identisch aussehen. Fett wird nur, was im Text selbst
// als **fett** ausgezeichnet ist; eine automatische Hervorhebung von Stichworten
// gab es kurzzeitig, sie traf im Bogen aber zu oft daneben. Markdown-Reste aus dem
// gespeicherten Text werden dabei aufgelöst (** → fett, _kursiv_ → weg).
// forPdf: „⚠" ersetzen — die Standardschriften von jsPDF können nur WinAnsi und
// würden daraus ein Kästchen machen.
function richTokens(line, { forPdf = false } = {}) {
  let s = String(line ?? '')
  if (forPdf) s = s.replace(/⚠️?\s*/g, '(!) ')
  s = s.replace(/(^|\s)_([^_]+)_(?=$|[\s.,;:!?])/g, '$1$2').trim()
  const out = []
  for (const part of s.split(/(\*\*[^*]+\*\*)/g)) {
    if (!part) continue
    if (part.startsWith('**') && part.endsWith('**')) out.push({ t: part.slice(2, -2), b: true })
    else out.push({ t: part, b: false })
  }
  return out.filter(t => t.t.trim())
}

// Fließtext in Setz-Einheiten zerlegen (eine je Zeile). `blank` merkt sich, ob im
// Quelltext eine Leerzeile davor stand — die KI trennt Stichpunkte mal mit einem
// Umbruch, mal mit einer Leerzeile, und daraus entstand im Export der ungleiche
// Zeilenabstand (z. B. bei „Vorerkrankungen").
function textItems(text) {
  const items = []
  let blank = false
  for (const rawLine of String(text || '').split('\n')) {
    const l = rawLine.trim()
    if (!l) { blank = true; continue }
    const level = l.startsWith('## ') ? 2 : l.startsWith('# ') ? 1 : 0
    const b = level ? null : l.match(BULLET_RE)
    items.push({
      kind: level ? 'heading' : b ? 'bullet' : 'text',
      level, blank,
      text: level ? l.slice(level + 1) : b ? b[1] : l,
    })
    blank = false
  }
  return items
}

// Abstand VOR einer Zeile. Aufeinanderfolgende Aufzählungspunkte stehen immer
// direkt untereinander — unabhängig davon, ob im Quelltext eine Leerzeile
// zwischen ihnen stand. Sonst gibt es Abstand nur bei echtem Absatzwechsel.
function itemGapBefore(items, i, gap) {
  const it = items[i], prev = items[i - 1]
  if (!prev || prev.kind === 'heading') return 0
  if (prev.kind === 'bullet' && it.kind === 'bullet') return 0
  return it.blank ? gap : 0
}

// Logo-Quelle auflösen: Data-URL direkt, sonst laden. SVG (z. B. das KVSW-Logo)
// können weder jsPDF noch docx — es wird über ein Canvas in ein PNG gerastert.
async function resolveLogoDataUrl(src) {
  if (!src || typeof src !== 'string') return null
  if (src.startsWith('data:image/')) return src
  try {
    const res = await fetch(src)
    if (!res.ok) return null
    const blob = await res.blob()
    if (!/^image\//.test(blob.type)) return null
    const dataUrl = await new Promise(r => {
      const fr = new FileReader()
      fr.onload = () => r(String(fr.result)); fr.onerror = () => r(null)
      fr.readAsDataURL(blob)
    })
    if (!dataUrl) return null
    if (!/^image\/svg/.test(blob.type)) return dataUrl
    // SVG rastern (3× für einen sauberen Druck)
    return await new Promise(r => {
      const im = new Image()
      im.onload = () => {
        const w = im.naturalWidth || 600, h = im.naturalHeight || 200
        const cv = document.createElement('canvas')
        cv.width = w * 3; cv.height = h * 3
        const ctx = cv.getContext('2d')
        ctx.drawImage(im, 0, 0, cv.width, cv.height)
        try { r(cv.toDataURL('image/png')) } catch { r(null) }
      }
      im.onerror = () => r(null)
      im.src = dataUrl
    })
  } catch { return null }
}

// Fließtext (Pflegeexzerpt, Rede, Anamnesebogen …) als A4-PDF. Gleiche Konvention
// wie beim DOCX-Export: „# " / „## " am Absatzanfang sind Überschriften. Bewusst
// nüchtern gesetzt — das Dokument wird ausgedruckt und in eine Akte geheftet.
// opts.logo: Data-URL des Inhaber-Logos (Seite 1, oben rechts).
// opts.disclaimerTitle/-Text: überschreiben den Buch-Hinweis am Ende (Anamnesebogen).
export async function downloadTextPdf(filename, title, text, lang = 'de', opts = {}) {
  const bt = uiText(lang)
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const margin = 22
  const maxW = pageW - margin * 2
  let y = margin

  // Einheitlich EINFACHER Zeilenabstand für ALLE Zeilen und Schriftgrößen
  // (1,15 × Schriftgrad = „einfach" in Word). Zusatzabstände gibt es nur
  // zwischen Absätzen und vor Überschriften — NIE zwischen zwei Zeilen.
  const LINE = 1.15
  const GAP = 3             // Abstand zwischen zwei Absätzen
  const HEAD_GAP_BEFORE = 5 // zusätzlicher Abstand vor einer Überschrift
  const lh = size => size * 0.3528 * LINE
  const bottom = () => pageH - margin - 8
  const ensure = h => { if (y + h > bottom()) { doc.addPage(); y = margin } }

  // Zeile(n) aus fetten/normalen Stücken setzen. `bullet` rückt mit hängendem
  // Einzug ein (Folgezeilen stehen unter dem Text, nicht unter dem Kreis).
  const writeRich = (tokens, { size = 11, color = [40, 40, 40], gapAfter = 0, bullet = false } = {}) => {
    const textX = margin + (bullet ? 7 : 0)
    const width = maxW - (bullet ? 7 : 0)
    doc.setFontSize(size); doc.setTextColor(...color)
    const words = []
    for (const t of tokens) for (const w of String(t.t).split(/\s+/).filter(Boolean)) words.push({ w, b: t.b })
    let line = [], lineW = 0, firstLine = true
    const flush = () => {
      if (!line.length) return
      ensure(lh(size))
      if (firstLine && bullet) { doc.setFont('helvetica', 'normal'); doc.text(BULLET, margin + 2, y) }
      let x = textX
      for (const it of line) {
        doc.setFont('helvetica', it.b ? 'bold' : 'normal')
        doc.text(it.w, x, y)
        x += doc.getTextWidth(`${it.w} `)
      }
      y += lh(size); line = []; lineW = 0; firstLine = false
    }
    for (const it of words) {
      doc.setFont('helvetica', it.b ? 'bold' : 'normal')
      const w = doc.getTextWidth(it.w)
      const sp = line.length ? doc.getTextWidth(' ') : 0
      if (line.length && lineW + sp + w > width) flush()
      line.push(it); lineW += (line.length > 1 ? doc.getTextWidth(' ') : 0) + w
    }
    flush()
    y += gapAfter
  }
  const write = (str, { size = 11, style = 'normal', color = [40, 40, 40], gapAfter = GAP } = {}) => {
    doc.setFont('helvetica', style); doc.setFontSize(size); doc.setTextColor(...color)
    for (const line of doc.splitTextToSize(String(str ?? ''), maxW)) {
      ensure(lh(size)); doc.text(line, margin, y); y += lh(size)
    }
    y += gapAfter
  }

  // Logo auf Seite 1 (oben rechts). SVG wird vorher gerastert.
  const pdfLogo = await prepareLogoForExport(await resolveLogoDataUrl(opts.logo))
  if (pdfLogo && /^(png|jpe?g)$/.test(pdfLogo.kind)) {
    let w = 40, h = w * pdfLogo.h / pdfLogo.w
    if (h > 20) { h = 20; w = h * pdfLogo.w / pdfLogo.h }
    doc.addImage(pdfLogo.dataUrl, pdfLogo.kind === 'png' ? 'PNG' : 'JPEG', pageW - margin - w, y, w, h)
    y += h + 6
  }

  write(title, { size: 18, style: 'bold', color: [25, 25, 25], gapAfter: 2 })
  doc.setDrawColor(200); ensure(3); doc.line(margin, y, pageW - margin, y); y += 6

  const items = textItems(text)
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    if (it.kind === 'heading') {
      // „Nicht vom Folgetext trennen": Passen Überschrift + zwei Textzeilen nicht
      // mehr auf die Seite, wandert die Überschrift mit auf die nächste.
      y += HEAD_GAP_BEFORE
      const size = it.level === 1 ? 15 : 13
      if (y + lh(size) + 2 + 2 * lh(11) > bottom()) { doc.addPage(); y = margin }
      writeRich([{ t: it.text, b: true }], { size, color: [25, 25, 25], gapAfter: 2 })
      continue
    }
    y += itemGapBefore(items, i, GAP)
    writeRich(richTokens(it.text, { forPdf: true }), { size: 11, gapAfter: 0, bullet: it.kind === 'bullet' })
  }

  y += 4
  write(opts.disclaimerTitle || bt.aiDisclaimerTitle, { size: 9, style: 'bold', color: [120, 113, 108], gapAfter: 1 })
  write(opts.disclaimerText || bt.aiDisclaimer, { size: 8, style: 'italic', color: [120, 113, 108], gapAfter: 0 })

  // Seitenzahlen
  const total = doc.getNumberOfPages()
  for (let i = 1; i <= total; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(150)
    doc.text(`${i} / ${total}`, pageW - margin, pageH - 10, { align: 'right' })
  }
  doc.save(filename)
}

// Fließtext als DOCX — bewusst 1:1 wie downloadTextPdf gesetzt (einfacher
// Zeilenabstand, dieselben Aufzählungskreise, Logo auf Seite 1, derselbe
// Entstehungs-Hinweis), damit PDF und Word-Datei identisch aussehen.
export async function downloadAsDocx(filename, title, text, lang = 'de', opts = {}) {
  const bt = uiText(lang)
  const SINGLE = { line: 240, lineRule: 'auto' }   // einfacher Zeilenabstand
  const children = []

  // Logo oben auf Seite 1 (rechtsbündig). SVG wird vorher gerastert.
  const docxLogo = await prepareLogoForExport(await resolveLogoDataUrl(opts.logo))
  if (docxLogo && /^(png|jpe?g|gif)$/.test(docxLogo.kind)) {
    let w = 130, h = Math.round(w * docxLogo.h / docxLogo.w)
    if (h > 70) { h = 70; w = Math.round(h * docxLogo.w / docxLogo.h) }
    try {
      children.push(new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { after: 200 },
        children: [new ImageRun({ data: dataUrlToUint8(docxLogo.dataUrl), transformation: { width: w, height: h } })] }))
    } catch { /* defektes Logo darf den Export nicht abbrechen */ }
  }

  children.push(new Paragraph({
    text: title,
    heading: HeadingLevel.HEADING_1,
    alignment: AlignmentType.CENTER,
    spacing: { after: 400, ...SINGLE },
  }))
  // Zeile → Word-Runs (dieselbe Zerlegung wie im PDF)
  const runs = line => richTokens(line).map(t => new TextRun({ text: t.t, bold: t.b }))
  // Zeilenweise wie im PDF (gleiche Zerlegung, gleiche Abstandsregel): Aufzählungen
  // bekommen überall denselben kleinen Kreis (Word-Listenpunkt) und stehen ohne
  // Zusatzabstand untereinander.
  const items = textItems(text)
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    if (it.kind === 'heading') {
      // keepNext: Word zieht die Überschrift mit auf die nächste Seite, statt sie
      // allein am Seitenende stehen zu lassen.
      children.push(new Paragraph({
        text: richTokens(it.text).map(t => t.t).join(' '),
        heading: it.level === 1 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2,
        keepNext: true, keepLines: true,
        spacing: { before: 300, after: 120, ...SINGLE },
      }))
    } else {
      children.push(new Paragraph({
        children: runs(it.text),
        ...(it.kind === 'bullet' ? { bullet: { level: 0 } } : {}),
        spacing: { before: itemGapBefore(items, i, 160), after: 0, ...SINGLE },
      }))
    }
  }
  children.push(new Paragraph({
    children: [new TextRun({ text: opts.disclaimerTitle || bt.aiDisclaimerTitle, size: 20, bold: true, color: '78716c' })],
    spacing: { before: 500, after: 120, ...SINGLE },
  }))
  children.push(new Paragraph({
    children: [new TextRun({ text: opts.disclaimerText || bt.aiDisclaimer, size: 18, italics: true, color: '78716c' })],
    spacing: { after: 200, ...SINGLE },
  }))
  const doc = new Document({
    creator: 'Lebenswerk', title,
    styles: { default: { document: { run: { font: DOCX_FONT, size: 24 } } } },
    sections: [docxSection(children)],
  })
  downloadBlob(filename, await Packer.toBlob(doc))
}
