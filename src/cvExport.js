// src/cvExport.js
// Zeichnet den Lebenslauf der Kategorie „Lebenslauf" (career) aus den
// strukturierten Daten der Spalte `cv` — fünf Vorlagen, PDF und DOCX.
//
// Warum ein eigener Renderer und keine KI-Textausgabe: Der Inhalt entsteht
// EINMAL (src/career.js), die Form beliebig oft. Ein Vorlagenwechsel kostet
// deshalb weder Geld noch Wartezeit, und — wichtiger — er kann den Inhalt nicht
// verändern. Was einmal belegt in den Daten steht, steht in jeder Vorlage gleich.
//
// Die Vorlagen unterscheiden sich in Geometrie und Auswahl, nicht im Text:
//   klassisch   zweispaltig (Zeitraum | Station), vollständig
//   kompakt     Einseiter, je Station eine Zeile
//   interim     Mandatsliste mit Ausgangslage/Auftrag/Ergebnis/Übergabe
//   kurzprofil  halbe Seite zur Vorstellung
//   narrativ    Fließtext in der Ich-Form
//
// Schriften: über newPdfDoc() aus src/pdfFonts.js, damit sie im PDF EINGEBETTET
// sind (die Druckerei reklamiert sonst; siehe Kommentar dort).

import { Document, Packer, Paragraph, HeadingLevel, AlignmentType, TextRun } from 'docx'
import { loadPdfFonts, newPdfDoc } from './pdfFonts.js'
import { downloadBlob } from './bookExport.js'
import { getCvTemplate } from './career.js'

const INK  = [30, 30, 30]
const SOFT = [110, 110, 110]
const LINE = [200, 200, 200]
const PAGE = { PW: 210, PH: 297, M: 20, FOOT: 14 }

// ── Beschriftungen (nur DE/EN; die Inhalte selbst kommen in der Sprache, in
// der die KI sie erzeugt hat — data.language). ────────────────────────
const T = {
  de: {
    profile: 'Profil', career: 'Beruflicher Werdegang', education: 'Ausbildung',
    skills: 'Kompetenzen', languages: 'Sprachen', mandates: 'Mandate',
    situation: 'Ausgangslage', mandate: 'Auftrag', result: 'Ergebnis', handover: 'Übergabe',
    stations: 'Weitere Stationen', today: 'heute', since: 'seit', from: 'ab', until: 'bis',
    missing: 'Im Gespräch nicht genannt',
    missingHint: 'Diese Angaben fehlen im Lebenslauf, weil sie im Gespräch nicht vorkamen. Sie lassen sich jederzeit ergänzen — geschätzt wird nichts.',
    page: 'Seite', cv: 'Lebenslauf',
    note: 'Aus dem eigenen Bericht erstellt. Alle Angaben stammen aus dem geführten Gespräch.',
  },
  en: {
    profile: 'Profile', career: 'Professional experience', education: 'Education',
    skills: 'Skills', languages: 'Languages', mandates: 'Assignments',
    situation: 'Starting point', mandate: 'Assignment', result: 'Outcome', handover: 'Handover',
    stations: 'Further positions', today: 'present', since: 'since', from: 'from', until: 'until',
    missing: 'Not stated in the interview',
    missingHint: 'These details are absent because they did not come up in the interview. They can be added at any time — nothing is estimated.',
    page: 'Page', cv: 'Curriculum vitae',
    note: 'Compiled from the person’s own account. All details stem from the recorded interview.',
  },
}
const labels = data => T[data?.language === 'en' ? 'en' : 'de']

// ── Datenzugriff, durchgehend defensiv ────────────────────────────
// Die KI liefert JSON; ein fehlendes Feld darf den Export nie abbrechen.
const str = v => String(v ?? '').trim()
const list = v => (Array.isArray(v) ? v : []).map(str).filter(Boolean)
const rows = v => (Array.isArray(v) ? v : []).filter(x => x && typeof x === 'object')

// Zeitraum einer Station. Der Sonderfall, der hier zaehlt: from gesetzt, to leer.
// Das heisst NICHT automatisch "bis heute" — es heisst nur, dass kein Enddatum
// genannt wurde. "bis heute" bei einer laengst beendeten Station waere eine
// Falschaussage im Dokument, also sagt es nur, wer sich ausdruecklich als laufend
// gemeldet hat (st.current).
function period(st, t) {
  const from = str(st.from), to = str(st.to)
  if (from && to) return `${from} – ${to}`
  if (from) return st.current === true ? `${t.since} ${from}` : `${t.from} ${from}`
  if (to) return `${t.until} ${to}`
  return ''
}
// Welche Stationen stehen in der Interim-Vorlage schon als Mandat oben? Zwei
// Wege, weil man sich auf die Kennzeichnung durch die KI nicht verlassen kann:
// die ausdrueckliche Markierung kind="interim" UND ein Namensabgleich mit den
// Auftraggebern. Ohne den zweiten Weg stuende jedes Mandat zweimal im Dokument.
function isMandateStation(st, mandates) {
  if (str(st.kind) === 'interim') return true
  const key = v => str(v).toLowerCase().replace(/[^a-zäöüß0-9]+/g, ' ').trim()
  const names = new Set(mandates.map(m => key(m.client)).filter(Boolean))
  return names.has(key(st.organization)) || names.has(key(st.role))
}

function stationTitle(st) {
  const role = str(st.role), org = str(st.organization), place = str(st.place)
  const head = [role, org].filter(Boolean).join(', ')
  return place ? `${head}${head ? ' · ' : ''}${place}` : head
}

// ── Kleine Layout-Maschine (mm, A4) ───────────────────────────────
function sheet(doc) {
  const { PW, PH, M, FOOT } = PAGE
  const maxW = PW - 2 * M
  let y = M

  const lh = s => s * 0.3528 * 1.25
  const ensure = h => { if (y + h > PH - FOOT) { doc.addPage(); y = M } }
  const font = (style = 'normal', size = 10, color = INK) => {
    doc.setFont('helvetica', style); doc.setFontSize(size); doc.setTextColor(...color)
  }

  function text(s, { size = 10, style = 'normal', color = INK, x = M, w = maxW, gapAfter = 2, align } = {}) {
    if (!str(s)) return
    font(style, size, color)
    for (const ln of doc.splitTextToSize(String(s), w)) {
      ensure(lh(size))
      if (align === 'center') doc.text(ln, PW / 2, y, { align: 'center' })
      else if (align === 'right') doc.text(ln, x + w, y, { align: 'right' })
      else doc.text(ln, x, y)
      y += lh(size)
    }
    y += gapAfter
  }

  // Abschnittsüberschrift; sie darf nicht allein am Seitenfuß stehen.
  function heading(s) {
    y += 4
    if (y + lh(11) + 4 + 2 * lh(10) > PH - FOOT) { doc.addPage(); y = M }
    text(String(s).toUpperCase(), { size: 9.5, style: 'bold', color: SOFT, gapAfter: 1.5 })
    ensure(2); doc.setDrawColor(...LINE); doc.setLineWidth(0.3)
    doc.line(M, y, PW - M, y); y += 3.5
  }

  function bullet(s, { x = M, w = maxW, size = 9.5 } = {}) {
    if (!str(s)) return
    font('normal', size, INK)
    doc.splitTextToSize(String(s), w - 4).forEach((ln, i) => {
      ensure(lh(size))
      if (i === 0) { doc.setFillColor(150); doc.circle(x + 1.1, y - 1.1, 0.6, 'F') }
      doc.setTextColor(...INK)
      doc.text(ln, x + 4, y); y += lh(size)
    })
    y += 0.8
  }

  // Zweispaltiger Eintrag: links der Zeitraum, rechts der Inhalt. Der Block
  // wird als Ganzes umbrochen, damit ein Zeitraum nie ohne seine Station steht.
  function entry(left, draw, { colW = 30 } = {}) {
    const x2 = M + colW + 4
    const w2 = maxW - colW - 4
    ensure(lh(10) * 2)
    font('normal', 9, SOFT)
    doc.text(doc.splitTextToSize(String(left || ''), colW), M, y)
    draw({ x: x2, w: w2 })
    y += 1.5
  }

  return {
    doc, maxW, M, PW, PH,
    text, heading, bullet, entry,
    gap: h => { y += h },
    get y() { return y },
    set y(v) { y = v },
    rule: () => { ensure(2); doc.setDrawColor(...LINE); doc.setLineWidth(0.3); doc.line(M, y, PW - M, y); y += 3 },
    newPage: () => { doc.addPage(); y = M },
  }
}

// Kopf: Name, Berufsbezeichnung, Ort. Kein Foto, kein Geburtsdatum — das ist
// Absicht (AGG; siehe Prompt in src/career.js).
function drawHeader(s, data, t, { compact = false } = {}) {
  const p = data.person || {}
  s.text(str(p.name) || t.cv, { size: compact ? 17 : 20, style: 'bold', gapAfter: compact ? 1 : 1.5 })
  if (str(p.headline)) s.text(p.headline, { size: compact ? 10.5 : 11.5, color: [70, 70, 70], gapAfter: 1 })
  if (str(p.location)) s.text(p.location, { size: 9, color: SOFT, gapAfter: 1 })
  s.gap(1.5); s.rule()
}

function drawSkills(s, data, t) {
  const skills = list(data.skills)
  if (skills.length) { s.heading(t.skills); s.text(skills.join(' · '), { size: 9.5 }) }
  const langs = rows(data.languages)
  if (langs.length) {
    s.heading(t.languages)
    s.text(langs.map(l => [str(l.name), str(l.level)].filter(Boolean).join(' (') + (str(l.level) ? ')' : '')).join(' · '), { size: 9.5 })
  }
}

function drawEducation(s, data, t, { oneLine = false } = {}) {
  const edu = rows(data.education)
  if (!edu.length) return
  s.heading(t.education)
  for (const e of edu) {
    const when = period({ from: e.from, to: e.to }, t)
    const what = [str(e.qualification), str(e.institution)].filter(Boolean).join(', ')
    if (!what && !when) continue
    if (oneLine) s.text(`${when ? when + '  ·  ' : ''}${what}`, { size: 9.5, gapAfter: 1 })
    else s.entry(when, ({ x, w }) => s.text(what, { size: 10, style: 'bold', x, w, gapAfter: 1 }))
  }
}

// „Nicht genannt": die ausgewiesenen Lücken. Sie stehen bewusst IM Dokument
// (für die Person, am Ende, klein) — eine Lücke zu verschweigen wäre der
// Anfang davon, sie zu füllen.
function drawMissing(s, data, t) {
  const missing = list(data.not_stated)
  if (!missing.length) return
  s.gap(3); s.rule()
  s.text(t.missing, { size: 9, style: 'bold', color: SOFT, gapAfter: 1 })
  s.text(missing.join(' · '), { size: 8.5, color: SOFT, gapAfter: 1 })
  s.text(t.missingHint, { size: 8, color: SOFT })
}

// ── Die fünf Vorlagen ─────────────────────────────────────────────
function tplKlassisch(s, data, t) {
  drawHeader(s, data, t)
  if (str(data.summary)) { s.heading(t.profile); s.text(data.summary, { size: 10 }) }
  const st = rows(data.stations)
  if (st.length) {
    s.heading(t.career)
    for (const x of st) {
      s.entry(period(x, t), ({ x: cx, w }) => {
        s.text(stationTitle(x), { size: 10.5, style: 'bold', x: cx, w, gapAfter: 1 })
        for (const r of list(x.responsibilities)) s.bullet(r, { x: cx, w })
        for (const r of list(x.results)) s.bullet(r, { x: cx, w })
      })
    }
  }
  drawEducation(s, data, t)
  drawSkills(s, data, t)
  drawMissing(s, data, t)
}

function tplKompakt(s, data, t) {
  drawHeader(s, data, t, { compact: true })
  if (str(data.summary)) s.text(data.summary, { size: 9.5, gapAfter: 2 })
  const st = rows(data.stations)
  if (st.length) {
    s.heading(t.career)
    for (const x of st) {
      const when = period(x, t)
      s.entry(when, ({ x: cx, w }) => {
        s.text(stationTitle(x), { size: 9.8, style: 'bold', x: cx, w, gapAfter: 0.5 })
        // Einseiter: höchstens zwei Punkte je Station, Aufgaben vor Ergebnissen.
        const pts = [...list(x.responsibilities), ...list(x.results)].slice(0, 2)
        for (const p of pts) s.text(p, { size: 9, color: [70, 70, 70], x: cx, w, gapAfter: 0.5 })
      }, { colW: 26 })
    }
  }
  drawEducation(s, data, t, { oneLine: true })
  drawSkills(s, data, t)
}

function tplInterim(s, data, t) {
  drawHeader(s, data, t)
  if (str(data.summary)) { s.heading(t.profile); s.text(data.summary, { size: 10 }) }
  const mandates = rows(data.interim)
  if (mandates.length) {
    s.heading(t.mandates)
    for (const m of mandates) {
      const head = [str(m.client), str(m.period)].filter(Boolean).join(' · ')
      if (head) s.text(head, { size: 10.5, style: 'bold', gapAfter: 1.5 })
      for (const [key, label] of [['situation', t.situation], ['mandate', t.mandate], ['result', t.result], ['handover', t.handover]]) {
        const v = str(m[key])
        if (!v) continue
        s.entry(label, ({ x, w }) => s.text(v, { size: 9.5, x, w, gapAfter: 1 }), { colW: 26 })
      }
      s.gap(2)
    }
  }
  // Die Mandate stehen oben schon einzeln — hier nur die uebrigen Stationen,
  // sonst stuende jedes Mandat zweimal im selben Dokument.
  const st = rows(data.stations).filter(x => !isMandateStation(x, mandates))
  if (st.length) {
    s.heading(t.stations)
    for (const x of st) {
      s.entry(period(x, t), ({ x: cx, w }) => {
        s.text(stationTitle(x), { size: 10, style: 'bold', x: cx, w, gapAfter: 0.5 })
        const first = list(x.results)[0] || list(x.responsibilities)[0]
        if (first) s.text(first, { size: 9, color: [70, 70, 70], x: cx, w, gapAfter: 0.5 })
      }, { colW: 26 })
    }
  }
  drawEducation(s, data, t, { oneLine: true })
  drawSkills(s, data, t)
  drawMissing(s, data, t)
}

function tplKurzprofil(s, data, t) {
  drawHeader(s, data, t, { compact: true })
  if (str(data.summary)) s.text(data.summary, { size: 10, gapAfter: 2 })
  const st = rows(data.stations).slice(0, 3)
  if (st.length) {
    s.heading(t.career)
    for (const x of st) {
      s.entry(period(x, t), ({ x: cx, w }) => s.text(stationTitle(x), { size: 10, style: 'bold', x: cx, w, gapAfter: 1 }), { colW: 26 })
    }
  }
  drawSkills(s, data, t)
}

function tplNarrativ(s, data, t) {
  drawHeader(s, data, t)
  const paras = list(data.narrative)
  if (paras.length) {
    for (const p of paras) s.text(p, { size: 10.5, gapAfter: 3 })
  } else if (str(data.summary)) {
    s.text(data.summary, { size: 10.5, gapAfter: 3 })
  }
  const st = rows(data.stations)
  if (st.length) {
    s.heading(t.stations)
    for (const x of st) {
      s.entry(period(x, t), ({ x: cx, w }) => s.text(stationTitle(x), { size: 9.8, x: cx, w, gapAfter: 0.5 }), { colW: 26 })
    }
  }
  drawEducation(s, data, t, { oneLine: true })
  drawMissing(s, data, t)
}

const TEMPLATES = {
  klassisch: tplKlassisch,
  kompakt: tplKompakt,
  interim: tplInterim,
  kurzprofil: tplKurzprofil,
  narrativ: tplNarrativ,
}

// Fußzeile auf jeder Seite: Name, Herkunftshinweis, Seitenzahl. Der Hinweis
// steht bewusst auf JEDER Seite — ein Lebenslauf wird oft nur teilweise kopiert.
function drawFooters(doc, data, t) {
  const total = doc.getNumberOfPages()
  const name = str(data.person?.name)
  for (let i = 1; i <= total; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...SOFT)
    doc.text(t.note, PAGE.M, PAGE.PH - 8)
    doc.text(`${name ? name + ' · ' : ''}${t.page} ${i}/${total}`, PAGE.PW - PAGE.M, PAGE.PH - 8, { align: 'right' })
  }
}

// Das fertige jsPDF-Dokument bauen. Getrennt vom Speichern, damit dieselbe
// Zeichenroutine auch ausserhalb des Browsers pruefbar ist (Layout-Kontrolle).
export async function buildCvDoc(data, templateKey = 'klassisch') {
  if (!data || typeof data !== 'object') throw new Error('Es liegen keine Lebenslauf-Daten vor.')
  await loadPdfFonts()
  const t = labels(data)
  const doc = newPdfDoc({ unit: 'mm', format: 'a4' })
  const s = sheet(doc)
  const draw = TEMPLATES[getCvTemplate(templateKey).key] || tplKlassisch
  draw(s, data, t)
  drawFooters(doc, data, t)
  return doc
}

// Vorlage als PDF laden. `templateKey` ist einer der Schlüssel aus CV_TEMPLATES.
export async function downloadCvPdf(filename, data, templateKey = 'klassisch') {
  const doc = await buildCvDoc(data, templateKey)
  doc.save(filename)
}

// ── DOCX ──────────────────────────────────────────────────────────
// Zum Weiterbearbeiten: dieselbe Gliederung, ohne die feine Geometrie des PDF
// (Word kann die zweispaltige Zeitleiste nicht ohne Tabellen, und eine Tabelle
// wäre beim Bearbeiten im Weg).
export async function downloadCvDocx(filename, data, templateKey = 'klassisch') {
  if (!data || typeof data !== 'object') throw new Error('Es liegen keine Lebenslauf-Daten vor.')
  const t = labels(data)
  const key = getCvTemplate(templateKey).key
  const SINGLE = { line: 240, lineRule: 'auto' }
  const c = []
  const P = (text, o = {}) => c.push(new Paragraph({ children: [new TextRun({ text: String(text), ...o.run })], spacing: { after: 120, ...SINGLE, ...o.spacing }, ...o.rest }))
  const H = (text, level = HeadingLevel.HEADING_2) => c.push(new Paragraph({ text: String(text), heading: level, keepNext: true, spacing: { before: 280, after: 120, ...SINGLE } }))

  const p = data.person || {}
  c.push(new Paragraph({ text: str(p.name) || t.cv, heading: HeadingLevel.HEADING_1, spacing: { after: 80, ...SINGLE } }))
  if (str(p.headline)) P(p.headline, { run: { color: '444444' } })
  if (str(p.location)) P(p.location, { run: { color: '777777', size: 18 } })

  if (str(data.summary)) { H(t.profile); P(data.summary) }

  if (key === 'narrativ' && list(data.narrative).length) {
    for (const para of list(data.narrative)) P(para)
  }

  const mandates = rows(data.interim)
  if (key === 'interim' && mandates.length) {
    H(t.mandates)
    for (const m of mandates) {
      P([str(m.client), str(m.period)].filter(Boolean).join(' · '), { run: { bold: true } })
      for (const [k, label] of [['situation', t.situation], ['mandate', t.mandate], ['result', t.result], ['handover', t.handover]]) {
        if (str(m[k])) P(`${label}: ${str(m[k])}`)
      }
    }
  }

  const st = rows(data.stations).filter(x => key !== 'interim' || !isMandateStation(x, mandates))
  if (st.length) {
    H(key === 'interim' || key === 'narrativ' ? t.stations : t.career)
    for (const x of st) {
      P(`${period(x, t)}${period(x, t) ? '  ·  ' : ''}${stationTitle(x)}`, { run: { bold: true } })
      const pts = key === 'kompakt' || key === 'kurzprofil'
        ? [...list(x.responsibilities), ...list(x.results)].slice(0, 2)
        : [...list(x.responsibilities), ...list(x.results)]
      for (const b of pts) c.push(new Paragraph({ text: b, bullet: { level: 0 }, spacing: { after: 40, ...SINGLE } }))
    }
  }

  const edu = rows(data.education)
  if (edu.length) {
    H(t.education)
    for (const e of edu) {
      const when = period({ from: e.from, to: e.to }, t)
      P(`${when ? when + '  ·  ' : ''}${[str(e.qualification), str(e.institution)].filter(Boolean).join(', ')}`)
    }
  }

  if (list(data.skills).length) { H(t.skills); P(list(data.skills).join(' · ')) }
  const langs = rows(data.languages)
  if (langs.length) { H(t.languages); P(langs.map(l => [str(l.name), str(l.level)].filter(Boolean).join(' (') + (str(l.level) ? ')' : '')).join(' · ')) }

  if (list(data.not_stated).length && key !== 'kompakt' && key !== 'kurzprofil') {
    H(t.missing)
    P(list(data.not_stated).join(' · '), { run: { color: '777777', size: 18 } })
    P(t.missingHint, { run: { color: '777777', size: 16, italics: true } })
  }
  P(t.note, { run: { color: '777777', size: 16, italics: true }, spacing: { before: 300 } })

  const doc = new Document({
    creator: 'Lebenswerk', title: str(p.name) || t.cv,
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    sections: [{ children: c }],
  })
  downloadBlob(filename, await Packer.toBlob(doc))
}
