// api/_lib/profileqa.js
// FRAGEN AN DAS PROFIL (Kategorie „Lebenslauf"): Filter und Prompt.
//
// WARUM DAS SERVERSEITIG LIEGT und nicht wie die übrigen Prompts im Browser:
// Der Filter ist der eigentliche Zweck dieses Bausteins. Läge er im Frontend,
// wäre er mit den Entwicklerwerkzeugen in zehn Sekunden umgangen — und dann
// wäre der Baustein eine Maschine, die auf Zuruf Auskunft über geschützte
// Merkmale erteilt. Deshalb: Filter und Prompt entstehen hier, der Client
// schickt nur die Frage.
//
// ZWEI SCHICHTEN:
//   1. Regelbasiert (unten). Fängt das Offensichtliche sofort und ohne Kosten,
//      und zwar VOR jedem Modellaufruf — eine geblockte Frage wird gar nicht
//      erst an die KI geschickt.
//   2. Im Prompt. Fängt das Umschriebene („Wie geht sie mit dem Älterwerden
//      um?") und lenkt es auf die zulässige Frage nach Situationen um.
//
// Beides ist protokolliert: Jede Frage und jede Antwort landet in
// memorials.profile_queries — auch die geblockten. Wer fragt, hinterlässt eine
// Spur; das ist Absicht.

// Regelbasierte Sperre. Bewusst großzügig: Ein zu Unrecht geblockter Satz lässt
// sich umformulieren, eine durchgerutschte Frage nach der Familienplanung nicht
// zurücknehmen.
//
// ACHTUNG BEIM ERWEITERN: Die Muster stehen als WORTANFÄNGE da (`\bmigrationsh`
// ohne abschließendes `\b`). Ein `\b` am Ende würde genau das kaputtmachen,
// wofür die Präfixe da sind — „migrationsh" hat nach dem „h" keine Wortgrenze,
// die Regel liefe bei „Migrationshintergrund" also ins Leere. Genau dieser
// Fehler war beim ersten Bau drin.
const BLOCKED = [
  // Umlaut-Anfaenge stehen AUSSERHALB der \b-Gruppe: In JavaScript ist „ä“ kein
  // Wortzeichen, ein \b davor findet deshalb nie eine Grenze — „Älterwerden“
  // wäre sonst durchgerutscht.
  { re: /\b(alter\b|geburtsjahr|geburtsdatum|geburtstag|wie alt|jahrgang|altersgruppe|boomer|generation\b|rente|ruhestand|pensio)|älter|aelter/i,
    topic: 'Alter', hint: 'Fragen Sie stattdessen nach der Dauer der Berufserfahrung oder nach konkreten Stationen.' },
  { re: /\b(herkunft|woher|nationalit|staatsangeh|migrationsh|muttersprach|akzent|geburtsort|geboren in|ausländ|auslaend|heimat|wurzeln|ethni|religionszugeh)|\bwo (kommt|kommen)\b.*\bher\b/i,
    topic: 'Herkunft', hint: 'Fragen Sie stattdessen nach Sprachkenntnissen, die die Person selbst genannt hat, oder nach Auslandserfahrung im Beruf.' },
  { re: /\b(geschlecht|männlich|maennlich|weiblich|mann oder frau|schwanger|kinderwunsch|kinder\b|nachwuchs|familienplanung|familienstand|verheiratet|ledig|geschieden|allein\s?erziehend|elternzeit|mutterschutz)/i,
    topic: 'Geschlecht und Familie', hint: 'Fragen Sie stattdessen nach Verfügbarkeit oder Reisebereitschaft — sofern die Person dazu etwas gesagt hat.' },
  { re: /\b(religio|konfession|kirche|glaub|weltanschau|muslim|christ|jüdisch|juedisch|partei|gewerkschaft|betriebsrat)/i,
    topic: 'Religion, Weltanschauung, Gewerkschaft', hint: 'Diese Angaben dürfen in einem Auswahlverfahren keine Rolle spielen.' },
  { re: /\b(behinder|schwerbehind|krank|krankheit|gesundheit|diagnose|therapie|sucht\b|alkohol|psychisch|psychiat|burnout|depress|fehlzeit|arbeitsunfähig|arbeitsunfaehig|attest)/i,
    topic: 'Gesundheit', hint: 'Fragen Sie stattdessen nach der Belastung in konkreten geschilderten Situationen und wie die Person damit umgegangen ist.' },
  { re: /\b(sexuell|homosexuell|schwul|lesbisch|orientierung|lgbt|queer|ehepartner|lebensgefährt|lebensgefaehrt)/i,
    topic: 'Sexuelle Identität', hint: 'Diese Angaben dürfen in einem Auswahlverfahren keine Rolle spielen.' },
  { re: /\b(gehalt|verdienst|einkommen|schulden|vermögen|vermoegen|kredit|bonität|bonitaet|vorstraf|strafrecht|polizeilich|führungszeugnis|fuehrungszeugnis)/i,
    topic: 'Vermögen und Vorstrafen', hint: 'Konditionen und Vorstrafen sind nicht Gegenstand dieses Profils.' },
]

// Fragen, die eine psychologische Beurteilung verlangen. Sie werden nicht
// geblockt, sondern UMGELENKT — die dahinterliegende Sorge ist meist legitim,
// nur die Frage ist falsch gestellt.
const REDIRECT = [
  { re: /\b(belastbar|belastung ab|stressresistent|resilien|hält (er|sie) (das )?aus|haelt (er|sie) (das )?aus|nervenstark)/i,
    as: 'Welche Situationen mit hoher Belastung hat die Person geschildert, und wie ist sie darin vorgegangen?' },
  { re: /\b(persönlichkeit|persoenlichkeit|charakter|menschentyp|wesen\b|naturell|menschlich (passen|ins team)|passt (er|sie) (menschlich|ins team|zu uns))/i,
    as: 'Welche Zusammenarbeit hat die Person geschildert, und wie hat sie sich darin verhalten?' },
  { re: /\b(intelligen|\biq\b|klug|schlau|begabt|potenzial|potential|auffassungsgab)/i,
    as: 'Welche fachlichen Aufgaben hat die Person bewältigt, und was hat sie sich dafür angeeignet?' },
  { re: /\b(loyal|treu\b|wechselwillig|fluktuation|bleibt (er|sie) lange|springt (er|sie) ab)/i,
    as: 'Wie lange war die Person an ihren Stationen, und welche Gründe für Wechsel hat sie genannt?' },
  { re: /\b(durchsetzungsstark|durchsetzungsfähig|durchsetzungsfaehig|führungsstärke|fuehrungsstaerke|autorität|autoritaet|dominan|standfest)/i,
    as: 'In welchen Situationen hat die Person Entscheidungen gegen Widerstand durchgesetzt, und wie ist sie dabei vorgegangen?' },
  { re: /\b(motiviert|motivation|engagiert|einsatzbereit|leistungsbereit|ehrgeiz)/i,
    as: 'Woran lässt sich im Erzählten ablesen, wofür die Person zusätzlichen Aufwand betrieben hat?' },
]

// Ergebnis: null = zulässig; sonst { blocked, topic, hint } bzw. { redirect }.
function screenQuestion(question) {
  const q = String(question || '')
  for (const b of BLOCKED) if (b.re.test(q)) return { blocked: true, topic: b.topic, hint: b.hint }
  for (const r of REDIRECT) if (r.re.test(q)) return { redirect: r.as }
  return null
}

// Material für die Antwort. Dieselbe Nummerierung wie im Lebenslauf-Prompt
// (A17 = Antwort, D2 = bestätigtes Dokument), damit Belegstellen im ganzen
// Produkt dasselbe bedeuten.
function material(contributions) {
  const out = []
  let n = 0
  for (const c of contributions || []) {
    let lastQ = ''
    for (const m of c.messages || []) {
      if (m.role === 'assistant') { lastQ = String(m.content || '').trim(); continue }
      const t = String(m.content || '').trim()
      if (!t) continue
      n += 1
      out.push(`[A${n}] F: ${lastQ}\n      A: ${t}`)
    }
  }
  return out.join('\n\n')
}

function docsText(documents) {
  const list = (Array.isArray(documents) ? documents : [])
    .filter(d => d && d.confirmed === true && d.data && d.data.readable !== false)
  if (!list.length) return ''
  const lines = list.map((d, i) => {
    const x = d.data || {}
    return `[D${i + 1}] ${[x.organization, x.role, [x.from, x.to].filter(Boolean).join(' – '), x.qualification, x.grade]
      .filter(Boolean).join(' · ')}${x.summary ? `\n      ${x.summary}` : ''}`
  })
  return `\n\nBESTÄTIGTE DOKUMENTE:\n\n${lines.join('\n\n')}`
}

function buildSystem(memorial, contributions, redirect) {
  const name = String(memorial?.name || '').trim() || 'die Person'
  const cv = memorial?.cv ? `\n\nSTRUKTURIERTER LEBENSLAUF (bereits erzeugt, aus demselben Gespräch):\n${JSON.stringify(memorial.cv)}` : ''
  const avoca = memorial?.avoca ? `\n\nKOMPETENZPROFIL (bereits erzeugt, mit Belegstellen):\n${JSON.stringify(memorial.avoca)}` : ''
  const redirectNote = redirect
    ? `\n\nUMFORMULIERTE FRAGE: Die gestellte Frage verlangt ein Urteil über die Person. Beantworte sie NICHT so, wie sie gestellt wurde, sondern beantworte diese Frage: „${redirect}" — und sage im ersten Satz, dass du sie so verstanden hast.`
    : ''

  return `Du beantwortest Fragen zum beruflichen Weg von ${name} — ausschließlich auf Grundlage des Gesprächs, das die Person selbst geführt hat, und der bestätigten Dokumente.

REGELN:
- Antworte NUR aus dem Material. Erfinde nichts, ergänze nichts aus Allgemeinwissen, vermute nicht.
- Jede Aussage nennt ihre Belegstelle in Klammern: (A17), (D2), mehrere durch Komma getrennt.
- Gibt das Material zur Frage nichts her, ist die vollständige Antwort: „Dazu liegt nichts vor." — gegebenenfalls mit einem Satz, was stattdessen erzählt wurde. Konstruiere keine Antwort aus Nachbarthemen.
- Beschreibe HANDELN in Situationen, nie die Person. KEINE Aussagen über Persönlichkeit, Charakter, Eignung, Belastbarkeit, Motive, Intelligenz oder Potenzial; keine Empfehlung, ob jemand eingestellt werden sollte; kein Vergleich mit anderen Menschen.
- KEINE Angaben zu Alter, Herkunft, Geschlecht, Religion, Gesundheit, Behinderung, sexueller Identität, Familienstand, Familienplanung oder Gewerkschaftszugehörigkeit — auch dann nicht, wenn die Person im Gespräch davon erzählt hat, und auch nicht mittelbar (z. B. Rückschluss vom Abschlussjahr auf das Alter).
- Antworte knapp: höchstens sechs Sätze, ohne Einleitung, ohne Wiederholung der Frage.
- Antworte auf Deutsch.${redirectNote}${cv}${avoca}

GESPRÄCH:

${material(contributions)}${docsText(memorial?.documents)}`
}

module.exports = { screenQuestion, buildSystem, BLOCKED, REDIRECT }
