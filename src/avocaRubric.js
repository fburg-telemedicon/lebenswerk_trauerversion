// src/avocaRubric.js
// Die RUBRIK des Kompetenzprofils: fünf Dimensionen (AVOCA) mit je fünf
// Ausprägungsstufen.
//
// HERKUNFT — bitte lesen, bevor jemand hier etwas ändert:
// AVOCA ist der Future-Skills-Rahmen von Tobias; die fünf Dimensionen stammen
// von dort. Die Stufenbeschreibungen unten sind hausgemacht (7. September 2026),
// weil eine ausformulierte Rubrik nicht zur Verfügung stand. Sie sind deshalb
// als Version 1.0 gekennzeichnet, und JEDES erzeugte Profil trägt diese Version
// sichtbar im Dokument. Kommt später eine Rubrik von Tobias, wird diese Datei
// ersetzt und die Version hochgezählt — die bereits erzeugten Profile bleiben
// dadurch nachvollziehbar, weil sie ihre eigene Version mitführen.
//
// DIE BAUREGEL DER STUFEN: Jede Stufe beschreibt, was ein Mensch TUT, nicht wie
// er IST. „Verwirft einen Plan, wenn die Annahmen nicht mehr tragen" ist eine
// Beobachtung; „ist flexibel" wäre eine Eigenschaftszuschreibung und damit
// genau das, was dieses Produkt nicht macht. Höhere Stufen bedeuten NICHT
// „besser als Mensch" — sie bedeuten, dass das beschriebene Handeln in den
// erzählten Situationen weiter reicht. Für viele Aufgaben ist Stufe 3 die
// passende Ausprägung, nicht Stufe 5.

export const RUBRIC_VERSION = '1.0'
export const RUBRIC_DATE = '2026-09-07'
export const RUBRIC_ORIGIN = 'Hausformulierung Lebensgeschichten.ai; Dimensionen nach dem AVOCA-Rahmen.'

export const AVOCA_DIMENSIONS = [
  {
    code: 'A',
    name: 'Agilität',
    definition: 'Wie jemand handelt, wenn sich die Lage ändert: wann das eigene Vorgehen angepasst wird, wer die Änderung anstößt und wie weit sie reicht.',
    levels: [
      'Nimmt Veränderungen wahr und reagiert, wenn sie unumgänglich geworden sind; hält bis dahin am eingeschlagenen Weg fest.',
      'Passt das eigene Vorgehen an, wenn andere die Änderung anstoßen oder vorgeben; korrigiert innerhalb des Bestehenden.',
      'Ändert das eigene Vorgehen aus eigenem Antrieb, sobald Anzeichen dagegen sprechen, und verwirft dafür auch Teile des Geplanten.',
      'Verwirft einen selbst verantworteten Plan als Ganzes, wenn seine Annahmen nicht mehr tragen, und begründet den Kurswechsel gegenüber anderen.',
      'Richtet Arbeitsweise und Organisation so ein, dass Kurswechsel früh erkannt und geordnet vollzogen werden — auch gegen Widerstand.',
    ],
    evidence: 'Verworfene oder überarbeitete Pläne, Reaktionen auf Ausfälle und Störungen, Umsteuern unter Zeitdruck, zweite Anläufe nach einem Fehlschlag, Umgang mit nicht selbst gewählten Veränderungen.',
    counter: 'An einem Vorgehen festgehalten, obwohl Gegenanzeichen erzählt werden; Änderung erst nach Eskalation oder auf Weisung; Wechsel, die ausschließlich von außen bestimmt waren.',
  },
  {
    code: 'V',
    name: 'Vision',
    definition: 'Wie jemand mit dem Künftigen umgeht: ob eigene Vorstellungen über die weitere Entwicklung erzählt werden und ob aus ihnen heute schon Handeln folgt.',
    levels: [
      'Arbeitet an dem, was ansteht; eigene Vorstellungen über die weitere Entwicklung des Felds kommen nicht vor.',
      'Beschreibt Entwicklungen im eigenen Feld, richtet das eigene Tun aber am Bestehenden aus.',
      'Leitet aus einer Erwartung an die Zukunft konkrete eigene Schritte ab und setzt sie um.',
      'Stößt etwas an, bevor der Bedarf im Umfeld allgemein gesehen wird, und gewinnt andere dafür.',
      'Entwirft ein Zielbild über den eigenen Bereich hinaus, richtet Mittel und Aufmerksamkeit darauf aus und hält daran auch über Rückschläge hinweg fest.',
    ],
    evidence: 'Früh angestoßene Vorhaben, Investitionen in Themen vor deren Konjunktur, Aussagen über das eigene Feld in fünf oder zehn Jahren mit daran anschließendem Handeln, Überzeugungsarbeit vor einer Entscheidung.',
    counter: 'Vorhaben, die erst nach allgemeiner Einsicht begonnen wurden; Zukunftsbilder ohne erzähltes eigenes Handeln; Vorhaben, die nach dem ersten Widerstand fallen gelassen wurden.',
  },
  {
    code: 'O',
    name: 'Offenheit',
    definition: 'Wie jemand mit fremden Sichtweisen umgeht: ob sie die eigene Position tatsächlich verändern und ob Widerspruch aktiv gesucht wird.',
    levels: [
      'Hört sich andere Sichtweisen an und bleibt bei der eigenen Position.',
      'Nimmt Einwände auf, wenn sie von fachlich oder hierarchisch anerkannter Stelle kommen.',
      'Ändert eine eigene Position aufgrund eines Arguments und benennt, von wem es kam.',
      'Holt aktiv Widerspruch ein — auch von Menschen mit anderer Perspektive oder aus anderen Ebenen — und lässt ihn Entscheidungen verändern.',
      'Richtet die Zusammenarbeit so ein, dass Widerspruch regelmäßig entsteht und folgenreich wird, nicht nur wenn es gerade passt.',
    ],
    evidence: 'Situationen, in denen jemand die Person überzeugt hat; Zusammenarbeit mit sehr unterschiedlichen Menschen; Umgang mit öffentlichem Widerspruch; Entscheidungen, die durch Einwände anders ausfielen.',
    counter: 'Einwände, die als „am Ende habe ich mich durchgesetzt" enden; Widerspruch, der erzählt, aber nicht folgenreich wird; Zusammenarbeit, die als Belastung ohne Ertrag geschildert wird.',
  },
  {
    code: 'C',
    name: 'Curiosity',
    definition: 'Wie jemand Wissen sucht: was ohne Auftrag gelernt wird, wie weit dafür gegangen wird und ob das Gelernte in die Arbeit zurückkommt.',
    levels: [
      'Lernt, was für die Aufgabe verlangt wird.',
      'Vertieft von sich aus Themen, die die aktuelle Aufgabe unmittelbar erfordert.',
      'Erschließt aus eigenem Antrieb Themen, die niemand verlangt hat, und bringt sie in die Arbeit ein.',
      'Sucht gezielt außerhalb des eigenen Umfelds nach Wissen, das dort niemand hat, und macht es nutzbar.',
      'Macht das Fragen zum Bestandteil der Arbeit anderer — schafft Wege, auf denen neues Wissen regelmäßig ins Team kommt.',
    ],
    evidence: 'Freiwillig Gelerntes der letzten Monate, offene Fragen, die die Person umtreiben, Wege zu Wissen außerhalb des eigenen Umfelds, Weitergabe des Gelernten.',
    counter: 'Weiterbildung ausschließlich auf Anordnung; Interesse ohne erzählte Folge; Wissen, das nicht in die Arbeit zurückfand.',
  },
  {
    code: 'AT',
    name: 'Ambiguitätstoleranz',
    definition: 'Wie jemand handelt, wenn die Lage unklar bleibt: ob unter Unsicherheit entschieden wird und wie mit dem Offenen umgegangen wird.',
    levels: [
      'Wartet, bis die Lage klar ist, bevor gehandelt wird.',
      'Handelt bei Unklarheit nach Vorgabe oder nach Rückversicherung bei anderen.',
      'Entscheidet bei unvollständiger Information und benennt ausdrücklich, was offen bleibt.',
      'Handelt bewusst unter Unsicherheit, sichert schrittweise ab und hält die Entscheidung revidierbar.',
      'Hält Mehrdeutigkeit über längere Zeit aus, ohne sie vorschnell aufzulösen, und ermöglicht anderen das Arbeiten in dieser Lage.',
    ],
    evidence: 'Entscheidungen ohne belastbare Datenlage, Phasen ohne Gewissheit über die Richtigkeit einer Entscheidung, bewusst offen gelassene Entscheidungen und deren Preis, Umgang mit widersprüchlichen Anforderungen.',
    counter: 'Entscheidungen, die bis zur vollständigen Klarheit aufgeschoben wurden; Unsicherheit, die ausschließlich an andere weitergereicht wurde; nachträgliche Glättung („war von Anfang an klar").',
  },
]

export const getDimension = code => AVOCA_DIMENSIONS.find(d => d.code === code) || null

// Belegstärke: rein aus Anzahl und Streuung der Belege, nicht aus ihrer
// Überzeugungskraft. Zwei Belege aus derselben Station sind schwächer als zwei
// aus verschiedenen — deshalb zählt die Vielfalt mit.
export const EVIDENCE_STRENGTH = {
  hoch:    'Mindestens drei Belege aus mindestens zwei verschiedenen Stationen oder Zeiträumen.',
  mittel:  'Zwei Belege, oder drei Belege aus ein und demselben Zusammenhang.',
  niedrig: 'Ein einzelner Beleg.',
}

// Der feste Hinweis, der auf JEDEM Profil steht. Er ist keine Verzierung: Das
// Dokument beschreibt Handeln in erzählten Situationen — nicht die Person.
export const AVOCA_DISCLAIMER =
  'Dieses Profil beschreibt Handeln in Situationen, die die Person selbst erzählt hat, entlang der fünf AVOCA-Dimensionen. '
  + 'Es ist kein psychologisches Verfahren und trifft keine Aussage über Persönlichkeit, Charakter oder Eignung. '
  + 'Grundlage sind ausschließlich die zitierten Belegstellen aus dem Gespräch. Eine höhere Stufe bedeutet nicht „besser", '
  + 'sondern ein weiter reichendes Handeln in den geschilderten Lagen. Eine Auswahlentscheidung bleibt Sache der beteiligten Menschen.'

export const AVOCA_DISCLAIMER_EN =
  'This profile describes actions in situations the person recounted themselves, along the five AVOCA dimensions. '
  + 'It is not a psychological instrument and makes no statement about personality, character or suitability. '
  + 'It rests solely on the quoted passages from the interview. A higher level does not mean “better”, but action of wider '
  + 'reach in the situations described. Any selection decision remains a matter for the people involved.'
