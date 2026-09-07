// src/avocaExport.js
// Zeichnet das Kompetenzprofil aus den Daten der Spalte `avoca` — PDF und DOCX.
//
// GESTALTUNGSENTSCHEIDUNGEN, die inhaltlich sind und deshalb nicht beiläufig
// geändert werden sollten:
//
//  - KEIN RADAR, KEIN AMPELDIAGRAMM. Eine Netzgrafik über fünf Stufen lädt zum
//    Vergleichen zweier Menschen ein und verdeckt, worauf jede Stufe beruht.
//    Stattdessen eine schlichte Stufenleiste je Dimension, direkt neben den
//    Belegen, die sie tragen.
//  - KEIN ROT/GRÜN. Eine niedrige Stufe ist kein Mangel, sondern eine
//    Beschreibung. Farbe würde daraus eine Bewertung machen.
//  - BELEGE STEHEN IM DOKUMENT, nicht in einem Anhang. Wer die Stufe liest,
//    soll im selben Blickfeld sehen, worauf sie sich stützt — und die
//    Gegenprobe gleich darunter.
//  - NICHT BELEGBARE DIMENSIONEN werden ausgedruckt, nicht weggelassen. Eine
//    fehlende Grundlage ist eine Aussage über das Gespräch, keine Leerstelle.

import { Document, Packer, Paragraph, HeadingLevel, TextRun } from 'docx'
import { loadPdfFonts, newPdfDoc } from './pdfFonts.js'
import { downloadBlob } from './bookExport.js'
import { AVOCA_DIMENSIONS, getDimension, RUBRIC_VERSION, RUBRIC_DATE, RUBRIC_ORIGIN, AVOCA_DISCLAIMER, AVOCA_DISCLAIMER_EN } from './avocaRubric.js'

const INK  = [30, 30, 30]
const SOFT = [110, 110, 110]
const LINE = [200, 200, 200]
const FILL = [60, 60, 60]
const PAGE = { PW: 210, PH: 297, M: 20, FOOT: 16 }

const T = {
  de: {
    title: 'Kompetenzprofil', subtitle: 'Handeln in erzählten Situationen entlang der fünf AVOCA-Dimensionen',
    level: 'Stufe', of: 'von', strength: 'Belegstärke', evidence: 'Belege', counter: 'Gegenprobe',
    development: 'Wo Entwicklung ansetzen könnte', overall: 'Gesamtbild', unclear: 'Nicht belegbar',
    noCounter: 'Keine Gegenbelege im Gespräch gefunden.', missing: 'Im Gespräch nicht genannt',
    rubric: 'Rubrik', page: 'Seite', source: 'Beleg', note: 'Zum Vorgehen',
    disclaimer: AVOCA_DISCLAIMER,
  },
  en: {
    title: 'Competency profile', subtitle: 'Action in recounted situations along the five AVOCA dimensions',
    level: 'Level', of: 'of', strength: 'Evidence strength', evidence: 'Evidence', counter: 'Counter-check',
    development: 'Where development could start', overall: 'Overall picture', unclear: 'Not evidenced',
    noCounter: 'No counter-evidence found in the interview.', missing: 'Not stated in the interview',
    rubric: 'Rubric', page: 'Page', source: 'Source', note: 'On the method',
    disclaimer: AVOCA_DISCLAIMER_EN,
  },
}
const labels = data => T[data?.language === 'en' ? 'en' : 'de']

const str = v => String(v ?? '').trim()
const list = v => (Array.isArray(v) ? v : []).map(str).filter(Boolean)
const rows = v => (Array.isArray(v) ? v : []).filter(x => x && typeof x === 'object')

function sheet(doc) {
  const { PW, PH, M, FOOT } = PAGE
  const maxW = PW - 2 * M
  let y = M
  const lh = s => s * 0.3528 * 1.25
  const ensure = h => { if (y + h > PH - FOOT) { doc.addPage(); y = M } }

  function text(s, { size = 10, style = 'normal', color = INK, x = M, w = maxW, gapAfter = 2, align } = {}) {
    if (!str(s)) return
    doc.setFont('helvetica', style); doc.setFontSize(size); doc.setTextColor(...color)
    for (const ln of doc.splitTextToSize(String(s), w)) {
      ensure(lh(size))
      if (align === 'right') doc.text(ln, x + w, y, { align: 'right' })
      else doc.text(ln, x, y)
      y += lh(size)
    }
    y += gapAfter
  }

  // Die Stufenleiste: fuenf Kaestchen, die erreichte Stufe gefuellt. Bewusst
  // grau — Farbe waere hier eine Wertung.
  function scale(level) {
    const boxW = 9, gap = 2.2, h = 4.2
    ensure(h + 3)
    for (let i = 1; i <= 5; i++) {
      const x = M + (i - 1) * (boxW + gap)
      if (level && i <= level) { doc.setFillColor(...FILL); doc.rect(x, y, boxW, h, 'F') }
      else { doc.setDrawColor(175); doc.setLineWidth(0.25); doc.rect(x, y, boxW, h) }
    }
    y += h + 3.5
  }

  function quote(q, srcLabel) {
    const src = str(q.source)
    const body = str(q.quote)
    if (!body && !str(q.note)) return
    const w = maxW - 5
    doc.setFont('helvetica', 'italic'); doc.setFontSize(9.2); doc.setTextColor(50, 50, 50)
    for (const ln of doc.splitTextToSize(`„${body}"`, w)) {
      ensure(lh(9.2))
      doc.setDrawColor(190); doc.setLineWidth(0.5)
      doc.line(M + 0.8, y - 2.8, M + 0.8, y + 0.6)
      doc.text(ln, M + 5, y); y += lh(9.2)
    }
    const tail = [src ? `${srcLabel} ${src}` : '', str(q.note)].filter(Boolean).join(' · ')
    if (tail) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.2); doc.setTextColor(...SOFT)
      for (const ln of doc.splitTextToSize(tail, w)) { ensure(lh(8.2)); doc.text(ln, M + 5, y); y += lh(8.2) }
    }
    y += 2
  }

  return {
    doc, text, scale, quote,
    gap: h => { y += h },
    rule: () => { ensure(2); doc.setDrawColor(...LINE); doc.setLineWidth(0.3); doc.line(M, y, PW - M, y); y += 3 },
    // Ueberschrift einer Dimension: bricht um, wenn der Block nicht mehr
    // sinnvoll auf die Seite passt — Stufe und Belege gehoeren zusammen.
    dimHead: (name, code) => {
      y += 5
      if (y + 34 > PH - FOOT) { doc.addPage(); y = M }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(20, 20, 20)
      doc.text(String(name), M, y)
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...SOFT)
      doc.text(String(code), PW - M, y, { align: 'right' })
      y += lh(13) + 1
      doc.setDrawColor(170); doc.setLineWidth(0.4); doc.line(M, y, PW - M, y); y += 4
    },
    section: s => {
      y += 2.5
      ensure(lh(9) + lh(9.2) * 2)
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8.8); doc.setTextColor(...SOFT)
      doc.text(String(s).toUpperCase(), M, y); y += lh(8.8) + 1.2
    },
  }
}

function drawFooters(doc, data, t) {
  const total = doc.getNumberOfPages()
  const name = str(data.person?.name)
  const ver = str(data.rubric_version) || RUBRIC_VERSION
  for (let i = 1; i <= total; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...SOFT)
    doc.text(`${t.rubric} ${ver} · ${t.title}`, PAGE.M, PAGE.PH - 9)
    doc.text(`${name ? name + ' · ' : ''}${t.page} ${i}/${total}`, PAGE.PW - PAGE.M, PAGE.PH - 9, { align: 'right' })
  }
}

export async function buildAvocaDoc(data, memorial = null) {
  if (!data || typeof data !== 'object') throw new Error('Es liegen keine Profildaten vor.')
  await loadPdfFonts()
  const t = labels(data)
  const doc = newPdfDoc({ unit: 'mm', format: 'a4' })
  const s = sheet(doc)
  const name = str(data.person?.name) || str(memorial?.name)

  s.text(t.title, { size: 20, style: 'bold', gapAfter: 1 })
  if (name) s.text(name, { size: 12, color: [70, 70, 70], gapAfter: 1 })
  s.text(t.subtitle, { size: 9.5, color: SOFT, gapAfter: 2 })
  s.rule()

  // Der feste Hinweis steht VORNE, nicht im Kleingedruckten am Ende: Wer das
  // Dokument aufschlaegt, soll zuerst wissen, was es nicht ist.
  s.gap(1)
  s.text(t.disclaimer, { size: 8.6, color: [80, 80, 80], gapAfter: 2 })
  s.rule()

  if (str(data.overall)) { s.section(t.overall); s.text(data.overall, { size: 10 }) }

  const dims = rows(data.dimensions)
  // Immer alle fuenf, in der Reihenfolge der Rubrik — auch die, zu denen die
  // KI nichts geliefert hat.
  for (const def of AVOCA_DIMENSIONS) {
    const d = dims.find(x => str(x.code) === def.code) || { code: def.code, unclear: true, unclear_reason: '' }
    s.dimHead(def.name, def.code)
    s.text(def.definition, { size: 8.8, color: SOFT, gapAfter: 3 })

    const lvl = Number.isInteger(d.level) ? d.level : null
    const unclear = d.unclear === true || lvl === null
    if (unclear) {
      s.text(t.unclear, { size: 10, style: 'bold', gapAfter: 1 })
      s.text(str(d.unclear_reason) || '—', { size: 9.5, color: [70, 70, 70] })
    } else {
      s.scale(lvl)
      s.text(`${t.level} ${lvl} ${t.of} 5 — ${def.levels[lvl - 1] || ''}`, { size: 9.6, gapAfter: 1.5 })
      const strength = str(d.evidence_strength)
      if (strength) s.text(`${t.strength}: ${strength}`, { size: 8.8, color: SOFT, gapAfter: 2 })
    }

    if (str(d.summary)) s.text(d.summary, { size: 10, gapAfter: 2 })

    const ev = rows(d.evidence)
    if (ev.length) { s.section(t.evidence); for (const q of ev) s.quote(q, t.source) }

    // Die Gegenprobe steht auch dann im Dokument, wenn sie nichts ergeben hat —
    // dann als Notiz, WONACH gesucht wurde. Ein stillschweigend leerer Abschnitt
    // liesse offen, ob gesucht oder nur nichts gefunden wurde.
    const ce = rows(d.counter_evidence)
    s.section(t.counter)
    if (ce.length) for (const q of ce) s.quote(q, t.source)
    if (str(d.counter_note)) s.text(str(d.counter_note), { size: 9, color: SOFT, gapAfter: 1 })
    else if (!ce.length) s.text(t.noCounter, { size: 9, color: SOFT, gapAfter: 1 })

    const dev = list(d.development)
    if (dev.length) {
      s.section(t.development)
      for (const x of dev) s.text(`— ${x}`, { size: 9.3, color: [60, 60, 60], gapAfter: 1 })
    }
  }

  const missing = list(data.not_stated)
  if (missing.length) {
    s.gap(4); s.rule()
    s.text(t.missing, { size: 9, style: 'bold', color: SOFT, gapAfter: 1 })
    s.text(missing.join(' · '), { size: 8.5, color: SOFT })
  }

  s.gap(3)
  s.text(`${t.note}: ${t.rubric} ${str(data.rubric_version) || RUBRIC_VERSION} (${RUBRIC_DATE}). ${RUBRIC_ORIGIN}`,
         { size: 8, color: SOFT })

  drawFooters(doc, data, t)
  return doc
}

export async function downloadAvocaPdf(filename, data, memorial = null) {
  const doc = await buildAvocaDoc(data, memorial)
  doc.save(filename)
}

export async function downloadAvocaDocx(filename, data, memorial = null) {
  if (!data || typeof data !== 'object') throw new Error('Es liegen keine Profildaten vor.')
  const t = labels(data)
  const SINGLE = { line: 240, lineRule: 'auto' }
  const c = []
  const P = (text, o = {}) => c.push(new Paragraph({ children: [new TextRun({ text: String(text), ...o.run })], spacing: { after: 120, ...SINGLE, ...o.spacing } }))
  const H = (text, level = HeadingLevel.HEADING_2) => c.push(new Paragraph({ text: String(text), heading: level, keepNext: true, spacing: { before: 280, after: 120, ...SINGLE } }))

  const name = str(data.person?.name) || str(memorial?.name)
  c.push(new Paragraph({ text: t.title, heading: HeadingLevel.HEADING_1, spacing: { after: 80, ...SINGLE } }))
  if (name) P(name, { run: { color: '444444' } })
  P(t.subtitle, { run: { color: '777777', size: 18 } })
  P(t.disclaimer, { run: { color: '666666', size: 17, italics: true } })

  if (str(data.overall)) { H(t.overall); P(data.overall) }

  const dims = rows(data.dimensions)
  for (const def of AVOCA_DIMENSIONS) {
    const d = dims.find(x => str(x.code) === def.code) || { unclear: true }
    H(`${def.name} (${def.code})`)
    P(def.definition, { run: { color: '777777', size: 17 } })
    const lvl = Number.isInteger(d.level) ? d.level : null
    if (d.unclear === true || lvl === null) {
      P(t.unclear, { run: { bold: true } })
      if (str(d.unclear_reason)) P(d.unclear_reason)
    } else {
      P(`${t.level} ${lvl} ${t.of} 5 — ${def.levels[lvl - 1] || ''}`, { run: { bold: true } })
      if (str(d.evidence_strength)) P(`${t.strength}: ${str(d.evidence_strength)}`, { run: { color: '777777', size: 17 } })
    }
    if (str(d.summary)) P(d.summary)

    const ev = rows(d.evidence)
    if (ev.length) {
      P(t.evidence, { run: { bold: true, size: 18 } })
      for (const q of ev) {
        P(`„${str(q.quote)}"`, { run: { italics: true } })
        const tail = [str(q.source) ? `${t.source} ${str(q.source)}` : '', str(q.note)].filter(Boolean).join(' · ')
        if (tail) P(tail, { run: { color: '777777', size: 16 } })
      }
    }
    P(t.counter, { run: { bold: true, size: 18 } })
    const ce = rows(d.counter_evidence)
    if (ce.length) {
      for (const q of ce) {
        P(`„${str(q.quote)}"`, { run: { italics: true } })
        const tail = [str(q.source) ? `${t.source} ${str(q.source)}` : '', str(q.note)].filter(Boolean).join(' · ')
        if (tail) P(tail, { run: { color: '777777', size: 16 } })
      }
    }
    if (str(d.counter_note)) P(str(d.counter_note), { run: { color: '777777', size: 17 } })
    else if (!ce.length) P(t.noCounter, { run: { color: '777777', size: 17 } })

    const dev = list(d.development)
    if (dev.length) {
      P(t.development, { run: { bold: true, size: 18 } })
      for (const x of dev) c.push(new Paragraph({ text: x, bullet: { level: 0 }, spacing: { after: 40, ...SINGLE } }))
    }
  }

  if (list(data.not_stated).length) {
    H(t.missing)
    P(list(data.not_stated).join(' · '), { run: { color: '777777', size: 17 } })
  }
  P(`${t.note}: ${t.rubric} ${str(data.rubric_version) || RUBRIC_VERSION} (${RUBRIC_DATE}). ${RUBRIC_ORIGIN}`,
    { run: { color: '777777', size: 16, italics: true }, spacing: { before: 300 } })

  const doc = new Document({
    creator: 'Lebenswerk', title: `${t.title}${name ? ' – ' + name : ''}`,
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    sections: [{ children: c }],
  })
  downloadBlob(filename, await Packer.toBlob(doc))
}
