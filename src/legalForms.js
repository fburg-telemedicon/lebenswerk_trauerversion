// src/legalForms.js
// Gemeinsamer Formular-Baukasten der Vorsorge-Dokumente des Lebenswerks:
//
//   src/careDirective.js    — Betreuungsverfügung
//   src/powerOfAttorney.js  — Vorsorgevollmacht
//
// Beide sind DIN-A4-Formulare mit derselben Anmutung: Abschnittsüberschriften,
// Ausfüllfelder mit Linie, Ankreuzkästchen, Hinweisblöcke mit farbigem Balken,
// Unterschriftszeilen und eine Fußzeile auf jeder Seite. Die Bausteine lagen
// zuerst in careDirective.js; als die Vollmacht dazukam, wären sie ein zweites
// Mal entstanden — und zwei Formulare, die sich langsam auseinanderentwickeln,
// sind bei Rechtsdokumenten das Letzte, was man will.
//
// Maße in mm, Ursprung oben links (wie lifeworkExtras.js).

import { newPdfDoc } from './pdfFonts.js'

export const INK   = [35, 35, 35]
export const SOFT  = [110, 110, 110]
export const AMBER = [180, 83, 9]     // Warnung / Entwurfshinweis
export const BLUE  = [37, 99, 235]    // Hinweis aus der Lebensgeschichte
export const RED   = [185, 28, 28]    // besonders heikle Befugnis

export const PAGE = { PW: 210, PH: 297, M: 20, FOOT: 15 }

// Erzeugt ein leeres A4-Dokument samt Werkzeugkasten. Der Schreibcursor `y`
// gehört dem Werkzeugkasten; wer von Hand zeichnet (Unterschriftszeilen),
// liest und setzt ihn über `t.y`.
export function newForm() {
  const doc = newPdfDoc({ unit: 'mm', format: 'a4' })
  const { PW, PH, M, FOOT } = PAGE
  const maxW = PW - 2 * M
  let y = M

  const lh = s => s * 0.3528 * 1.22
  const ensure = h => { if (y + h > PH - FOOT) { doc.addPage(); y = M } }

  function text(str, { size = 10.5, style = 'normal', color = INK, x = M, w = maxW, gapAfter = 2.5, align } = {}) {
    doc.setFont('helvetica', style); doc.setFontSize(size); doc.setTextColor(...color)
    for (const line of doc.splitTextToSize(String(str ?? ''), w)) {
      ensure(lh(size))
      if (align === 'center') doc.text(line, PW / 2, y, { align: 'center' })
      else doc.text(line, x, y)
      y += lh(size)
    }
    y += gapAfter
  }

  function rule(color = [200, 200, 200], lw = 0.3) {
    ensure(2); doc.setDrawColor(...color); doc.setLineWidth(lw)
    doc.line(M, y, PW - M, y); y += 3
  }

  // Abschnittsüberschrift. Sie darf nicht allein am Seitenfuß stehen bleiben —
  // deshalb wird Platz für Überschrift plus zwei Textzeilen verlangt.
  function h1(str) {
    y += 4
    if (y + lh(13) + 4 + 2 * lh(10.5) > PH - FOOT) { doc.addPage(); y = M }
    text(str, { size: 13, style: 'bold', color: [20, 20, 20], gapAfter: 1 })
    rule([170, 170, 170], 0.4)
  }
  function h2(str) {
    y += 2
    if (y + lh(11) + 2 * lh(10.5) > PH - FOOT) { doc.addPage(); y = M }
    text(str, { size: 11, style: 'bold', color: [30, 30, 30], gapAfter: 1.5 })
  }

  // Aufzählungspunkt; `box` setzt statt des Punktes ein Ankreuzkästchen.
  function bullet(str, { box = false, size = 10.5, indent = 0, color = INK } = {}) {
    const x = M + indent + (box ? 6.5 : 5)
    const w = maxW - (x - M)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(size); doc.setTextColor(...color)
    doc.splitTextToSize(String(str ?? ''), w).forEach((ln, i) => {
      ensure(lh(size))
      if (i === 0) {
        if (box) { doc.setDrawColor(120); doc.setLineWidth(0.35); doc.rect(M + indent, y - 3.1, 3.5, 3.5) }
        else { doc.setFillColor(130); doc.circle(M + indent + 1.5, y - 1.2, 0.65, 'F') }
      }
      doc.setTextColor(...color)
      doc.text(ln, x, y); y += lh(size)
    })
    y += 1.2
  }

  // Ausfüllfeld: Beschriftung links, Linie rechts. `value` wird nur gesetzt,
  // wenn die Angabe wirklich bekannt ist — geraten wird in einem solchen
  // Dokument nichts.
  function field(label, value = '', { labelW = 40, w = maxW } = {}) {
    ensure(9)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...SOFT)
    doc.text(label, M, y)
    doc.setDrawColor(160); doc.setLineWidth(0.25)
    doc.line(M + labelW, y + 0.9, M + w, y + 0.9)
    if (value) {
      doc.setFontSize(10.5); doc.setTextColor(...INK)
      doc.text(String(value), M + labelW + 1.5, y)
    }
    y += 8.5
  }

  function blankLines(n = 3, w = maxW) {
    for (let i = 0; i < n; i++) {
      ensure(8); doc.setDrawColor(175); doc.setLineWidth(0.25)
      doc.line(M, y + 0.9, M + w, y + 0.9); y += 8
    }
    y += 1
  }

  // Hinweisblock mit farbigem Balken links. Bewusst KEIN gefüllter Kasten: Der
  // Block darf über einen Seitenumbruch laufen, ein Kasten könnte das nicht.
  function callout(title, items, accent = BLUE) {
    y += 1.5
    const push = (str, style, size, color) => {
      doc.setFont('helvetica', style); doc.setFontSize(size); doc.setTextColor(...color)
      for (const ln of doc.splitTextToSize(String(str ?? ''), maxW - 7)) {
        ensure(lh(size))
        doc.setDrawColor(...accent); doc.setLineWidth(1)
        doc.line(M + 0.5, y - 3.2, M + 0.5, y + 1)
        doc.setFont('helvetica', style); doc.setTextColor(...color)
        doc.text(ln, M + 7, y); y += lh(size)
      }
    }
    if (title) push(title, 'bold', 9.5, accent)
    for (const it of items) push(it, 'normal', 9.5, [70, 70, 70])
    y += 3.5
  }

  // Ja/Nein-Ankreuzzeile für einen Aufgaben- oder Vollmachtsbereich.
  function yesNo(yesLabel, noLabel) {
    ensure(9)
    doc.setDrawColor(90); doc.setLineWidth(0.4)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...INK)
    doc.rect(M, y - 3.2, 3.8, 3.8)
    doc.text(yesLabel, M + 6, y)
    const x2 = M + 105
    doc.rect(x2, y - 3.2, 3.8, 3.8)
    doc.text(noLabel, x2 + 6, y)
    y += 8
  }

  // Zwei nebeneinanderliegende Unterschriftszeilen (Ort/Datum | Unterschrift).
  function signatureRow(leftLabel, rightLabel, { gapBefore = 10, gapAfter = 22, lw = 0.35, color = 120 } = {}) {
    ensure(gapBefore + 14)
    doc.setDrawColor(color); doc.setLineWidth(lw)
    doc.line(M, y + gapBefore, M + 78, y + gapBefore)
    doc.line(M + 92, y + gapBefore, PW - M, y + gapBefore)
    if (leftLabel || rightLabel) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...SOFT)
      if (leftLabel) doc.text(leftLabel, M, y + gapBefore + 4.5)
      if (rightLabel) doc.text(rightLabel, M + 92, y + gapBefore + 4.5)
    }
    y += gapAfter
  }

  // Fußzeile auf ALLEN Seiten. Ganz am Ende aufrufen — vorher steht die
  // Gesamtseitenzahl noch nicht fest.
  function footer(leftText) {
    const total = doc.getNumberOfPages()
    for (let p = 1; p <= total; p++) {
      doc.setPage(p)
      doc.setDrawColor(215); doc.setLineWidth(0.25)
      doc.line(M, PH - 12, PW - M, PH - 12)
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(140, 140, 140)
      doc.text(String(leftText || ''), M, PH - 8)
      doc.text(`Seite ${p} von ${total}`, PW - M, PH - 8, { align: 'right' })
    }
  }

  // Fußzeile für eine MAPPE aus mehreren Urkunden. Jeder Teil zählt seine
  // Seiten selbst („Teil 1 · Seite 2 von 4"), denn genau darauf kommt es an:
  // Die Vollmacht wird der Bank einzeln vorgelegt, und eine Urkunde, deren
  // Seitenzählung mitten im Dokument beginnt, sieht nach fehlenden Seiten aus.
  // `sections` = [{ from, label }] mit `from` = erste Seite des Teils (1-basiert),
  // aufsteigend. Seiten vor dem ersten Abschnitt (Deckblatt) bleiben ohne Zählung.
  function footerSections(sections, leftText) {
    const total = doc.getNumberOfPages()
    const secs = [...sections].sort((a, b) => a.from - b.from)
      .map((s, i, all) => ({ ...s, to: (all[i + 1]?.from ?? total + 1) - 1 }))
    for (let p = 1; p <= total; p++) {
      doc.setPage(p)
      doc.setDrawColor(215); doc.setLineWidth(0.25)
      doc.line(M, PH - 12, PW - M, PH - 12)
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(140, 140, 140)
      const sec = secs.find(s => p >= s.from && p <= s.to)
      doc.text(sec ? `${sec.label}${leftText ? ` · ${leftText}` : ''}` : String(leftText || ''), M, PH - 8)
      if (sec) doc.text(`Seite ${p - sec.from + 1} von ${sec.to - sec.from + 1}`, PW - M, PH - 8, { align: 'right' })
    }
  }

  return {
    doc, maxW, PW, PH, M,
    get y() { return y }, set y(v) { y = v },
    lh, ensure, gap: h => { y += h },
    text, rule, h1, h2, bullet, field, blankLines, callout, yesNo, signatureRow, footer, footerSections,
    // Neue Seite erzwingen — jede Urkunde der Mappe beginnt auf einem eigenen
    // Blatt, sonst endet Teil 1 und beginnt Teil 2 auf derselben Seite und die
    // Teile lassen sich nicht mehr getrennt vorlegen.
    newPage() { doc.addPage(); y = M; return doc.getNumberOfPages() },
    page() { return doc.getNumberOfPages() },
  }
}

// ── Bausteine, die beide Dokumente teilen ─────────────────────────

// Die KI liefert Listenfelder mal als Liste, mal als Objekt — beides annehmen,
// statt am Formatwechsel eines einzelnen Laufs zu scheitern.
export function pickByKey(src, key) {
  if (Array.isArray(src)) return src.find(a => a?.key === key) || {}
  if (src && typeof src === 'object') return src[key] || {}
  return {}
}
export const strList = v => (Array.isArray(v) ? v : []).map(s => String(s ?? '').trim()).filter(Boolean)

// Wunsch-Einträge normalisieren: { text, evidence } — Strings sind auch erlaubt.
export function wishList(a, field = 'wishes') {
  return (Array.isArray(a?.[field]) ? a[field] : [])
    .map(w => (typeof w === 'string'
      ? { text: w.trim(), evidence: '' }
      : { text: String(w?.text ?? '').trim(), evidence: String(w?.evidence ?? '').trim() }))
    .filter(w => w.text)
}

// Sammelbezeichnungen und Platzhalter, die als „Name" durchgehen wollen.
// Aufgefallen im Probelauf mit zwei fertigen Biographien: „Söhne (nicht einzeln
// benannt)" und „meine Schwester" standen in der Liste der Vertrauenspersonen.
// Als Gedächtnisstütze ist das wertlos — gemeint ist eine Person, die man
// ansprechen kann. Der Prompt verbietet es inzwischen; hier steht das Netz,
// falls das Modell sich nicht daran hält.
const NO_NAME = /^(meine|mein|unsere|unser|die|der|das)\s|[()]/i
// Reine Verwandtschaftsbezeichnung STATT eines Namens („Schwester", „Ehefrau").
// Nur bei exakter Übereinstimmung — „Schwester Anna" ist ein Name und bleibt.
const KINSHIP = new Set([
  'kind', 'kinder', 'sohn', 'söhne', 'tochter', 'töchter', 'enkel', 'enkelin', 'enkelkind',
  'geschwister', 'schwester', 'bruder', 'familie', 'mutter', 'vater', 'eltern',
  'ehefrau', 'ehemann', 'frau', 'mann', 'partner', 'partnerin', 'lebensgefährte', 'lebensgefährtin',
  'nichte', 'neffe', 'schwager', 'schwägerin', 'schwiegertochter', 'schwiegersohn',
  'nachbar', 'nachbarin', 'nachbarn', 'freund', 'freundin', 'freunde', 'angehörige', 'angehöriger',
])

// Personen-Hinweise (Vertrauenspersonen aus dem Interview) normalisieren.
export function personList(v, limit = 4) {
  return (Array.isArray(v) ? v : [])
    .map(h => ({
      name: String(h?.name ?? '').trim(),
      relation: String(h?.relation ?? '').trim(),
      evidence: String(h?.evidence ?? '').trim(),
    }))
    .filter(h => h.name && !NO_NAME.test(h.name) && !KINSHIP.has(h.name.toLowerCase()))
    .slice(0, limit)
}
export const personLine = h => (h.relation ? `${h.name} (${h.relation})` : h.name)
