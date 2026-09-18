// src/precaution.js
// Produktkategorie „Vorsorgevollmacht" (`precaution`) — der KI-Prompt und die
// Konstanten, die Prompt und Renderer (src/precautionExport.js) teilen.
//
// Grundlage ist die „VORSORGEN! Mappe" der Deutschen PalliativStiftung
// (13. Auflage, Rechtslage 2026, Stand 09/2026). Ihre acht Formulare sind die
// Gliederung dieses Datenmodells; jedes Feld hier hat dort sein Gegenstück.
//
// ═══ DIE DREI REGELN, AUF DENEN ALLES RUHT ═══
//
// 1. DREI ZUSTÄNDE, NICHT ZWEI. Jede Ja/Nein-Festlegung ist `true`, `false`
//    ODER `null`. `null` heißt: nicht gefragt, nicht beantwortet, oder
//    ausdrücklich offengelassen („das sollen andere entscheiden"). Im Dokument
//    bleiben dann BEIDE Kästchen leer. Ein aus dem Zusammenhang geratenes
//    „Nein" wäre hier kein Schönheitsfehler, sondern eine Verfügung, die etwas
//    ablehnt, das der Mensch nie abgelehnt hat.
//
// 2. WÖRTLICH, NICHT SINNGEMÄSS. Namen, Geburtsdaten, Anschriften, Telefon-
//    nummern und E-Mail-Adressen werden genau so übernommen, wie sie gesagt
//    wurden. Keine ergänzte Postleitzahl, kein vervollständigter Vorname, keine
//    korrigierte Schreibweise. Was unvollständig blieb, bleibt unvollständig
//    und wandert in `open_points`.
//
// 3. JEDE HARTE ANGABE TRÄGT IHREN BELEG. `verify` sammelt sie alle mit dem
//    wörtlichen Zitat, aus dem sie stammen. Daraus zeichnet der Renderer die
//    PRÜFLISTE, die der Mappe vorangeht — denn Spracherkennung verhört genau
//    das: Eigennamen und Ziffern. Ohne diese Liste wäre das ganze Produkt ein
//    Risiko statt einer Hilfe.
//
// Warum die KI hier Namen nennen DARF, während sie es in der Vorsorgemappe des
// Lebenswerks (src/powerOfAttorney.js) nicht darf: Dort leitet sie Vorschläge
// aus einer erzählten Lebensgeschichte ab — eine Schlussfolgerung, die niemand
// gezogen hat. Hier diktiert der Mensch die Angaben ausdrücklich für dieses
// Dokument. Die KI schließt nichts, sie schreibt auf.

import { selfOnly, contributionBlocks } from './categories.js'

// ── Die Bereiche der Vollmacht ────────────────────────────────────
// Reihenfolge und Zuschnitt wie im Formular der PalliativStiftung (Ziffern 1–8
// der (Vorsorge)Vollmacht). `key` ist zugleich der Schlüssel im JSON.
export const VORSORGE_AREAS = [
  { key: 'gesundheit', title: 'Gesundheitssorge und Pflege',
    scope: 'Entscheidung in allen Angelegenheiten der Gesundheitssorge sowie über Einzelheiten einer ambulanten oder (teil-)stationären Pflege. Einwilligung in Untersuchungen, Heilbehandlungen und ärztliche Eingriffe, deren Ablehnung sowie der Widerruf einer Einwilligung. Einsicht in Krankenunterlagen und deren Herausgabe an Dritte; Entbindung aller behandelnden Ärztinnen, Ärzte und des nichtärztlichen Personals von der Schweigepflicht.',
    guide: 'Wie und mit wem soll entschieden werden, wer wird einbezogen, wie viel möchte ich selbst erfahren und mitentscheiden, worauf soll im Umgang mit mir geachtet werden?' },
  { key: 'aufenthalt', title: 'Aufenthalt und Wohnungsangelegenheiten',
    scope: 'Bestimmung des Aufenthalts; Rechte und Pflichten aus dem Mietvertrag über meine Wohnung einschließlich Kündigung; Auflösung des Haushalts; Abschluss und Kündigung eines neuen Wohnraummietvertrags sowie eines Vertrags nach dem Wohn- und Betreuungsvertragsgesetz (Heimvertrag).',
    guide: 'Wo möchte ich leben, was ist mir an einem Ort wichtig, unter welchen Bedingungen darf meine Wohnung aufgegeben werden, wer soll vorher gefragt werden?' },
  { key: 'behoerden', title: 'Behörden, Versicherungen und Sozialleistungsträger',
    scope: 'Vertretung gegenüber Behörden, Versicherungen, Renten- und Sozialleistungsträgern; Stellung, Änderung und Rücknahme von Anträgen; Einlegung von Rechtsbehelfen.',
    guide: 'Worauf lege ich im Umgang mit Ämtern Wert, was soll beantragt oder gerade nicht beantragt werden?' },
  { key: 'gericht', title: 'Vertretung vor Gericht',
    scope: 'Vertretung gegenüber Gerichten sowie Vornahme von Prozesshandlungen aller Art.',
    guide: 'Wie soll bei Streit vorgegangen werden — eher vergleichen oder eher durchsetzen?' },
  { key: 'vermoegen', title: 'Vermögenssorge',
    scope: 'Verwaltung meines Vermögens mit allen Rechtshandlungen und Rechtsgeschäften im In- und Ausland; Abgabe und Entgegennahme von Erklärungen aller Art; Verfügung über Vermögensgegenstände jeder Art; Annahme von Zahlungen und Wertgegenständen; Erklärungen zu Konten, Depots und Safes; Vertretung im Geschäftsverkehr mit Kreditinstituten; Eingehen von Verbindlichkeiten.',
    guide: 'Wie soll mit Geld umgegangen werden — sparsam oder großzügig, wofür darf ausgegeben werden, worüber möchte ich informiert bleiben?' },
  { key: 'digital', title: 'Digitale Vorsorge / digitales Vermächtnis',
    scope: 'Vollumfänglicher Zugriff auf meine Benutzerkonten und Profile bei Internetdiensten, auf meine digitalen Daten im Internet, auf meiner Hardware (z. B. PC, Laptop, Tablet, Smartphone) und auf jeder weiteren Form von Datenträgern; Entscheidung darüber, ob diese Inhalte beibehalten, geändert, gelöscht oder anderweitig genutzt werden; Nutzung und Anforderung der erforderlichen Zugangsdaten sowie Kündigung entsprechender Verträge.',
    guide: 'Was soll mit meinen Konten, Fotos und Daten geschehen — erhalten, löschen, an wen weitergeben? Gibt es etwas, das niemand sehen soll?' },
  { key: 'post', title: 'Post- und Fernmeldeverkehr',
    scope: 'Entgegennahme und Öffnen der für mich bestimmten Post — auch mit dem Service „eigenhändig" — sowie Entscheidung über den Fernmeldeverkehr einschließlich aller damit zusammenhängenden Willenserklärungen (z. B. Vertragsabschlüsse, Kündigungen).',
    guide: 'Was darf gelesen und beantwortet werden, gibt es Post, die mir persönlich vorbehalten bleiben soll?' },
]

// Befugnisse, die nach dem Gesetz nur wirken, wenn sie AUSDRÜCKLICH erteilt
// sind. Sie stehen im Formular als eigene Kästchen und werden im Beiblatt
// einzeln erklärt — ohne diese Erklärung unterschreibt jemand eine
// Immobilienvollmacht, die ohne Notar nichts wert ist.
export const VORSORGE_SPECIAL = [
  { key: 'para1829', area: 'gesundheit', ref: '§ 1829 BGB',
    text: 'Die Vollmacht umfasst auch die Einwilligung in Untersuchungen, Heilbehandlungen oder ärztliche Eingriffe, bei denen die begründete Gefahr besteht, dass ich sterbe oder einen schweren und länger dauernden gesundheitlichen Schaden erleide — ebenso die Nichteinwilligung oder den Widerruf einer Einwilligung in solche Maßnahmen.' },
  { key: 'para1831', area: 'aufenthalt', ref: '§§ 1831, 1832 BGB',
    text: 'Die Vollmacht umfasst auch meine Unterbringung mit freiheitsentziehender Wirkung, ärztliche Zwangsmaßnahmen im Rahmen der Unterbringung sowie freiheitsentziehende Maßnahmen wie Bettgitter, Gurte oder Medikamente, die diesem Zweck dienen — solange dergleichen zu meinem Wohle erforderlich ist.' },
  { key: 'immobilien', area: 'vermoegen', ref: 'notarielle Beurkundung nötig',
    text: 'Die Vollmacht umfasst auch Verfügungen über Grundstücke und grundstücksgleiche Rechte: Erwerb, Veräußerung, Belastung sowie alle Erklärungen gegenüber dem Grundbuchamt.' },
  { key: 'schenkungen', area: 'vermoegen', ref: '§ 1798 Abs. 3 BGB',
    text: 'Die bevollmächtigte Person darf Schenkungen in dem Rahmen vornehmen, der auch einem Betreuer rechtlich gestattet ist (insbesondere die üblichen Gelegenheitsgeschenke).' },
]

// Weitere Festlegungen der Vollmacht (Ziffern 8, 10, 11, 12 des Formulars).
export const VORSORGE_EXTRAS = [
  { key: 'untervollmacht', text: 'Die bevollmächtigte Person darf Untervollmacht erteilen.' },
  { key: 'ueber_den_tod', text: 'Die Vollmacht gilt über meinen Tod hinaus.' },
  { key: 'bestattung', text: 'Die bevollmächtigte Person soll meine Bestattung nach meinen Wünschen regeln.' },
  { key: 'para181', text: 'Die bevollmächtigte Person ist von den Beschränkungen des § 181 BGB (Insichgeschäfte) befreit — sie darf also als meine Vertreterin auch mit sich selbst einen Vertrag schließen.' },
  { key: 'rechenschaft', text: 'Die bevollmächtigte Person soll mir oder einer von mir benannten Person auf Verlangen Rechenschaft über ihre Tätigkeit ablegen.' },
]

// Die Situationen, in denen die Patientenverfügung gelten soll (Ziffer 1.2 des
// Formulars, Buchstaben A–F). Wortlaut bewusst nah am Original: Die
// Rechtsprechung verlangt für § 1827 BGB hinreichend KONKRETE Situationen.
export const PV_SITUATIONS = [
  { key: 'sterbeprozess', label: 'A',
    text: 'wenn ich mich nach ärztlicher Feststellung aller Wahrscheinlichkeit nach unabwendbar im unmittelbaren Sterbeprozess befinde' },
  { key: 'endstadium', label: 'B',
    text: 'wenn ich mich im Endstadium einer unheilbaren, tödlich verlaufenden Krankheit befinde, selbst wenn der Todeszeitpunkt noch nicht absehbar ist' },
  { key: 'hirn_aeusserung', label: 'C.1',
    text: 'wenn ich infolge einer Gehirnschädigung die Fähigkeit, Einsichten zu gewinnen, Entscheidungen zu treffen und mit anderen Menschen in Kontakt zu treten, nach Einschätzung meiner Ärzte aller Wahrscheinlichkeit nach so weit verloren habe, dass ein Leben, zu dem ich mich verständlich äußern kann, nicht mehr möglich ist' },
  { key: 'hirn_vollstaendig', label: 'C.2',
    text: 'wenn ich diese Fähigkeit unwiederbringlich vollständig verloren habe' },
  { key: 'hirn_bewusst', label: 'C.3',
    text: 'Mir ist bewusst, dass in solchen Situationen die Fähigkeit zu Empfindungen erhalten sein kann und dass ein Erwachen aus diesem Zustand nicht völlig auszuschließen, aber sehr unwahrscheinlich ist. Meine Antworten zu C gelten auch dann — für jede Gehirnschädigung unabhängig von der Ursache und selbst dann, wenn der Todeszeitpunkt noch nicht absehbar ist.' },
  { key: 'demenz', label: 'D',
    text: 'wenn ich infolge eines weit fortgeschrittenen Hirnabbauprozesses (z. B. bei Demenz) auch mit angemessener Hilfestellung nicht mehr in der Lage bin, Nahrung und Flüssigkeit auf natürliche Weise zu mir zu nehmen' },
]

// Die einzelnen Behandlungen (Ziffer 3.5 des Formulars).
export const PV_MEASURES = [
  { key: 'beatmung',    text: 'künstliche Atemhilfe und/oder Sauerstoffgabe' },
  { key: 'dialyse',     text: 'künstliche Blutwäsche (Dialyse)' },
  { key: 'antibiotika', text: 'Gabe von Antibiotika' },
  { key: 'blut',        text: 'Gabe von Blut oder Blutbestandteilen' },
  { key: 'schrittmacher', text: 'Einsatz von Herzschrittmacher und/oder Defibrillator' },
]

// Die Palliativ-Ampel: das Blatt fürs Patientenzimmer. Reihenfolge wie im
// Original (rot oben), weil es im Notfall auf einen Blick gelesen wird.
export const AMPEL_STUFEN = [
  { key: 'rot',  color: [185, 28, 28],  title: 'ROT',  motto: 'Halt! Erst nachdenken, nachlesen, dann handeln.',
    text: 'Therapieziel: Symptomlinderung. Ausreichende Schmerztherapie, Linderung von Unruhe, Angst, Atemnot. Keine Krankenhauseinweisung.' },
  { key: 'gelb', color: [180, 83, 9],   title: 'GELB', motto: 'Behandlung einfach zu erreichender Ziele.',
    text: 'Therapie gut und einfach zu erreichender Zustände und Erkrankungen — im unten angekreuzten Umfang.' },
  { key: 'gruen', color: [21, 128, 61], title: 'GRÜN', motto: 'Indizierte maximale Therapie sofort gewünscht.',
    text: 'Therapieziel: uneingeschränkte Maximaltherapie, ambulant oder stationär.' },
]

// Die Maßnahmen der gelben Ampelstufe (Ankreuzliste des Originals).
export const AMPEL_MEASURES = [
  { key: 'peg',        text: 'Flüssigkeit/Nahrung über PEG/PEJ' },
  { key: 'infusion',   text: 'Flüssigkeit/Nahrung subkutan oder intravenös' },
  { key: 'antibiotika', text: 'Antibiotika' },
  { key: 'dialyse',    text: 'Dialyse' },
  { key: 'beatmung',   text: 'Beatmung' },
  { key: 'reanimation', text: 'Wiederbelebung' },
  { key: 'schrittmacher', text: 'Behandlung mit implantiertem Herzschrittmacher/Defibrillator' },
]

// ════════════════════════════════════════════════════════════════
// Der KI-Prompt
// ════════════════════════════════════════════════════════════════
//
// EIN Lauf für die ganze Mappe. Acht getrennte Läufe wären teurer und — viel
// schlimmer — sie würden acht Fassungen desselben Namens erzeugen, die
// auseinanderlaufen. Die Mappe muss in sich stimmen: Derselbe Mensch, dieselbe
// bevollmächtigte Person, dieselben Daten in allen Urkunden.

export function precautionSystem(memorial, allContributions) {
  // Nur Selbstauskunft: Eine Verfügung ist eine Willenserklärung. Was andere
  // über die Person gesagt haben, darf niemals zu ihrem erklärten Willen werden.
  const contributions = selfOnly(allContributions)
  const who = memorial?.name || 'die vorsorgende Person'
  const areaSpec = VORSORGE_AREAS.map(a => `  • "${a.key}" (${a.title}): ${a.guide}`).join('\n')
  const sitSpec = PV_SITUATIONS.map(s => `  • "${s.key}" (${s.label}): ${s.text}`).join('\n')
  const specialSpec = VORSORGE_SPECIAL.map(s => `  • "${s.key}" (${s.ref})`).join('\n')

  return `Du bist Protokollführerin in einer Vorsorgeberatung. Du hast ein Vorsorgegespräch mit ${who} vor dir und überträgst es in die Felder einer VORSORGEN-MAPPE nach dem Muster der Deutschen PalliativStiftung: Vorsorgevollmacht, Betreuungsverfügung, Patientenverfügung, Wertvorstellungen, Bestattungsverfügung und Palliativ-Ampel.

Du bist SCHREIBKRAFT, nicht Beraterin. Du überträgst, was gesagt wurde. Du schließt nicht, du ergänzt nicht, du glättest nicht.

Gib REINES, GÜLTIGES JSON aus (kein Markdown, keine Erklärungen, keine Code-Fences):
{
  "person": { "name": "", "birthdate": "", "birthplace": "", "address": "", "phone": "", "email": "" },
  "attorneys": [
    { "name": "", "birthdate": "", "address": "", "phone": "", "email": "", "relation": "",
      "spoken_to": true|false|null }
  ],
  "attorney_mode": "einzeln"|"gemeinsam"|null,
  "poa": {
    "areas": [
      { "key": "gesundheit", "granted": true|false|null,
        "wishes": [ { "text": "EIN Wunsch in der ICH-FORM", "evidence": "wörtliches Zitat" } ] }
    ],
    "special": { "para1829": true|false|null, "para1831": true|false|null, "immobilien": true|false|null, "schenkungen": true|false|null },
    "extras": { "untervollmacht": true|false|null, "ueber_den_tod": true|false|null, "bestattung": true|false|null, "para181": true|false|null, "rechenschaft": true|false|null },
    "excluded": [ "Geschäft oder Angelegenheit, die die bevollmächtigte Person ausdrücklich NICHT wahrnehmen können soll" ],
    "usage_wishes": [ { "text": "EIN Satz in der ICH-FORM: wie von der Vollmacht Gebrauch gemacht werden soll", "evidence": "wörtliches Zitat" } ]
  },
  "guardianship": {
    "proposed": [ { "name": "", "birthdate": "", "address": "", "phone": "", "email": "", "relation": "" } ],
    "excluded": [ { "name": "", "relation": "" } ],
    "wishes": [ { "text": "ICH-FORM: Wunsch zur Führung einer Betreuung", "evidence": "wörtliches Zitat" } ]
  },
  "patient_decree": {
    "situations": { "sterbeprozess": true|false|null, "endstadium": true|false|null, "hirn_aeusserung": true|false|null, "hirn_vollstaendig": true|false|null, "hirn_bewusst": true|false|null, "demenz": true|false|null },
    "situation_own": "",
    "gilt_schon_jetzt": true|false|null,
    "hospital": { "einweisung": true|false|null, "niemals": true|false|null },
    "max_therapie": true|false|null,
    "symptom": { "bewusst_erleben": true|false|null, "bewusstseinsdaempfend": true|false|null, "lebensverkuerzung_hinnehmen": true|false|null },
    "nutrition": { "natuerlich": true|false|null, "kuenstlich": true|false|null },
    "resuscitation": { "wiederbelebung": true|false|null, "rettungsdienst_informieren": true|false|null },
    "measures": { "beatmung": true|false|null, "dialyse": true|false|null, "antibiotika": true|false|null, "blut": true|false|null, "schrittmacher": true|false|null, "schrittmacher_deaktivieren": true|false|null },
    "nur_palliativ": true|false|null,
    "gewuenschte_behandlungen": [ "ausdrücklich gewünschte Behandlung, ICH-FORM" ],
    "aufklaerungsverzicht": true|false|null,
    "organ": { "zustimmung": true|false|null, "ausnahmen": "", "nur_fuer": "", "vorrang": "organspende"|"patientenverfuegung"|null, "ausweis": true|false|null },
    "konflikt": { "wer": "bevollmaechtigter"|"arzt"|"andere"|null, "name": "", "kontakt": "" },
    "andere_behandlung_erwarten": true|false|null,
    "beratung": ""
  },
  "values": {
    "summary": "3–5 Sätze in der ICH-FORM: was mir wichtig ist, was ein Mensch über mich wissen muss, der mich pflegt und nicht kennt.",
    "sterbeort": "zuhause"|"hospiz"|"palliativstation"|"krankenhaus"|null,
    "beistand": { "seelsorglich": true|false|null, "hospizlich": true|false|null, "personen": "", "glaubensgemeinschaft": "" },
    "kirchliche_bestattung": "ja"|"nein"|"egal"|null,
    "daily_life": [ "Gewohnheit, Vorliebe oder Abneigung, die auch dann geachtet werden soll, wenn ich mich nicht mehr äußern kann — ICH-FORM, ein Satz" ],
    "attitudes": [ { "topic": "1–4 Wörter", "text": "2–3 Sätze in der ICH-FORM: meine Haltung dazu", "evidence": "wörtliches Zitat" } ],
    "message": "Was ich den Menschen sagen möchte, die später für mich entscheiden müssen — ICH-FORM, 1–4 Sätze."
  },
  "funeral": {
    "art": "erde"|"feuer"|"reerdigung"|"andere_entscheiden"|null, "art_text": "",
    "ort": "friedhof"|"see"|"wald"|"anderer"|"andere_entscheiden"|null, "ort_text": "",
    "grabart": "wahlgrab"|"reihengrab"|"wiese"|"urnenwand"|"baumgrab"|"andere_entscheiden"|null,
    "ort_konkret": "",
    "feier": "weltlich"|"religioes"|"party"|"keine"|"andere_entscheiden"|null, "glaubensgemeinschaft": "",
    "rahmen": "engster"|"erweitert"|"oeffentlich"|"andere_entscheiden"|null,
    "rede": { "gewuenscht": true|false|null, "von": "" },
    "musik": { "gewuenscht": true|false|null, "welche": "" },
    "weitere_wuensche": [ "Wunsch zu Trauerkarten, Anzeigen, Aufbahrung, Blumen, Grabmal, Grabpflege …" ],
    "nicht_erwuenscht": [ "Was an meinem Abschied auf keinen Fall vorkommen soll" ],
    "institut": "",
    "verantwortlich": { "name": "", "address": "", "phone": "", "relation": "" }
  },
  "ampel": {
    "stufe": "rot"|"gelb"|"gruen"|null,
    "gelb": { "peg": true|false|null, "infusion": true|false|null, "antibiotika": true|false|null, "dialyse": true|false|null, "beatmung": true|false|null, "reanimation": true|false|null, "schrittmacher": true|false|null },
    "krankenhauseinweisung": true|false|null
  },
  "documents": {
    "patientenverfuegung": { "vorhanden": true|false|null, "datum": "" },
    "testament": { "vorhanden": true|false|null, "ort": "" },
    "vorsorgevollmacht_alt": { "vorhanden": true|false|null, "datum": "" },
    "betreuung_bestehend": true|false|null,
    "vorsorgeregister": true|false|null
  },
  "emergency_contact": { "name": "", "phone": "" },
  "storage": { "original": "", "copies": [ "" ] },
  "anlass": "Was die Person dazu gebracht hat, sich jetzt darum zu kümmern — 1–2 Sätze, ICH-FORM. Leer, wenn nichts gesagt wurde.",
  "verify": [
    { "label": "Wofür die Angabe steht, z. B. Bevollmächtigte Person – Name",
      "value": "die übernommene Angabe, genau wie sie im Dokument steht",
      "quote": "das wörtliche Zitat aus dem Gespräch, aus dem sie stammt" }
  ],
  "open_points": [ "Was vor der Unterschrift noch zu klären, zu ergänzen oder zu entscheiden ist" ]
}

DIE BEREICHE DER VOLLMACHT ("poa.areas" — alle sieben müssen vorkommen, mit genau diesen "key"-Werten):
${areaSpec}

DIE SONDERBEFUGNISSE ("poa.special") — sie wirken nur, wenn sie ausdrücklich erteilt sind:
${specialSpec}

DIE SITUATIONEN DER PATIENTENVERFÜGUNG ("patient_decree.situations"):
${sitSpec}

REGELN — verbindlich, in dieser Rangfolge:

1. DREI ZUSTÄNDE. Jedes Ja/Nein-Feld ist "true", "false" ODER null. "true" nur, wenn die Person ausdrücklich zugestimmt hat; "false" nur, wenn sie ausdrücklich abgelehnt hat. In JEDEM anderen Fall null — nicht gefragt, nicht beantwortet, ausweichend beantwortet, „weiß ich nicht", „das sollen andere entscheiden", übersprungen, widersprüchlich. Im Dokument bleibt das Feld dann leer. LIEBER EIN LEERES FELD ALS EIN FALSCHES KREUZ: Ein irrtümliches "false" wäre eine Ablehnung, die dieser Mensch nie erklärt hat, und sie würde im Ernstfall befolgt.

2. NICHTS ERFINDEN, NICHTS ERGÄNZEN. Kein Name, kein Datum, keine Adresse, kein Wunsch ohne Grundlage im Gespräch. Keine ergänzte Postleitzahl, kein vervollständigter Vorname, keine „übliche" Formulierung. Fehlt eine Angabe, bleibt das Feld ein leerer String "" und die Lücke steht in "open_points".

3. WÖRTLICH BEI HARTEN ANGABEN. Namen, Geburtsdaten, Anschriften, Telefonnummern und E-Mail-Adressen übernimmst du exakt so, wie sie genannt wurden — auch wenn sie ungewöhnlich klingen. Wurde eine Angabe im Gespräch korrigiert, gilt die LETZTE Fassung. Wurde sie buchstabiert, gilt die Buchstabierung.

4. JEDE HARTE ANGABE IN "verify". Jeder Name, jedes Datum, jede Anschrift, jede Telefonnummer und jede E-Mail-Adresse, die im Dokument erscheint, bekommt dort einen Eintrag mit wörtlichem Zitat. Das ist die Prüfliste, mit der der Mensch kontrolliert, ob die Spracherkennung ihn richtig verstanden hat. Nichts auslassen.

5. ICH-FORM für alles, was in eine Urkunde geht ("wishes", "usage_wishes", "daily_life", "attitudes[].text", "values.summary", "values.message", "gewuenschte_behandlungen", "funeral.weitere_wuensche"). Über die bevollmächtigte Person wird in der DRITTEN PERSON geschrieben — „die bevollmächtigte Person" —, sie wird nie geduzt und nie gesiezt. FALSCH: „Ich möchte, dass du mich mitentscheiden lässt." RICHTIG: „Ich möchte so lange wie möglich selbst mitentscheiden." Grund: Die Urkunde wird unterschrieben, bevor feststeht, wer sie annimmt.

6. KEINE BERATUNG, KEINE EMPFEHLUNG, KEINE WERTUNG. Du schreibst nirgends, was sinnvoll, üblich, mutig oder bedenklich wäre. Keine Paragraphen, keine Rechtsauskunft, keine medizinische Einordnung, keine Vollmachtsformeln — der rechtliche Rahmen steht im Formular.

7. WIDERSPRÜCHE NICHT AUFLÖSEN. Hat die Person sich im Lauf des Gesprächs widersprochen, ohne erkennbar zu korrigieren, setzt du das Feld auf null und beschreibst den Widerspruch in "open_points" („Zur künstlichen Ernährung fielen zwei gegensätzliche Aussagen; das ist vor der Unterschrift zu klären."). Du entscheidest nicht, was gemeint war.

8. "attorneys" IN DER REIHENFOLGE, in der die Person sie benannt hat: zuerst die eigentliche bevollmächtigte Person, dann die Ersatzpersonen. Höchstens vier. Nur Menschen, die ausdrücklich für diese Aufgabe benannt wurden — nicht jeder, der im Gespräch vorkam. Dasselbe gilt für "guardianship.proposed".

9. KEINE GESUNDHEITSANGABEN DRITTER. Über andere Menschen stehen nur Name, Kontaktdaten und Verhältnis im Dokument — nichts über ihre Gesundheit, ihren Glauben oder ihr Vermögen, auch wenn davon erzählt wurde.

10. "values" ist der Ort für alles Erzählte, das keine Festlegung ist: Gewohnheiten, Vorlieben, Ängste, Haltungen. Hier darfst du zusammenfassen und in die Ich-Form bringen — aber auch hier nichts hinzuerfinden.

11. Umfang: je Bereich 0–5 "wishes"; 3–8 "usage_wishes"; höchstens 8 "daily_life"; 3–8 "attitudes"; 3–15 "open_points". Gibt das Gespräch zu einem Punkt nichts her, bleibt die Liste leer.

12. Antworte AUSSCHLIESSLICH auf Deutsch, auch wenn das Gespräch in einer anderen Sprache geführt wurde. Gültiges JSON, keine trailing commas.

Vorsorgegespräch mit ${who} (Selbstauskunft):

${contributionBlocks(contributions)}`
}
