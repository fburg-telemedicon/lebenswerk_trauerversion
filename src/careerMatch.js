// src/careerMatch.js
// ABGLEICH einer Stellenanzeige mit dem Profil (Kategorie „Lebenslauf"):
// Prompt-Bauer und Renderer.
//
// WAS DIESER BAUSTEIN BEWUSST NICHT TUT — und warum das die eigentliche
// Gestaltungsentscheidung ist:
//
//  - KEINE PROZENTZAHL, KEIN SCORE. Eine Zahl wie „78 % Übereinstimmung"
//    beendet das Nachdenken: Sie wird sortiert, verglichen und irgendwann als
//    Schwellenwert benutzt („alles unter 70 fliegt raus"). Der Abgleich liefert
//    stattdessen je Anforderung eine EINSTUFUNG mit Beleg — belegt, teilweise
//    belegt, nicht belegt, keine Aussage möglich.
//  - KEINE EMPFEHLUNG. Nirgends steht, ob jemand eingeladen werden sollte. Das
//    Dokument sagt, was belegt ist und was fehlt; entscheiden muss ein Mensch.
//  - KEINE RANGFOLGE. Der Abgleich gilt für EINE Person und EINE Stelle. Es gibt
//    keine Ansicht, die mehrere Menschen nebeneinanderstellt — auch nicht als
//    Nebenprodukt einer Liste.
//
//  „Keine Aussage möglich" ist dabei die wichtigste der vier Einstufungen: Sie
//  unterscheidet die Anforderung, zu der die Person nichts erzählt hat, von der,
//  die sie nachweislich nicht erfüllt. Ohne diese Unterscheidung wird jede Lücke
//  im Gespräch zu einem Mangel der Person.

import { Document, Packer, Paragraph, HeadingLevel, TextRun } from 'docx'
import { loadPdfFonts, newPdfDoc } from './pdfFonts.js'
import { downloadBlob } from './bookExport.js'
import { selfOnly } from './categories.js'
import { numberedMaterial } from './career.js'
import { docsBlock } from './careerDocs.js'
import { AVOCA_DIMENSIONS } from './avocaRubric.js'

export const MATCH_VERDICTS = {
  belegt:    { label: 'Belegt',              color: [45, 90, 61] },
  teilweise: { label: 'Teilweise belegt',    color: [120, 95, 30] },
  nicht:     { label: 'Nicht belegt',        color: [130, 60, 60] },
  offen:     { label: 'Keine Aussage möglich', color: [110, 110, 110] },
}
export const verdictLabel = v => MATCH_VERDICTS[v]?.label || MATCH_VERDICTS.offen.label

// ── Prompt ────────────────────────────────────────────────────────
export function matchSystem(memorial, allContributions, jobText, lang = 'de') {
  const contributions = selfOnly(allContributions)
  const name = String(memorial?.name || '').trim()
  const docs = docsBlock(memorial?.documents)
  const out = lang === 'en' ? 'Englisch (English)' : 'Deutsch'
  const cv = memorial?.cv ? `\n\nSTRUKTURIERTER LEBENSLAUF (aus demselben Gespräch):\n${JSON.stringify(memorial.cv)}` : ''
  const avoca = memorial?.avoca
    ? `\n\nKOMPETENZPROFIL (bereits erzeugt; Stufen 1–5 je Dimension mit Belegen):\n${JSON.stringify(memorial.avoca)}`
    : ''
  const dims = AVOCA_DIMENSIONS.map(d => `"${d.code}" (${d.name})`).join(', ')

  return `Du gleichst eine Stellenausschreibung mit dem beruflichen Profil${name ? ` von ${name}` : ''} ab. Du entscheidest NICHTS — du machst sichtbar, was belegt ist und was nicht.

Gib REINES, GÜLTIGES JSON aus (kein Markdown, keine Erklärungen):
{
  "language": "${lang}",
  "position": "Bezeichnung der Stelle, wie sie in der Anzeige steht",
  "employer": "",
  "criteria": [
    {
      "requirement": "die Anforderung, wie sie in der Anzeige steht",
      "must": true,
      "verdict": "belegt",
      "finding": "in ein bis zwei Sätzen, was dafür oder dagegen spricht",
      "evidence": ["A17", "D2"]
    }
  ],
  "avoca": [
    { "code": "A", "required_level": 4, "shown_level": 3, "required_reason": "woraus in der Anzeige sich das ableitet", "note": "" }
  ],
  "gaps": ["..."],
  "open_questions": ["..."],
  "summary": ""
}

REGELN:

1. ANFORDERUNGEN AUS DER ANZEIGE, nicht aus dem Profil. Lies die Ausschreibung und ziehe daraus 6 bis 14 einzelne Anforderungen — fachliche wie organisatorische (Verantwortungsumfang, Branche, Reisebereitschaft, Führungsspanne). Formuliere jede so, wie die Anzeige sie meint. "must": true für ausdrückliche Muss-Anforderungen, false für Wünschenswertes.

2. VIER EINSTUFUNGEN, mehr nicht:
   "belegt"    — das Profil weist die Anforderung nach; Belegstelle vorhanden.
   "teilweise" — teilweise nachgewiesen (kleinerer Umfang, angrenzendes Feld, kürzere Dauer). Sage im "finding" WAS genau fehlt.
   "nicht"     — das Profil zeigt, dass die Anforderung nicht erfüllt ist (z. B. Anzeige verlangt zehn Jahre Führung, belegt sind zwei).
   "offen"     — im Gespräch kam dazu nichts vor. Das ist KEIN Mangel der Person, sondern eine Lücke im Gespräch. Verwende diese Einstufung IMMER, wenn du sonst raten müsstest.

3. "evidence": Belegnummern aus dem Material ("A17" für Gesprächsantworten, "D2" für bestätigte Dokumente). Bei "offen" bleibt die Liste leer. Jede andere Einstufung OHNE Beleg ist ein Fehler — dann ist es "offen".

4. NICHTS ERFINDEN. Keine Erfahrung, keine Jahreszahl, keine Branche, die nicht im Material steht. Aus „Produktionsleiterin" wird nicht „Erfahrung in der Automobilzulieferung", wenn das nirgends steht.

5. "avoca": nur wenn ein Kompetenzprofil vorliegt. Leite je Dimension (${dims}) aus der ANZEIGE ab, welche Stufe die Aufgabe verlangt ("required_level", 1–5, mit "required_reason" aus dem Anzeigentext), und stelle die im Profil belegte Stufe daneben ("shown_level", null wenn nicht belegbar). Kein Gesamtwert, keine Differenzsumme. Liegt kein Profil vor, gib eine leere Liste.
   Nicht jede Aufgabe verlangt in jeder Dimension dasselbe — leite jede Stufe EINZELN aus dem Anzeigentext ab und begründe sie dort. Fünfmal dieselbe Stufe ist fast immer ein Zeichen dafür, dass nicht wirklich abgeleitet, sondern geschätzt wurde.

6. "gaps": die wichtigsten Punkte, an denen die Anzeige mehr verlangt, als belegt ist — sachlich, ohne Bewertung der Person.
   "open_questions": drei bis sechs Fragen, die ein Gespräch klären sollte. Sie dürfen KEINE geschützten Merkmale berühren (Alter, Herkunft, Geschlecht, Religion, Gesundheit, Behinderung, sexuelle Identität, Familienstand, Familienplanung, Gewerkschaft).

7. "summary": drei bis fünf Sätze in Worten. Schreibe über die BELEGLAGE, nicht über die Person: „zur Investitionsplanung liegt nichts vor" statt „Defizite bei der Investitionsplanung". Vermeide „Defizit", „Schwäche", „Mangel", „Lücken im Profil" — gemeint ist immer das Gespräch, nicht der Mensch. KEINE Prozentzahl, KEIN Score, KEINE Note, KEIN „passt gut/schlecht", KEINE Empfehlung, ob eingeladen oder eingestellt werden soll, KEIN Vergleich mit anderen Menschen. Benenne, worauf das Bild beruht und wo es dünn ist.

8. KEINE geschützten Merkmale in irgendeinem Feld — auch nicht mittelbar (kein Rückschluss vom Abschlussjahr auf das Alter). KEINE psychologischen Begriffe (Persönlichkeit, Charakter, Eignung, Belastbarkeit, Motiv, Potenzial).

9. Schreibe alle Inhalte auf ${out}. Gültiges JSON, keine trailing commas.

STELLENAUSSCHREIBUNG:

${String(jobText || '').trim()}
${cv}${avoca}

GESPRÄCH:

${numberedMaterial(contributions)}${docs}`
}

// ── Renderer ──────────────────────────────────────────────────────
const INK = [30, 30, 30], SOFT = [110, 110, 110], LINE = [200, 200, 200]
const PAGE = { PW: 210, PH: 297, M: 20, FOOT: 15 }

const T = {
  de: { title: 'Abgleich mit der Stelle', criteria: 'Anforderungen', avoca: 'Kompetenzprofil und Anforderung',
        gaps: 'Wo die Anzeige mehr verlangt', questions: 'Fragen für das Gespräch', summary: 'Gesamtbild',
        required: 'Aufgabe verlangt', shown: 'im Profil belegt', level: 'Stufe', none: 'nicht belegbar',
        must: 'Muss', wish: 'Wunsch', page: 'Seite', source: 'Beleg',
        note: 'Dieser Abgleich vergibt keine Punktzahl und keine Empfehlung. Er zeigt je Anforderung, was im Gespräch belegt ist und was nicht. „Keine Aussage möglich" heißt: Dazu kam nichts vor — es ist kein Mangel der Person. Die Entscheidung treffen Menschen.' },
  en: { title: 'Match with the position', criteria: 'Requirements', avoca: 'Competency profile and requirement',
        gaps: 'Where the posting asks for more', questions: 'Questions for the interview', summary: 'Overall picture',
        required: 'role requires', shown: 'evidenced in profile', level: 'Level', none: 'not evidenced',
        must: 'Must', wish: 'Desirable', page: 'Page', source: 'Source',
        note: 'This match assigns no score and makes no recommendation. It shows, requirement by requirement, what the interview evidences and what it does not. “No statement possible” means nothing came up on this — it is not a shortcoming of the person. People make the decision.' },
}
const labels = d => T[d?.language === 'en' ? 'en' : 'de']
const str = v => String(v ?? '').trim()
const list = v => (Array.isArray(v) ? v : []).map(str).filter(Boolean)
const rows = v => (Array.isArray(v) ? v : []).filter(x => x && typeof x === 'object')

function sheet(doc) {
  const { PW, PH, M, FOOT } = PAGE
  const maxW = PW - 2 * M
  let y = M
  const lh = s => s * 0.3528 * 1.25
  const ensure = h => { if (y + h > PH - FOOT) { doc.addPage(); y = M } }
  function text(s, { size = 10, style = 'normal', color = INK, x = M, w = maxW, gapAfter = 2 } = {}) {
    if (!str(s)) return
    doc.setFont('helvetica', style); doc.setFontSize(size); doc.setTextColor(...color)
    for (const ln of doc.splitTextToSize(String(s), w)) { ensure(lh(size)); doc.text(ln, x, y); y += lh(size) }
    y += gapAfter
  }
  return {
    doc, text,
    gap: h => { y += h },
    rule: () => { ensure(2); doc.setDrawColor(...LINE); doc.setLineWidth(0.3); doc.line(M, y, PW - M, y); y += 3 },
    heading: s => {
      y += 4
      if (y + 20 > PH - FOOT) { doc.addPage(); y = M }
      text(String(s).toUpperCase(), { size: 9.5, style: 'bold', color: SOFT, gapAfter: 1.5 })
      ensure(2); doc.setDrawColor(...LINE); doc.setLineWidth(0.3); doc.line(M, y, PW - M, y); y += 3.5
    },
    // Eine Anforderung: Einstufung als Wortmarke links, Text rechts. Keine
    // Ampelfarben — die Einstufung steht als Wort da, nicht als Signal.
    criterion: c => {
      const v = MATCH_VERDICTS[str(c.verdict)] || MATCH_VERDICTS.offen
      const colW = 34
      ensure(lh(10) * 3)
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8.2); doc.setTextColor(...v.color)
      doc.text(doc.splitTextToSize(v.label, colW), M, y)
      const x2 = M + colW + 4, w2 = maxW - colW - 4
      const before = y
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9.8); doc.setTextColor(...INK)
      for (const ln of doc.splitTextToSize(str(c.requirement), w2)) { ensure(lh(9.8)); doc.text(ln, x2, y); y += lh(9.8) }
      if (str(c.finding)) {
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(70, 70, 70)
        for (const ln of doc.splitTextToSize(str(c.finding), w2)) { ensure(lh(9)); doc.text(ln, x2, y); y += lh(9) }
      }
      const ev = list(c.evidence)
      if (ev.length) {
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...SOFT)
        ensure(lh(8)); doc.text(ev.join(', '), x2, y); y += lh(8)
      }
      if (y < before) y = before
      y += 2.5
    },
  }
}

export async function buildMatchDoc(data, memorial = null) {
  if (!data || typeof data !== 'object') throw new Error('Es liegt kein Abgleich vor.')
  await loadPdfFonts()
  const t = labels(data)
  const doc = newPdfDoc({ unit: 'mm', format: 'a4' })
  const s = sheet(doc)
  const name = str(memorial?.name)

  s.text(t.title, { size: 19, style: 'bold', gapAfter: 1 })
  const head = [str(data.position), str(data.employer)].filter(Boolean).join(' · ')
  if (head) s.text(head, { size: 11.5, color: [70, 70, 70], gapAfter: 1 })
  if (name) s.text(name, { size: 9.5, color: SOFT, gapAfter: 1 })
  s.gap(1); s.rule()
  s.text(t.note, { size: 8.4, color: [80, 80, 80], gapAfter: 2 })
  s.rule()

  if (str(data.summary)) { s.heading(t.summary); s.text(data.summary, { size: 10 }) }

  const crit = rows(data.criteria)
  if (crit.length) {
    // Muss-Anforderungen zuerst — nicht nach Einstufung sortiert: Eine Sortierung
    // nach „belegt" waere schon eine halbe Rangfolge.
    s.heading(t.criteria)
    for (const c of crit.filter(x => x.must === true)) s.criterion(c)
    const wish = crit.filter(x => x.must !== true)
    if (wish.length) { s.gap(2); s.text(t.wish, { size: 8.6, style: 'bold', color: SOFT, gapAfter: 2 }); for (const c of wish) s.criterion(c) }
  }

  const av = rows(data.avoca)
  if (av.length) {
    s.heading(t.avoca)
    for (const a of av) {
      const def = AVOCA_DIMENSIONS.find(d => d.code === str(a.code))
      const shown = Number.isInteger(a.shown_level) ? `${t.level} ${a.shown_level}` : t.none
      const req = Number.isInteger(a.required_level) ? `${t.level} ${a.required_level}` : '—'
      s.text(`${def?.name || str(a.code)} — ${t.required}: ${req} · ${t.shown}: ${shown}`, { size: 9.8, style: 'bold', gapAfter: 1 })
      if (str(a.required_reason)) s.text(str(a.required_reason), { size: 8.8, color: SOFT, gapAfter: 1 })
      if (str(a.note)) s.text(str(a.note), { size: 9, color: [70, 70, 70], gapAfter: 2 })
    }
  }

  const gaps = list(data.gaps)
  if (gaps.length) { s.heading(t.gaps); for (const g of gaps) s.text(`— ${g}`, { size: 9.6, gapAfter: 1 }) }

  const q = list(data.open_questions)
  if (q.length) { s.heading(t.questions); for (const x of q) s.text(`— ${x}`, { size: 9.6, gapAfter: 1 }) }

  const total = doc.getNumberOfPages()
  for (let i = 1; i <= total; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...SOFT)
    doc.text(t.title, PAGE.M, PAGE.PH - 8)
    doc.text(`${name ? name + ' · ' : ''}${t.page} ${i}/${total}`, PAGE.PW - PAGE.M, PAGE.PH - 8, { align: 'right' })
  }
  return doc
}

export async function downloadMatchPdf(filename, data, memorial = null) {
  const doc = await buildMatchDoc(data, memorial)
  doc.save(filename)
}

export async function downloadMatchDocx(filename, data, memorial = null) {
  if (!data || typeof data !== 'object') throw new Error('Es liegt kein Abgleich vor.')
  const t = labels(data)
  const SINGLE = { line: 240, lineRule: 'auto' }
  const c = []
  const P = (text, o = {}) => c.push(new Paragraph({ children: [new TextRun({ text: String(text), ...o.run })], spacing: { after: 120, ...SINGLE, ...o.spacing } }))
  const H = t2 => c.push(new Paragraph({ text: String(t2), heading: HeadingLevel.HEADING_2, keepNext: true, spacing: { before: 280, after: 120, ...SINGLE } }))

  c.push(new Paragraph({ text: t.title, heading: HeadingLevel.HEADING_1, spacing: { after: 80, ...SINGLE } }))
  const head = [str(data.position), str(data.employer)].filter(Boolean).join(' · ')
  if (head) P(head, { run: { color: '444444' } })
  if (str(memorial?.name)) P(str(memorial.name), { run: { color: '777777', size: 18 } })
  P(t.note, { run: { color: '666666', size: 17, italics: true } })

  if (str(data.summary)) { H(t.summary); P(data.summary) }

  const crit = rows(data.criteria)
  if (crit.length) {
    H(t.criteria)
    for (const x of [...crit.filter(k => k.must === true), ...crit.filter(k => k.must !== true)]) {
      P(`${verdictLabel(str(x.verdict))} — ${str(x.requirement)}${x.must === true ? '' : ` (${t.wish})`}`, { run: { bold: true } })
      if (str(x.finding)) P(str(x.finding))
      if (list(x.evidence).length) P(`${t.source}: ${list(x.evidence).join(', ')}`, { run: { color: '777777', size: 16 } })
    }
  }
  const av = rows(data.avoca)
  if (av.length) {
    H(t.avoca)
    for (const a of av) {
      const def = AVOCA_DIMENSIONS.find(d => d.code === str(a.code))
      const shown = Number.isInteger(a.shown_level) ? `${t.level} ${a.shown_level}` : t.none
      const req = Number.isInteger(a.required_level) ? `${t.level} ${a.required_level}` : '—'
      P(`${def?.name || str(a.code)} — ${t.required}: ${req} · ${t.shown}: ${shown}`, { run: { bold: true } })
      if (str(a.required_reason)) P(str(a.required_reason), { run: { color: '777777', size: 17 } })
      if (str(a.note)) P(str(a.note))
    }
  }
  for (const [head2, items] of [[t.gaps, list(data.gaps)], [t.questions, list(data.open_questions)]]) {
    if (!items.length) continue
    H(head2)
    for (const x of items) c.push(new Paragraph({ text: x, bullet: { level: 0 }, spacing: { after: 40, ...SINGLE } }))
  }

  const doc = new Document({
    creator: 'Lebenswerk', title: t.title,
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    sections: [{ children: c }],
  })
  downloadBlob(filename, await Packer.toBlob(doc))
}
