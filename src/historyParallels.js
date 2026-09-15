// src/historyParallels.js
// „Historische Parallelen" — liest das FERTIGE Buch (nicht die Interviews),
// sammelt die dort genannten Datierungen und stellt ihnen das Zeitgeschehen
// gegenüber. Gehört zur Geschichtsbuch-Funktion (`history_mode` sorgt im
// Interview dafür, dass überhaupt Datierungen erzählt werden) — der Knopf
// funktioniert aber auch ohne sie, für Bücher, in denen ohnehin Jahreszahlen
// vorkommen.
//
// Muster wie die übrigen Nebenprodukte: KI liefert JSON, der Browser stellt es
// dar. Anders als Stammbaum/Poster entsteht daraus KEIN PDF — das Ergebnis wird
// angezeigt.
//
// Heikel ist hier die Faktentreue: Ein Sprachmodell erfindet Jahreszahlen und
// Ereignisse bereitwillig, und ein falsches Datum neben einer echten
// Familiengeschichte ist schlimmer als gar keins. Der Prompt drückt deshalb an
// mehreren Stellen auf Zurückhaltung, und jedes Ereignis trägt eine
// Sicherheitsangabe, die die Anzeige sichtbar macht.

// Fließtext des Buchs, kapitelweise, damit die KI die Fundstelle benennen kann.
function bookText(book) {
  const chapters = Array.isArray(book?.chapters) ? book.chapters : []
  return chapters.map((ch, i) => {
    const titel = String(ch?.heading || ch?.title || '').trim() || `Kapitel ${i + 1}`
    const text = String(ch?.body || ch?.text || '').trim()
    return `## Kapitel ${ch?.number || i + 1}: ${titel}\n${text}`
  }).filter(c => c.trim()).join('\n\n')
}

export function historyParallelsSystem(memorial, book) {
  const wer = memorial?.name || 'die Hauptperson'
  return `Du bist Zeithistoriker. Du liest die Lebensgeschichte von ${wer} und stellst den darin GENANNTEN Zeitpunkten das damalige Zeitgeschehen gegenüber.

Aufgabe in zwei Schritten:
1. Finde jede Datierung, die im Text WIRKLICH VORKOMMT: ein volles Datum ("13. August 1961"), ein Monat mit Jahr ("im Mai 1968"), eine Jahreszahl ("1975"), ein benannter Zeitraum ("Anfang der Sechziger"). Auch mittelbare Angaben zählen, wenn der Text sie eindeutig macht (etwa ein Geburtsjahr plus "mit achtzehn Jahren").
2. Nenne zu jedem gefundenen Zeitpunkt, was damals geschah — je nach Genauigkeit an genau diesem Tag, in diesem Monat oder in diesem Jahr.

Was NICHT passieren darf:
- ERFINDE NICHTS. Nimm nur Zeitpunkte auf, die im Text stehen. Rechne keine Daten aus, die dort nicht stehen, und rate keine.
- Nenne nur Ereignisse, die du sicher weißt. Im Zweifel LASS DAS EREIGNIS WEG. Eine kurze Liste ist besser als eine falsche.
- Zu einem TAG gehören Tagesereignisse. Findest du für den konkreten Tag nichts Belegtes, gib Ereignisse des Monats oder des Jahres an und setze "genauigkeit" entsprechend niedriger — aber behaupte nicht, etwas sei an genau diesem Tag geschehen.
- Keine Ereignisse nach dem jeweiligen Zeitpunkt, keine Wertungen, keine Deutung des Lebens der Person.

Gewichtung der Ereignisse: zuerst Deutschland und Europa, dann Weltgeschehen; gern auch Alltagsnahes (Technik, Musik, Sport, Preise), weil das beim Wiedererkennen hilft. Zwei bis fünf Ereignisse je Zeitpunkt.

Gib REINES, GÜLTIGES JSON aus (kein Markdown, keine Erklärungen):
{
  "eintraege": [
    {
      "anzeige": "13. August 1961",
      "jahr": 1961,
      "genauigkeit": "tag",
      "fundstelle": "Kapitel 3: Die Jahre in Berlin",
      "zitat": "kurzes wörtliches Zitat aus dem Buch, max. 15 Wörter",
      "parallelen": [
        { "was": "In Berlin beginnt der Bau der Mauer.", "ort": "Deutschland", "sicher": true }
      ]
    }
  ]
}

Feldregeln:
- "genauigkeit": "tag" | "monat" | "jahr" | "zeitraum" — die Genauigkeit der ANGABE IM BUCH.
- "jahr": vierstellige Zahl. Bei einem Zeitraum das erste Jahr. Ist kein Jahr bestimmbar, lass den Eintrag weg.
- "fundstelle": Kapitelnummer und -überschrift, wie oben im Text angegeben.
- "zitat": wörtlich aus dem Buch, damit die Stelle wiederzufinden ist.
- "sicher": true nur bei gesichertem Allgemeinwissen; false, wenn du dir bei Datum oder Hergang nicht sicher bist. Bei false wird das Ereignis in der Anzeige als ungeprüft gekennzeichnet.
- Sortiere "eintraege" chronologisch aufsteigend.
- Kommt im Buch keine einzige Datierung vor, gib {"eintraege": []} aus.

Das Buch:

${bookText(book)}`
}

// Zählt, was die Anzeige über dem Ergebnis ausweist.
export function parallelsStats(data) {
  const e = Array.isArray(data?.eintraege) ? data.eintraege : []
  const parallelen = e.reduce((n, x) => n + (Array.isArray(x.parallelen) ? x.parallelen.length : 0), 0)
  const unsicher = e.reduce((n, x) => n + (Array.isArray(x.parallelen) ? x.parallelen.filter(p => p?.sicher === false).length : 0), 0)
  const taggenau = e.filter(x => x.genauigkeit === 'tag').length
  return { eintraege: e.length, parallelen, unsicher, taggenau }
}

export const GENAUIGKEIT_LABEL = {
  tag: 'taggenau',
  monat: 'Monat',
  jahr: 'Jahr',
  zeitraum: 'Zeitraum',
}
