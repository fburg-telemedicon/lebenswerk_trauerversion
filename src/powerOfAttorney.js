// src/powerOfAttorney.js
// Viertes Nebenprodukt des Lebenswerks: die VORSORGEVOLLMACHT.
//
// Abgrenzung zur Betreuungsverfügung (src/careDirective.js) — die beiden werden
// ständig verwechselt, und der Unterschied ist der ganze Punkt:
//
//   Betreuungsverfügung  richtet sich an das GERICHT und greift erst, wenn dieses
//                        eine Betreuung anordnet. Der Betreuer steht unter
//                        gerichtlicher Aufsicht.
//   Vorsorgevollmacht    richtet sich an DRITTE (Bank, Klinik, Behörde) und wirkt
//                        SOFORT. Sie kann eine Betreuung ganz vermeiden — es gibt
//                        dann aber auch keine gerichtliche Kontrolle.
//
// Deshalb ist dieses Dokument das gefährlichere von beiden, und die Warnungen
// darin sind entsprechend deutlicher. Die drei Grenzen aus careDirective.js
// gelten hier erst recht:
//
//  1. NUR SELBSTAUSKUNFT (keine Gastbeiträge) — eine Vollmacht ist eine
//     Willenserklärung; was Angehörige über die Person sagen, darf nicht zu
//     ihrem erklärten Willen werden.
//  2. DIE KI BENENNT NIEMANDEN. Das Feld für die bevollmächtigte Person bleibt
//     leer. Hier wiegt das noch schwerer als bei der Betreuungsverfügung: Wer
//     hier eingetragen wird, kann am Tag darauf über das Konto verfügen.
//  3. KEINE BEHANDLUNGSENTSCHEIDUNGEN. Was behandelt oder unterlassen wird,
//     gehört in eine Patientenverfügung (§ 1827 BGB).
//
// Zusätzlich gilt hier: Die KI kreuzt NICHTS an. Die heiklen Befugnisse
// (§ 1829 lebensgefährliche Eingriffe, § 1831 freiheitsentziehende Maßnahmen,
// Immobilien) wirken nur, wenn sie ausdrücklich erteilt sind — diese Kästchen
// füllt ausschließlich der Mensch selbst.
//
// Wirksamkeitsmodell (bewusst gewählt): im AUSSENVERHÄLTNIS unbedingt, im
// INNENVERHÄLTNIS an die Weisung gebunden, erst bei Entscheidungsunfähigkeit
// Gebrauch zu machen. Eine im Außenverhältnis bedingte Vollmacht („gilt erst,
// wenn zwei Ärzte bescheinigen …") wird von Banken und Grundbuchämtern in der
// Praxis regelmäßig zurückgewiesen — sie verfehlt dann genau in dem Moment ihren
// Zweck, für den sie gemacht wurde.

import { selfOnly, contributionBlocks } from './categories.js'
import { newForm, pickByKey, strList, wishList, personList, personLine, INK, SOFT, AMBER, RED } from './legalForms.js'

// Die Bereiche der Vollmacht. `key` ist zugleich der Schlüssel, den die KI im
// JSON liefern muss. Reihenfolge = Reihenfolge im Formular.
export const POA_AREAS = [
  { key: 'gesundheit', title: 'Gesundheitssorge und Pflege',
    scope: 'Einwilligung in Untersuchungen, Heilbehandlungen und ärztliche Eingriffe, Gespräche mit Ärztinnen und Ärzten, Entbindung von der Schweigepflicht, Einsicht in Krankenunterlagen, Auswahl und Beauftragung von Pflege- und Therapieleistungen, Abschluss von Heim- und Pflegeverträgen.',
    guide: 'Wie soll entschieden werden — wer wird einbezogen, wie viel möchte ich selbst erfahren und mitentscheiden, worauf soll im Umgang mit mir geachtet werden? KEINE Festlegung auf einzelne Behandlungen.' },
  { key: 'aufenthalt', title: 'Aufenthalt und Wohnungsangelegenheiten',
    scope: 'Bestimmung des Aufenthaltsorts, Wohnungsangelegenheiten einschließlich Kündigung, Umzug und Auflösung des Haushalts, Abschluss und Kündigung von Miet- und Heimverträgen.',
    guide: 'Wo möchte ich leben, was ist mir an einem Ort wichtig, unter welchen Bedingungen darf meine Wohnung aufgegeben werden, wer soll vorher gefragt werden?' },
  { key: 'vermoegen', title: 'Vermögenssorge',
    scope: 'Verwaltung meines Vermögens, Verfügung über Konten und Depots, Entgegennahme und Verwendung von Einkünften, laufende Zahlungen, Abschluss, Änderung und Kündigung von Verträgen, Aufnahme und Rückzahlung von Krediten.',
    guide: 'Wie soll mit Geld umgegangen werden — sparsam oder großzügig, wofür darf ausgegeben werden, welche Verpflichtungen sind mir wichtig, worüber möchte ich informiert bleiben?' },
  { key: 'behoerden', title: 'Behörden, Versicherungen und Gericht',
    scope: 'Vertretung gegenüber Behörden, Sozialleistungsträgern, Kranken-, Pflege- und sonstigen Versicherungen, Stellung von Anträgen, Einlegung von Rechtsbehelfen sowie Vertretung vor Gericht.',
    guide: 'Worauf lege ich im Umgang mit Ämtern Wert, was soll beantragt oder gerade nicht beantragt werden, wie soll bei Streit vorgegangen werden?' },
  { key: 'post', title: 'Post und Telekommunikation',
    scope: 'Entgegennahme, Öffnen und Beantwortung meiner Post, Auskünfte und Verträge bei Telefon-, Mobilfunk- und Internetanbietern.',
    guide: 'Was darf gelesen und beantwortet werden, gibt es Post, die mir persönlich vorbehalten bleiben soll?' },
]

// ════════════════════════════════════════════════════════════════
// 1) KI-Prompt
// ════════════════════════════════════════════════════════════════

export function powerOfAttorneySystem(memorial, allContributions) {
  const contributions = selfOnly(allContributions)
  const who = memorial?.name || 'die erzählende Person'
  const areaSpec = POA_AREAS.map(a => `  • "${a.key}" (${a.title}): ${a.guide}`).join('\n')

  return `Du bist eine erfahrene Notarin mit biografischer Ausbildung. Du liest die Lebensgeschichte von ${who} — erzählt von ${who} selbst — und arbeitest daraus das WERTESYSTEM heraus: woran dieser Mensch sein Leben ausrichtet, wie er entscheidet, was ihm Würde und Selbstbestimmung bedeuten.

Daraus entwirfst du eine VORSORGEVOLLMACHT: das Dokument, mit dem ein Mensch einer Vertrauensperson die Befugnis gibt, für ihn zu handeln, falls er seine Angelegenheiten nicht mehr selbst besorgen kann. Anders als eine Betreuungsverfügung wirkt sie SOFORT und ohne Gericht.

Gib REINES, GÜLTIGES JSON aus (kein Markdown, keine Erklärungen, keine Code-Fences):
{
  "values_summary": "3–5 Sätze in der dritten Person: das Wertesystem dieses Menschen, so wie es aus seiner Erzählung hervorgeht.",
  "values": [
    { "value": "Wert in 1–3 Wörtern",
      "evidence": "kurzes wörtliches Zitat aus dem Interview (max. 25 Wörter), das diesen Wert belegt",
      "consequence": "EIN Satz in der ICH-FORM: was daraus für das Handeln einer bevollmächtigten Person folgt" }
  ],
  "usage_wishes": [
    { "text": "EIN Satz in der ICH-FORM: wie ich möchte, dass von dieser Vollmacht Gebrauch gemacht wird (Art des Entscheidens, Einbeziehung, Rechenschaft, Umgang mit mir)",
      "evidence": "kurzes wörtliches Zitat, das ihn trägt" }
  ],
  "attorney_hints": [
    { "name": "Name der Person", "relation": "Beziehung",
      "evidence": "kurzes wörtliches Zitat, das ein besonderes Vertrauensverhältnis belegt" }
  ],
  "exclusion_hints": [
    { "name": "Name", "relation": "Beziehung", "evidence": "kurzes wörtliches Zitat, das ein Zerwürfnis oder ausdrückliche Ablehnung belegt" }
  ],
  "areas": [
    { "key": "gesundheit", "wishes": [ { "text": "EIN Wunsch in der ICH-FORM", "evidence": "wörtliches Zitat" } ], "gaps": [ "Wozu die Erzählung nichts hergibt" ] },
    { "key": "aufenthalt", "wishes": [], "gaps": [] },
    { "key": "vermoegen",  "wishes": [], "gaps": [] },
    { "key": "behoerden",  "wishes": [], "gaps": [] },
    { "key": "post",       "wishes": [], "gaps": [] }
  ],
  "open_points": [ "Was vor der Unterschrift entschieden oder ergänzt werden muss" ]
}

DIE BEREICHE DER VOLLMACHT:
${areaSpec}

REGELN — verbindlich:
- ERFINDE NICHTS. Jeder Wunsch, jeder Wert, jeder Name muss sich auf eine Stelle der Erzählung stützen. Ohne Beleg kein Eintrag. "evidence" ist ein WÖRTLICHES Zitat, nicht deine Zusammenfassung.
- ABLEITEN ist erlaubt und erwünscht, ERFINDEN nicht. Aus „Ich habe mein Leben lang jeden Monat ein Budget gemacht" darf „Ich möchte, dass mit meinem Geld weiterhin geplant und sparsam umgegangen wird" werden.
- ICH-FORM für alles, was ins Dokument geht ("wishes", "usage_wishes", "consequence"). "values_summary" bleibt in der dritten Person.
- DU BENENNST NIEMANDEN ALS BEVOLLMÄCHTIGTEN. Wer hier eingetragen wird, kann am Tag darauf über Konten verfügen und über den Aufenthalt entscheiden — diese Wahl darf NIEMALS aus einer KI-Schlussfolgerung stammen. "attorney_hints" sammelt ausschließlich Menschen, die die Erzählung als besondere Vertrauenspersonen ausweist, als Gedächtnisstütze für die Person selbst. Keine Rangfolge, keine Empfehlung, höchstens 4. Gibt die Erzählung niemanden her: leere Liste.
- KEINE BEHANDLUNGSENTSCHEIDUNGEN. Bei "gesundheit" geht es darum, WIE und mit wem entschieden wird und wie mit mir umgegangen werden soll — NIEMALS darum, welche Behandlung erfolgen oder unterbleiben soll (keine Wiederbelebung, keine künstliche Ernährung, keine Medikamente). Das ist Sache einer Patientenverfügung. Ebenso: keine Diagnosen, keine medizinischen Empfehlungen.
- DU ERTEILST KEINE BEFUGNISSE. Die besonders eingriffsintensiven Punkte — ärztliche Maßnahmen mit Lebensgefahr (§ 1829 BGB), freiheitsentziehende Maßnahmen wie Fixierung oder geschlossene Unterbringung (§ 1831 BGB), Verfügungen über Immobilien — stehen als anzukreuzende Optionen im Formular und werden ausschließlich vom Menschen selbst erteilt. Schlage NICHT vor, sie zu erteilen. Erlaubt und wertvoll ist der umgekehrte Fall: Sagt die Erzählung etwas über die HALTUNG dazu (z. B. große Bedeutung von Bewegungsfreiheit oder der eigenen Wohnung), nimm das als Wunsch auf.
- "exclusion_hints" nur bei einem AUSDRÜCKLICHEN Zerwürfnis oder einer klaren Ablehnung. Bloße Distanz reicht nicht. Im Zweifel: leere Liste.
- KEINE RECHTSBERATUNG, keine Paragraphen, keine Vollmachtsformeln — der rechtliche Rahmen steht bereits im Formular.
- Umfang: 4–7 "values"; 4–8 "usage_wishes"; je Bereich 2–6 "wishes" und 1–3 "gaps"; 3–8 "open_points".
- Gibt die Erzählung zu einem Bereich nichts her, lass "wishes" LEER und benenne das in "gaps".
- Alle fünf Bereiche müssen in "areas" vorkommen, mit genau diesen "key"-Werten: gesundheit, aufenthalt, vermoegen, behoerden, post.
- AUSLANDSBEZUG: Spielt die Lebensgeschichte erkennbar außerhalb Deutschlands, dann nimm als ERSTEN "open_points"-Eintrag einen Hinweis auf, dass dieses Formular deutschem Recht folgt und zu prüfen ist, welches Recht gilt — im angelsächsischen Raum entsprechen ihm am ehesten „Power of Attorney" und „Health Care Proxy", in Österreich der Vorsorgebevollmächtigte, in der Schweiz der Vorsorgeauftrag. Spielt sie in Deutschland, lass den Hinweis weg.
- Antworte AUSSCHLIESSLICH auf Deutsch, auch wenn das Interview in einer anderen Sprache geführt wurde.
- Gültiges JSON, keine trailing commas.

Interview mit ${who} (Selbstauskunft):

${contributionBlocks(contributions)}`
}

// ════════════════════════════════════════════════════════════════
// 2) Das Formular (DIN A4 hoch)
// ════════════════════════════════════════════════════════════════

const areaData = (data, key) => pickByKey(data?.areas, key)

export function buildPowerOfAttorneyDoc(data, memorial) {
  const t = newForm()
  const { doc, maxW, PW, M } = t
  const { text, rule, h1, h2, bullet, field, blankLines, callout, yesNo, signatureRow } = t

  const name = String(memorial?.name || '').trim()
  const d = data || {}

  // ── Kopf ──────────────────────────────────────────────────────
  text('VORSORGEVOLLMACHT', { size: 20, style: 'bold', color: [15, 15, 15], gapAfter: 1.5 })
  text(name ? `von ${name}` : 'von', { size: 12, color: SOFT, gapAfter: 3 })
  rule([120, 120, 120], 0.6)

  callout('Entwurf — und ein Dokument mit sofortiger Wirkung', [
    'Dieser Entwurf wurde von einer KI aus Ihrer eigenen Lebensgeschichte erarbeitet. Er ist ein Vorschlag, keine Rechtsberatung und keine fertige Erklärung.',
    'Eine Vorsorgevollmacht wirkt SOFORT, sobald sie unterschrieben und aus der Hand gegeben ist — nicht erst, wenn Ihnen etwas zustößt. Die bevollmächtigte Person kann damit über Ihre Konten verfügen und über Ihren Aufenthalt entscheiden, ohne dass ein Gericht das kontrolliert. Genau darin liegt ihr Vorteil gegenüber einer Betreuung, und genau darin ihr Risiko.',
    'Erteilen Sie sie deshalb nur einem Menschen, dem Sie ohne jeden Vorbehalt vertrauen. Das Feld dafür ist leer, weil diese Wahl niemand für Sie treffen darf.',
    'Lassen Sie Ihre Unterschrift bei der Betreuungsbehörde Ihrer Stadt oder Ihres Landkreises beglaubigen (kostet wenige Euro) — viele Banken und Behörden verlangen das. Für Geschäfte mit Immobilien ist eine notarielle Beurkundung nötig.',
    'Diese Vorlage richtet sich nach deutschem Recht.',
  ], AMBER)

  // ── 1. Vollmachtgeber ─────────────────────────────────────────
  h1('1. Ich, die vollmachtgebende Person')
  field('Name, Vorname', name)
  field('Geburtsdatum')
  field('Geburtsort')
  field('Anschrift')
  field('Telefon / E-Mail')

  // ── 2. Bevollmächtigte Person ─────────────────────────────────
  h1('2. Ich bevollmächtige')
  text('Hiermit bevollmächtige ich die nachstehende Person, mich in den unter Ziffer 3 angekreuzten Bereichen zu vertreten:', { gapAfter: 3 })
  field('Name, Vorname')
  field('Geburtsdatum')
  field('Anschrift')
  field('Telefon / E-Mail')
  field('Verhältnis zu mir')
  t.gap(2)
  text('Ist diese Person verhindert, verstorben oder will oder kann sie die Aufgabe nicht übernehmen, bevollmächtige ich an ihrer Stelle:', { gapAfter: 3 })
  field('Name, Vorname')
  field('Geburtsdatum')
  field('Anschrift')
  field('Telefon / E-Mail')
  field('Verhältnis zu mir')

  t.gap(2)
  h2('Wenn ich mehrere Personen bevollmächtige')
  bullet('Jede von ihnen darf mich allein vertreten (Einzelvertretung).', { box: true })
  bullet('Sie dürfen mich nur gemeinsam vertreten (Gesamtvertretung — sicherer gegen Missbrauch, im Alltag aber deutlich schwerfälliger).', { box: true })

  const hints = personList(d.attorney_hints)
  if (hints.length) {
    callout('Gedächtnisstütze aus Ihrer Lebensgeschichte — keine Empfehlung', [
      `Im Interview haben Sie über diese Menschen als besondere Vertrauenspersonen gesprochen: ${hints.map(personLine).join(', ')}.`,
      'Wen Sie eintragen, entscheiden allein Sie. Die Belegstellen stehen in der Arbeitshilfe am Ende. Sprechen Sie unbedingt vorher mit der Person — eine Vollmacht ist auch für sie eine Last, und niemand kann dazu verpflichtet werden.',
    ])
  } else {
    callout('Hinweis', ['Ihre Erzählung nennt keine Person eindeutig genug, als dass hier ein Hinweis stehen dürfte. Lassen Sie sich mit dieser Entscheidung Zeit — sie ist die wichtigste in diesem Dokument.'])
  }

  const exHints = personList(d.exclusion_hints)
  if (exHints.length) {
    callout('Genannte Zerwürfnisse', [
      `Sie haben über ein Zerwürfnis oder eine Ablehnung gesprochen, die folgende Menschen betrifft: ${exHints.map(personLine).join(', ')}.`,
      'Eine Vollmacht muss niemanden ausschließen — sie gilt nur für die Person, die Sie eintragen. Wenn Sie es dennoch festhalten möchten, tun Sie das unter Ziffer 8.',
    ])
  }

  // ── 3. Umfang ─────────────────────────────────────────────────
  h1('3. Wofür die Vollmacht gilt')
  text('Ich kreuze für jeden Bereich an, ob die Vollmacht ihn umfassen soll. Nicht angekreuzte Bereiche sind NICHT von der Vollmacht gedeckt — dort bliebe im Ernstfall nur eine gerichtliche Betreuung.', { gapAfter: 4 })

  for (const area of POA_AREAS) {
    const a = areaData(d, area.key)
    const wishes = wishList(a)
    const gaps = strList(a?.gaps)

    h2(area.title)
    text(area.scope, { size: 9.5, color: SOFT, gapAfter: 3 })
    yesNo('Dieser Bereich ist umfasst.', 'Ausdrücklich nicht.')

    // Die Sonderbefugnisse, die NUR wirken, wenn sie eigens erteilt sind.
    if (area.key === 'gesundheit') {
      text('Zusätzlich und nur, wenn eigens angekreuzt (§ 1829 BGB):', { size: 10, style: 'bold', color: RED, gapAfter: 2 })
      bullet('Die Vollmacht umfasst auch die Einwilligung in Untersuchungen, Heilbehandlungen oder ärztliche Eingriffe, bei denen die begründete Gefahr besteht, dass ich sterbe oder einen schweren und länger dauernden gesundheitlichen Schaden erleide — ebenso die Nichteinwilligung oder den Widerruf einer Einwilligung in solche Maßnahmen.', { box: true, size: 10 })
      text('Ohne dieses Kreuz ist die Vollmacht in genau den Situationen unwirksam, in denen es am meisten darauf ankommt. Umgekehrt gilt: In manchen dieser Fälle muss die bevollmächtigte Person zusätzlich das Betreuungsgericht einschalten, wenn sie sich mit den Ärzten nicht einig ist.', { size: 9, color: SOFT, gapAfter: 3 })
    }
    if (area.key === 'aufenthalt') {
      text('Zusätzlich und nur, wenn eigens angekreuzt (§ 1831 BGB):', { size: 10, style: 'bold', color: RED, gapAfter: 2 })
      bullet('Die Vollmacht umfasst auch freiheitsentziehende Maßnahmen: meine Unterbringung in einer geschlossenen Einrichtung sowie Maßnahmen wie Bettgitter, Gurte oder andere Vorrichtungen, mit denen mir über einen längeren Zeitraum die Bewegungsfreiheit entzogen wird, und ebenso Medikamente, die diesem Zweck dienen.', { box: true, size: 10 })
      text('Solche Maßnahmen bedürfen zusätzlich der Genehmigung des Betreuungsgerichts. Viele Menschen schließen diesen Punkt bewusst aus — das ist eine legitime Entscheidung und kein Versäumnis.', { size: 9, color: SOFT, gapAfter: 3 })
    }
    if (area.key === 'vermoegen') {
      text('Zusätzlich und nur, wenn eigens angekreuzt:', { size: 10, style: 'bold', color: RED, gapAfter: 2 })
      bullet('Die Vollmacht umfasst auch Verfügungen über Grundstücke und grundstücksgleiche Rechte: Erwerb, Veräußerung, Belastung sowie alle Erklärungen gegenüber dem Grundbuchamt.', { box: true, size: 10 })
      text('ACHTUNG: Für Grundstücksgeschäfte und für die Eintragung im Grundbuch verlangt das Gesetz eine NOTARIELL BEURKUNDETE Vollmacht. Ein selbst unterschriebenes Formular reicht dafür nicht aus, auch nicht mit beglaubigter Unterschrift. Wenn Ihnen dieser Punkt wichtig ist, führt kein Weg an einem Notartermin vorbei. Dasselbe gilt für die Aufnahme von Verbraucherdarlehen und für Erklärungen gegenüber dem Handelsregister.', { size: 9, color: RED, gapAfter: 3 })
      text('Viele Banken bestehen zusätzlich auf ihren eigenen Vollmachtsformularen. Klären Sie das mit Ihrer Bank, solange Sie es selbst können — ein Nachholen ist später nicht mehr möglich.', { size: 9, color: SOFT, gapAfter: 3 })
    }

    text('Meine Wünsche für diesen Bereich:', { size: 10, style: 'bold', gapAfter: 2.5 })
    if (wishes.length) {
      for (const w of wishes) bullet(w.text, { box: true })
    } else {
      text('Aus Ihrer Lebensgeschichte ließ sich für diesen Bereich kein belegter Wunsch ableiten. Bitte selbst ergänzen.', { size: 9.5, color: SOFT, gapAfter: 2 })
    }
    if (gaps.length) callout('Noch zu ergänzen', gaps)
    blankLines(2)
    t.gap(2)
  }

  // ── 4. Wie Gebrauch gemacht werden soll ───────────────────────
  h1('4. Wie von dieser Vollmacht Gebrauch gemacht werden soll')
  text('Die bevollmächtigte Person ist mir gegenüber verpflichtet, sich an das Folgende zu halten. Nach außen — gegenüber Bank, Klinik und Behörde — bleibt die Vollmacht davon unberührt und uneingeschränkt gültig:', { gapAfter: 3 })
  const usage = wishList(d, 'usage_wishes')
  if (usage.length) {
    for (const u of usage) bullet(u.text, { box: true })
  } else {
    blankLines(4)
  }

  t.gap(2)
  h2('Woran meine Bevollmächtigung sich ausrichten soll')
  text('Wo Entscheidungen zu treffen sind, die ich hier nicht ausdrücklich geregelt habe, soll sich die bevollmächtigte Person an dem ausrichten, was mir zeitlebens wichtig war:', { gapAfter: 3 })
  const values = (Array.isArray(d.values) ? d.values : [])
    .map(v => ({ value: String(v?.value ?? '').trim(), consequence: String(v?.consequence ?? '').trim() }))
    .filter(v => v.value || v.consequence)
  if (values.length) {
    for (const v of values) bullet(v.value && v.consequence ? `${v.value} — ${v.consequence}` : (v.consequence || v.value), { box: true })
  } else {
    blankLines(4)
  }

  // ── 5. Wirksamkeit ────────────────────────────────────────────
  h1('5. Ab wann und wie lange die Vollmacht gilt')
  text('Diese Vollmacht ist im Außenverhältnis sofort und unbedingt wirksam. Sie gilt also gegenüber Dritten von der Unterschrift an, ohne dass jemand meine Entscheidungsfähigkeit prüfen müsste.', { gapAfter: 2.5 })
  text('Im Innenverhältnis — also mir gegenüber — gilt jedoch die Weisung: Von dieser Vollmacht darf erst Gebrauch gemacht werden, wenn ich meine Angelegenheiten ganz oder in dem betroffenen Bereich nicht mehr selbst besorgen kann. Solange ich dazu in der Lage bin, entscheide ich selbst.', { gapAfter: 2.5 })
  text('Diese Aufteilung ist Absicht: Eine Vollmacht, die schon nach außen an eine Bedingung geknüpft ist („gilt erst, wenn zwei Ärzte bescheinigen …"), wird von Banken und Grundbuchämtern in der Praxis regelmäßig zurückgewiesen — sie versagt dann genau in dem Moment, für den sie gedacht war. Der Preis dafür ist, dass alles am Vertrauen zur bevollmächtigten Person hängt.', { size: 9.5, color: SOFT, gapAfter: 3 })

  h2('Weitere Festlegungen')
  bullet('Die Vollmacht gilt über meinen Tod hinaus fort, bis sie von meinen Erben widerrufen wird.', { box: true })
  bullet('Die bevollmächtigte Person darf Untervollmacht erteilen.', { box: true })
  bullet('Die bevollmächtigte Person ist von den Beschränkungen des § 181 BGB befreit (sie darf also auch Geschäfte zwischen mir und sich selbst vornehmen). Gut überlegen — dieser Punkt öffnet Geschäfte mit sich selbst.', { box: true })
  bullet('Die bevollmächtigte Person soll mir oder einer von mir benannten Person auf Verlangen Rechenschaft über ihre Tätigkeit ablegen.', { box: true })
  t.gap(1)
  text('Ich kann diese Vollmacht jederzeit ohne Angabe von Gründen widerrufen. Dazu genügt eine Erklärung gegenüber der bevollmächtigten Person; zusätzlich sollte die Vollmachtsurkunde zurückgefordert werden, weil sie sonst weiterhin verwendet werden kann.', { size: 9.5, color: SOFT })

  // ── 6. Verhältnis zu anderen Vorsorgedokumenten ───────────────
  h1('6. Verhältnis zu meinen anderen Vorsorgedokumenten')
  text('Diese Vollmacht ersetzt KEINE Patientenverfügung (§ 1827 BGB): Welche ärztlichen Behandlungen an mir vorgenommen oder unterlassen werden sollen, ist hier bewusst nicht geregelt. Liegt eine Patientenverfügung von mir vor, hat die bevollmächtigte Person ihr Geltung zu verschaffen.', { gapAfter: 2.5 })
  text('Ergänzend zu dieser Vollmacht kann eine Betreuungsverfügung sinnvoll sein: Sie sagt dem Gericht, wen ich als Betreuerin oder Betreuer wünsche, falls trotz dieser Vollmacht einmal eine Betreuung eingerichtet werden muss — etwa weil die Vollmacht angefochten wird oder die bevollmächtigte Person ausfällt.', { gapAfter: 3 })
  h2('Diese Dokumente habe ich außerdem errichtet')
  bullet('Patientenverfügung, errichtet am:', { box: true })
  bullet('Betreuungsverfügung, errichtet am:', { box: true })
  bullet('Testament, hinterlegt bei:', { box: true })
  blankLines(2)

  // ── 7. Unterschriften ─────────────────────────────────────────
  h1('7. Ort, Datum und eigenhändige Unterschrift')
  text('Die Vollmacht muss von mir eigenhändig unterschrieben sein. Empfohlen wird zusätzlich die Beglaubigung der Unterschrift durch die Betreuungsbehörde; für Geschäfte mit Immobilien, Verbraucherdarlehen und Handelsregister ist die notarielle Beurkundung zwingend.', { size: 9.5, color: SOFT, gapAfter: 5 })
  signatureRow('Ort, Datum', 'Unterschrift der vollmachtgebenden Person')

  h2('Annahme durch die bevollmächtigte Person')
  text('Ich nehme die Vollmacht an. Ich weiß, dass ich mit ihr weitreichend für die vollmachtgebende Person handeln kann, und werde von ihr nur im Sinne der oben festgehaltenen Weisungen Gebrauch machen.', { size: 9.5, color: SOFT, gapAfter: 5 })
  signatureRow('Ort, Datum', 'Unterschrift der bevollmächtigten Person')

  h2('Spätere Bestätigung')
  text('Eine Vollmacht wirkt umso überzeugender, je aktueller sie ist. Bestätigen Sie sie am besten alle ein bis zwei Jahre mit Datum und Unterschrift.', { size: 9.5, color: SOFT, gapAfter: 4 })
  for (let i = 0; i < 3; i++) signatureRow(null, null, { gapBefore: 5, gapAfter: 13, lw: 0.25, color: 150 })

  // ── 8. Ergänzungen und Aufbewahrung ───────────────────────────
  h1('8. Ergänzungen, Aufbewahrung und Auffindbarkeit')
  h2('Weitere Wünsche und Anmerkungen')
  blankLines(4)
  h2('Wo diese Vollmacht liegt')
  bullet('Das Original bewahre ich auf bei:')
  blankLines(2)
  bullet('Eine Ausfertigung oder Kopie haben erhalten:')
  blankLines(2)
  text('Eine Vollmacht nützt nur, wenn sie im Ernstfall zur Hand ist — die bevollmächtigte Person muss das Original vorlegen können. Sie kann beim Zentralen Vorsorgeregister der Bundesnotarkammer (www.vorsorgeregister.de) eingetragen werden; die Betreuungsgerichte fragen dort vor jeder Betreuerbestellung an. Bewahren Sie das Original NICHT im Bankschließfach auf — ohne die Vollmacht kommt niemand daran.', { size: 9.5, color: SOFT })

  // ════════════════════════════════════════════════════════════
  // TEIL B — Arbeitshilfe
  // ════════════════════════════════════════════════════════════
  doc.addPage(); t.y = M

  text('ARBEITSHILFE', { size: 16, style: 'bold', color: [15, 15, 15], gapAfter: 1.5 })
  text('Nicht Bestandteil der Vorsorgevollmacht', { size: 10, color: SOFT, gapAfter: 3 })
  rule([120, 120, 120], 0.6)
  callout('Wozu diese Seiten da sind', [
    'Hier steht, worauf jeder Vorschlag der vorangehenden Seiten beruht: die Stellen Ihres Interviews, aus denen er stammt. So können Sie prüfen, ob die Schlussfolgerung stimmt — und sie streichen, wenn nicht.',
    'Diese Seiten gehören nicht zur Vollmacht. Trennen Sie sie vor der Unterschrift ab oder heften Sie sie getrennt ab — eine Vollmachtsurkunde sollte nichts enthalten, was nicht Teil der Erklärung ist.',
  ], AMBER)

  const summary = String(d.values_summary ?? '').trim()
  if (summary) { h1('Das Wertebild, das die KI gelesen hat'); text(summary) }

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

  if (usage.length) {
    h1('Belege zu „Wie Gebrauch gemacht werden soll"')
    for (const u of usage) {
      bullet(u.text, { size: 10 })
      if (u.evidence) text(`„${u.evidence}"`, { size: 9, style: 'italic', color: SOFT, x: M + 5, w: maxW - 5, gapAfter: 2 })
    }
  }

  const hintsFull = personList(d.attorney_hints)
  if (hintsFull.length) {
    h1('Vertrauenspersonen, die Ihre Erzählung nennt')
    text('Keine Empfehlung und keine Rangfolge — nur eine Auflistung dessen, wen Sie selbst als besonders nah beschrieben haben.', { size: 9.5, color: SOFT, gapAfter: 3 })
    for (const h of hintsFull) {
      h2(personLine(h))
      if (h.evidence) text(`„${h.evidence}"`, { size: 9.5, style: 'italic', color: SOFT })
    }
  }

  const exFull = personList(d.exclusion_hints)
  if (exFull.length) {
    h1('Genannte Zerwürfnisse')
    for (const h of exFull) {
      h2(personLine(h))
      if (h.evidence) text(`„${h.evidence}"`, { size: 9.5, style: 'italic', color: SOFT })
    }
  }

  h1('Belege zu den Wünschen je Bereich')
  for (const area of POA_AREAS) {
    const a = areaData(d, area.key)
    const wishes = wishList(a)
    const gaps = strList(a?.gaps)
    h2(area.title)
    if (!wishes.length && !gaps.length) { text('Keine belegten Angaben.', { size: 9.5, color: SOFT }); continue }
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
    'Mit der ausgewählten Person sprechen und sie fragen, ob sie die Vollmacht annehmen würde. Niemand kann dazu verpflichtet werden.',
    'Die drei angekreuzten Sonderbefugnisse noch einmal in Ruhe durchgehen — § 1829 (lebensgefährliche Eingriffe), § 1831 (freiheitsentziehende Maßnahmen) und Immobilien. Sie sind die einzigen Punkte, die ohne ausdrückliches Kreuz nicht gelten.',
    'Unterschrift bei der Betreuungsbehörde beglaubigen lassen. Sind Immobilien, Darlehen oder ein Handelsregistereintrag im Spiel: Notartermin.',
    'Mit der Bank klären, ob sie zusätzlich ein eigenes Formular verlangt — das geht nur, solange Sie selbst handlungsfähig sind.',
    'Prüfen, ob zusätzlich eine Betreuungsverfügung sinnvoll ist, falls trotz Vollmacht eine Betreuung nötig wird.',
    'Prüfen, ob eine Patientenverfügung besteht oder erstellt werden soll. Behandlungsentscheidungen sind hier bewusst nicht geregelt.',
    'Die Vollmacht im Zentralen Vorsorgeregister eintragen lassen und dafür sorgen, dass die bevollmächtigte Person im Ernstfall an das Original kommt.',
    'Alle ein bis zwei Jahre erneut lesen, bestätigen und bei Bedarf ändern oder widerrufen.',
  ]) bullet(step, { box: true })

  const created = new Date().toLocaleDateString('de-DE')
  t.footer(`Vorsorgevollmacht${name ? ` · ${name}` : ''} · Entwurf vom ${created}`)

  return doc
}

export function downloadPowerOfAttorneyPdf(filename, data, memorial) {
  buildPowerOfAttorneyDoc(data, memorial).save(filename)
}
