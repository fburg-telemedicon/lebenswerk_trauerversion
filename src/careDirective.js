// src/careDirective.js
// Drittes Nebenprodukt des Lebenswerks: die BETREUUNGSVERFÜGUNG.
//
// Eine Betreuungsverfügung richtet sich an das Betreuungsgericht. Sie benennt
// die WUNSCHPERSON für eine gesetzliche Betreuung und sagt, wie diese Person in
// den vier rechtlichen Aufgabenbereichen handeln soll:
//   Gesundheitssorge · Vermögenssorge · Wohnungsangelegenheiten · Aufenthaltsbestimmung
//
// Ablauf wie bei Stammbaum und Poster:
//   a) Die KI liest die SELBSTAUSKUNFT (nur das eigene Interview, siehe unten)
//      und arbeitet das WERTESYSTEM heraus — daraus leitet sie je Aufgabenbereich
//      Wünsche ab. Ergebnis ist strukturiertes JSON (memorials.care_directive).
//   b) Aus dem JSON zeichnet jsPDF hier das fertige Formular. Kein KI-Layout,
//      damit die Gliederung verlässlich ist und Unterschrift/Ankreuzfelder sitzen.
//
// DREI ENTSCHEIDUNGEN, die hier bewusst so getroffen sind:
//
//  1. NUR SELBSTAUSKUNFT. Gastbeiträge (Angehörige erzählen ÜBER die Person)
//     fließen NICHT ein — anders als bei Stammbaum, Poster und Pflegeexzerpt.
//     Eine Betreuungsverfügung ist eine Willenserklärung: Was die Tochter über
//     ihre Mutter sagt, darf nicht zum erklärten Willen der Mutter werden.
//
//  2. DIE KI BESTIMMT KEINE PERSON. Nach § 1816 Abs. 2 BGB ist der Vorschlag des
//     Betroffenen für das Gericht bindend (soweit er dem Wohl nicht zuwiderläuft).
//     Diese Bindung darf nicht aus einer KI-Schlussfolgerung entstehen. Die
//     Wunschperson bleibt deshalb ein LEERES FELD; im Interview genannte
//     Vertrauenspersonen stehen nur als Hinweis in der Arbeitshilfe.
//
//  3. KEINE BEHANDLUNGSENTSCHEIDUNGEN. „Gesundheitssorge" meint hier, WIE
//     entschieden und mit wem gesprochen wird — nicht, welche Behandlung erfolgen
//     oder unterbleiben soll. Das ist Sache einer Patientenverfügung
//     (§ 1827 BGB) und lässt sich aus einer Lebensgeschichte nicht ableiten.
//
// Das PDF hat zwei Teile: TEIL A ist das Dokument zum Unterschreiben, TEIL B eine
// Arbeitshilfe mit den Belegstellen, aus denen die KI ihre Vorschläge gezogen hat.
// So bleibt nachprüfbar, worauf jeder Satz beruht, ohne die Verfügung selbst mit
// KI-Begründungen zu belasten.
//
// Maße in mm, Ursprung oben links (wie lifeworkExtras.js).

import { jsPDF } from 'jspdf'
import { selfOnly, contributionBlocks } from './categories.js'

// Die vier rechtlichen Aufgabenbereiche. Reihenfolge = Reihenfolge im Formular;
// `key` ist zugleich der Schlüssel, den die KI im JSON liefern muss.
export const CARE_AREAS = [
  { key: 'gesundheit', title: 'Gesundheitssorge',
    scope: 'Einwilligung in Untersuchungen und Behandlungen, Gespräche mit Ärztinnen und Ärzten, Aufklärung, Einsicht in Krankenunterlagen, Auswahl von Pflege- und Therapieangeboten.',
    guide: 'Wie soll entschieden werden — wer wird einbezogen, wie viel möchte ich selbst erfahren und mitentscheiden, worauf soll im Umgang mit mir geachtet werden? KEINE Festlegung auf einzelne Behandlungen (das gehört in eine Patientenverfügung).' },
  { key: 'vermoegen', title: 'Vermögenssorge',
    scope: 'Konten und Einkünfte, laufende Zahlungen, Verträge, Anträge bei Behörden, Versicherungen und Kassen, Umgang mit Ersparnissen.',
    guide: 'Wie soll mit Geld umgegangen werden — sparsam oder großzügig, wofür darf ausgegeben werden, welche Verpflichtungen sind mir wichtig (Unterstützung, Spenden, Mitgliedschaften), worüber möchte ich informiert bleiben?' },
  { key: 'wohnung', title: 'Wohnungsangelegenheiten',
    scope: 'Erhalt oder Kündigung meiner Wohnung, Miete, Hausrat, Umzug, Auflösung des Haushalts.',
    guide: 'Was bedeutet mir meine Wohnung, was soll mit Möbeln, Erinnerungsstücken, Tieren und Pflanzen geschehen, unter welchen Bedingungen darf die Wohnung aufgegeben werden?' },
  { key: 'aufenthalt', title: 'Aufenthaltsbestimmung',
    scope: 'Wo ich lebe: zu Hause, betreutes Wohnen, Pflegeeinrichtung, Klinik — sowie Reisen, Ausflüge und Besuche.',
    guide: 'Wo möchte ich leben, was ist mir an einem Ort wichtig (Umgebung, Nähe zu Menschen, Natur, Glaubensgemeinschaft), wann darf ein Wechsel erfolgen und wer soll vorher gefragt werden?' },
]

// ════════════════════════════════════════════════════════════════
// 1) KI-Prompt: Wertesystem lesen, Wünsche ableiten
// ════════════════════════════════════════════════════════════════

export function careDirectiveSystem(memorial, allContributions) {
  // Bewusst OHNE Gastbeiträge (siehe Kopfkommentar, Punkt 1).
  const contributions = selfOnly(allContributions)
  const who = memorial?.name || 'die erzählende Person'
  const areaSpec = CARE_AREAS
    .map(a => `  • "${a.key}" (${a.title}): ${a.guide}`)
    .join('\n')

  return `Du bist eine erfahrene Betreuungsrichterin mit biografischer Ausbildung. Du liest die Lebensgeschichte von ${who} — erzählt von ${who} selbst — und arbeitest daraus das WERTESYSTEM heraus: woran dieser Mensch sein Leben ausrichtet, was ihm Würde bedeutet, wie er entscheidet und behandelt werden möchte.

Daraus entwirfst du eine BETREUUNGSVERFÜGUNG: das Dokument, mit dem ein Mensch dem Betreuungsgericht im Voraus sagt, WER ihn betreuen soll und WIE diese Betreuung zu führen ist, falls er seine Angelegenheiten einmal nicht mehr selbst besorgen kann.

Gib REINES, GÜLTIGES JSON aus (kein Markdown, keine Erklärungen, keine Code-Fences):
{
  "values_summary": "3–5 Sätze in der dritten Person: das Wertesystem dieses Menschen, so wie es aus seiner Erzählung hervorgeht.",
  "values": [
    { "value": "Wert in 1–3 Wörtern, z. B. Selbstbestimmung",
      "evidence": "kurzes wörtliches Zitat aus dem Interview (max. 25 Wörter), das diesen Wert belegt",
      "consequence": "EIN Satz in der ICH-FORM: was daraus für eine Betreuung folgt" }
  ],
  "guardian_hints": [
    { "name": "Name der Person", "relation": "Beziehung, z. B. Tochter, Nachbar, Freundin",
      "evidence": "kurzes wörtliches Zitat, das das Vertrauensverhältnis belegt" }
  ],
  "exclusion_hints": [
    { "name": "Name", "relation": "Beziehung",
      "evidence": "kurzes wörtliches Zitat, das ein Zerwürfnis oder ausdrückliche Ablehnung belegt" }
  ],
  "areas": [
    { "key": "gesundheit",
      "wishes": [ { "text": "EIN Wunsch in der ICH-FORM, konkret und umsetzbar",
                    "evidence": "kurzes wörtliches Zitat aus dem Interview, das ihn trägt" } ],
      "gaps": [ "Wozu die Erzählung nichts hergibt — knapp benannt, damit es beim Ausfüllen ergänzt wird" ] },
    { "key": "vermoegen",  "wishes": [], "gaps": [] },
    { "key": "wohnung",    "wishes": [], "gaps": [] },
    { "key": "aufenthalt", "wishes": [], "gaps": [] }
  ],
  "daily_life": [ "Gewohnheit, Ritual oder Vorliebe, die eine Betreuung achten soll — ICH-FORM, ein Satz" ],
  "open_points": [ "Was vor der Unterschrift entschieden oder ergänzt werden muss" ]
}

DIE VIER AUFGABENBEREICHE — worum es jeweils geht:
${areaSpec}

REGELN — verbindlich:
- ERFINDE NICHTS. Jeder Wunsch, jeder Wert, jeder Name muss sich auf eine Stelle der Erzählung stützen. Ohne Beleg kein Eintrag. "evidence" ist ein WÖRTLICHES Zitat aus dem Interview, nicht deine Zusammenfassung.
- ABLEITEN ist erlaubt und erwünscht: Aus „Ich habe unser Haus mit eigenen Händen gebaut und will hier nicht weg" darf „Ich möchte so lange wie irgend möglich in meiner eigenen Wohnung leben" werden. Aus dem Nichts erfinden ist verboten.
- ICH-FORM für alles, was im Dokument steht ("wishes", "consequence", "daily_life") — die Verfügung ist die Erklärung dieses Menschen. "values_summary" bleibt in der dritten Person.
- KEINE BEHANDLUNGSENTSCHEIDUNGEN. Bei "gesundheit" geht es darum, WIE und mit wem entschieden wird, wie mit mir gesprochen und umgegangen wird — NIEMALS darum, welche Behandlung erfolgen oder unterbleiben soll (keine Wiederbelebung, keine künstliche Ernährung, keine Medikamente). Das ist Sache einer Patientenverfügung und lässt sich aus einer Lebensgeschichte nicht ableiten. Ebenso: keine Diagnosen, keine medizinischen Empfehlungen.
- KEINE PERSON BESTIMMEN. Du schlägst NIEMANDEN als Betreuer vor und stellst keine Rangfolge auf. "guardian_hints" sammelt ausschließlich Menschen, die die Erzählung als enge Vertrauenspersonen ausweist — als Gedächtnisstütze für die Person selbst, die dann entscheidet. Nenne höchstens 4. Gibt die Erzählung niemanden her: leere Liste.
- "exclusion_hints" nur bei einem AUSDRÜCKLICHEN Zerwürfnis oder einer klaren Ablehnung. Bloße Distanz oder Streit reichen nicht. Im Zweifel: leere Liste.
- KEINE RECHTSBERATUNG, keine Paragraphen, keine Vollmachtsformeln — der rechtliche Rahmen steht bereits im Formular.
- Umfang: 4–7 "values"; je Aufgabenbereich 3–6 "wishes" und 1–3 "gaps"; höchstens 6 "daily_life"; 3–8 "open_points".
- Gibt die Erzählung zu einem Aufgabenbereich nichts her, lass "wishes" LEER und benenne das in "gaps". Eine leere Liste ist besser als ein erfundener Wunsch.
- Alle vier Aufgabenbereiche müssen in "areas" vorkommen, mit genau diesen "key"-Werten: gesundheit, vermoegen, wohnung, aufenthalt.
- Antworte AUSSCHLIESSLICH auf Deutsch — auch wenn das Interview in einer anderen Sprache geführt wurde. Das Dokument geht an ein deutsches Betreuungsgericht.
- Gültiges JSON, keine trailing commas.

Interview mit ${who} (Selbstauskunft):

${contributionBlocks(contributions)}`
}

// ════════════════════════════════════════════════════════════════
// 2) Das Formular (DIN A4 hoch)
// ════════════════════════════════════════════════════════════════

// Die KI liefert "areas" mal als Liste, mal als Objekt — beides annehmen, statt
// am Formatwechsel eines einzelnen Laufs zu scheitern.
function areaData(data, key) {
  const src = data?.areas
  if (Array.isArray(src)) return src.find(a => a?.key === key) || {}
  if (src && typeof src === 'object') return src[key] || {}
  return {}
}
const strList = v => (Array.isArray(v) ? v : []).map(s => String(s ?? '').trim()).filter(Boolean)
function wishList(a) {
  return (Array.isArray(a?.wishes) ? a.wishes : [])
    .map(w => (typeof w === 'string'
      ? { text: w.trim(), evidence: '' }
      : { text: String(w?.text ?? '').trim(), evidence: String(w?.evidence ?? '').trim() }))
    .filter(w => w.text)
}

const AMBER = [180, 83, 9]
const BLUE  = [37, 99, 235]
const INK   = [35, 35, 35]
const SOFT  = [110, 110, 110]

// Zeichnet das Formular und gibt das jsPDF-Dokument zurück, ohne es zu speichern.
// Getrennt von downloadCareDirectivePdf(), damit dasselbe Layout auch außerhalb
// des Browsers erzeugt werden kann (Skripte, Nachbearbeitung bestehender
// Biographien) — dort gibt es kein doc.save().
export function buildCareDirectiveDoc(data, memorial) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const PW = 210, PH = 297, M = 20, FOOT = 15
  const maxW = PW - 2 * M
  let y = M

  const lh = s => s * 0.3528 * 1.22
  const ensure = h => { if (y + h > PH - FOOT) { doc.addPage(); y = M } }
  const gap = h => { y += h }

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
    gap(4)
    if (y + lh(13) + 4 + 2 * lh(10.5) > PH - FOOT) { doc.addPage(); y = M }
    text(str, { size: 13, style: 'bold', color: [20, 20, 20], gapAfter: 1 })
    rule([170, 170, 170], 0.4)
  }
  function h2(str) {
    gap(2)
    if (y + lh(11) + 2 * lh(10.5) > PH - FOOT) { doc.addPage(); y = M }
    text(str, { size: 11, style: 'bold', color: [30, 30, 30], gapAfter: 1.5 })
  }

  // Aufzählungspunkt; `box` setzt statt des Punktes ein Ankreuzkästchen. Jeder
  // KI-Vorschlag bekommt eins: Was hier steht, ist ein ENTWURF — die Person hakt
  // ab, was sie sich zu eigen macht, und streicht den Rest.
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

  // Ausfüllfeld: Beschriftung links, Linie rechts. `value` wird nur gesetzt, wenn
  // die Angabe wirklich bekannt ist — geraten wird in einem solchen Dokument nichts.
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
    gap(1.5)
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

  // Ja/Nein-Ankreuzzeile für einen Aufgabenbereich.
  function yesNo() {
    ensure(9)
    doc.setDrawColor(90); doc.setLineWidth(0.4)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...INK)
    doc.rect(M, y - 3.2, 3.8, 3.8)
    doc.text('Dieser Aufgabenbereich soll übertragen werden.', M + 6, y)
    const x2 = M + 105
    doc.rect(x2, y - 3.2, 3.8, 3.8)
    doc.text('Ausdrücklich nicht.', x2 + 6, y)
    y += 8
  }

  const name = String(memorial?.name || '').trim()
  const d = data || {}

  // ── Kopf ──────────────────────────────────────────────────────
  text('BETREUUNGSVERFÜGUNG', { size: 20, style: 'bold', color: [15, 15, 15], gapAfter: 1.5 })
  text(name ? `von ${name}` : 'von', { size: 12, color: SOFT, gapAfter: 3 })
  rule([120, 120, 120], 0.6)

  callout('Entwurf — vor der Unterschrift Punkt für Punkt prüfen', [
    'Dieser Entwurf wurde von einer KI aus Ihrer eigenen Lebensgeschichte erarbeitet: aus dem, was Sie im Interview über Ihre Werte, Ihren Alltag und Ihre Haltung erzählt haben. Er ist ein Vorschlag, keine Rechtsberatung und keine fertige Erklärung.',
    'Die angekreuzten Kästchen sind leer, weil nur Sie sie füllen können. Streichen Sie, was nicht stimmt, ergänzen Sie, was fehlt, und tragen Sie die Wunschperson selbst ein — niemand sonst darf das für Sie tun.',
    'Kostenlose Beratung gibt es bei der Betreuungsbehörde Ihrer Stadt oder Ihres Landkreises und bei den örtlichen Betreuungsvereinen. Diese Vorlage richtet sich nach deutschem Recht (§§ 1814 ff. BGB).',
  ], AMBER)

  // ── 1. Person ─────────────────────────────────────────────────
  h1('1. Meine Angaben')
  field('Name, Vorname', name)
  field('Geburtsdatum')
  field('Geburtsort')
  field('Anschrift')
  field('Telefon / E-Mail')

  // ── 2. Zweck ──────────────────────────────────────────────────
  h1('2. Wozu diese Verfügung dient')
  text('Für den Fall, dass ich meine Angelegenheiten ganz oder teilweise nicht mehr selbst besorgen kann und das Betreuungsgericht deshalb eine rechtliche Betreuung anordnet, lege ich hiermit im Voraus fest, wer diese Betreuung führen soll und wie sie zu führen ist. Ich treffe diese Festlegungen bei klarem Verstand und aus freiem Willen.')

  // ── 3. Wunschperson ───────────────────────────────────────────
  h1('3. Wer mich betreuen soll')
  text('Sollte eine rechtliche Betreuung für mich eingerichtet werden, wünsche ich mir, dass folgende Person zu meiner Betreuerin oder meinem Betreuer bestellt wird:', { gapAfter: 3 })
  field('Name, Vorname')
  field('Anschrift')
  field('Telefon / E-Mail')
  field('Verhältnis zu mir')
  gap(2)
  text('Ist diese Person verhindert oder kann sie die Aufgabe nicht übernehmen, wünsche ich mir an ihrer Stelle:', { gapAfter: 3 })
  field('Name, Vorname')
  field('Anschrift')
  field('Telefon / E-Mail')
  field('Verhältnis zu mir')

  const hints = (Array.isArray(d.guardian_hints) ? d.guardian_hints : [])
    .map(h => ({ name: String(h?.name ?? '').trim(), relation: String(h?.relation ?? '').trim() }))
    .filter(h => h.name)
    .slice(0, 4)
  if (hints.length) {
    callout('Gedächtnisstütze aus Ihrer Lebensgeschichte — keine Empfehlung', [
      `Im Interview haben Sie über diese Menschen als enge Vertrauenspersonen gesprochen: ${hints.map(h => (h.relation ? `${h.name} (${h.relation})` : h.name)).join(', ')}.`,
      'Wen Sie eintragen, entscheiden allein Sie. Die Belegstellen dazu stehen in der Arbeitshilfe am Ende. Sprechen Sie vorher mit der Person — niemand kann zu einer Betreuung verpflichtet werden.',
    ])
  } else {
    callout('Hinweis', ['Ihre Erzählung nennt keine Person eindeutig genug, als dass hier ein Hinweis stehen dürfte. Überlegen Sie in Ruhe, wem Sie diese Aufgabe zutrauen, und sprechen Sie vorher mit ihr.'])
  }

  // ── 4. Ausschluss ─────────────────────────────────────────────
  h1('4. Wer mich nicht betreuen soll')
  text('Folgende Personen sollen ausdrücklich NICHT zu meiner Betreuerin oder meinem Betreuer bestellt werden:', { gapAfter: 3 })
  blankLines(3)
  const exHints = (Array.isArray(d.exclusion_hints) ? d.exclusion_hints : [])
    .map(h => ({ name: String(h?.name ?? '').trim(), relation: String(h?.relation ?? '').trim() }))
    .filter(h => h.name)
  if (exHints.length) {
    callout('Aus Ihrer Lebensgeschichte', [
      `Sie haben über ein Zerwürfnis oder eine Ablehnung gesprochen, die folgende Menschen betrifft: ${exHints.map(h => (h.relation ? `${h.name} (${h.relation})` : h.name)).join(', ')}.`,
      'Ob Sie das hier aufnehmen möchten, entscheiden Sie. Eine Begründung ist nicht erforderlich.',
    ])
  }

  // ── 5. Aufgabenbereiche ───────────────────────────────────────
  h1('5. Aufgabenbereiche und meine Wünsche darin')
  text('Eine Betreuung gilt immer nur für die Bereiche, in denen ich tatsächlich Hilfe brauche. Für jeden Bereich kreuze ich an, ob er übertragen werden soll, und sage, wie meine Wünsche darin umzusetzen sind.', { gapAfter: 4 })

  for (const area of CARE_AREAS) {
    const a = areaData(d, area.key)
    const wishes = wishList(a)
    const gaps = strList(a?.gaps)

    h2(area.title)
    text(area.scope, { size: 9.5, color: SOFT, gapAfter: 3 })
    yesNo()
    text('Meine Wünsche für diesen Bereich:', { size: 10, style: 'bold', gapAfter: 2.5 })
    if (wishes.length) {
      for (const w of wishes) bullet(w.text, { box: true })
    } else {
      text('Aus Ihrer Lebensgeschichte ließ sich für diesen Bereich kein belegter Wunsch ableiten. Bitte selbst ergänzen.', { size: 9.5, color: SOFT, gapAfter: 2 })
    }
    if (gaps.length) {
      callout('Noch zu ergänzen', gaps)
    }
    blankLines(2)
    gap(2)
  }

  // ── 6. Wertebild ──────────────────────────────────────────────
  h1('6. Woran meine Betreuung sich ausrichten soll')
  text('Wo Entscheidungen zu treffen sind, die ich hier nicht ausdrücklich geregelt habe, soll sich meine Betreuerin oder mein Betreuer an dem ausrichten, was mir zeitlebens wichtig war:', { gapAfter: 3 })
  const values = (Array.isArray(d.values) ? d.values : [])
    .map(v => ({ value: String(v?.value ?? '').trim(), consequence: String(v?.consequence ?? '').trim() }))
    .filter(v => v.value || v.consequence)
  if (values.length) {
    for (const v of values) {
      bullet(v.value && v.consequence ? `${v.value} — ${v.consequence}` : (v.consequence || v.value), { box: true })
    }
  } else {
    blankLines(4)
  }

  const daily = strList(d.daily_life)
  if (daily.length) {
    gap(2)
    h2('Mein Alltag, den ich gewahrt wissen möchte')
    for (const item of daily) bullet(item, { box: true })
  }

  gap(2)
  h2('Weitere Wünsche und Anmerkungen')
  blankLines(5)

  // ── 7. Rechtlicher Rahmen ─────────────────────────────────────
  h1('7. Verbindlichkeit dieser Verfügung')
  text('Nach § 1816 Abs. 2 BGB ist das Betreuungsgericht an meinen Vorschlag zur Person der Betreuerin oder des Betreuers gebunden, soweit dies meinem Wohl nicht zuwiderläuft. Schlage ich eine Person ausdrücklich ab, ist darauf Rücksicht zu nehmen.')
  text('Nach § 1821 BGB hat die Betreuerin oder der Betreuer meinen Wünschen zu entsprechen, soweit dies mein Wohl nicht erheblich gefährdet und ihr oder ihm zuzumuten ist. Das gilt ausdrücklich auch für Wünsche, die ich — wie hier — vor der Bestellung geäußert habe.')
  text('Diese Betreuungsverfügung ersetzt KEINE Vorsorgevollmacht: Eine Vollmacht wirkt sofort und kann eine Betreuung ganz vermeiden, diese Verfügung greift erst, wenn das Gericht eine Betreuung anordnet. Sie ersetzt auch KEINE Patientenverfügung (§ 1827 BGB): Welche ärztlichen Behandlungen an mir vorgenommen oder unterlassen werden sollen, ist hier bewusst nicht geregelt.')
  text('Ich kann diese Verfügung jederzeit ganz oder in Teilen widerrufen oder ändern. Solange ich sie nicht widerrufen habe, gilt sie fort.')

  // ── 8. Unterschrift ───────────────────────────────────────────
  h1('8. Ort, Datum und eigenhändige Unterschrift')
  text('Eine Betreuungsverfügung ist an keine Form gebunden. Sie sollte aber schriftlich vorliegen und eigenhändig unterschrieben sein — sonst lässt sich später schwer belegen, dass sie von mir stammt. Eine Beglaubigung ist nicht erforderlich.', { size: 9.5, color: SOFT, gapAfter: 5 })
  ensure(24)
  doc.setDrawColor(120); doc.setLineWidth(0.35)
  doc.line(M, y + 10, M + 78, y + 10)
  doc.line(M + 92, y + 10, PW - M, y + 10)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...SOFT)
  doc.text('Ort, Datum', M, y + 14.5)
  doc.text('Unterschrift', M + 92, y + 14.5)
  y += 22

  h2('Spätere Bestätigung')
  text('Eine Verfügung wirkt umso stärker, je aktueller sie ist. Bestätigen Sie sie am besten alle ein bis zwei Jahre mit Datum und Unterschrift.', { size: 9.5, color: SOFT, gapAfter: 4 })
  for (let i = 0; i < 3; i++) {
    ensure(13)
    doc.setDrawColor(150); doc.setLineWidth(0.25)
    doc.line(M, y + 5, M + 78, y + 5)
    doc.line(M + 92, y + 5, PW - M, y + 5)
    y += 13
  }

  // ── 9. Aufbewahrung ───────────────────────────────────────────
  h1('9. Wo diese Verfügung liegt')
  bullet('Das Original bewahre ich auf bei:')
  blankLines(2)
  bullet('Eine Kopie haben erhalten:')
  blankLines(2)
  text('Eine Betreuungsverfügung nützt nur, wenn das Gericht sie findet. Sie kann beim Zentralen Vorsorgeregister der Bundesnotarkammer (www.vorsorgeregister.de) eingetragen werden; die Betreuungsgerichte fragen dort vor jeder Bestellung an. Alternativ hinterlegen Sie sie beim Betreuungsgericht Ihres Wohnorts oder bei einer Vertrauensperson.', { size: 9.5, color: SOFT })

  // ════════════════════════════════════════════════════════════
  // TEIL B — Arbeitshilfe (nicht Bestandteil der Verfügung)
  // ════════════════════════════════════════════════════════════
  doc.addPage(); y = M

  text('ARBEITSHILFE', { size: 16, style: 'bold', color: [15, 15, 15], gapAfter: 1.5 })
  text('Nicht Bestandteil der Betreuungsverfügung', { size: 10, color: SOFT, gapAfter: 3 })
  rule([120, 120, 120], 0.6)
  callout('Wozu diese Seiten da sind', [
    'Hier steht, worauf jeder Vorschlag der vorangehenden Seiten beruht: die Stellen Ihres Interviews, aus denen er stammt. So können Sie prüfen, ob die Schlussfolgerung stimmt — und sie streichen, wenn nicht.',
    'Diese Seiten gehören nicht zur Verfügung. Trennen Sie sie vor der Unterschrift ab oder heften Sie sie getrennt ab.',
  ], AMBER)

  const summary = String(d.values_summary ?? '').trim()
  if (summary) {
    h1('Das Wertebild, das die KI gelesen hat')
    text(summary)
  }

  const valuesFull = (Array.isArray(d.values) ? d.values : [])
    .map(v => ({ value: String(v?.value ?? '').trim(), evidence: String(v?.evidence ?? '').trim(), consequence: String(v?.consequence ?? '').trim() }))
    .filter(v => v.value || v.evidence)
  if (valuesFull.length) {
    h1('Werte und ihre Belegstellen')
    for (const v of valuesFull) {
      h2(v.value || '—')
      if (v.consequence) text(v.consequence, { size: 10, gapAfter: 1.5 })
      if (v.evidence) text(`„${v.evidence}"`, { size: 9.5, style: 'italic', color: SOFT })
    }
  }

  const hintsFull = (Array.isArray(d.guardian_hints) ? d.guardian_hints : [])
    .map(h => ({ name: String(h?.name ?? '').trim(), relation: String(h?.relation ?? '').trim(), evidence: String(h?.evidence ?? '').trim() }))
    .filter(h => h.name)
  if (hintsFull.length) {
    h1('Vertrauenspersonen, die Ihre Erzählung nennt')
    text('Keine Empfehlung und keine Rangfolge — nur eine Auflistung dessen, wen Sie selbst als nah beschrieben haben.', { size: 9.5, color: SOFT, gapAfter: 3 })
    for (const h of hintsFull) {
      h2(h.relation ? `${h.name} (${h.relation})` : h.name)
      if (h.evidence) text(`„${h.evidence}"`, { size: 9.5, style: 'italic', color: SOFT })
    }
  }

  const exFull = (Array.isArray(d.exclusion_hints) ? d.exclusion_hints : [])
    .map(h => ({ name: String(h?.name ?? '').trim(), relation: String(h?.relation ?? '').trim(), evidence: String(h?.evidence ?? '').trim() }))
    .filter(h => h.name)
  if (exFull.length) {
    h1('Genannte Zerwürfnisse')
    for (const h of exFull) {
      h2(h.relation ? `${h.name} (${h.relation})` : h.name)
      if (h.evidence) text(`„${h.evidence}"`, { size: 9.5, style: 'italic', color: SOFT })
    }
  }

  h1('Belege zu den Wünschen je Aufgabenbereich')
  for (const area of CARE_AREAS) {
    const a = areaData(d, area.key)
    const wishes = wishList(a)
    const gaps = strList(a?.gaps)
    h2(area.title)
    if (!wishes.length && !gaps.length) {
      text('Keine belegten Angaben.', { size: 9.5, color: SOFT })
      continue
    }
    for (const w of wishes) {
      bullet(w.text, { size: 10 })
      if (w.evidence) text(`„${w.evidence}"`, { size: 9, style: 'italic', color: SOFT, x: M + 5, w: maxW - 5, gapAfter: 2 })
    }
    if (gaps.length) callout('Lücken', gaps)
  }

  const open = strList(d.open_points)
  if (open.length) {
    h1('Vor der Unterschrift zu klären')
    for (const o of open) bullet(o, { box: true })
  }

  h1('Was Sie noch tun sollten')
  for (const step of [
    'Mit der Wunschperson sprechen und sie fragen, ob sie die Aufgabe übernehmen würde. Niemand kann dazu verpflichtet werden.',
    'Prüfen, ob zusätzlich eine Vorsorgevollmacht sinnvoll ist — sie kann eine gerichtliche Betreuung ganz vermeiden.',
    'Prüfen, ob Sie eine Patientenverfügung möchten. Behandlungsentscheidungen sind hier bewusst nicht geregelt.',
    'Die Verfügung im Zentralen Vorsorgeregister eintragen lassen oder anderweitig auffindbar hinterlegen.',
    'Die Betreuungsbehörde Ihrer Stadt oder Ihres Landkreises berät kostenlos und beglaubigt auf Wunsch Ihre Unterschrift.',
    'Alle ein bis zwei Jahre erneut lesen, bestätigen und bei Bedarf ändern.',
  ]) bullet(step, { box: true })

  // ── Fußzeile auf allen Seiten ─────────────────────────────────
  const total = doc.getNumberOfPages()
  const created = new Date().toLocaleDateString('de-DE')
  for (let p = 1; p <= total; p++) {
    doc.setPage(p)
    doc.setDrawColor(215); doc.setLineWidth(0.25)
    doc.line(M, PH - 12, PW - M, PH - 12)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(140, 140, 140)
    doc.text(`Betreuungsverfügung${name ? ` · ${name}` : ''} · Entwurf vom ${created}`, M, PH - 8)
    doc.text(`Seite ${p} von ${total}`, PW - M, PH - 8, { align: 'right' })
  }

  return doc
}

export function downloadCareDirectivePdf(filename, data, memorial) {
  buildCareDirectiveDoc(data, memorial).save(filename)
}
