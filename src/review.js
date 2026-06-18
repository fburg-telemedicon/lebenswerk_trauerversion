// src/review.js
// Automatische Inhalts-/Datenschutzprüfung generierter Texte (Gedenkbuch,
// Lebensgeschichte, Trauerrede). Eine zusätzliche Claude-Anfrage prüft den
// fertigen Text und liefert strukturierte Befunde als JSON zurück.

// Geprüfte Kategorien. Die KI MUSS exakt diese Bezeichnungen im Feld
// "category" verwenden, damit die Anzeige stabil ist.
export const REVIEW_CATEGORIES = [
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

Deine Aufgabe: Prüfe den Text gewissenhaft auf problematische Stellen und liste JEDE gefundene Stelle einzeln auf. Prüfe auf folgende Kategorien (verwende im Feld "category" EXAKT eine dieser Bezeichnungen):

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

Sei sorgfältig, aber melde keine Fehlalarme: Ein liebevoll-würdigender, festlicher oder anerkennender Text ist unproblematisch. Positive Erinnerungen, übliche Glück- und Trauerformeln und neutrale Lebensdaten sind KEINE Befunde. Religion/Glaube nur melden, wenn konkret eine Überzeugung zugeschrieben wird, nicht bei bloßer Erwähnung einer Feier oder eines Anlasses.

Der Text ist mit Abschnitts-Markern in eckigen Klammern gegliedert, z. B. "[Titel]", "[Untertitel]" und "[Kapitel 3: <Überschrift>]". Nenne für jeden Befund im Feld "location" den zugehörigen Marker (z. B. "Kapitel 3: Die letzten Jahre" oder "Titel"), damit die Stelle auffindbar ist.

WICHTIG: Das Feld "quote" muss die betroffene Stelle WÖRTLICH und unverändert aus dem Text übernehmen (exakt gleiche Schreibweise, ohne die eckigen Marker), damit sie im Buch automatisch markiert werden kann.

PRÜFE NUR DEN BUCHTEXT: Melde ausschließlich Befunde, deren beanstandeter Inhalt TATSÄCHLICH im BUCHTEXT (oben) steht. Inhalte, die zwar in den Beiträgen, aber NICHT (mehr) im Buchtext vorkommen, sind KEIN Befund – sie wurden ggf. bereits entfernt oder umformuliert.

QUELLENZUORDNUNG: Nach dem Buchtext folgen unter "BEITRÄGE (Quellen)" die Original-Antworten der Beitragenden. Sie dienen NUR der Zuordnung, nicht der Befundung. Ordne jeden Befund der Quelle zu, aus der die kritische Information stammt: Feld "source_contributor" = Name des Beitragenden, "source_quote" = die wörtliche Antwort (oder ein kurzer wörtlicher Auszug daraus), in der diese Information vorkommt. Lässt sich die Quelle nicht eindeutig zuordnen (z. B. aus mehreren Beiträgen verwoben), gib beide Felder als leeren String "" zurück. Erfinde keine Quelle.

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
