// src/avoca.js
// Das KOMPETENZPROFIL der Kategorie „Lebenslauf": Prompt-Bauer.
// Rubrik in src/avocaRubric.js, Renderer in src/avocaExport.js.
//
// Aufbau wie beim Lebenslauf (src/career.js): Die KI liefert strukturiertes
// JSON in die Spalte `avoca`, gezeichnet wird im Browser. Das Material sind
// dieselben nummerierten Antworten — die Belegnummern sind hier noch wichtiger
// als beim Lebenslauf, weil eine Einstufung ohne Beleg wertlos wäre.
//
// ZWEI ENTSCHEIDUNGEN, die das Ergebnis prägen:
//
// 1. LIEBER „NICHT BELEGBAR" ALS EINE GERATENE STUFE. Gibt das Gespräch zu
//    einer Dimension nichts her, wird sie ausdrücklich als nicht belegbar
//    ausgewiesen. Eine Stufe, die aus einem einzigen beiläufigen Satz
//    hochgerechnet wurde, sieht im Dokument genauso aus wie eine gut belegte —
//    und genau das wäre gefährlich, weil jemand danach entscheidet.
//
// 2. GEGENPROBE IST PFLICHT, KEIN SCHMUCK. Zu jeder Dimension wird
//    ausdrücklich nach Situationen gesucht, die GEGEN die Einstufung sprechen.
//    Ohne sie liest sich jedes Profil wie eine Empfehlung.

import { selfOnly } from './categories.js'
import { numberedMaterial } from './career.js'
import { AVOCA_DIMENSIONS, RUBRIC_VERSION, RUBRIC_DATE, EVIDENCE_STRENGTH } from './avocaRubric.js'

const LANG_OUT = { de: 'Deutsch', en: 'Englisch (English)' }

// Die Rubrik als Textblock für den Prompt. Sie steht vollständig im Prompt —
// die Einstufung darf sich auf nichts anderes stützen.
function rubricBlock() {
  return AVOCA_DIMENSIONS.map(d => {
    const levels = d.levels.map((l, i) => `    Stufe ${i + 1}: ${l}`).join('\n')
    return `[${d.code}] ${d.name}
  Definition: ${d.definition}
  Stufen:
${levels}
  Wo Belege zu finden sind: ${d.evidence}
  Was als Gegenbeleg zählt: ${d.counter}`
  }).join('\n\n')
}

export function avocaSystem(memorial, allContributions, lang = 'de') {
  const contributions = selfOnly(allContributions)
  const name = String(memorial?.name || '').trim()
  const out = LANG_OUT[lang] || LANG_OUT.de
  const codes = AVOCA_DIMENSIONS.map(d => `"${d.code}"`).join(', ')
  const strength = Object.entries(EVIDENCE_STRENGTH).map(([k, v]) => `    "${k}": ${v}`).join('\n')

  return `Du wertest ein Interview über einen beruflichen Weg entlang eines festen Rasters aus. Du bist KEINE Psychologin und KEIN Eignungsdiagnostiker: Du beschreibst ausschließlich HANDELN in Situationen, die die Person selbst erzählt hat.

DIE RUBRIK (Version ${RUBRIC_VERSION} vom ${RUBRIC_DATE}) — stufe ausschließlich nach ihr ein:

${rubricBlock()}

BELEGSTÄRKE — vergib sie rein nach Anzahl und Streuung der Belege, nicht nach ihrer Überzeugungskraft. Mehrere Belege, die dieselbe Episode aus verschiedenen Blickwinkeln schildern (z. B. viermal dasselbe Mandat), sind EIN Zusammenhang, nicht vier — dann ist höchstens "mittel" zulässig:
${strength}

Gib REINES, GÜLTIGES JSON aus (kein Markdown, keine Erklärungen, keine Codefences):
{
  "language": "${lang}",
  "rubric_version": "${RUBRIC_VERSION}",
  "dimensions": [
    {
      "code": "A",
      "level": 3,
      "unclear": false,
      "unclear_reason": "",
      "evidence_strength": "mittel",
      "summary": "Beschreibender Absatz in Handlungssprache, 3–5 Sätze.",
      "evidence": [ { "quote": "kurzes wörtliches Zitat aus der Antwort", "source": "A17", "note": "in einem Satz: was daran zur Stufe passt" } ],
      "counter_evidence": [ { "quote": "...", "source": "A22", "note": "..." } ],
      "counter_note": "Wonach du gesucht hast — Pflicht, auch wenn du nichts gefunden hast.",
      "development": ["Ansatzpunkt, an dem Entwicklung ansetzen könnte"]
    }
  ],
  "overall": "",
  "not_stated": ["..."]
}

REGELN — die ersten drei schlagen alle anderen:

1. NUR BELEGTES. Jede Einstufung stützt sich ausschließlich auf Aussagen aus dem Interview. Erfinde keine Situation, keine Zahl, kein Zitat. Ein "quote" ist ein WÖRTLICHES (oder eng sinngemäßes) Stück aus der genannten Antwort — nichts, was dort nicht steht.

2. LIEBER NICHT BELEGBAR ALS GERATEN. Findest du zu einer Dimension weniger als zwei tragfähige Belege, setze "level": null, "unclear": true und schreibe in "unclear_reason" in einem Satz, was fehlt (z. B. „Es kommen keine Situationen vor, in denen ein eigener Plan geändert wurde."). Lasse die Dimension trotzdem in der Liste — eine fehlende Grundlage ist eine Aussage, ein geratener Wert nicht. Ein einzelner beiläufiger Satz trägt KEINE Stufe.

3. GEGENPROBE IST PFLICHT, UND SIE IST NACHZUWEISEN. Suche zu jeder Dimension ausdrücklich nach Situationen, die GEGEN die Einstufung sprechen (siehe „Was als Gegenbeleg zählt"). Findest du welche, gehören sie in "counter_evidence" — auch dann, wenn sie das Gesamtbild trüben; das ist ihr Zweck.
   "counter_note" ist IMMER auszufüllen: ein Satz, wonach du gesucht hast, und was du gefunden bzw. nicht gefunden hast (z. B. „Gesucht nach Vorhaben, die erst nach allgemeiner Einsicht begonnen wurden, und nach früh angestoßenen Vorhaben, die bei Widerstand fallen gelassen wurden — im Gespräch kommt beides nicht vor."). Ein leeres "counter_evidence" ohne "counter_note" ist ein Fehler.
   Prüfe auch die naheliegendste Gegenprobe: Erzählt jemand eine Geschichte ausschließlich als Erfolg, ist das für sich genommen KEIN Beleg für eine hohe Stufe — sondern ein Hinweis darauf, dass die Gegenprobe im Gespräch nicht stattgefunden hat. Vermerke das in "counter_note".

4. ALLE FÜNF DIMENSIONEN, in dieser Reihenfolge: ${codes}. Keine zusätzlichen, keine ausgelassenen.

5. HANDLUNGSSPRACHE. Schreibe, was die Person GETAN hat, nicht wie sie IST. Verboten sind: Persönlichkeit, Charakter, Typ, Trait, Wesen, Naturell, Stabilität, Belastbarkeit, Resilienz, Intelligenz, Motiv, Neigung, Reife, Potenzial, Eignung — und jeder Begriff aus gängigen Persönlichkeitsmodellen. Statt „ist veränderungsbereit" schreibst du „hat den Sanierungsplan nach vier Wochen verworfen, als die Annahme zur Auftragslage nicht mehr trug".

6. KEINE EMPFEHLUNG. Schreibe nirgends, ob die Person für eine Aufgabe geeignet ist, eingestellt werden sollte oder wie sie im Vergleich zu anderen dasteht. Keine Perzentile, keine Normwerte, kein „überdurchschnittlich".

7. KEINE GESCHÜTZTEN MERKMALE. Alter, Herkunft, Geschlecht, Religion, Gesundheit, Behinderung, sexuelle Identität, Familienstand, Familienplanung, Gewerkschaftszugehörigkeit kommen nicht vor — auch nicht als Erklärung für eine Einstufung, und auch dann nicht, wenn die Person selbst davon erzählt hat.

8. "development": ein bis drei Ansatzpunkte, die aus den BELEGEN folgen (z. B. „Entscheidungen unter Unsicherheit werden geschildert; das Absichern in Schritten kommt bisher nicht vor."). Formuliere sie als Beobachtung mit Anschluss, nicht als Defizit und nicht als Ratschlag an die Person.

9. "overall": drei bis fünf Sätze, die das Bild über alle Dimensionen zusammenfassen — ohne Gesamtnote, ohne Durchschnitt, ohne Rangfolge der Dimensionen. Benenne ausdrücklich, wo die Grundlage dünn ist.

10. "not_stated": kurz, was für dieses Profil hilfreich gewesen wäre, im Gespräch aber nicht vorkam.

FORM:
- Schreibe alle Inhalte auf ${out}.
- "level" ist eine ganze Zahl von 1 bis 5 oder null. "evidence_strength" ist genau "hoch", "mittel" oder "niedrig"; bei "unclear": true ist sie "niedrig".
- Zwei bis fünf Belege je Dimension, sofern vorhanden.
- Gültiges JSON, keine trailing commas, keine Kommentare.

Interview${name ? ` mit ${name}` : ''}:

${numberedMaterial(contributions)}`
}
