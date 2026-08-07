// src/powerOfAttorney.js
// TEIL 1 der Vorsorgemappe (src/provisionFolder.js): die VORSORGEVOLLMACHT —
// und seit 2026-08-07 zugleich Träger der BETREUUNGSVERFÜGUNG, die vorher ein
// eigenes Dokument war (src/careDirective.js).
//
// Warum zusammengelegt: Rückmeldung aus der Praxis (Vorsorgeberatung). Zwei
// getrennte Urkunden, die einander ständig erklären mussten, sind für den
// Menschen, der sie unterschreiben soll, zu viel. Die Betreuungsverfügung ist
// gegenüber der Vollmacht ohnehin nachrangig: Sie greift erst, wenn trotz
// Vollmacht ein Gericht eine Betreuung einrichtet. Als Abschnitt am Ende der
// Vollmacht bleibt genau diese Rückfallebene erhalten, ohne ein zweites
// Dokument zu erzeugen. So halten es auch die Formulare des BMJ.
//
// ZWEITE Änderung aus derselben Rückmeldung: Aus der URKUNDE ist alles heraus,
// was nicht Erklärung ist. Belehrungen, Begründungen und Hinweise stehen jetzt
// ausschließlich im Beiblatt (`poaWorksheet`), das ausdrücklich nicht Bestandteil
// der Vollmacht ist. Eine Vollmachtsurkunde, die der Bank vorgelegt wird, soll
// nichts enthalten als die Erklärung selbst — jeder erklärende Satz darin ist
// eine Angriffsfläche und lädt zu Auslegung ein.
//
// Die Grenzen von vorher gelten unverändert:
//
//  1. NUR SELBSTAUSKUNFT (keine Gastbeiträge) — eine Vollmacht ist eine
//     Willenserklärung; was Angehörige über die Person sagen, darf nicht zu
//     ihrem erklärten Willen werden.
//  2. DIE KI BENENNT NIEMANDEN. Weder die bevollmächtigte Person noch die
//     Wunsch-Betreuung. Wer hier eingetragen wird, kann am Tag darauf über das
//     Konto verfügen; und der Betreuungsvorschlag bindet nach § 1816 Abs. 2 BGB
//     das Gericht. Beides darf nie aus einer KI-Schlussfolgerung stammen.
//  3. KEINE BEHANDLUNGSENTSCHEIDUNGEN. Was behandelt oder unterlassen wird,
//     gehört in eine Patientenverfügung (§ 1827 BGB) — die diese Mappe bewusst
//     NICHT enthält und an ihrer Stelle deutlich als fehlend ausweist.
//
// Zusätzlich gilt: Die KI kreuzt NICHTS an. Die heiklen Befugnisse (§ 1829
// lebensgefährliche Eingriffe, § 1831 freiheitsentziehende Maßnahmen,
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
import { pickByKey, strList, wishList, personList, personLine, SOFT, AMBER, RED } from './legalForms.js'

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
//
// Der Prompt speist BEIDE Urkunden der Mappe: Teil 1 (Vollmacht, hier) und
// Teil 3 (Wertvorstellungen, src/provisionFolder.js). Deshalb liefert er neben
// den Vollmachts-Feldern auch "daily_life" und "attitudes" — die Bausteine, aus
// denen die Wertvorstellungen entstehen. Ein zweiter KI-Lauf für dieselbe
// Lebensgeschichte wäre teuer und würde zwei Fassungen desselben Wertebilds
// erzeugen, die auseinanderlaufen.

export function powerOfAttorneySystem(memorial, allContributions) {
  const contributions = selfOnly(allContributions)
  const who = memorial?.name || 'die erzählende Person'
  const areaSpec = POA_AREAS.map(a => `  • "${a.key}" (${a.title}): ${a.guide}`).join('\n')

  return `Du bist eine erfahrene Notarin mit biografischer Ausbildung. Du liest die Lebensgeschichte von ${who} — erzählt von ${who} selbst — und arbeitest daraus das WERTESYSTEM heraus: woran dieser Mensch sein Leben ausrichtet, wie er entscheidet, was ihm Würde und Selbstbestimmung bedeuten.

Daraus entwirfst du eine VORSORGEMAPPE mit zwei Urkunden: einer VORSORGEVOLLMACHT (das Dokument, mit dem ein Mensch einer Vertrauensperson die Befugnis gibt, für ihn zu handeln, falls er seine Angelegenheiten nicht mehr selbst besorgen kann — sie wirkt SOFORT und ohne Gericht) und einer WERTEERKLÄRUNG (kein bindendes Dokument, sondern die Auslegungshilfe für alle, die später in seinem Sinne entscheiden müssen).

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
  "daily_life": [ "Gewohnheit, Ritual oder Vorliebe, die auch dann geachtet werden soll, wenn ich mich nicht mehr äußern kann — ICH-FORM, ein Satz" ],
  "attitudes": [
    { "topic": "Worum es geht, 1–4 Wörter (z. B. Abhängigkeit, Krankheit, Zuhause, Glaube, Sterben)",
      "text": "2–3 Sätze in der ICH-FORM: meine Haltung dazu, so wie sie aus meiner Erzählung spricht",
      "evidence": "kurzes wörtliches Zitat, das sie belegt" }
  ],
  "open_points": [ "Was vor der Unterschrift entschieden oder ergänzt werden muss" ]
}

DIE BEREICHE DER VOLLMACHT:
${areaSpec}

REGELN — verbindlich:
- ERFINDE NICHTS. Jeder Wunsch, jeder Wert, jeder Name muss sich auf eine Stelle der Erzählung stützen. Ohne Beleg kein Eintrag. "evidence" ist ein WÖRTLICHES Zitat, nicht deine Zusammenfassung.
- ABLEITEN ist erlaubt und erwünscht, ERFINDEN nicht. Aus „Ich habe mein Leben lang jeden Monat ein Budget gemacht" darf „Ich möchte, dass mit meinem Geld weiterhin geplant und sparsam umgegangen wird" werden.
- ICH-FORM für alles, was in eine Urkunde geht ("wishes", "usage_wishes", "consequence", "daily_life", "attitudes[].text"). "values_summary" bleibt in der dritten Person.
- DU BENENNST NIEMANDEN ALS BEVOLLMÄCHTIGTEN. Wer hier eingetragen wird, kann am Tag darauf über Konten verfügen und über den Aufenthalt entscheiden — diese Wahl darf NIEMALS aus einer KI-Schlussfolgerung stammen. Dasselbe gilt für die Frage, wer im Fall einer gerichtlichen Betreuung Betreuerin oder Betreuer werden soll: Dieser Vorschlag bindet nach § 1816 Abs. 2 BGB das Gericht. "attorney_hints" sammelt ausschließlich Menschen, die die Erzählung als besondere Vertrauenspersonen ausweist, als Gedächtnisstütze für die Person selbst. Keine Rangfolge, keine Empfehlung, höchstens 4. Gibt die Erzählung niemanden her: leere Liste.
- KEINE BEHANDLUNGSENTSCHEIDUNGEN — nirgends, auch nicht in "attitudes". Bei "gesundheit" geht es darum, WIE und mit wem entschieden wird und wie mit mir umgegangen werden soll — NIEMALS darum, welche Behandlung erfolgen oder unterbleiben soll (keine Wiederbelebung, keine künstliche Ernährung, keine Beatmung, keine Medikamente). Das ist Sache einer Patientenverfügung. Ebenso: keine Diagnosen, keine medizinischen Empfehlungen. Sprach die Person über Krankheit, Pflegebedürftigkeit oder Sterben, darf das als HALTUNG in "attitudes" stehen ("Ich möchte nicht allein sein", "Ich habe Angst davor, anderen zur Last zu fallen") — niemals als Anweisung, was zu tun oder zu unterlassen ist.
- DU ERTEILST KEINE BEFUGNISSE. Die besonders eingriffsintensiven Punkte — ärztliche Maßnahmen mit Lebensgefahr (§ 1829 BGB), freiheitsentziehende Maßnahmen wie Fixierung oder geschlossene Unterbringung (§ 1831 BGB), Verfügungen über Immobilien — stehen als anzukreuzende Optionen im Formular und werden ausschließlich vom Menschen selbst erteilt. Schlage NICHT vor, sie zu erteilen. Erlaubt und wertvoll ist der umgekehrte Fall: Sagt die Erzählung etwas über die HALTUNG dazu (z. B. große Bedeutung von Bewegungsfreiheit oder der eigenen Wohnung), nimm das als Wunsch auf.
- "exclusion_hints" nur bei einem AUSDRÜCKLICHEN Zerwürfnis oder einer klaren Ablehnung. Bloße Distanz reicht nicht. Im Zweifel: leere Liste.
- KEINE RECHTSBERATUNG, keine Paragraphen, keine Vollmachtsformeln — der rechtliche Rahmen steht bereits im Formular.
- Umfang: 4–7 "values"; 4–8 "usage_wishes"; je Bereich 2–6 "wishes" und 1–3 "gaps"; höchstens 6 "daily_life"; 3–6 "attitudes"; 3–8 "open_points".
- Gibt die Erzählung zu einem Bereich nichts her, lass "wishes" LEER und benenne das in "gaps".
- Alle fünf Bereiche müssen in "areas" vorkommen, mit genau diesen "key"-Werten: gesundheit, aufenthalt, vermoegen, behoerden, post.
- AUSLANDSBEZUG: Spielt die Lebensgeschichte erkennbar außerhalb Deutschlands, dann nimm als ERSTEN "open_points"-Eintrag einen Hinweis auf, dass dieses Formular deutschem Recht folgt und zu prüfen ist, welches Recht gilt — im angelsächsischen Raum entsprechen ihm am ehesten „Power of Attorney" und „Health Care Proxy", in Österreich der Vorsorgebevollmächtigte, in der Schweiz der Vorsorgeauftrag. Spielt sie in Deutschland, lass den Hinweis weg.
- Antworte AUSSCHLIESSLICH auf Deutsch, auch wenn das Interview in einer anderen Sprache geführt wurde.
- Gültiges JSON, keine trailing commas.

Interview mit ${who} (Selbstauskunft):

${contributionBlocks(contributions)}`
}

// ════════════════════════════════════════════════════════════════
// 2) Teil 1 der Mappe — die Urkunde (DIN A4 hoch)
// ════════════════════════════════════════════════════════════════

const areaData = (data, key) => pickByKey(data?.areas, key)

// Zeichnet die Vollmacht in eine bereits geöffnete Form (siehe legalForms.js).
// Die Mappe ruft das auf; die Funktion beginnt NICHT selbst eine neue Seite und
// setzt KEINE Fußzeile — beides gehört der Mappe, weil nur sie weiß, welcher
// Teil wo anfängt.
//
// Was hier NICHT mehr steht (und bewusst ins Beiblatt gewandert ist): jede
// Belehrung, jede Begründung, jeder KI-Hinweis. Sie sind nicht verschwunden —
// `poaWorksheet` gibt sie vollständig wieder, einschließlich der Warnung, dass
// Immobiliengeschäfte zwingend zum Notar müssen.
export function drawPowerOfAttorney(t, data, memorial) {
  const { maxW, M } = t
  const { text, rule, h1, h2, bullet, field, blankLines, yesNo, signatureRow } = t

  const name = String(memorial?.name || '').trim()
  const d = data || {}

  // ── Kopf ──────────────────────────────────────────────────────
  text('VORSORGEVOLLMACHT', { size: 20, style: 'bold', color: [15, 15, 15], gapAfter: 1.5 })
  text(name ? `von ${name}` : 'von', { size: 12, color: SOFT, gapAfter: 3 })
  rule([120, 120, 120], 0.6)
  // Der EINZIGE erklärende Satz, der in der Urkunde bleibt: ohne ihn könnte ein
  // unfertiger Entwurf für eine fertige Vollmacht gehalten werden.
  text('Entwurf zur eigenen Prüfung. Wirksam erst mit eigenhändiger Unterschrift; die Hinweise dazu stehen im Beiblatt am Ende der Mappe.', { size: 9, color: AMBER, gapAfter: 4 })

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
  bullet('Sie dürfen mich nur gemeinsam vertreten (Gesamtvertretung).', { box: true })

  // ── 3. Umfang ─────────────────────────────────────────────────
  h1('3. Wofür die Vollmacht gilt')
  text('Ich kreuze für jeden Bereich an, ob die Vollmacht ihn umfassen soll. Nicht angekreuzte Bereiche sind von der Vollmacht nicht gedeckt.', { gapAfter: 4 })

  for (const area of POA_AREAS) {
    const a = areaData(d, area.key)
    const wishes = wishList(a)

    h2(area.title)
    text(area.scope, { size: 9.5, color: SOFT, gapAfter: 3 })
    yesNo('Dieser Bereich ist umfasst.', 'Ausdrücklich nicht.')

    // Die Sonderbefugnisse, die NUR wirken, wenn sie eigens erteilt sind. Der
    // Erteilungstext bleibt (er IST die Erklärung), die Belehrung dazu steht im
    // Beiblatt.
    if (area.key === 'gesundheit') {
      text('Zusätzlich, nur wenn eigens angekreuzt (§ 1829 BGB):', { size: 10, style: 'bold', color: RED, gapAfter: 2 })
      bullet('Die Vollmacht umfasst auch die Einwilligung in Untersuchungen, Heilbehandlungen oder ärztliche Eingriffe, bei denen die begründete Gefahr besteht, dass ich sterbe oder einen schweren und länger dauernden gesundheitlichen Schaden erleide — ebenso die Nichteinwilligung oder den Widerruf einer Einwilligung in solche Maßnahmen.', { box: true, size: 10 })
    }
    if (area.key === 'aufenthalt') {
      text('Zusätzlich, nur wenn eigens angekreuzt (§ 1831 BGB):', { size: 10, style: 'bold', color: RED, gapAfter: 2 })
      bullet('Die Vollmacht umfasst auch freiheitsentziehende Maßnahmen: meine Unterbringung in einer geschlossenen Einrichtung sowie Maßnahmen wie Bettgitter, Gurte oder andere Vorrichtungen, mit denen mir über einen längeren Zeitraum die Bewegungsfreiheit entzogen wird, und ebenso Medikamente, die diesem Zweck dienen.', { box: true, size: 10 })
    }
    if (area.key === 'vermoegen') {
      text('Zusätzlich, nur wenn eigens angekreuzt:', { size: 10, style: 'bold', color: RED, gapAfter: 2 })
      bullet('Die Vollmacht umfasst auch Verfügungen über Grundstücke und grundstücksgleiche Rechte: Erwerb, Veräußerung, Belastung sowie alle Erklärungen gegenüber dem Grundbuchamt.', { box: true, size: 10 })
    }

    text('Meine Wünsche für diesen Bereich:', { size: 10, style: 'bold', gapAfter: 2.5 })
    if (wishes.length) {
      for (const w of wishes) bullet(w.text, { box: true })
    } else {
      blankLines(1)
    }
    blankLines(2)
    t.gap(2)
  }

  // ── 4. Wie Gebrauch gemacht werden soll ───────────────────────
  h1('4. Wie von dieser Vollmacht Gebrauch gemacht werden soll')
  text('Die bevollmächtigte Person ist mir gegenüber verpflichtet, sich an das Folgende zu halten. Nach außen bleibt die Vollmacht davon unberührt und uneingeschränkt gültig:', { gapAfter: 3 })
  const usage = wishList(d, 'usage_wishes')
  if (usage.length) {
    for (const u of usage) bullet(u.text, { box: true })
  } else {
    blankLines(4)
  }

  t.gap(2)
  h2('Woran sich Entscheidungen ausrichten sollen')
  text('Wo Entscheidungen zu treffen sind, die ich hier nicht ausdrücklich geregelt habe, soll sich die bevollmächtigte Person an dem ausrichten, was mir zeitlebens wichtig war. Ausführlich steht das in meiner Werteerklärung (Teil 3 dieser Mappe):', { gapAfter: 3 })
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
  text('Diese Vollmacht ist im Außenverhältnis sofort und unbedingt wirksam. Sie gilt gegenüber Dritten von der Unterschrift an.', { gapAfter: 2.5 })
  text('Im Innenverhältnis gilt die Weisung: Von dieser Vollmacht darf erst Gebrauch gemacht werden, wenn ich meine Angelegenheiten ganz oder in dem betroffenen Bereich nicht mehr selbst besorgen kann. Solange ich dazu in der Lage bin, entscheide ich selbst.', { gapAfter: 3 })

  h2('Weitere Festlegungen')
  bullet('Die Vollmacht gilt über meinen Tod hinaus fort, bis sie von meinen Erben widerrufen wird.', { box: true })
  bullet('Die bevollmächtigte Person darf Untervollmacht erteilen.', { box: true })
  bullet('Die bevollmächtigte Person ist von den Beschränkungen des § 181 BGB befreit.', { box: true })
  bullet('Die bevollmächtigte Person soll mir oder einer von mir benannten Person auf Verlangen Rechenschaft über ihre Tätigkeit ablegen.', { box: true })
  t.gap(1)
  text('Ich kann diese Vollmacht jederzeit ohne Angabe von Gründen widerrufen.', { gapAfter: 2 })

  // ── 6. Verhältnis zu anderen Vorsorgedokumenten ───────────────
  h1('6. Verhältnis zu meinen anderen Vorsorgedokumenten')
  text('Diese Vollmacht ersetzt keine Patientenverfügung (§ 1827 BGB): Welche ärztlichen Behandlungen an mir vorgenommen oder unterlassen werden sollen, ist hier nicht geregelt. Liegt eine Patientenverfügung von mir vor, hat die bevollmächtigte Person ihr Geltung zu verschaffen.', { gapAfter: 3 })
  h2('Diese Dokumente habe ich außerdem errichtet')
  bullet('Patientenverfügung, errichtet am:', { box: true })
  bullet('Testament, hinterlegt bei:', { box: true })
  blankLines(2)

  // ── 7. Betreuungsverfügung ────────────────────────────────────
  // Früher ein eigenes Dokument (src/careDirective.js). Als Abschnitt hier
  // bleibt die Rückfallebene erhalten: Sie greift, wenn die Vollmacht NICHT
  // greift — angefochten, nicht anerkannt, oder die bevollmächtigte Person
  // fällt aus. Die Felder bleiben leer, § 1816 Abs. 2 BGB bindet das Gericht
  // an den Vorschlag; er darf nie aus einer KI-Schlussfolgerung stammen.
  h1('7. Falls dennoch eine Betreuung eingerichtet wird (Betreuungsverfügung)')
  text('Sollte trotz dieser Vollmacht ein Betreuungsgericht eine rechtliche Betreuung für mich einrichten, verfüge ich:', { gapAfter: 3 })
  h2('Zur Betreuerin oder zum Betreuer soll bestellt werden')
  field('Name, Vorname')
  field('Anschrift')
  field('Verhältnis zu mir')
  t.gap(1)
  h2('Auf keinen Fall bestellt werden soll')
  field('Name, Vorname')
  field('Verhältnis zu mir')
  t.gap(2)
  text('Für die Führung der Betreuung gelten meine Wünsche unter Ziffer 3 und 4 sowie meine Werteerklärung entsprechend. Das Betreuungsgericht ist an meinen Vorschlag gebunden, soweit er meinem Wohl nicht zuwiderläuft (§ 1816 Abs. 2 BGB).', { gapAfter: 2 })

  // ── 8. Unterschriften ─────────────────────────────────────────
  h1('8. Ort, Datum und eigenhändige Unterschrift')
  signatureRow('Ort, Datum', 'Unterschrift der vollmachtgebenden Person')

  h2('Annahme durch die bevollmächtigte Person')
  text('Ich nehme die Vollmacht an und werde von ihr nur im Sinne der oben festgehaltenen Weisungen Gebrauch machen.', { size: 9.5, color: SOFT, gapAfter: 5 })
  signatureRow('Ort, Datum', 'Unterschrift der bevollmächtigten Person')

  h2('Spätere Bestätigung')
  for (let i = 0; i < 3; i++) signatureRow(null, null, { gapBefore: 5, gapAfter: 13, lw: 0.25, color: 150 })

  // ── 9. Ergänzungen und Aufbewahrung ───────────────────────────
  h1('9. Ergänzungen, Aufbewahrung und Auffindbarkeit')
  h2('Weitere Wünsche und Anmerkungen')
  blankLines(4)
  h2('Wo diese Vollmacht liegt')
  bullet('Das Original bewahre ich auf bei:')
  blankLines(2)
  bullet('Eine Ausfertigung oder Kopie haben erhalten:')
  blankLines(2)

  return { usage, values }
}

// ════════════════════════════════════════════════════════════════
// 3) Beiblatt-Anteil der Vollmacht
// ════════════════════════════════════════════════════════════════
//
// Hier steht ALLES, was aus der Urkunde herausgenommen wurde: die Belehrungen
// (die inhaltlich unverzichtbar sind — ohne sie unterschreibt jemand eine
// Immobilienvollmacht, die ohne Notar nichts wert ist), die KI-Hinweise auf
// Vertrauenspersonen und die Belegstellen zu jedem Vorschlag.
export function poaWorksheet(t, data, _memorial) {
  const { maxW, M } = t
  const { text, h1, h2, bullet, callout } = t
  const d = data || {}

  h1('Zur Vorsorgevollmacht (Teil 1)')

  callout('Was eine Vorsorgevollmacht bedeutet', [
    'Sie wirkt SOFORT, sobald sie unterschrieben und aus der Hand gegeben ist — nicht erst, wenn Ihnen etwas zustößt. Die bevollmächtigte Person kann damit über Ihre Konten verfügen und über Ihren Aufenthalt entscheiden, ohne dass ein Gericht das kontrolliert. Genau darin liegt ihr Vorteil gegenüber einer Betreuung, und genau darin ihr Risiko.',
    'Erteilen Sie sie deshalb nur einem Menschen, dem Sie ohne jeden Vorbehalt vertrauen. Das Feld dafür ist leer, weil diese Wahl niemand für Sie treffen darf.',
    'Sprechen Sie vorher mit dieser Person. Eine Vollmacht ist auch für sie eine Last, und niemand kann dazu verpflichtet werden.',
    'Die Vollmacht ist im Außenverhältnis bewusst unbedingt gestellt. Eine Vollmacht, die schon nach außen an eine Bedingung geknüpft ist („gilt erst, wenn zwei Ärzte bescheinigen …"), wird von Banken und Grundbuchämtern regelmäßig zurückgewiesen — sie versagt dann genau in dem Moment, für den sie gedacht war. Der Preis dafür: Alles hängt am Vertrauen zur bevollmächtigten Person.',
  ], AMBER)

  h2('Die drei Kästchen, die ohne Kreuz nicht gelten')
  bullet('§ 1829 BGB — ärztliche Maßnahmen mit Lebensgefahr: Ohne dieses Kreuz ist die Vollmacht in genau den Situationen unwirksam, in denen es am meisten darauf ankommt. Umgekehrt gilt: In manchen dieser Fälle muss die bevollmächtigte Person zusätzlich das Betreuungsgericht einschalten, wenn sie sich mit den Ärzten nicht einig ist.')
  bullet('§ 1831 BGB — freiheitsentziehende Maßnahmen: Solche Maßnahmen bedürfen zusätzlich der Genehmigung des Betreuungsgerichts. Viele Menschen schließen diesen Punkt bewusst aus — das ist eine legitime Entscheidung und kein Versäumnis.')
  bullet('Immobilien: Für Grundstücksgeschäfte und für die Eintragung im Grundbuch verlangt das Gesetz eine NOTARIELL BEURKUNDETE Vollmacht. Ein selbst unterschriebenes Formular reicht dafür nicht aus, auch nicht mit beglaubigter Unterschrift. Dasselbe gilt für Verbraucherdarlehen und Erklärungen gegenüber dem Handelsregister.')

  h2('Unterschrift, Beglaubigung, Aufbewahrung')
  bullet('Die Vollmacht muss eigenhändig unterschrieben sein. Lassen Sie die Unterschrift bei der Betreuungsbehörde Ihrer Stadt oder Ihres Landkreises beglaubigen (kostet wenige Euro) — viele Banken und Behörden verlangen das.')
  bullet('Viele Banken bestehen zusätzlich auf ihren eigenen Formularen. Klären Sie das mit Ihrer Bank, solange Sie es selbst können — ein Nachholen ist später nicht mehr möglich.')
  bullet('Eine Vollmacht nützt nur, wenn sie im Ernstfall zur Hand ist: Die bevollmächtigte Person muss das Original vorlegen können. Bewahren Sie es NICHT im Bankschließfach auf — ohne die Vollmacht kommt niemand daran.')
  bullet('Eintragung im Zentralen Vorsorgeregister der Bundesnotarkammer (www.vorsorgeregister.de) empfohlen; die Betreuungsgerichte fragen dort vor jeder Betreuerbestellung an.')
  bullet('Eine Vollmacht wirkt umso überzeugender, je aktueller sie ist. Bestätigen Sie sie alle ein bis zwei Jahre mit Datum und Unterschrift (Ziffer 8).')
  bullet('Widerruf: Es genügt eine Erklärung gegenüber der bevollmächtigten Person; zusätzlich sollte die Urkunde zurückgefordert werden, weil sie sonst weiterhin verwendet werden kann.')

  h2('Zur Betreuungsverfügung in Ziffer 7')
  text('Ziffer 7 greift nur, wenn die Vollmacht NICHT greift — etwa weil sie angefochten wird, eine Stelle sie nicht anerkennt oder die bevollmächtigte Person ausfällt. Bis 2026 war das ein eigenes Dokument; als Abschnitt der Vollmacht bleibt die Rückfallebene erhalten, ohne dass Sie zwei Urkunden führen müssen. Auch hier gilt: Die Namen trägt nur die Person selbst ein.', { size: 10 })

  // ── Belegstellen ──────────────────────────────────────────────
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

  const usage = wishList(d, 'usage_wishes')
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
    text('Keine Empfehlung und keine Rangfolge — nur eine Auflistung dessen, wen Sie selbst als besonders nah beschrieben haben. Wen Sie eintragen, entscheiden allein Sie.', { size: 9.5, color: SOFT, gapAfter: 3 })
    for (const h of hintsFull) {
      h2(personLine(h))
      if (h.evidence) text(`„${h.evidence}"`, { size: 9.5, style: 'italic', color: SOFT })
    }
  } else {
    h1('Vertrauenspersonen')
    text('Ihre Erzählung nennt keine Person eindeutig genug, als dass hier ein Hinweis stehen dürfte. Lassen Sie sich mit dieser Entscheidung Zeit — sie ist die wichtigste in diesem Dokument.', { size: 10, color: SOFT })
  }

  const exFull = personList(d.exclusion_hints)
  if (exFull.length) {
    h1('Genannte Zerwürfnisse')
    text('Eine Vollmacht muss niemanden ausschließen — sie gilt nur für die Person, die Sie eintragen. Wenn Sie es dennoch festhalten möchten, tun Sie das in Ziffer 7 oder 9.', { size: 9.5, color: SOFT, gapAfter: 3 })
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
    if (gaps.length) callout('Noch zu ergänzen', gaps)
  }
}
