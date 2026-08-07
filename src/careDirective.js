// src/careDirective.js
// ALTBESTAND — die BETREUUNGSVERFÜGUNG als eigenes Dokument.
//
// Seit dem 2026-08-07 wird sie NICHT MEHR NEU ERZEUGT: Sie steckt jetzt als
// Ziffer 7 in der Vorsorgevollmacht (src/powerOfAttorney.js), die ihrerseits
// Teil 1 der Vorsorgemappe ist (src/provisionFolder.js). Grund war die
// Rückmeldung aus der Vorsorgeberatung, die Unterlagen seien zu umfangreich;
// als nachrangige Rückfallebene braucht die Betreuungsverfügung kein eigenes
// Dokument.
//
// Diese Datei bleibt, damit die vor diesem Datum erzeugten Verfügungen
// weiterhin als PDF geladen werden können — `downloadCareDirectivePdf` wird
// aus App.jsx genau dafür noch aufgerufen. `careDirectiveSystem` (der Prompt)
// wird nirgends mehr verwendet und steht nur noch als Beleg dafür, woraus die
// gespeicherten Daten entstanden sind. Nichts hier anfassen, ohne zu prüfen,
// ob bestehende `care_directive`-Daten weiter zeichenbar bleiben.
//
// Die ursprüngliche Beschreibung:
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

import { selfOnly, contributionBlocks } from './categories.js'
import { newForm, pickByKey, strList, wishList, personList, personLine, INK, SOFT, AMBER } from './legalForms.js'

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
- AUSLANDSBEZUG: Spielt die Lebensgeschichte erkennbar außerhalb Deutschlands (Wohnort, Beruf, Staatsangehörigkeit), dann nimm als ERSTEN "open_points"-Eintrag einen Hinweis auf, dass dieses Formular deutschem Recht folgt und zu prüfen ist, welches Recht tatsächlich gilt — im angelsächsischen Raum entsprechen ihm am ehesten „Power of Attorney" und „Health Care Proxy", in Österreich die Erwachsenenvertretung, in der Schweiz der Vorsorgeauftrag. Spielt sie in Deutschland, lass diesen Hinweis weg.
- Alle vier Aufgabenbereiche müssen in "areas" vorkommen, mit genau diesen "key"-Werten: gesundheit, vermoegen, wohnung, aufenthalt.
- Antworte AUSSCHLIESSLICH auf Deutsch — auch wenn das Interview in einer anderen Sprache geführt wurde. Das Dokument geht an ein deutsches Betreuungsgericht.
- Gültiges JSON, keine trailing commas.

Interview mit ${who} (Selbstauskunft):

${contributionBlocks(contributions)}`
}

// ════════════════════════════════════════════════════════════════
// 2) Das Formular (DIN A4 hoch)
// ════════════════════════════════════════════════════════════════

// Die KI liefert "areas" mal als Liste, mal als Objekt — pickByKey nimmt beides.
const areaData = (data, key) => pickByKey(data?.areas, key)

// Zeichnet das Formular und gibt das jsPDF-Dokument zurück, ohne es zu speichern.
// Zeichnet das Formular und gibt das jsPDF-Dokument zurück, ohne es zu speichern.
// Getrennt von downloadCareDirectivePdf(), damit dasselbe Layout auch außerhalb
// des Browsers erzeugt werden kann (Skripte, Nachbearbeitung bestehender
// Biographien) — dort gibt es kein doc.save().
export function buildCareDirectiveDoc(data, memorial) {
  // Layout-Bausteine aus src/legalForms.js — dieselben, aus denen die
  // Vorsorgevollmacht gesetzt wird. Die Ankreuzkästchen an jedem KI-Vorschlag
  // sind Absicht: Was hier steht, ist ein ENTWURF; die Person hakt ab, was sie
  // sich zu eigen macht, und streicht den Rest.
  const t = newForm()
  const { doc, maxW, PW, M } = t
  const { text, rule, h1, h2, bullet, field, blankLines, callout, yesNo, signatureRow, ensure, gap } = t

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
    yesNo('Dieser Aufgabenbereich soll übertragen werden.', 'Ausdrücklich nicht.')
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
  signatureRow('Ort, Datum', 'Unterschrift')

  h2('Spätere Bestätigung')
  text('Eine Verfügung wirkt umso stärker, je aktueller sie ist. Bestätigen Sie sie am besten alle ein bis zwei Jahre mit Datum und Unterschrift.', { size: 9.5, color: SOFT, gapAfter: 4 })
  for (let i = 0; i < 3; i++) signatureRow(null, null, { gapBefore: 5, gapAfter: 13, lw: 0.25, color: 150 })

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
  doc.addPage(); t.y = M

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
  const created = new Date().toLocaleDateString('de-DE')
  t.footer(`Betreuungsverfügung${name ? ` · ${name}` : ''} · Entwurf vom ${created}`)

  return doc
}

export function downloadCareDirectivePdf(filename, data, memorial) {
  buildCareDirectiveDoc(data, memorial).save(filename)
}
