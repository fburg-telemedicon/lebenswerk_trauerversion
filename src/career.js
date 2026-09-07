// src/career.js
// Der LEBENSLAUF der Produktkategorie „Lebenslauf" (career): Prompt-Bauer und
// Vorlagen-Liste. Gezeichnet wird in src/cvExport.js.
//
// Muster: exakt wie die Nebenprodukte des Lebenswerks (src/lifeworkExtras.js,
// src/powerOfAttorney.js) — die KI liefert STRUKTURIERTES JSON, das am Buch
// gespeichert wird (Spalte `cv`), und der Browser zeichnet daraus das PDF. Der
// Vorteil ist derselbe wie dort: Die Vorlage lässt sich beliebig wechseln, ohne
// die KI noch einmal zu bemühen — das kostet nichts und dauert eine Sekunde.
//
// DIE ZENTRALE REGEL: Es wird nichts erfunden. Ein Lebenslauf, in dem eine
// geschätzte Jahreszahl steht, ist schlimmer als einer mit einer Lücke — die
// Person legt ihn Fremden vor und haftet für seinen Inhalt. Deshalb verlangt
// der Prompt zu jeder Angabe eine Belegstelle aus dem Gespräch und lässt
// Unbekanntes ausdrücklich leer, statt es zu füllen.

import { selfOnly } from './categories.js'
import { docsBlock, docsRule } from './careerDocs.js'

// Die wählbaren Vorlagen. `key` landet im Dateinamen und steuert cvExport.js.
export const CV_TEMPLATES = [
  { key: 'klassisch', label: 'Klassisch',
    sub: 'Chronologisch, tabellarisch — die übliche Form für Bewerbungen.' },
  { key: 'kompakt', label: 'Kompakt',
    sub: 'Einseiter: Kurzprofil, Stationen in einer Zeile, Kompetenzen.' },
  { key: 'interim', label: 'Interim',
    sub: 'Mandatsliste: je Mandat Ausgangslage, Auftrag, Ergebnis, Übergabe.' },
  { key: 'kurzprofil', label: 'Kurzprofil',
    sub: 'Halbe Seite zur Vorstellung — Profil, drei Stationen, Kompetenzen.' },
  { key: 'narrativ', label: 'Narrativ',
    sub: 'Ein bis zwei Seiten in der Ich-Form, in der Stimme der Person.' },
]

export const DEFAULT_CV_TEMPLATE = 'klassisch'
export const getCvTemplate = k => CV_TEMPLATES.find(t => t.key === k) || CV_TEMPLATES[0]

// Das Material für den Prompt: alle Antworten der Person, fortlaufend
// NUMMERIERT. Die Nummern sind die Belegstellen ("A17"), auf die sich jede
// Angabe im Lebenslauf berufen muss — ohne sie ließe sich später nicht prüfen,
// ob eine Jahreszahl wirklich gefallen ist oder die KI sie ergänzt hat.
export function numberedMaterial(contributions) {
  const out = []
  let n = 0
  for (const c of contributions || []) {
    let lastQ = ''
    for (const m of c.messages || []) {
      if (m.role === 'assistant') { lastQ = String(m.content || '').trim(); continue }
      const text = String(m.content || '').trim()
      if (!text) continue
      n += 1
      const who = m.speaker === 'companion' ? ' [Begleitperson]' : ''
      out.push(`[A${n}]${who} F: ${lastQ}\n      A: ${text}`)
    }
  }
  return out.join('\n\n')
}

const LANGS = {
  de: { name: 'Deutsch', out: 'Deutsch' },
  en: { name: 'Englisch', out: 'Englisch (English)' },
}

// Prompt für die Struktur. Der Aufbau folgt treeSystem/posterSystem: erst das
// gewünschte JSON als Beispiel, dann die Regeln, dann das Material.
export function cvSystem(memorial, allContributions, lang = 'de') {
  const contributions = selfOnly(allContributions)
  const docs = docsBlock(memorial?.documents)
  const docRules = docsRule(memorial?.documents)
  const name = String(memorial?.name || '').trim()
  const focus = memorial?.intake?.focus || ''
  const target = String(memorial?.intake?.target || '').trim()
  const L = LANGS[lang] || LANGS.de
  const interimNote = focus === 'interim'
    ? '\n- Diese Person arbeitet als Interim-Managerin/Interim-Manager: Fülle zusätzlich "interim" mit den einzelnen Mandaten (Ausgangslage, Auftrag, Ergebnis, Übergabe), soweit das Gespräch sie hergibt. Dieselben Mandate gehören AUSSERDEM als Stationen mit "kind": "interim" in "stations" — die Vorlagen ohne Mandatsliste zeigen sie sonst gar nicht. Die Interim-Vorlage blendet sie unten automatisch aus, es entsteht also keine Dopplung.'
    : '\n- "interim" bleibt eine leere Liste, wenn im Gespräch keine Interim-Mandate vorkommen.'
  const targetNote = target
    ? `\n- Die Person strebt an: „${target}". Das darf die AUSWAHL und Reihenfolge der genannten Aufgaben und Ergebnisse leiten (Wichtiges zuerst) — es darf NICHTS hinzufügen, umdeuten oder beschönigen.`
    : ''

  return `Du bist eine erfahrene Lebenslauf-Redakteurin. Du liest das folgende Interview${name ? ` mit ${name}` : ''} über den eigenen beruflichen Weg und überführst es in die STRUKTUR eines Lebenslaufs.

Gib REINES, GÜLTIGES JSON aus (kein Markdown, keine Erklärungen, keine Codefences):
{
  "language": "${lang}",
  "person": { "name": "", "headline": "", "location": "" },
  "summary": "",
  "stations": [
    { "from": "2018", "to": "2023", "organization": "", "role": "", "place": "",
      "kind": "job", "current": false,
      "responsibilities": ["..."],
      "results": ["..."],
      "evidence": ["A17"] }
  ],
  "education": [
    { "from": "", "to": "", "institution": "", "qualification": "", "evidence": ["A3"] }
  ],
  "skills": ["..."],
  "languages": [ { "name": "Englisch", "level": "verhandlungssicher", "evidence": ["A40"] } ],
  "interim": [
    { "period": "", "client": "", "situation": "", "mandate": "", "result": "", "handover": "", "evidence": ["A22"] }
  ],
  "narrative": ["Absatz 1 in der Ich-Form", "Absatz 2"],
  "not_stated": ["..."]
}

DIE WICHTIGSTE REGEL — NICHTS ERFINDEN:
- Jede Angabe muss im Interview VORKOMMEN. Erfinde keine Organisation, keine Rollenbezeichnung, keine Jahreszahl, kein Ergebnis, keine Kompetenz.
- Fehlt eine Angabe, bleibt das Feld ein LEERER STRING. Schätze NIEMALS ein Jahr, runde nichts, leite nichts aus dem Zusammenhang ab („dann wird sie wohl 2015 gewechselt sein" ist verboten).
- Formuliere um, verdichte, ordne — aber füge inhaltlich nichts hinzu. Aus „wir haben die Abteilung umgebaut" wird nicht „Restrukturierung mit Effizienzgewinn".
- "evidence": zu JEDEM Eintrag die Nummern der Quellen, aus denen er stammt (Gesprächsantworten "A12", bestätigte Dokumente "D2"). Ein Eintrag ohne Beleg gehört nicht in den Lebenslauf.${docRules}
- "not_stated": Benenne hier kurz, was für einen Lebenslauf üblich wäre, im Gespräch aber NICHT vorkam (z. B. „Zeitraum der zweiten Station", „Abschlussnote", „Sprachkenntnisse"). Diese Liste ist erwünscht — sie zeigt der Person, was sie noch ergänzen kann.

INHALTLICHE REGELN:
- "person.name": nur, wenn das Gespräch den Namen hergibt${name ? ` (bekannt: „${name}")` : ''}; sonst leer.
- "person.headline": eine knappe Berufsbezeichnung aus dem Erzählten (z. B. „Leiterin Logistik" oder „Interim-Manager Produktion"), höchstens sechs Wörter. Keine Selbstlob-Formeln („dynamische Führungspersönlichkeit").
- "person.location": Wohnort/Region nur, wenn genannt.
- "summary": drei bis fünf Sätze, sachlich, in der dritten Person, ausschließlich aus Belegtem. Keine Eigenschaftszuschreibungen.
- "stations": ALLE beruflichen Stationen, chronologisch ABSTEIGEND (aktuellste zuerst). "kind" ist "job", "education", "break" (Pause, Umweg, Auszeit — nur wenn die Person selbst davon erzählt) oder "interim".
- "from"/"to": Jahreszahlen wie genannt ("2018"), gern mit Monat ("03/2018"), wenn er fiel. Fiel eine Jahreszahl nicht, bleibt das Feld LEER — schätze sie nicht.
- "current": true NUR für die Station, die zum Zeitpunkt des Gesprächs noch läuft; bei allen anderen false. Eine beendete Station mit unbekanntem Enddatum hat "to": "" UND "current": false — daraus wird im Lebenslauf „ab 2004", nicht „bis heute". Das ist wichtig: „bis heute" bei einer längst beendeten Station wäre eine Falschaussage.
- "responsibilities": zwei bis fünf kurze Punkte, was die Aufgabe war. "results": nur, was die Person als Ergebnis oder Veränderung GENANNT hat — keine Zahlen, die nicht fielen. Beides ohne Punkt am Ende.
- "education": Ausbildung, Studium, Weiterbildungen mit Abschluss, soweit genannt.
- "skills": höchstens zwölf Einträge, je ein bis drei Wörter, nur belegte Fähigkeiten, Methoden, Werkzeuge, Fachgebiete. KEINE Charaktereigenschaften („teamfähig", „belastbar", „durchsetzungsstark").
- "languages": NUR Sprachkenntnisse, über die die Person ausdrücklich gesprochen hat. Die Sprache, in der das Gespräch geführt wurde, ist KEIN Beleg für eine Sprachkenntnis — leite aus ihr NICHTS ab, auch keine Muttersprache. Sagt die Person nichts über Sprachen, bleibt die Liste LEER und "Sprachkenntnisse" gehört in "not_stated".${interimNote}
- "narrative": vier bis acht Absätze, die denselben Werdegang als zusammenhängenden Text in der ICH-FORM erzählen, in der Sprache und den Bildern der Person. Nur für die Vorlage „Narrativ" — inhaltlich exakt dasselbe Material, kein zusätzliches Wissen.${targetNote}

WAS NICHT IN EINEN LEBENSLAUF GEHÖRT (verbindlich):
- KEIN Geburtsdatum, KEIN Alter, KEIN Geburtsort, KEINE Staatsangehörigkeit, KEIN Familienstand, KEINE Kinder, KEINE Religion, KEINE Gesundheitsangaben, KEINE Behinderung, KEINE sexuelle Identität, KEINE Gewerkschafts- oder Parteizugehörigkeit, KEIN Foto. Auch dann nicht, wenn die Person im Gespräch davon erzählt hat.
- KEINE psychologischen Begriffe und keine Aussagen über Persönlichkeit, Charakter, Eignung, Belastbarkeit, Stabilität, Motive oder Intelligenz.
- KEINE Bewertung der Person und keine Empfehlung.
- KEINE Kündigungsgründe, keine Bewertung früherer Arbeitgeber, keine Konflikte. Eine Pause bleibt eine Pause, ohne Erklärung, wenn die Person keine gegeben hat.
- KEINE Kontaktdaten (Adresse, Telefon, E-Mail) — die trägt die Person selbst ein.

FORM:
- Schreibe alle Inhalte auf ${L.out}.
- Gültiges JSON, keine trailing commas, keine Kommentare.

Interview:

${numberedMaterial(contributions)}${docs}`
}
