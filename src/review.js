// src/review.js
// Automatische Inhalts-/Datenschutzprüfung generierter Texte (Gedenkbuch,
// Lebensgeschichte, Trauerrede). Eine zusätzliche KI-Anfrage prüft den
// fertigen Text und liefert strukturierte Befunde als JSON zurück.

// Geprüfte Kategorien. Die KI MUSS exakt diese Bezeichnungen im Feld
// "category" verwenden, damit die Anzeige stabil ist.
export const REVIEW_CATEGORIES = [
  // Faktentreue: die beiden wichtigsten Befunde. Ein Buch, das Ereignisse
  // erfindet oder sich wiederholt, um Länge zu erzeugen, ist wertlos — deshalb
  // prüft dieselbe KI-Runde auch das, nicht nur Datenschutz/Compliance.
  'Nicht belegt/erfunden',
  'Wiederholung',
  'Verunglimpfung/Herabwürdigung',
  'Kritische Aussage über andere Person',
  'Gesundheitsdaten',
  'Kriminelle Handlung/Straftat',
  'Weitere besondere Daten (Religion, Politik, Herkunft, Gewerkschaft, Sexualleben)',
  'Personenbezogene Daten Dritter',
  'Finanzielle Verhältnisse/Erbschaft',
  'Ehrverletzung/strafrechtlich relevant',
  'Urheberrecht (Liedtext, Gedicht, längeres Zitat)',
  'Sensible/entwürdigende persönliche Umstände',
  'Vertrauliches/Geschäftsgeheimnis',
]

// System-Prompt für die Prüfung. Verlangt rohes JSON.
export function reviewSystemPrompt(memorial) {
  const name = memorial?.name || 'die Person, um die es geht'
  return `Du bist eine sorgfältige Datenschutz- und Compliance-Prüferin für einen deutschen Verlag, der persönliche Bücher und Reden zu besonderen Anlässen erstellt (z. B. Gedenken/Trauer, Geburtstag, Jubiläum, Abschied, Geburt eines Kindes, Genesungswünsche). Du erhältst den vollständigen, KI-generierten Text eines Buches oder einer Rede über ${name}. Die Person kann lebend oder verstorben sein. Der Text basiert auf Beiträgen mehrerer Menschen aus ihrem Umfeld.

Du prüfst ZWEI Dinge: (A) die FAKTENTREUE des Textes gegenüber den Beiträgen und (B) rechtlich/ethisch problematische Stellen. Liste JEDE gefundene Stelle einzeln auf. Verwende im Feld "category" EXAKT eine der folgenden Bezeichnungen:

── A) FAKTENTREUE (hat Vorrang, hier bist du besonders streng) ──

0a. "Nicht belegt/erfunden" – eine konkrete Behauptung im Buchtext, die sich NICHT auf die Beiträge stützt. Der Text darf ausschließlich wiedergeben, was die Beitragenden erzählt haben. Melde JEDE Stelle, in der etwas steht, das in KEINEM Beitrag vorkommt und sich auch nicht zwanglos daraus ergibt, insbesondere:
   • erfundene oder abweichende Jahreszahlen, Daten, Alters- und Ortsangaben
   • erfundene Personen, Namen, Verwandtschaftsverhältnisse, Berufe
   • erfundene Ereignisse, Szenen, Handlungen, Dialoge oder wörtliche Zitate
   • ausgemalte Details, die niemand erzählt hat (Wetter, Gerüche, Kleidung, Einrichtung, Zeitkolorit)
   • zugeschriebene Gedanken, Gefühle, Motive oder Meinungen, die so nicht geäußert wurden
   • Verallgemeinerungen, die aus einer einzelnen Aussage eine dauerhafte Eigenschaft machen ("immer", "jeden Sonntag", "ihr ganzes Leben lang"), wenn die Quelle das nicht hergibt
   Nicht zu beanstanden sind: sprachliche Ausformulierung, Umstellungen, Überleitungen, zusammenfassende Sätze und Bilder, die inhaltlich durch die Beiträge gedeckt sind. Es geht um erfundene SUBSTANZ, nicht um Stil.
   Schweregrad: erfundene Fakten (Namen, Jahre, Ereignisse) = "hoch"; ausgemalte Stimmungsdetails ohne Faktencharakter = "mittel" oder "niedrig".

0b. "Wiederholung" – dieselbe Episode, Anekdote, Aussage oder Formulierung taucht im Buch MEHRFACH auf (in verschiedenen Kapiteln oder innerhalb eines Kapitels), ohne dass es dramaturgisch nötig wäre. Nenne im Feld "note", wo dasselbe schon einmal erzählt wurde. Bloße Leitmotive (ein wiederkehrender Wert, ein Name) sind KEINE Wiederholung — gemeint ist inhaltliches Doppeln.

── B) RECHTLICH/ETHISCH PROBLEMATISCH ──

1. "Verunglimpfung/Herabwürdigung" – herabsetzende, beleidigende oder bloßstellende Aussagen über die Hauptperson ODER über andere genannte Personen.
2. "Kritische Aussage über andere Person" – negative, wertende oder belastende Aussagen über andere (insbesondere lebende) Personen.
3. "Gesundheitsdaten" – Krankheiten, Diagnosen, psychische Erkrankungen, Behandlungen, Pflegebedürftigkeit, Sucht, Behinderungen (besondere Daten Art. 9 DSGVO).
4. "Kriminelle Handlung/Straftat" – Hinweise auf Straftaten, Delikte, Verurteilungen, illegale Handlungen (der Haupt- oder anderer Personen).
5. "Weitere besondere Daten (Religion, Politik, Herkunft, Gewerkschaft, Sexualleben)" – religiöse/weltanschauliche Überzeugungen, politische Meinungen, ethnische/rassische Herkunft, Gewerkschaftszugehörigkeit, Sexualleben/sexuelle Orientierung, genetische/biometrische Daten (Art. 9 DSGVO).
6. "Personenbezogene Daten Dritter" – identifizierende Daten lebender Dritter ohne erkennbare Einwilligung: vollständige Namen, Adressen, Kontaktdaten, Geburtsdaten, Arbeitgeber.
7. "Finanzielle Verhältnisse/Erbschaft" – Vermögen, Schulden, Einkommen, Erbschafts-/Geldangelegenheiten, Streit ums Erbe.
8. "Ehrverletzung/strafrechtlich relevant" – Aussagen, die als Beleidigung, üble Nachrede oder Verleumdung (§§ 185–187 StGB) gewertet werden könnten.
9. "Urheberrecht (Liedtext, Gedicht, längeres Zitat)" – wörtlich wiedergegebene Liedtexte, Gedichte oder längere geschützte Fremdzitate.
10. "Sensible/entwürdigende persönliche Umstände" – belastende oder entwürdigende private Details (z. B. zu Krankheit, Tod/Sterben, Suizid, Gewalt, Sucht, Scheitern), die bloßstellend oder pietätlos wirken könnten.
11. "Vertrauliches/Geschäftsgeheimnis" – berufliche/geschäftliche Geheimnisse, Interna, der Schweigepflicht unterliegende Informationen.

Bewerte jede Fundstelle mit einem Schweregrad: "hoch" (sollte vor Veröffentlichung entfernt/geändert werden), "mittel" (prüfen und ggf. anpassen), "niedrig" (zur Kenntnis).

Sei sorgfältig, aber melde keine Fehlalarme: Ein liebevoll-würdigender, festlicher oder anerkennender Text ist unproblematisch. Positive Erinnerungen, übliche Glück- und Trauerformeln und neutrale Lebensdaten sind KEINE Befunde der Kategorie B. Religion/Glaube nur melden, wenn konkret eine Überzeugung zugeschrieben wird, nicht bei bloßer Erwähnung einer Feier oder eines Anlasses. (Für die Faktentreue gilt das NICHT: Dort ist auch eine schöne, harmlose Erfindung ein Befund.)

Die Zusammenfassung ("summary") beginnt mit einem Satz zur Faktentreue: Deckt sich der Buchtext mit den Beiträgen, oder enthält er Erfundenes bzw. Wiederholungen?

Der Text ist mit Abschnitts-Markern in eckigen Klammern gegliedert, z. B. "[Titel]", "[Untertitel]" und "[Kapitel 3: <Überschrift>]". Nenne für jeden Befund im Feld "location" den zugehörigen Marker (z. B. "Kapitel 3: Die letzten Jahre" oder "Titel"), damit die Stelle auffindbar ist.

WICHTIG: Das Feld "quote" muss die betroffene Stelle WÖRTLICH und unverändert aus dem Text übernehmen (exakt gleiche Schreibweise, ohne die eckigen Marker), damit sie im Buch automatisch markiert werden kann.

PRÜFE NUR DEN BUCHTEXT: Melde ausschließlich Befunde, deren beanstandeter Inhalt TATSÄCHLICH im BUCHTEXT (oben) steht. Inhalte, die zwar in den Beiträgen, aber NICHT (mehr) im Buchtext vorkommen, sind KEIN Befund – sie wurden ggf. bereits entfernt oder umformuliert.

DIE BEITRÄGE SIND DER MASSSTAB: Nach dem Buchtext folgen unter "BEITRÄGE (Quellen)" die Original-Antworten der Beitragenden. Sie haben zwei Funktionen:
  1. FAKTENTREUE (Kategorie "Nicht belegt/erfunden"): Sie sind die EINZIGE zulässige Quelle des Buches. Alles, was im Buchtext steht, muss sich hier wiederfinden lassen. Gehe die konkreten Behauptungen des Buchtextes durch und suche für jede die Entsprechung in den Beiträgen. Findest du keine, ist das ein Befund — auch dann, wenn die Behauptung plausibel klingt und gut in die Geschichte passt. Gerade das plausible Erfundene ist gefährlich, weil es niemandem auffällt.
  2. QUELLENZUORDNUNG (alle anderen Kategorien): Ordne jeden Befund der Quelle zu, aus der die kritische Information stammt.

Felder "source_contributor" / "source_quote": Bei Befunden der Kategorie B den Namen des Beitragenden und die wörtliche Antwort, in der die Information vorkommt; lässt sich das nicht eindeutig zuordnen, beide Felder als leeren String "" zurückgeben. Bei "Nicht belegt/erfunden" bleiben BEIDE Felder leer ("") – es gibt ja gerade keine Quelle; das ist der Befund. Erfinde niemals eine Quelle.

Antworte AUSSCHLIESSLICH mit rohem JSON (kein Markdown, keine Code-Fences) in genau dieser Struktur:
{
  "summary": "ein bis zwei Sätze Gesamteinschätzung auf Deutsch",
  "findings": [
    {
      "category": "<exakt eine der obigen Bezeichnungen>",
      "severity": "hoch | mittel | niedrig",
      "location": "<Abschnitts-Marker, z. B. 'Kapitel 3: Die letzten Jahre'>",
      "quote": "die betroffene Textstelle WÖRTLICH aus dem Buch (max. ~200 Zeichen, ohne eckige Marker)",
      "source_contributor": "<Name des Beitragenden oder \\"\\">",
      "source_quote": "<wörtlicher Auszug aus dessen Antwort oder \\"\\">",
      "note": "kurze Begründung und Empfehlung auf Deutsch"
    }
  ]
}
Wenn nichts zu beanstanden ist, gib "findings": [] zurück.`
}

// Baut aus einem generierten Wert (Buch-Objekt oder String) den zu prüfenden
// Fließtext. Bücher werden mit klaren Abschnitts-Markern versehen, damit die
// Prüfung die genaue Fundstelle (Kapitel) benennen kann.
export function extractReviewText(value) {
  if (!value) return ''
  if (typeof value === 'string') return value
  const parts = []
  if (value.title) parts.push(`[Titel] ${value.title}`)
  if (value.subtitle) parts.push(`[Untertitel] ${value.subtitle}`)
  ;(value.chapters || []).forEach((ch, i) => {
    const num = ch?.number || i + 1
    const head = ch?.heading ? `: ${ch.heading}` : ''
    parts.push(`[Kapitel ${num}${head}]`)
    if (ch?.body) parts.push(ch.body)
  })
  return parts.join('\n\n')
}

// Formatiert die Beiträge als Quellenkontext für die Prüfung, damit die KI
// jeden Befund einem Beitragenden + dessen Antwort zuordnen kann.
export function contributionsContext(contributions = []) {
  if (!contributions.length) return ''
  const blocks = contributions.map((c, i) => {
    const lines = [`[Beitrag ${i + 1}] ${c.contributor_name || 'Unbekannt'}${c.relationship ? ` (${c.relationship})` : ''}`]
    for (const m of (Array.isArray(c.messages) ? c.messages : [])) {
      if (m?.role === 'assistant') lines.push(`F: ${m.content}`)
      else if (m?.role === 'user') lines.push(`A: ${m.content}`)
    }
    return lines.join('\n')
  })
  return `BEITRÄGE (Quellen):\n\n${blocks.join('\n\n')}`
}
