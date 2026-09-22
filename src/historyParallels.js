// src/historyParallels.js
// „Historische Parallelen" — sammelt die Datierungen aus den INTERVIEWS (den
// Originalantworten) und stellt ihnen das Zeitgeschehen gegenüber. Das fertige
// Buch dient nur noch dazu, jedem Zeitpunkt das Kapitel zuzuordnen, in das ein
// Kasten gehört. Gehört zur Geschichtsbuch-Funktion (`history_mode` sorgt im
// Interview dafür, dass überhaupt Datierungen erzählt werden) — der Knopf
// funktioniert aber auch ohne sie.
//
// Warum die Interviews und nicht mehr das Buch (bis 22.09. las der Prompt nur
// den Buchtext): Das Buch ist bei jeder Generierung ein anderer Text, und
// Jahreszahlen fallen dabei still heraus. Buch NPQXU5LC6G hatte „83 seid ihr
// umgezogen" in der ersten Fassung als 1983 im Text, in der zweiten gar nicht
// mehr — die Parallelen waren danach leer. Die Interviews ändern sich nicht.
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
import { contributionBlocks, selfOnly } from './categories.js'

// Fließtext des Buchs, kapitelweise — nur noch für die Kapitelzuordnung.
function bookText(book) {
  const chapters = Array.isArray(book?.chapters) ? book.chapters : []
  return chapters.map((ch, i) => {
    const titel = String(ch?.heading || ch?.title || '').trim() || `Kapitel ${i + 1}`
    const text = String(ch?.body || ch?.text || '').trim()
    return `## Kapitel ${ch?.number || i + 1}: ${titel}\n${text}`
  }).filter(c => c.trim()).join('\n\n')
}

export function historyParallelsSystem(memorial, book, contributions) {
  const wer = memorial?.name || 'die Hauptperson'
  // Nur das Selbst-Interview: Gastbeiträge erzählen ÜBER die Person und stehen
  // im Buch als Stimmen-Kästen, nicht im Fließtext, dem die Kästen folgen.
  const interview = contributionBlocks(selfOnly(contributions))
  return `Du bist Zeithistoriker. Du liest das Interview, in dem ${wer} ihr/sein Leben erzählt, und stellst den darin GENANNTEN Zeitpunkten das damalige Zeitgeschehen gegenüber. Danach ordnest du jeden Zeitpunkt dem Kapitel des Buchs zu, in dem die Begebenheit erzählt wird.

Aufgabe in drei Schritten:
1. Finde jede Datierung, die im INTERVIEW wirklich vorkommt: ein volles Datum ("13. August 1961"), ein Monat mit Jahr ("im Mai 1968"), eine Jahreszahl ("1975", auch zweistellig: "83" = 1983, wenn der Zusammenhang das Jahrhundert eindeutig macht), ein benannter Zeitraum ("Anfang der Sechziger"). Auch mittelbare Angaben zählen, wenn das Interview sie eindeutig macht (etwa "nach dem Krieg" = ab 1945, oder ein Geburtsjahr plus "mit achtzehn Jahren").
   Die Interviews sind gesprochen und maschinell transkribiert: Mehrere Personen können durcheinander reden, Zahlen können verhört sein ("1819 1919"). Nimm eine Angabe, die nur jemand anders in den Raum stellt und ${wer} bloß bestätigt, trotzdem auf — setze dann "genauigkeit" auf "ungefaehr". Ist eine Zahl erkennbar verhört und nicht eindeutig aufzulösen, lass sie weg.
2. Nenne zu jedem gefundenen Zeitpunkt, was damals geschah — je nach Genauigkeit an genau diesem Tag, in diesem Monat oder in diesem Jahr.
3. Bestimme das Kapitel des BUCHS, in dem die zugehörige Begebenheit erzählt wird (der Buchtext steht unten). Maßgeblich ist die Begebenheit, nicht ob die Jahreszahl im Buchtext steht. Wird sie in keinem Kapitel erzählt, nimm das Kapitel, das diesen Lebensabschnitt behandelt.

Was NICHT passieren darf:
- ERFINDE NICHTS. Nimm nur Zeitpunkte auf, die im Interview stehen oder sich daraus eindeutig ergeben. Rate keine.
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
      "kapitel": 3,
      "fundstelle": "Kapitel 3: Die Jahre in Berlin",
      "zitat": "kurzes wörtliches Zitat aus dem INTERVIEW, max. 15 Wörter",
      "parallelen": [
        { "was": "In Berlin beginnt der Bau der Mauer.", "ort": "Deutschland", "sicher": true }
      ]
    }
  ]
}

Feldregeln:
- "anzeige": der Zeitpunkt in lesbarer Form, Jahreszahlen vierstellig ("um 1983", "nach 1945").
- "genauigkeit": "tag" | "monat" | "jahr" | "zeitraum" | "ungefaehr" — die Genauigkeit der ANGABE IM INTERVIEW. "ungefaehr" für Näherungen und für Angaben, die ${wer} nur bestätigt hat.
- "jahr": vierstellige Zahl. Bei einem Zeitraum das erste Jahr. Ist kein Jahr bestimmbar, lass den Eintrag weg.
- "kapitel": die NUMMER des Buchkapitels aus Schritt 3 (Zahl, wie unten im Buchtext angegeben). Sie entscheidet später, wo ein Kasten eingefügt wird — gib sie immer an.
- "fundstelle": Nummer und Überschrift dieses Kapitels, wie unten im Buchtext angegeben.
- "zitat": wörtlich aus dem Interview, damit die Stelle wiederzufinden ist.
- "sicher": true nur bei gesichertem Allgemeinwissen; false, wenn du dir bei Datum oder Hergang nicht sicher bist. Bei false wird das Ereignis in der Anzeige als ungeprüft gekennzeichnet.
- Sortiere "eintraege" chronologisch aufsteigend.
- Kommt im Interview keine einzige Datierung vor, gib {"eintraege": []} aus.

Das Interview (Quelle der Datierungen):

${interview}

Das Buch (nur für die Kapitelzuordnung):

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
  ungefaehr: 'ungefähr',
}
