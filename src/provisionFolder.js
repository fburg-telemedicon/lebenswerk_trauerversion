// src/provisionFolder.js
// Die VORSORGEMAPPE — das Nebenprodukt des Lebenswerks, das die früheren
// Einzeldokumente Vorsorgevollmacht und Betreuungsverfügung ablöst.
//
// Anlass (2026-08-07, Rückmeldung aus der Vorsorgeberatung): Die erzeugten
// Unterlagen waren zu umfangreich, und die Vollmacht enthielt zu viel, was
// keine Erklärung ist. Der Standard, auf den die Beratung zeigt, ist ein
// Dreiklang — Vollmacht, Patientenverfügung, Wertvorstellungen.
//
// Was daraus hier geworden ist:
//
//   Teil 1  VORSORGEVOLLMACHT   (src/powerOfAttorney.js) — entschlackt, mit der
//           Betreuungsverfügung als Ziffer 7 statt als eigenem Dokument.
//   Teil 2  PATIENTENVERFÜGUNG  — FEHLT. Bewusst als eigene Seite ausgewiesen
//           und nicht weggelassen (Begründung unten).
//   Teil 3  WERTEERKLÄRUNG      — die Wertvorstellungen als eigene, ausdrücklich
//           NICHT bindende Urkunde: die Auslegungshilfe für alle, die später in
//           diesem Sinne entscheiden müssen.
//   Beiblatt — Belehrungen, KI-Hinweise, Belegstellen. Nicht Bestandteil der
//           Urkunden, ausdrücklich zum Abtrennen.
//
// WARUM DIE PATIENTENVERFÜGUNG FEHLT UND TROTZDEM AUFTAUCHT: Eine
// Patientenverfügung verlangt nach § 1827 BGB hinreichend KONKRETE Festlegungen
// für konkrete Behandlungssituationen; „keine lebenserhaltenden Maßnahmen"
// allein ist nach der Rechtsprechung des BGH unwirksam. Solche Festlegungen
// lassen sich aus einer Lebensgeschichte nicht ableiten — sie müssten eigens
// erfragt werden. Solange das nicht gebaut ist, wäre das Verschweigen der Lücke
// das Gefährlichste an der ganzen Mappe: Sie sähe vollständig aus, obwohl genau
// das Dokument fehlt, das im Ernstfall über die Behandlung entscheidet.
//
// WARUM EINE MAPPE UND NICHT EIN SCHRIFTSTÜCK: Die Teile werden verschiedenen
// Leuten vorgelegt — die Vollmacht der Bank, die Patientenverfügung der Klinik,
// die Werteerklärung den Angehörigen. Deshalb beginnt jeder Teil auf einer
// eigenen Seite, zählt seine Seiten selbst (footerSections in legalForms.js) und
// trägt seine eigene Unterschrift. Ein einziges durchlaufendes Dokument würde
// erzwingen, immer alles herauszugeben.

import { newForm, strList, SOFT, AMBER, BLUE } from './legalForms.js'
import { drawPowerOfAttorney, poaWorksheet } from './powerOfAttorney.js'

// Haltungen („attitudes") normalisieren — die KI liefert sie als Objekte,
// darf aber auch Strings schicken.
function attitudeList(v) {
  return (Array.isArray(v) ? v : [])
    .map(a => (typeof a === 'string'
      ? { topic: '', text: a.trim(), evidence: '' }
      : { topic: String(a?.topic ?? '').trim(), text: String(a?.text ?? '').trim(), evidence: String(a?.evidence ?? '').trim() }))
    .filter(a => a.text)
}

// ── Deckblatt ─────────────────────────────────────────────────────
function drawCover(t, data, memorial) {
  const { text, rule, h2, bullet, callout } = t
  const name = String(memorial?.name || '').trim()

  t.gap(18)
  text('VORSORGEMAPPE', { size: 24, style: 'bold', color: [15, 15, 15], gapAfter: 2, align: 'center' })
  text(name || ' ', { size: 13, color: SOFT, gapAfter: 4, align: 'center' })
  rule([120, 120, 120], 0.6)
  t.gap(6)

  text('Diese Mappe enthält drei Vorsorgedokumente. Jedes wirkt für sich, jedes wird für sich unterschrieben, und jedes kann einzeln vorgelegt werden.', { gapAfter: 6 })

  h2('Teil 1 · Vorsorgevollmacht')
  text('Wer für mich handeln darf, wenn ich es nicht mehr selbst kann — gegenüber Bank, Klinik und Behörde. Wirkt sofort ab Unterschrift. Enthält in Ziffer 7 zugleich meine Betreuungsverfügung für den Fall, dass trotzdem ein Gericht eine Betreuung einrichtet.', { size: 10, color: SOFT, gapAfter: 4 })

  h2('Teil 2 · Patientenverfügung — noch zu erstellen')
  text('Welche ärztlichen Behandlungen an mir vorgenommen oder unterlassen werden sollen. Dieser Teil ist in dieser Mappe NICHT enthalten und auch durch die Vollmacht nicht ersetzt.', { size: 10, color: SOFT, gapAfter: 4 })

  h2('Teil 3 · Werteerklärung')
  text('Woran sich Entscheidungen ausrichten sollen, die ich nicht ausdrücklich geregelt habe. Nicht bindend, aber die wichtigste Auslegungshilfe für alle, die für mich entscheiden müssen.', { size: 10, color: SOFT, gapAfter: 6 })

  callout('Entwurf — bitte vor der Unterschrift prüfen', [
    'Die Vorschläge in dieser Mappe hat eine KI aus der eigenen Lebensgeschichte erarbeitet. Sie sind ein Vorschlag, keine Rechtsberatung und keine fertige Erklärung.',
    'Alle Namen bleiben leer: weder die bevollmächtigte Person noch eine Wunsch-Betreuung werden von der KI benannt. Diese Entscheidungen trifft ausschließlich die Person selbst.',
    'Das Beiblatt am Ende erklärt jeden Punkt und weist zu jedem Vorschlag die Stelle im Interview nach, aus der er stammt. Es gehört nicht zu den Urkunden und ist vor der Unterschrift abzutrennen.',
    'Die Vorlagen richten sich nach deutschem Recht.',
  ], AMBER)

  h2('Was noch zu tun ist')
  bullet('Alle Felder ausfüllen, die leer geblieben sind — vor allem die Namen.')
  bullet('Patientenverfügung erstellen (Teil 2) und hier einlegen.')
  bullet('Jeden Teil einzeln unterschreiben; Unterschrift unter der Vollmacht bei der Betreuungsbehörde beglaubigen lassen.')
  bullet('Beiblatt abtrennen und getrennt aufbewahren.')
}

// ── Teil 2: die Fehlstelle ────────────────────────────────────────
function drawMissingDirective(t) {
  const { text, rule, h2, bullet, callout } = t

  text('TEIL 2 · PATIENTENVERFÜGUNG', { size: 18, style: 'bold', color: [15, 15, 15], gapAfter: 1.5 })
  text('Nicht Bestandteil dieser Mappe', { size: 11, color: SOFT, gapAfter: 3 })
  rule([120, 120, 120], 0.6)

  callout('Dieses Dokument fehlt — und es fehlt nicht aus Versehen', [
    'Eine Patientenverfügung legt fest, welche ärztlichen Maßnahmen in bestimmten Situationen durchgeführt oder unterlassen werden sollen. Sie muss dafür hinreichend konkret sein: Die Rechtsprechung verlangt Festlegungen für benannte Behandlungssituationen. Eine allgemeine Formel wie „keine lebenserhaltenden Maßnahmen" genügt nicht.',
    'So etwas lässt sich aus einer Lebensgeschichte nicht ableiten. Was jemand über Krankheit, Abhängigkeit oder Sterben erzählt hat, steht deshalb in Teil 3 als HALTUNG — nicht als Anweisung, was zu tun oder zu unterlassen ist.',
    'Die Vorsorgevollmacht ersetzt die Patientenverfügung nicht. Sie regelt, WER entscheidet; die Patientenverfügung regelt, WAS entschieden ist.',
  ], AMBER)

  h2('Wie Sie zu einer Patientenverfügung kommen')
  bullet('Im Gespräch mit der Hausärztin oder dem Hausarzt — sie kennen die Situationen, um die es geht, und können einordnen, was die Festlegungen im Ernstfall bedeuten.')
  bullet('Mit den Textbausteinen des Bundesministeriums der Justiz (kostenfrei erhältlich) oder über eine Vorsorgeberatung.')
  bullet('Bei Beratungsstellen der Wohlfahrtsverbände, Hospizvereinen oder der Betreuungsbehörde.')

  h2('Wenn Sie eine Patientenverfügung erstellt haben')
  bullet('Legen Sie sie an dieser Stelle in die Mappe.')
  bullet('Tragen Sie das Errichtungsdatum in Ziffer 6 der Vorsorgevollmacht ein.')
  bullet('Geben Sie der bevollmächtigten Person eine Kopie — sie muss ihr im Ernstfall Geltung verschaffen.')
  t.gap(4)
  text('Platz für eigene Notizen bis dahin:', { size: 10, style: 'bold', gapAfter: 2 })
  t.blankLines(6)
}

// ── Teil 3: Werteerklärung ────────────────────────────────────────
function drawValues(t, data, memorial) {
  const { text, rule, h1, h2, bullet, blankLines, signatureRow, callout } = t
  const d = data || {}
  const name = String(memorial?.name || '').trim()

  text('WERTEERKLÄRUNG', { size: 20, style: 'bold', color: [15, 15, 15], gapAfter: 1.5 })
  text(name ? `von ${name}` : 'von', { size: 12, color: SOFT, gapAfter: 3 })
  rule([120, 120, 120], 0.6)

  callout('Wozu diese Erklärung da ist', [
    'Sie ist kein bindendes Dokument. Sie sagt niemandem, was zu tun ist — sie sagt, woran sich das Entscheiden ausrichten soll, wenn ich es selbst nicht mehr sagen kann und die Lage nicht geregelt ist.',
    'Für alle, die dann für mich entscheiden müssen — bevollmächtigte Person, Ärztin, Betreuungsgericht, Angehörige — ist das die beste Auskunft über meinen mutmaßlichen Willen, die es gibt.',
  ], BLUE)

  const summary = String(d.values_summary ?? '').trim()
  if (summary) {
    h1('Wer ich bin')
    // Die KI schreibt values_summary in der dritten Person (Wertebild). Hier
    // steht sie als Bild, das die erzählende Person von sich bestätigt — der
    // Satz davor macht klar, dass es eine Fremdbeschreibung ist, die sie sich
    // zu eigen macht oder eben streicht.
    text('Aus meiner Lebensgeschichte ist folgendes Bild entstanden. Ich habe es gelesen und lasse es so stehen:', { size: 9.5, color: SOFT, gapAfter: 2.5 })
    text(summary)
  }

  const values = (Array.isArray(d.values) ? d.values : [])
    .map(v => ({ value: String(v?.value ?? '').trim(), consequence: String(v?.consequence ?? '').trim() }))
    .filter(v => v.value || v.consequence)
  h1('Was mir wichtig ist')
  if (values.length) {
    for (const v of values) {
      h2(v.value || '—')
      if (v.consequence) text(v.consequence, { size: 10.5 })
    }
  } else {
    blankLines(5)
  }

  const attitudes = attitudeList(d.attitudes)
  if (attitudes.length) {
    h1('Meine Haltung')
    text('Wie ich über das denke, was auf mich zukommen kann. Das sind keine Anweisungen für eine Behandlung — die gehören in eine Patientenverfügung.', { size: 9.5, color: SOFT, gapAfter: 3 })
    for (const a of attitudes) {
      if (a.topic) h2(a.topic)
      text(a.text, { size: 10.5 })
    }
  }

  const daily = strList(d.daily_life)
  if (daily.length) {
    h1('Was meinen Alltag ausmacht')
    text('Gewohnheiten und Vorlieben, die auch dann geachtet werden sollen, wenn ich mich nicht mehr dazu äußern kann:', { size: 9.5, color: SOFT, gapAfter: 3 })
    for (const item of daily) bullet(item)
  }

  h1('Was ich hier noch ergänzen möchte')
  blankLines(6)

  h1('Ort, Datum und Unterschrift')
  text('Diese Erklärung ist nicht bindend. Sie soll gelesen werden, wenn für mich entschieden werden muss.', { size: 9.5, color: SOFT, gapAfter: 5 })
  signatureRow('Ort, Datum', 'Unterschrift')
}

// ── Beiblatt ──────────────────────────────────────────────────────
function drawWorksheet(t, data, memorial) {
  const { text, rule, h1, bullet, callout } = t
  const d = data || {}

  text('BEIBLATT', { size: 16, style: 'bold', color: [15, 15, 15], gapAfter: 1.5 })
  text('Nicht Bestandteil der Urkunden — vor der Unterschrift abtrennen', { size: 10, color: SOFT, gapAfter: 3 })
  rule([120, 120, 120], 0.6)
  callout('Wozu diese Seiten da sind', [
    'Hier steht, was die Urkunden bewusst nicht enthalten: die Erklärungen zu jedem Punkt und die Stellen des Interviews, aus denen jeder Vorschlag stammt. So lässt sich prüfen, ob die Schlussfolgerung stimmt — und streichen, wenn nicht.',
    'Eine Urkunde soll nichts enthalten, was nicht Teil der Erklärung ist. Deshalb stehen diese Hinweise hier und nicht dort.',
  ], AMBER)

  poaWorksheet(t, d, memorial)

  h1('Zur Werteerklärung (Teil 3)')
  text('Die Werteerklärung ist absichtlich nicht bindend formuliert. Eine bindende Festlegung auf ärztliche Maßnahmen wäre eine Patientenverfügung und müsste eigens erstellt werden (Teil 2). Prüfen Sie die Sätze trotzdem Wort für Wort: Sie werden gelesen, wenn Sie selbst nichts mehr sagen können.', { size: 10 })

  const open = strList(d.open_points)
  if (open.length) {
    h1('Vor der Unterschrift zu klären')
    for (const o of open) bullet(o, { box: true })
  }

  h1('Was Sie noch tun sollten')
  for (const step of [
    'Mit der ausgewählten Person sprechen und sie fragen, ob sie die Vollmacht annehmen würde. Niemand kann dazu verpflichtet werden.',
    'Die drei angekreuzten Sonderbefugnisse noch einmal in Ruhe durchgehen — § 1829 (lebensgefährliche Eingriffe), § 1831 (freiheitsentziehende Maßnahmen) und Immobilien. Sie sind die einzigen Punkte, die ohne ausdrückliches Kreuz nicht gelten.',
    'Unterschrift bei der Betreuungsbehörde beglaubigen lassen. Sind Immobilien, Darlehen oder ein Handelsregistereintrag im Spiel: Notartermin.',
    'Mit der Bank klären, ob sie zusätzlich ein eigenes Formular verlangt — das geht nur, solange Sie selbst handlungsfähig sind.',
    'Die Patientenverfügung erstellen (Teil 2). Sie ist der einzige Teil, den diese Mappe nicht mitbringt.',
    'Ziffer 7 ausfüllen, wenn Sie für den Fall einer gerichtlichen Betreuung eine bestimmte Person wünschen oder ausschließen möchten.',
    'Die Vollmacht im Zentralen Vorsorgeregister eintragen lassen und dafür sorgen, dass die bevollmächtigte Person im Ernstfall an das Original kommt.',
    'Alle ein bis zwei Jahre erneut lesen, bestätigen und bei Bedarf ändern oder widerrufen.',
  ]) bullet(step, { box: true })
}

// ── Die Mappe ─────────────────────────────────────────────────────

export function buildProvisionFolderDoc(data, memorial) {
  const t = newForm()
  const name = String(memorial?.name || '').trim()

  drawCover(t, data, memorial)

  const p1 = t.newPage()
  drawPowerOfAttorney(t, data, memorial)

  const p2 = t.newPage()
  drawMissingDirective(t)

  const p3 = t.newPage()
  drawValues(t, data, memorial)

  const p4 = t.newPage()
  drawWorksheet(t, data, memorial)

  const created = new Date().toLocaleDateString('de-DE')
  t.footerSections([
    { from: p1, label: 'Teil 1 · Vorsorgevollmacht' },
    { from: p2, label: 'Teil 2 · Patientenverfügung (fehlt)' },
    { from: p3, label: 'Teil 3 · Werteerklärung' },
    { from: p4, label: 'Beiblatt · nicht Bestandteil der Urkunden' },
  ], `${name ? `${name} · ` : ''}Entwurf vom ${created}`)

  return t.doc
}

export function downloadProvisionFolderPdf(filename, data, memorial) {
  buildProvisionFolderDoc(data, memorial).save(filename)
}
