// src/categories.js
// Zentrale Konfiguration aller Produktkategorien (Frontend).
//
// Pro Kategorie: Labels/Texte für Formulare & Contributor-Flow sowie die
// KI-Prompt-Builder (Interview, Buch V1/V2, Endtext/Rede). Die Slugs müssen
// mit api/_lib/categories.js übereinstimmen.
//
// Die `memorial`-Kategorie ist 1:1 die bisherige Trauerversion — ihre
// Prompt-Funktionen sind wörtlich übernommen, damit sich das Verhalten dort
// nicht ändert. Die übrigen fünf Kategorien nutzen generische Builder, die
// über ein `profile`-Objekt mit kategoriespezifischen Formulierungen gefüttert
// werden.

export const DEFAULT_CATEGORY = 'memorial'

// ── gemeinsame Helfer ─────────────────────────────────────────────
function genderNote(memorial) {
  return memorial?.gender ? ` (${memorial.gender})` : ''
}

function blocks(contributions) {
  return contributions.map(c => {
    const lines = c.messages.map(m => m.role === 'assistant' ? `F: ${m.content}` : `A: ${m.content}`)
    return `=== ${c.contributor_name} (${c.relationship}) ===\n${lines.join('\n')}`
  }).join('\n\n')
}

function addressRule(address) {
  return address === 'Du'
    ? 'Sprich die Person konsequent informell mit „du" an.'
    : 'Sprich die Person konsequent förmlich mit „Sie" an.'
}

function contributorGenderRule(contributorGender) {
  return contributorGender
    ? `Die Person ist ${contributorGender} — verwende passende grammatische Formen (Adjektivendungen, Pronomen, ggf. „Herr"/„Frau").`
    : ''
}

// ════════════════════════════════════════════════════════════════
// MEMORIAL — wörtlich übernommen aus der bisherigen Trauerversion
// ════════════════════════════════════════════════════════════════
function memorialInterview(memorial, name, rel, address, contributorGender) {
  const g = genderNote(memorial)
  const addr = addressRule(address)
  const gen = contributorGenderRule(contributorGender)
  return `Du bist ein einfühlsamer Biograph. Du führst ein persönliches Gespräch mit ${name} (${rel}), der/die ${memorial.name}${g} kannte.

Ziel: Wertvolle persönliche Erinnerungen für ein Gedenkbuch sammeln.

Regeln:
- ${addr}${gen ? `\n- ${gen}` : ''}
- Stelle immer nur EINE Frage pro Nachricht, maximal 2 kurze Sätze
- Reagiere kurz und herzlich auf die vorherige Antwort (max. 1 Satz)
- Frage nach konkreten Erlebnissen und Geschichten, nicht Allgemeinem
- Sei einfühlsam, respektiere die Trauer
- WICHTIG: Bohre nicht zu tief. Maximal EINE Nachfrage zu einer Antwort. Danach wechsle zu einem völlig neuen, thematisch unabhängigen Themenfeld — kein weiterer Anknüpfungspunkt an die vorherige Antwort.
- Variiere die Themenfelder bewusst: erste Begegnung, Kindheit, Schule, Familie, Beruf, Hobbies, Reisen, Charakterzüge, kleine Marotten, Lieblingsorte, besondere Momente, Werte, was die Person bedeutete, Abschied — wähle pro neuer Frage ein anderes Feld.
- Schreibe auf Deutsch`
}

function memorialV1Outline(memorial, contributions) {
  const g = genderNote(memorial)
  return `Du bist ein einfühlsamer Buchautor. Aus den folgenden Interviews mit ${contributions.length} Menschen, die ${memorial.name}${g} kannten, planst du ein Gedenkbuch (Variante 1: jede Person ein Kapitel).

Plane jetzt NUR den Gesamt-Titel und -Untertitel des Buches. Die einzelnen Kapitel werden später separat geschrieben.

Gib REINES, GÜLTIGES JSON aus (kein Markdown-Codeblock, keine Erklärungen):
{
  "title": "Gesamttitel des Buches",
  "subtitle": "Untertitel des Buches"
}

Regeln:
- "title" persönlich, würdevoll, bezogen auf ${memorial.name}
- "subtitle" knapp, ergänzt den Titel
- Auf Deutsch
- Gültiges JSON, keine trailing commas

Beiträge:\n\n${blocks(contributions)}`
}

function memorialV1Chapter(memorial, contribution, number) {
  const g = genderNote(memorial)
  const lines = contribution.messages.map(m => m.role === 'assistant' ? `F: ${m.content}` : `A: ${m.content}`)
  return `Du bist ein einfühlsamer Buchautor. Du schreibst EIN Kapitel eines Gedenkbuchs für ${memorial.name}${g} (Variante 1: jede Person ein Kapitel).

Dieses Kapitel: Nummer ${number}, basierend ausschließlich auf dem Interview mit ${contribution.contributor_name} (${contribution.relationship}).

Gib REINES, GÜLTIGES JSON für GENAU DIESES EINE KAPITEL aus (kein Markdown-Codeblock, keine Erklärungen):
{
  "number": ${number},
  "heading": "Kapitel-Überschrift",
  "body": "Fließtext …",
  "image_prompt": "English image description, atmospheric, no people"
}

Regeln:
- "heading": prägnant, z. B. "Mit den Augen von ${contribution.contributor_name}" oder "[Aspekt] — ${contribution.contributor_name}"
- "body": 250–450 Wörter, fließender Text in Ich-Form aus Sicht der Person ("Ich erinnere mich …"); konkrete Geschichten und Details aus den Antworten beibehalten; Absätze durch \\n\\n trennen
- "image_prompt": 15–30 Wörter, ENGLISCH, atmosphärisch/symbolisch, KEINE Personen, KEIN Foto-Stil; passt zum Inhalt des Kapitels
- Alles auf Deutsch (außer image_prompt)
- Gültiges JSON: Strings korrekt escapen, keine trailing commas, keine Kommentare

Interview:
=== ${contribution.contributor_name} (${contribution.relationship}) ===
${lines.join('\n')}`
}

function memorialV2Outline(memorial, contributions) {
  const g = genderNote(memorial)
  return `Du bist ein erfahrener Biograph. Aus den folgenden Interviews mit ${contributions.length} Menschen, die ${memorial.name}${g} kannten, planst du eine Lebensgeschichte (Variante 2: Aufbau nach Lebensstationen).

Plane jetzt das Gerüst: Titel, Untertitel und 5–9 Kapitel nach Lebensstationen (z. B. Kindheit, Schule, Familie, Reisen, Beruf, Charakter, Hobbies, Wendepunkte, Vermächtnis). Wähle nur Stationen, die zu dem passen, was die Beiträge tatsächlich hergeben. Die Kapitel-TEXTE werden später separat geschrieben.

Gib REINES, GÜLTIGES JSON aus (kein Markdown-Codeblock, keine Erklärungen):
{
  "title": "Gesamttitel des Buches",
  "subtitle": "Untertitel des Buches",
  "chapters": [
    { "number": 1, "heading": "Kindheit", "themes": "2–4 Sätze: welche konkreten Aspekte/Erinnerungen aus den Beiträgen sollen in DIESES Kapitel — als Anweisung für das spätere Schreiben." }
  ]
}

Regeln:
- 5–9 Kapitel, thematisch chronologisch sortiert (früh → spät)
- "heading": kurz und prägnant (1–3 Wörter)
- "themes": 2–4 Sätze, beschreibt KONKRET, welche Erinnerungen/Aspekte aus den Beiträgen hier behandelt werden sollen
- "title" persönlich, würdevoll, bezogen auf ${memorial.name}
- "subtitle" knapp, ergänzt den Titel
- Auf Deutsch
- Gültiges JSON, keine trailing commas

Beiträge:\n\n${blocks(contributions)}`
}

function memorialV2Chapter(memorial, contributions, plan) {
  const g = genderNote(memorial)
  return `Du bist ein erfahrener Biograph. Du schreibst EIN Kapitel einer Lebensgeschichte von ${memorial.name}${g} (Variante 2: Lebensstationen).

Dieses Kapitel: Nummer ${plan.number}, Überschrift "${plan.heading}".
Inhaltliche Schwerpunkte für dieses Kapitel:
${plan.themes || '(keine spezifischen Schwerpunkte aus dem Gerüst)'}

Webe die folgenden Interviews zu einem stimmigen Text zusammen — die einzelnen Beiträge dürfen NICHT als solche erkennbar sein.

Gib REINES, GÜLTIGES JSON für GENAU DIESES EINE KAPITEL aus (kein Markdown-Codeblock, keine Erklärungen):
{
  "number": ${plan.number},
  "heading": ${JSON.stringify(plan.heading || '')},
  "body": "Fließtext …",
  "image_prompt": "English image description, atmospheric, no people"
}

Regeln:
- "body": 300–500 Wörter, warme literarische Sprache, mehrere Absätze (durch \\n\\n getrennt); keine "X sagte …"-Zitate, keine Quellenangaben
- "image_prompt": 15–30 Wörter, ENGLISCH, atmosphärisch/symbolisch, KEINE Personen, KEIN Foto-Stil; passt zum jeweiligen Lebensabschnitt
- Alles auf Deutsch (außer image_prompt)
- Gültiges JSON: Strings korrekt escapen, keine trailing commas, keine Kommentare

Beiträge:\n\n${blocks(contributions)}`
}

const MEMORIAL_EULOGY_STYLES = [
  {
    key: 'klassisch',
    title: 'Klassisch-würdevoll',
    sub:  'Formell, traditionell, ernst-respektvoll',
    instruction:
      'Klassisch-würdevoll: formelle, traditionelle Trauerrede. Ernster, respektvoller Ton; gehobene Sprache, keine Umgangssprache. Klarer Aufbau: Hinführung → Würdigung → Lebensskizze → Abschied. Vermeide Anekdoten-Pointen und humorvolle Wendungen; halte die Distanz, die man von einer öffentlichen Rede erwartet.',
  },
  {
    key: 'persoenlich',
    title: 'Persönlich-warm',
    sub:  'Anekdotenhaft, intim, viele kleine Geschichten',
    instruction:
      'Persönlich-warm: intime, erzählerische Trauerrede. Beginne mit einer kleinen sprechenden Anekdote aus den Beiträgen. Verwebe viele konkrete Erinnerungen, Details und kleine Eigenheiten — der Eindruck soll sein, als spräche ein nahestehender Mensch. Weicher, erzählerischer Ton.',
  },
  {
    key: 'lebensfroh',
    title: 'Lebensfroh-erinnernd',
    sub:  'Würdigt das Leben mehr als den Verlust',
    instruction:
      'Lebensfroh-erinnernd: Fokus auf das gelebte Leben, nicht auf den Verlust. Heitere und ernste Momente werden bewusst verwoben; auch ein leises Lächeln ist erlaubt. Würdige Freude, Wesen und Eigenheiten der Person. Der Schluss endet hoffnungsvoll und dankbar — als Feier eines Lebens, nicht als Klage über einen Tod.',
  },
]

const MEMORIAL_EULOGY_SECTIONS = [
  { key: 'hinfuehrung', label: 'Hinführung', brief: 'Beginne mit „Liebe Trauergemeinde, …" und einer warmen, würdevollen Eröffnung. Stimme die Anwesenden auf den Abschied ein. Ca. 80–130 Wörter.', greets: true },
  { key: 'wuerdigung', label: 'Wer war diese Person', brief: 'Skizziere, wer der/die Verstorbene als Mensch war — Wesenszüge, was diese Person ausgemacht hat, was sie anderen bedeutete. Ca. 100–180 Wörter.', greets: false },
  { key: 'geschichten', label: 'Geschichten und Wesenszüge', brief: 'Webe konkrete Erinnerungen, Anekdoten und kleine Eigenheiten aus den Beiträgen ein, ohne die Quellen einzeln zu nennen. Mehrere konkrete Details, kein Allgemeinplatz. Ca. 150–260 Wörter.', greets: false },
  { key: 'abschluss', label: 'Abschluss und Verabschiedung', brief: 'Würdiger, persönlicher Abschluss; Verabschiedung der Trauergemeinde. Ca. 80–140 Wörter.', greets: false },
]

function memorialEulogySection(memorial, contributions, section, styleInstruction) {
  const g = genderNote(memorial)
  const styleBlock = styleInstruction
    ? `\nSTIL-VORGABE FÜR DIE GESAMTE REDE (verbindlich umsetzen):\n${styleInstruction}\n`
    : ''
  const greetRule = section.greets
    ? '- Beginne diesen Abschnitt mit „Liebe Trauergemeinde, …"'
    : '- KEINE Anrede der Trauergemeinde, KEIN „Liebe Trauergemeinde" — dieser Abschnitt schließt sich nahtlos an einen vorhergehenden Teil der Rede an'
  return `Du bist ein erfahrener Trauerredner. Du schreibst EINEN Abschnitt einer Trauerrede über ${memorial.name}${g}, basierend auf den Erinnerungen von ${contributions.length} nahestehenden Menschen. Die Rede wird laut auf einer Trauerfeier vorgelesen.

DIESER ABSCHNITT: „${section.label}"
${section.brief}
${styleBlock}
Anforderungen:
${greetRule}
- Würdevoll, warm, persönlich — kein religiöser Standardtext, sondern auf diesen konkreten Menschen zugeschnitten
- Webe konkrete Erinnerungen und Geschichten aus den Beiträgen ein, ohne die Quellen einzeln zu nennen
- Ton: gesprochene Sprache, gut zum Vorlesen geeignet — kurze Sätze sind willkommen
- Auf Deutsch
- Absätze durch eine Leerzeile (\\n\\n) trennen
- Gib AUSSCHLIESSLICH den fertigen Redetext dieses Abschnitts aus. Keine Überschrift, kein Titel, keine Metakommentare, keine Einleitung wie „Hier ist der Abschnitt …", kein Markdown.

Beiträge:\n\n${blocks(contributions)}`
}

// ════════════════════════════════════════════════════════════════
// GENERISCHE BUILDER für alle übrigen Kategorien (über `profile`)
// ════════════════════════════════════════════════════════════════
function makeInterview(p) {
  return (memorial, name, rel, address, contributorGender) => {
    const g = genderNote(memorial)
    const addr = addressRule(address)
    const gen = contributorGenderRule(contributorGender)
    return `Du bist ${p.interviewRole}. Du sprichst mit ${name} (${rel})${p.relationClause(memorial, g)}.

Ziel: ${p.interviewGoal}

Regeln:
- ${addr}${gen ? `\n- ${gen}` : ''}
- Stelle immer nur EINE Frage pro Nachricht, maximal 2 kurze Sätze
- Reagiere kurz und herzlich auf die vorherige Antwort (max. 1 Satz)
- Frage nach konkreten Erlebnissen und Geschichten, nicht Allgemeinem
- ${p.empathyRule}
- WICHTIG: Bohre nicht zu tief. Maximal EINE Nachfrage zu einer Antwort. Danach wechsle zu einem völlig neuen, thematisch unabhängigen Themenfeld — kein weiterer Anknüpfungspunkt an die vorherige Antwort.
- Variiere die Themenfelder bewusst: ${p.themeFields} — wähle pro neuer Frage ein anderes Feld.
- Schreibe auf Deutsch`
  }
}

function makeV1Outline(p) {
  return (memorial, contributions) => {
    const g = genderNote(memorial)
    return `Du bist ein einfühlsamer Buchautor. Aus den folgenden Beiträgen von ${contributions.length} Menschen, die ${memorial.name}${g} ${p.knowVerb}, gestaltest du ${p.bookNounIndef} (Variante 1: jede Person ein Kapitel).

Plane jetzt NUR den Gesamt-Titel und -Untertitel des Buches. Die einzelnen Kapitel werden später separat geschrieben.

Gib REINES, GÜLTIGES JSON aus (kein Markdown-Codeblock, keine Erklärungen):
{
  "title": "Gesamttitel des Buches",
  "subtitle": "Untertitel des Buches"
}

Regeln:
- "title" persönlich, ${p.titleTone}, bezogen auf ${memorial.name}
- "subtitle" knapp, ergänzt den Titel
- Auf Deutsch
- Gültiges JSON, keine trailing commas

Beiträge:\n\n${blocks(contributions)}`
  }
}

function makeV1Chapter(p) {
  return (memorial, contribution, number) => {
    const g = genderNote(memorial)
    const lines = contribution.messages.map(m => m.role === 'assistant' ? `F: ${m.content}` : `A: ${m.content}`)
    return `Du bist ein einfühlsamer Buchautor. Du schreibst EIN Kapitel ${p.bookNounGen} für ${memorial.name}${g} (Variante 1: jede Person ein Kapitel).

Dieses Kapitel: Nummer ${number}, basierend ausschließlich auf dem Beitrag von ${contribution.contributor_name} (${contribution.relationship}).

Gib REINES, GÜLTIGES JSON für GENAU DIESES EINE KAPITEL aus (kein Markdown-Codeblock, keine Erklärungen):
{
  "number": ${number},
  "heading": "Kapitel-Überschrift",
  "body": "Fließtext …",
  "image_prompt": "English image description, atmospheric, no people"
}

Regeln:
- "heading": prägnant, z. B. "Mit den Augen von ${contribution.contributor_name}" oder "[Aspekt] — ${contribution.contributor_name}"
- "body": 250–450 Wörter, ${p.chapterVoice}; konkrete Geschichten und Details aus den Antworten beibehalten; Absätze durch \\n\\n trennen
- "image_prompt": 15–30 Wörter, ENGLISCH, atmosphärisch/symbolisch, KEINE Personen, KEIN Foto-Stil; passt zum Inhalt des Kapitels
- Alles auf Deutsch (außer image_prompt)
- Gültiges JSON: Strings korrekt escapen, keine trailing commas, keine Kommentare

Beitrag:
=== ${contribution.contributor_name} (${contribution.relationship}) ===
${lines.join('\n')}`
  }
}

function makeV2Outline(p) {
  return (memorial, contributions) => {
    const g = genderNote(memorial)
    const sortRule = p.v2Chronological
      ? '5–9 Kapitel, thematisch chronologisch sortiert (früh → spät)'
      : '5–9 Kapitel, thematisch sinnvoll sortiert'
    return `Du bist ${p.v2Role}. Aus den folgenden Beiträgen von ${contributions.length} Menschen, die ${memorial.name}${g} ${p.knowVerb}, planst du ${p.v2NounIndef} (Variante 2: ${p.v2Concept}).

Plane jetzt das Gerüst: Titel, Untertitel und 5–9 Kapitel ${p.v2Arrange} (z. B. ${p.v2StationExamples}). Wähle nur Kapitel, die zu dem passen, was die Beiträge tatsächlich hergeben. Die Kapitel-TEXTE werden später separat geschrieben.

Gib REINES, GÜLTIGES JSON aus (kein Markdown-Codeblock, keine Erklärungen):
{
  "title": "Gesamttitel des Buches",
  "subtitle": "Untertitel des Buches",
  "chapters": [
    { "number": 1, "heading": "Überschrift", "themes": "2–4 Sätze: welche konkreten Aspekte/Erinnerungen aus den Beiträgen sollen in DIESES Kapitel — als Anweisung für das spätere Schreiben." }
  ]
}

Regeln:
- ${sortRule}
- "heading": kurz und prägnant (1–3 Wörter)
- "themes": 2–4 Sätze, beschreibt KONKRET, welche Erinnerungen/Aspekte aus den Beiträgen hier behandelt werden sollen
- "title" persönlich, ${p.titleTone}, bezogen auf ${memorial.name}
- "subtitle" knapp, ergänzt den Titel
- Auf Deutsch
- Gültiges JSON, keine trailing commas

Beiträge:\n\n${blocks(contributions)}`
  }
}

function makeV2Chapter(p) {
  return (memorial, contributions, plan) => {
    const g = genderNote(memorial)
    return `Du bist ${p.v2Role}. Du schreibst EIN Kapitel ${p.v2NounGen} für ${memorial.name}${g} (Variante 2).

Dieses Kapitel: Nummer ${plan.number}, Überschrift "${plan.heading}".
Inhaltliche Schwerpunkte für dieses Kapitel:
${plan.themes || '(keine spezifischen Schwerpunkte aus dem Gerüst)'}

Webe die folgenden Beiträge zu einem stimmigen Text zusammen — die einzelnen Beiträge dürfen NICHT als solche erkennbar sein.

Gib REINES, GÜLTIGES JSON für GENAU DIESES EINE KAPITEL aus (kein Markdown-Codeblock, keine Erklärungen):
{
  "number": ${plan.number},
  "heading": ${JSON.stringify(plan.heading || '')},
  "body": "Fließtext …",
  "image_prompt": "English image description, atmospheric, no people"
}

Regeln:
- "body": 300–500 Wörter, ${p.v2Voice}, mehrere Absätze (durch \\n\\n getrennt); keine "X sagte …"-Zitate, keine Quellenangaben
- "image_prompt": 15–30 Wörter, ENGLISCH, atmosphärisch/symbolisch, KEINE Personen, KEIN Foto-Stil; passt zum jeweiligen Kapitel
- Alles auf Deutsch (außer image_prompt)
- Gültiges JSON: Strings korrekt escapen, keine trailing commas, keine Kommentare

Beiträge:\n\n${blocks(contributions)}`
  }
}

function makeFinalSection(p) {
  return (memorial, contributions, section, styleInstruction) => {
    const g = genderNote(memorial)
    const greeting = (p.finalGreeting || '').replace(/\{name\}/g, memorial.name || '')
    const styleBlock = styleInstruction
      ? `\nSTIL-VORGABE FÜR DEN GESAMTEN TEXT (verbindlich umsetzen):\n${styleInstruction}\n`
      : ''
    const greetRule = section.greets
      ? `- Beginne diesen Abschnitt mit „${greeting}"`
      : '- KEINE einleitende Anrede — dieser Abschnitt schließt sich nahtlos an einen vorhergehenden Teil an'
    return `Du bist ${p.finalRole}. Du schreibst EINEN Abschnitt ${p.finalNounGen} ${p.finalAbout} ${memorial.name}${g}, basierend auf den Beiträgen von ${contributions.length} nahestehenden Menschen. ${p.finalContext}

DIESER ABSCHNITT: „${section.label}"
${section.brief}
${styleBlock}
Anforderungen:
${greetRule}
- ${p.finalToneRule}
- Webe konkrete Erinnerungen und Geschichten aus den Beiträgen ein, ohne die Quellen einzeln zu nennen
- Ton: gesprochene Sprache, gut zum Vorlesen geeignet — kurze Sätze sind willkommen
- Auf Deutsch
- Absätze durch eine Leerzeile (\\n\\n) trennen
- Gib AUSSCHLIESSLICH den fertigen Text dieses Abschnitts aus. Keine Überschrift, kein Titel, keine Metakommentare, keine Einleitung wie „Hier ist der Abschnitt …", kein Markdown.

Beiträge:\n\n${blocks(contributions)}`
  }
}

// ── Profile + Endtext-Stile/-Abschnitte je Nicht-Trauer-Kategorie ──
const FOUR_GREETS = (g1, l2, b2, l3, b3, l4, b4) => [g1, { label: l2, brief: b2, greets: false }, { label: l3, brief: b3, greets: false }, { label: l4, brief: b4, greets: false }]

const PROFILES = {
  birthday: {
    interviewRole: 'herzlicher Gesprächspartner',
    relationClause: (m, g) => ` für ein Geburtstagsbuch über ${m.name}${g}`,
    interviewGoal: 'Schöne Erinnerungen, Anekdoten und Glückwünsche für ein persönliches Geburtstagsbuch sammeln.',
    empathyRule: 'Sei herzlich und feiere die Freude.',
    themeFields: 'erste Begegnung, gemeinsame Erlebnisse, lustige Momente, Charakterzüge, kleine Marotten, Talente, Hobbies, Reisen, besondere Geschichten, was man an der Person schätzt, Wünsche zum Geburtstag',
    knowVerb: 'gut kennen', bookNounIndef: 'ein persönliches Geburtstagsbuch', bookNounGen: 'eines Geburtstagsbuchs',
    titleTone: 'festlich und warm', chapterVoice: 'fließender Text in Ich-Form aus Sicht der beitragenden Person ("Ich erinnere mich …")',
    v2Role: 'einfühlsamer Autor', v2NounIndef: 'ein festliches Geburtstagsbuch', v2NounGen: 'eines Geburtstagsbuchs',
    v2Concept: 'Aufbau nach Lebensstationen', v2Arrange: 'nach Lebensstationen',
    v2StationExamples: 'Kindheit, Familie, Freundschaften, Beruf, Hobbies, Charakter, schöne Momente, Glückwünsche', v2Chronological: true,
    v2Voice: 'warme, festliche Sprache',
    finalRole: 'erfahrener Redner für festliche Anlässe', finalNounGen: 'einer Geburtstagsrede', finalAbout: 'über', finalContext: 'Die Rede wird laut auf der Geburtstagsfeier vorgetragen.', finalToneRule: 'Festlich, herzlich und persönlich — feiere den Menschen und das gelebte Leben', finalGreeting: 'Liebe Gäste, …',
    finalLabel: 'Geburtstagsrede', finalFilename: 'Geburtstagsrede', finalNoun: 'Geburtstagsrede',
    finalStyles: [
      { key: 'klassisch', title: 'Klassisch-festlich', sub: 'Würdevoll, feierlich', instruction: 'Klassisch-festlich: würdevolle, feierliche Geburtstagsrede in gehobener Sprache, klarer Aufbau, herzlich aber nicht albern.' },
      { key: 'humorvoll', title: 'Humorvoll-herzlich', sub: 'Mit Augenzwinkern, viele Anekdoten', instruction: 'Humorvoll-herzlich: heitere Geburtstagsrede mit liebevollem Augenzwinkern und vielen kleinen Anekdoten; pointiert, aber nie verletzend.' },
      { key: 'bewegend', title: 'Bewegend-persönlich', sub: 'Warm, nahbar, emotional', instruction: 'Bewegend-persönlich: warme, emotionale Rede, die zeigt, was die Person den Menschen bedeutet; intime Erinnerungen im Vordergrund.' },
    ],
    finalSections: FOUR_GREETS(
      { key: 'begruessung', label: 'Begrüßung', brief: 'Warme, festliche Eröffnung. Stimme die Gäste auf die Feier ein. Ca. 80–130 Wörter.', greets: true },
      'Wer gefeiert wird', 'Skizziere, wer der/die Gefeierte als Mensch ist — Wesenszüge, was die Person ausmacht. Ca. 100–180 Wörter.',
      'Geschichten und Anekdoten', 'Webe konkrete Erinnerungen und Anekdoten aus den Beiträgen ein, ohne die Quellen einzeln zu nennen. Ca. 150–260 Wörter.',
      'Glückwünsche und Abschluss', 'Herzliche Glückwünsche und ein schöner Abschluss. Ca. 80–140 Wörter.'),
  },
  anniversary: {
    interviewRole: 'herzlicher Gesprächspartner',
    relationClause: (m, g) => ` für ein Buch zum Hochzeitsjubiläum von ${m.name}`,
    interviewGoal: 'Schöne Erinnerungen, Anekdoten und Glückwünsche über das Paar für ein Jubiläumsbuch sammeln.',
    empathyRule: 'Sei herzlich und würdige die gemeinsame Geschichte des Paares.',
    themeFields: 'wie sich das Paar kennenlernte, gemeinsame Höhepunkte, die Hochzeit, Familie, gemeinsame Reisen, wie sie als Paar wirken, kleine Eigenheiten, schöne Anekdoten, was ihre Verbindung ausmacht, Wünsche fürs Paar',
    knowVerb: 'als Paar kennen', bookNounIndef: 'ein Jubiläumsbuch zur Hochzeit', bookNounGen: 'eines Jubiläumsbuchs',
    titleTone: 'festlich und warm', chapterVoice: 'fließender Text in Ich-Form aus Sicht der beitragenden Person',
    v2Role: 'einfühlsamer Autor', v2NounIndef: 'eine Festschrift zum Jubiläum', v2NounGen: 'einer Festschrift',
    v2Concept: 'Aufbau nach gemeinsamen Stationen', v2Arrange: 'nach gemeinsamen Stationen',
    v2StationExamples: 'Kennenlernen, Hochzeit, gemeinsame Jahre, Familie, Höhepunkte, was sie als Paar ausmacht, Ausblick', v2Chronological: true,
    v2Voice: 'warme, festliche Sprache',
    finalRole: 'erfahrener Festredner', finalNounGen: 'einer Festrede zum Hochzeitsjubiläum', finalAbout: 'über das Paar', finalContext: 'Die Rede wird laut auf der Jubiläumsfeier vorgetragen.', finalToneRule: 'Festlich, warm und persönlich — würdige die gemeinsame Geschichte des Paares', finalGreeting: 'Liebe Festgesellschaft, …',
    finalLabel: 'Festrede', finalFilename: 'Festrede', finalNoun: 'Festrede',
    finalStyles: [
      { key: 'klassisch', title: 'Klassisch-würdevoll', sub: 'Feierlich, gehoben', instruction: 'Klassisch-würdevoll: feierliche Festrede in gehobener Sprache, klarer Aufbau, herzlich aber nicht albern.' },
      { key: 'humorvoll', title: 'Humorvoll-herzlich', sub: 'Mit Augenzwinkern', instruction: 'Humorvoll-herzlich: heitere Festrede mit liebevollem Augenzwinkern und kleinen Anekdoten über das Paar; nie verletzend.' },
      { key: 'romantisch', title: 'Romantisch-bewegend', sub: 'Emotional, von Herzen', instruction: 'Romantisch-bewegend: emotionale Rede, die die Liebe und Verbundenheit des Paares in den Mittelpunkt stellt.' },
    ],
    finalSections: FOUR_GREETS(
      { key: 'begruessung', label: 'Begrüßung', brief: 'Warme, festliche Eröffnung. Stimme die Gäste auf die Feier ein. Ca. 80–130 Wörter.', greets: true },
      'Das Paar', 'Würdige das Paar — wer sie sind, was ihre Verbindung ausmacht. Ca. 100–180 Wörter.',
      'Gemeinsame Geschichte und Anekdoten', 'Webe konkrete gemeinsame Erinnerungen und Anekdoten aus den Beiträgen ein, ohne Quellen einzeln zu nennen. Ca. 150–260 Wörter.',
      'Glückwünsche und Abschluss', 'Herzliche Glückwünsche fürs Paar und ein schöner Abschluss. Ca. 80–140 Wörter.'),
  },
  farewell: {
    interviewRole: 'wertschätzender Gesprächspartner',
    relationClause: (m, g) => ` für ein Abschiedsbuch über ${m.name}${g}`,
    interviewGoal: 'Erinnerungen, Anekdoten und gute Wünsche für ein Abschiedsbuch sammeln.',
    empathyRule: 'Sei wertschätzend und würdige die geleistete Arbeit und die Verbundenheit.',
    themeFields: 'erste Begegnung im beruflichen oder vereinsbezogenen Kontext, gemeinsame Projekte, Erfolge, prägende Momente, Charakterzüge, Humor, was die Person für das Team oder den Verein bedeutete, schöne Anekdoten, gute Wünsche für den neuen Lebensabschnitt',
    knowVerb: 'kennen und schätzen', bookNounIndef: 'ein Abschiedsbuch', bookNounGen: 'eines Abschiedsbuchs',
    titleTone: 'wertschätzend und warm', chapterVoice: 'fließender Text in Ich-Form aus Sicht der beitragenden Person',
    v2Role: 'erfahrener Autor', v2NounIndef: 'eine Abschieds-Festschrift', v2NounGen: 'einer Festschrift',
    v2Concept: 'Aufbau nach Stationen des gemeinsamen Weges', v2Arrange: 'nach Stationen',
    v2StationExamples: 'Anfänge, Werdegang, prägende Projekte, Charakter, was bleibt, Ausblick auf den neuen Lebensabschnitt', v2Chronological: true,
    v2Voice: 'warme, wertschätzende Sprache',
    finalRole: 'erfahrener Redner für Abschiedsfeiern', finalNounGen: 'einer Abschiedsrede', finalAbout: 'über', finalContext: 'Die Rede wird laut auf der Verabschiedungsfeier vorgetragen.', finalToneRule: 'Wertschätzend, warm und persönlich — würdige Leistung und Verbundenheit', finalGreeting: 'Liebe Kolleginnen und Kollegen, …',
    finalLabel: 'Abschiedsrede', finalFilename: 'Abschiedsrede', finalNoun: 'Abschiedsrede',
    finalStyles: [
      { key: 'wuerdevoll', title: 'Würdevoll-wertschätzend', sub: 'Respektvoll, gehoben', instruction: 'Würdevoll-wertschätzend: respektvolle Abschiedsrede in gehobener Sprache, würdigt Leistung und Charakter klar und ernst.' },
      { key: 'humorvoll', title: 'Humorvoll-herzlich', sub: 'Mit Augenzwinkern', instruction: 'Humorvoll-herzlich: heitere Abschiedsrede mit liebevollem Augenzwinkern und Anekdoten aus dem gemeinsamen Alltag; nie verletzend.' },
      { key: 'persoenlich', title: 'Persönlich-bewegend', sub: 'Nahbar, emotional', instruction: 'Persönlich-bewegend: warme, emotionale Rede, die zeigt, was die Person den Kolleginnen, Kollegen oder Mitstreitern bedeutet.' },
    ],
    finalSections: FOUR_GREETS(
      { key: 'begruessung', label: 'Begrüßung', brief: 'Warme Eröffnung. Stimme die Anwesenden auf die Verabschiedung ein. Ca. 80–130 Wörter.', greets: true },
      'Wer verabschiedet wird', 'Würdige, wer die Person ist und was sie geleistet und bewirkt hat. Ca. 100–180 Wörter.',
      'Anekdoten und Wegmarken', 'Webe konkrete gemeinsame Erinnerungen, Erfolge und Anekdoten aus den Beiträgen ein, ohne Quellen einzeln zu nennen. Ca. 150–260 Wörter.',
      'Gute Wünsche und Abschluss', 'Gute Wünsche für den neuen Lebensabschnitt und ein herzlicher Abschluss. Ca. 80–140 Wörter.'),
  },
  company: {
    interviewRole: 'wertschätzender, interessierter Gesprächspartner',
    relationClause: (m, g) => ` für ein Jubiläumsbuch über die Organisation ${m.name}`,
    interviewGoal: 'Geschichten, Meilensteine und Anekdoten über die Organisation für ein Jubiläumsbuch sammeln.',
    empathyRule: 'Sei wertschätzend und würdige die Geschichte der Organisation.',
    themeFields: 'Gründung und Anfänge, prägende Persönlichkeiten, Meilensteine und Erfolge, schwierige Zeiten und wie sie gemeistert wurden, Wandel über die Jahre, besondere Ereignisse, Unternehmens- bzw. Vereinskultur, lustige Anekdoten aus dem Alltag, was die Organisation ausmacht, Ausblick in die Zukunft',
    knowVerb: 'begleitet haben', bookNounIndef: 'ein Jubiläumsbuch', bookNounGen: 'eines Jubiläumsbuchs',
    titleTone: 'würdigend und festlich', chapterVoice: 'fließender Text in Ich-Form aus Sicht der beitragenden Person ("Ich erinnere mich …")',
    v2Role: 'erfahrener Chronist', v2NounIndef: 'eine Festschrift zum Jubiläum', v2NounGen: 'einer Festschrift',
    v2Concept: 'Aufbau nach Stationen der Geschichte', v2Arrange: 'nach Stationen der Geschichte',
    v2StationExamples: 'Gründung, Anfänge, Wachstum, Meilensteine, prägende Personen, schwierige Zeiten, Wandel, Gegenwart, Ausblick', v2Chronological: true,
    v2Voice: 'warme, würdigende Sprache',
    finalRole: 'erfahrener Festredner', finalNounGen: 'einer Festrede zum Jubiläum', finalAbout: 'über die Organisation', finalContext: 'Die Rede wird laut auf der Jubiläumsfeier vorgetragen.', finalToneRule: 'Festlich, würdigend und persönlich — würdige die Geschichte und die Menschen der Organisation', finalGreeting: 'Liebe Festgesellschaft, …',
    finalLabel: 'Festrede', finalFilename: 'Festrede', finalNoun: 'Festrede',
    finalStyles: [
      { key: 'klassisch', title: 'Klassisch-würdevoll', sub: 'Feierlich, gehoben', instruction: 'Klassisch-würdevoll: feierliche Festrede in gehobener Sprache, klarer Aufbau, würdigt die Geschichte der Organisation ernst und respektvoll.' },
      { key: 'humorvoll', title: 'Humorvoll-herzlich', sub: 'Mit Augenzwinkern', instruction: 'Humorvoll-herzlich: heitere Festrede mit liebevollem Augenzwinkern und Anekdoten aus dem Alltag der Organisation; nie verletzend.' },
      { key: 'geschichte', title: 'Geschichtsträchtig-bewegend', sub: 'Erzählt den Weg', instruction: 'Geschichtsträchtig-bewegend: erzählerische Festrede, die den Weg der Organisation von den Anfängen bis heute lebendig nachzeichnet.' },
    ],
    finalSections: FOUR_GREETS(
      { key: 'begruessung', label: 'Begrüßung', brief: 'Warme, festliche Eröffnung. Stimme die Gäste auf das Jubiläum ein. Ca. 80–130 Wörter.', greets: true },
      'Die Organisation', 'Würdige, wofür die Organisation steht und was sie ausmacht. Ca. 100–180 Wörter.',
      'Geschichte und Anekdoten', 'Webe konkrete Meilensteine, Erinnerungen und Anekdoten aus den Beiträgen ein, ohne Quellen einzeln zu nennen. Ca. 150–260 Wörter.',
      'Dank und Ausblick', 'Dank an die Menschen der Organisation und ein hoffnungsvoller Ausblick. Ca. 80–140 Wörter.'),
  },
  service: {
    interviewRole: 'wertschätzender Gesprächspartner',
    relationClause: (m, g) => ` für ein Buch zum Dienstjubiläum von ${m.name}${g}`,
    interviewGoal: 'Erinnerungen, Anekdoten und Glückwünsche zum Dienstjubiläum der Person sammeln.',
    empathyRule: 'Sei wertschätzend und würdige die langjährige Treue und Arbeit.',
    themeFields: 'erste Zeit im Unternehmen, prägende Projekte, Erfolge, gemeinsame Erlebnisse mit Kolleginnen und Kollegen, Charakterzüge, Humor, was die Person für das Team bedeutet, schöne Anekdoten, Wünsche für das weitere Miteinander',
    knowVerb: 'kennen und schätzen', bookNounIndef: 'ein Buch zum Dienstjubiläum', bookNounGen: 'eines Buchs zum Dienstjubiläum',
    titleTone: 'wertschätzend und festlich', chapterVoice: 'fließender Text in Ich-Form aus Sicht der beitragenden Person',
    v2Role: 'erfahrener Autor', v2NounIndef: 'eine Festschrift zum Dienstjubiläum', v2NounGen: 'einer Festschrift',
    v2Concept: 'Aufbau nach Stationen der gemeinsamen Zeit', v2Arrange: 'nach Stationen',
    v2StationExamples: 'Anfänge im Unternehmen, Werdegang, prägende Projekte, Charakter, gemeinsame Höhepunkte, Ausblick', v2Chronological: true,
    v2Voice: 'warme, wertschätzende Sprache',
    finalRole: 'erfahrener Festredner', finalNounGen: 'einer Festrede zum Dienstjubiläum', finalAbout: 'über', finalContext: 'Die Rede wird laut auf der Jubiläumsfeier vorgetragen.', finalToneRule: 'Wertschätzend, festlich und persönlich — würdige Treue, Leistung und Verbundenheit', finalGreeting: 'Liebe Festgesellschaft, …',
    finalLabel: 'Festrede', finalFilename: 'Festrede', finalNoun: 'Festrede',
    finalStyles: [
      { key: 'wuerdevoll', title: 'Würdevoll-wertschätzend', sub: 'Respektvoll, gehoben', instruction: 'Würdevoll-wertschätzend: respektvolle Festrede in gehobener Sprache, würdigt Treue und Leistung klar und ernst.' },
      { key: 'humorvoll', title: 'Humorvoll-herzlich', sub: 'Mit Augenzwinkern', instruction: 'Humorvoll-herzlich: heitere Festrede mit liebevollem Augenzwinkern und Anekdoten aus dem gemeinsamen Arbeitsalltag; nie verletzend.' },
      { key: 'persoenlich', title: 'Persönlich-bewegend', sub: 'Nahbar, emotional', instruction: 'Persönlich-bewegend: warme, emotionale Rede, die zeigt, was die Person den Kolleginnen und Kollegen bedeutet.' },
    ],
    finalSections: FOUR_GREETS(
      { key: 'begruessung', label: 'Begrüßung', brief: 'Warme, festliche Eröffnung zum Dienstjubiläum. Ca. 80–130 Wörter.', greets: true },
      'Wer gefeiert wird', 'Würdige die Person und was sie über die Jahre geleistet und bewirkt hat. Ca. 100–180 Wörter.',
      'Anekdoten und Wegmarken', 'Webe konkrete gemeinsame Erinnerungen, Erfolge und Anekdoten aus den Beiträgen ein, ohne Quellen einzeln zu nennen. Ca. 150–260 Wörter.',
      'Glückwünsche und Ausblick', 'Herzliche Glückwünsche und ein guter Ausblick auf das weitere Miteinander. Ca. 80–140 Wörter.'),
  },
  newborn: {
    interviewRole: 'warmherziger Gesprächspartner',
    relationClause: (m, g) => ` für ein Willkommensbuch für das neugeborene Kind ${m.name}`,
    interviewGoal: 'Hoffnungen, Wünsche und Botschaften für ein Willkommensbuch für das Kind sammeln.',
    empathyRule: 'Sei warmherzig und voller Vorfreude.',
    themeFields: 'Vorfreude auf das Kind, Hoffnungen, Wünsche fürs Leben, Werte die man weitergeben möchte, Familiengeschichten, Botschaften an das Kind für später, was man dem Kind mitgeben möchte',
    knowVerb: 'willkommen heißen', bookNounIndef: 'ein Willkommensbuch', bookNounGen: 'eines Willkommensbuchs',
    titleTone: 'warm und hoffnungsvoll', chapterVoice: 'fließender Text in Ich-Form aus Sicht der beitragenden Person, an das Kind gerichtet ("Ich wünsche dir …")',
    v2Role: 'warmherziger Autor', v2NounIndef: 'ein Willkommensbuch', v2NounGen: 'eines Willkommensbuchs',
    v2Concept: 'Aufbau nach Themen', v2Arrange: 'nach Themen',
    v2StationExamples: 'Vorfreude, Hoffnungen, Wünsche fürs Leben, Werte, Botschaften für später', v2Chronological: false,
    v2Voice: 'warme, hoffnungsvolle Sprache, an das Kind gerichtet',
    finalRole: 'warmherziger Autor', finalNounGen: 'eines Grußworts zur Geburt', finalAbout: 'für', finalContext: 'Der Text richtet sich an das Kind und seine Familie und kann später vorgelesen werden.', finalToneRule: 'Warm, hoffnungsvoll und liebevoll — an das Kind gerichtet', finalGreeting: 'Willkommen auf der Welt, {name}! …',
    finalLabel: 'Grußwort zur Geburt', finalFilename: 'Grußwort', finalNoun: 'Grußwort',
    finalStyles: [
      { key: 'poetisch', title: 'Warm-poetisch', sub: 'Bildhaft, zart', instruction: 'Warm-poetisch: zartes, bildhaftes Grußwort an das Kind, hoffnungsvoll und liebevoll.' },
      { key: 'froehlich', title: 'Fröhlich-leicht', sub: 'Heiter, vorfreudig', instruction: 'Fröhlich-leicht: heiteres, lebensfrohes Grußwort voller Vorfreude und Wärme.' },
      { key: 'weise', title: 'Weise-bewegend', sub: 'Tiefe Wünsche fürs Leben', instruction: 'Weise-bewegend: bewegendes Grußwort mit tiefen Wünschen und Werten fürs Leben des Kindes.' },
    ],
    finalSections: FOUR_GREETS(
      { key: 'willkommen', label: 'Willkommen', brief: 'Herzliches Willkommen für das Kind auf der Welt. Ca. 80–130 Wörter.', greets: true },
      'Hoffnungen und Wünsche', 'Trage die schönsten Hoffnungen und Wünsche fürs Leben aus den Beiträgen zusammen. Ca. 100–180 Wörter.',
      'Botschaften der Liebsten', 'Webe konkrete Botschaften und liebevolle Worte der Beitragenden ein, ohne Quellen einzeln zu nennen. Ca. 150–260 Wörter.',
      'Segenswunsch und Abschluss', 'Ein liebevoller Segenswunsch und ein warmer Abschluss. Ca. 80–140 Wörter.'),
  },
  encouragement: {
    interviewRole: 'einfühlsamer, ermutigender Gesprächspartner',
    relationClause: (m, g) => ` für ein Mutmachbuch für ${m.name}${g}`,
    interviewGoal: 'Mut machende Erinnerungen, Botschaften und Geschichten für ein Mutmachbuch sammeln.',
    empathyRule: 'Sei einfühlsam, ermutigend und zuversichtlich.',
    themeFields: 'schöne gemeinsame Erinnerungen, lustige Momente, Stärken der Person, Mut machende Worte, was man an der Person bewundert, gemeinsame Pläne für die Zukunft, Botschaften der Verbundenheit',
    knowVerb: 'begleiten und unterstützen', bookNounIndef: 'ein Mutmachbuch', bookNounGen: 'eines Mutmachbuchs',
    titleTone: 'ermutigend und warm', chapterVoice: 'fließender Text in Ich-Form aus Sicht der beitragenden Person, an die Person gerichtet ("Ich denke an dich …")',
    v2Role: 'einfühlsamer Autor', v2NounIndef: 'ein Mutmachbuch', v2NounGen: 'eines Mutmachbuchs',
    v2Concept: 'Aufbau nach Themen', v2Arrange: 'nach Themen',
    v2StationExamples: 'schöne gemeinsame Erinnerungen, Stärken, Mut machende Botschaften, gemeinsame Zukunft', v2Chronological: false,
    v2Voice: 'warme, ermutigende Sprache, an die Person gerichtet',
    finalRole: 'einfühlsamer Autor, der Mut macht', finalNounGen: 'einer Mutmach-Botschaft', finalAbout: 'für', finalContext: 'Der Text richtet sich direkt an die Person und soll Kraft und Zuversicht geben.', finalToneRule: 'Warm, ermutigend und zuversichtlich — der Person Kraft geben', finalGreeting: 'Liebe/r {name}, …',
    finalLabel: 'Mutmach-Botschaft', finalFilename: 'Mutmach-Botschaft', finalNoun: 'Mutmach-Botschaft',
    finalStyles: [
      { key: 'zuversichtlich', title: 'Warm-zuversichtlich', sub: 'Liebevoll, Hoffnung gebend', instruction: 'Warm-zuversichtlich: liebevolle, Hoffnung gebende Botschaft, die Nähe und Zuversicht vermittelt.' },
      { key: 'kraftvoll', title: 'Kraftvoll-motivierend', sub: 'Stark, anfeuernd', instruction: 'Kraftvoll-motivierend: starke, anfeuernde Botschaft, die die Stärken der Person betont und Mut macht.' },
      { key: 'ruhig', title: 'Ruhig-tröstend', sub: 'Sanft, beruhigend', instruction: 'Ruhig-tröstend: sanfte, beruhigende Botschaft, die Geborgenheit und stille Zuversicht schenkt.' },
    ],
    finalSections: FOUR_GREETS(
      { key: 'zuwendung', label: 'Zuwendung und Anrede', brief: 'Warme, persönliche Anrede, die Nähe vermittelt. Ca. 80–130 Wörter.', greets: true },
      'Was wir an dir schätzen', 'Würdige die Stärken und das Wesen der Person aus den Beiträgen. Ca. 100–180 Wörter.',
      'Gemeinsame Erinnerungen', 'Webe konkrete schöne Erinnerungen und Anekdoten aus den Beiträgen ein, ohne Quellen einzeln zu nennen. Ca. 150–260 Wörter.',
      'Mut und Zuversicht zum Abschluss', 'Mut machende Worte und ein zuversichtlicher Abschluss. Ca. 80–140 Wörter.'),
  },
}

function buildGenericCategory(slug, cfg) {
  const p = PROFILES[slug]
  return {
    slug,
    label: cfg.label,
    description: cfg.description,
    nounBook: cfg.nounBook,
    intake: cfg.intake,
    contributor: cfg.contributor,
    interviewSystem: makeInterview(p),
    generators: {
      book_v1: { label: cfg.v1Label, filename: cfg.v1Filename, outlineSystem: makeV1Outline(p), chapterSystem: makeV1Chapter(p) },
      book_v2: { label: cfg.v2Label, filename: cfg.v2Filename, outlineSystem: makeV2Outline(p), chapterSystem: makeV2Chapter(p) },
    },
    finalText: {
      label: p.finalLabel, filename: p.finalFilename, noun: p.finalNoun,
      styles: p.finalStyles, sections: p.finalSections, sectionSystem: makeFinalSection(p),
    },
  }
}

// ════════════════════════════════════════════════════════════════
// CATEGORIES — exportierte Konfiguration
// ════════════════════════════════════════════════════════════════
export const CATEGORIES = {
  memorial: {
    slug: 'memorial',
    label: 'Gedenkbuch',
    description: 'Zum Gedenken an eine verstorbene Person – die Trauergemeinschaft trägt Erinnerungen zusammen.',
    nounBook: 'Gedenkbuch',
    intake: {
      subjectLabel: 'Name der verstorbenen Person *',
      subjectPlaceholder: 'Vollständiger Name',
      useGender: true, genderLabel: 'Geschlecht der verstorbenen Person *',
      useDate: true, dateLabel: 'Geplantes Datum der Bestattung',
      useCutoff: true, cutoffLabel: 'Tage vor der Bestattung, bis zu denen Beiträge erfasst werden',
      extra: [],
      createHeading: 'Neues Gedenkbuch anlegen',
      createIntro: 'Erstellen Sie ein Gedenkbuch und teilen Sie anschließend den Einladungslink.',
      createButton: 'Gedenkbuch anlegen →',
    },
    contributor: {
      heading: 'Ihre Erinnerung',
      introNoun: 'Gedenkbuch für',
      relationshipLabel: 'Ihre Beziehung zu {name} *',
      relationshipPlaceholder: 'z.B. Tochter, Freund, Kollege, Nachbar …',
      consentNoun: 'Gedenkbuchs',
      interviewButton: '🎙 Sprach-Interview beginnen →',
    },
    interviewSystem: memorialInterview,
    generators: {
      book_v1: { label: 'Version 1 – Einzelne Beiträge', filename: 'Gedenkbuch_V1', outlineSystem: memorialV1Outline, chapterSystem: memorialV1Chapter },
      book_v2: { label: 'Version 2 – Lebensstationen', filename: 'Gedenkbuch_V2', outlineSystem: memorialV2Outline, chapterSystem: memorialV2Chapter },
    },
    finalText: {
      label: 'Trauerrede', filename: 'Trauerrede', noun: 'Trauerrede',
      styles: MEMORIAL_EULOGY_STYLES, sections: MEMORIAL_EULOGY_SECTIONS, sectionSystem: memorialEulogySection,
    },
  },

  birthday: buildGenericCategory('birthday', {
    label: 'Geburtstagsbuch', description: 'Zu einem besonderen Geburtstag – Freunde und Familie sammeln Geschichten und Glückwünsche.', nounBook: 'Geburtstagsbuch',
    v1Label: 'Version 1 – Einzelne Beiträge', v1Filename: 'Geburtstagsbuch_V1',
    v2Label: 'Version 2 – Lebensstationen', v2Filename: 'Geburtstagsbuch_V2',
    intake: {
      subjectLabel: 'Name des Geburtstagskindes *', subjectPlaceholder: 'Vollständiger Name',
      useGender: true, genderLabel: 'Geschlecht *',
      useDate: true, dateLabel: 'Tag der Feier',
      useCutoff: true, cutoffLabel: 'Tage vor der Feier, bis zu denen Beiträge erfasst werden',
      extra: [{ key: 'occasion', label: 'Welcher Geburtstag?', placeholder: 'z. B. 60. Geburtstag' }],
      createHeading: 'Neues Geburtstagsbuch anlegen',
      createIntro: 'Erstellen Sie ein Geburtstagsbuch und teilen Sie anschließend den Einladungslink.',
      createButton: 'Geburtstagsbuch anlegen →',
    },
    contributor: {
      heading: 'Ihr Beitrag', introNoun: 'Geburtstagsbuch für',
      relationshipLabel: 'Ihre Beziehung zu {name} *', relationshipPlaceholder: 'z.B. Tochter, Freund, Kollegin …',
      consentNoun: 'Geburtstagsbuchs', interviewButton: '🎙 Sprach-Interview beginnen →',
    },
  }),

  anniversary: buildGenericCategory('anniversary', {
    label: 'Hochzeitsjubiläum', description: 'Zur silbernen oder goldenen Hochzeit – Erinnerungen und Anekdoten über das Paar.', nounBook: 'Jubiläumsbuch',
    v1Label: 'Version 1 – Einzelne Beiträge', v1Filename: 'Jubilaeumsbuch_V1',
    v2Label: 'Version 2 – Festschrift', v2Filename: 'Jubilaeumsbuch_V2',
    intake: {
      subjectLabel: 'Name des Jubelpaars *', subjectPlaceholder: 'z. B. Anna & Thomas Müller',
      useGender: false,
      useDate: true, dateLabel: 'Tag der Feier',
      useCutoff: true, cutoffLabel: 'Tage vor der Feier, bis zu denen Beiträge erfasst werden',
      extra: [{ key: 'anniversaryType', label: 'Art des Jubiläums', placeholder: 'z. B. Goldene Hochzeit (50 Jahre)' }],
      createHeading: 'Neues Jubiläumsbuch anlegen',
      createIntro: 'Erstellen Sie ein Jubiläumsbuch und teilen Sie anschließend den Einladungslink.',
      createButton: 'Jubiläumsbuch anlegen →',
    },
    contributor: {
      heading: 'Ihr Beitrag', introNoun: 'Jubiläumsbuch für',
      relationshipLabel: 'Ihre Beziehung zum Paar *', relationshipPlaceholder: 'z.B. Kind, Freundin, Trauzeuge …',
      consentNoun: 'Jubiläumsbuchs', interviewButton: '🎙 Sprach-Interview beginnen →',
    },
  }),

  farewell: buildGenericCategory('farewell', {
    label: 'Abschied & Ruhestand', description: 'Abschied einer Person aus Unternehmen, Institution oder Verein – oder in den Ruhestand.', nounBook: 'Abschiedsbuch',
    v1Label: 'Version 1 – Einzelne Beiträge', v1Filename: 'Abschiedsbuch_V1',
    v2Label: 'Version 2 – Festschrift', v2Filename: 'Abschiedsbuch_V2',
    intake: {
      subjectLabel: 'Name der verabschiedeten Person *', subjectPlaceholder: 'Vollständiger Name',
      useGender: true, genderLabel: 'Geschlecht *',
      useDate: true, dateLabel: 'Tag der Verabschiedung',
      useCutoff: true, cutoffLabel: 'Tage vor der Feier, bis zu denen Beiträge erfasst werden',
      extra: [{ key: 'organization', label: 'Firma / Institution / Verein', placeholder: 'Name der Organisation' }],
      createHeading: 'Neues Abschiedsbuch anlegen',
      createIntro: 'Erstellen Sie ein Abschiedsbuch und teilen Sie anschließend den Einladungslink.',
      createButton: 'Abschiedsbuch anlegen →',
    },
    contributor: {
      heading: 'Ihr Beitrag', introNoun: 'Abschiedsbuch für',
      relationshipLabel: 'Ihre Beziehung zu {name} *', relationshipPlaceholder: 'z.B. Kollege, Vereinskamerad, Wegbegleiterin …',
      consentNoun: 'Abschiedsbuchs', interviewButton: '🎙 Sprach-Interview beginnen →',
    },
  }),

  company: buildGenericCategory('company', {
    label: 'Betriebsjubiläum', description: 'Jubiläum der Organisation selbst (Unternehmen, Institution, Verein) – Geschichten über das Haus.', nounBook: 'Jubiläumsbuch',
    v1Label: 'Version 1 – Einzelne Beiträge', v1Filename: 'Jubilaeumsbuch_V1',
    v2Label: 'Version 2 – Festschrift', v2Filename: 'Jubilaeumsbuch_V2',
    intake: {
      subjectLabel: 'Name des Unternehmens / der Institution / des Vereins *', subjectPlaceholder: 'z. B. Müller GmbH, TSV Musterstadt',
      useGender: false,
      useDate: true, dateLabel: 'Tag der Jubiläumsfeier',
      useCutoff: true, cutoffLabel: 'Tage vor der Feier, bis zu denen Beiträge erfasst werden',
      extra: [{ key: 'anniversaryType', label: 'Art des Jubiläums', placeholder: 'z. B. 50-jähriges Bestehen' }],
      createHeading: 'Neues Jubiläumsbuch anlegen',
      createIntro: 'Erstellen Sie ein Jubiläumsbuch für die Organisation und teilen Sie anschließend den Einladungslink.',
      createButton: 'Jubiläumsbuch anlegen →',
    },
    contributor: {
      heading: 'Ihr Beitrag', introNoun: 'Jubiläumsbuch für',
      relationshipLabel: 'Ihre Verbindung zu {name} *', relationshipPlaceholder: 'z.B. Mitarbeiterin, Gründer, Mitglied, Kundin …',
      consentNoun: 'Jubiläumsbuchs', interviewButton: '🎙 Sprach-Interview beginnen →',
    },
  }),

  service: buildGenericCategory('service', {
    label: 'Dienstjubiläum', description: 'Dienstjubiläum einer Person – z. B. 25 Jahre im selben Unternehmen.', nounBook: 'Jubiläumsbuch',
    v1Label: 'Version 1 – Einzelne Beiträge', v1Filename: 'Dienstjubilaeum_V1',
    v2Label: 'Version 2 – Festschrift', v2Filename: 'Dienstjubilaeum_V2',
    intake: {
      subjectLabel: 'Name der Jubilarin / des Jubilars *', subjectPlaceholder: 'Vollständiger Name',
      useGender: true, genderLabel: 'Geschlecht *',
      useDate: true, dateLabel: 'Tag der Feier',
      useCutoff: true, cutoffLabel: 'Tage vor der Feier, bis zu denen Beiträge erfasst werden',
      extra: [
        { key: 'organization', label: 'Firma / Institution / Verein', placeholder: 'Name der Organisation' },
        { key: 'years', label: 'Anzahl Dienstjahre', placeholder: 'z. B. 25 Jahre' },
      ],
      createHeading: 'Neues Buch zum Dienstjubiläum anlegen',
      createIntro: 'Erstellen Sie ein Buch zum Dienstjubiläum und teilen Sie anschließend den Einladungslink.',
      createButton: 'Buch anlegen →',
    },
    contributor: {
      heading: 'Ihr Beitrag', introNoun: 'Buch zum Dienstjubiläum für',
      relationshipLabel: 'Ihre Beziehung zu {name} *', relationshipPlaceholder: 'z.B. Kollege, Vorgesetzte, Teammitglied …',
      consentNoun: 'Buchs zum Dienstjubiläum', interviewButton: '🎙 Sprach-Interview beginnen →',
    },
  }),

  newborn: buildGenericCategory('newborn', {
    label: 'Willkommensbuch', description: 'Zur Geburt eines Kindes – Hoffnungen, Wünsche und Botschaften für das Kind.', nounBook: 'Willkommensbuch',
    v1Label: 'Version 1 – Einzelne Beiträge', v1Filename: 'Willkommensbuch_V1',
    v2Label: 'Version 2 – Nach Themen', v2Filename: 'Willkommensbuch_V2',
    intake: {
      subjectLabel: 'Name des Kindes *', subjectPlaceholder: 'Name (falls schon bekannt)',
      useGender: false,
      useDate: true, dateLabel: 'Geburtstag / errechneter Termin',
      useCutoff: false,
      extra: [{ key: 'parents', label: 'Eltern', placeholder: 'Namen der Eltern' }],
      createHeading: 'Neues Willkommensbuch anlegen',
      createIntro: 'Erstellen Sie ein Willkommensbuch und teilen Sie anschließend den Einladungslink.',
      createButton: 'Willkommensbuch anlegen →',
    },
    contributor: {
      heading: 'Ihre Wünsche', introNoun: 'Willkommensbuch für',
      relationshipLabel: 'Ihre Beziehung zur Familie *', relationshipPlaceholder: 'z.B. Oma, Onkel, Freundin der Eltern …',
      consentNoun: 'Willkommensbuchs', interviewButton: '🎙 Sprach-Interview beginnen →',
    },
  }),

  encouragement: buildGenericCategory('encouragement', {
    label: 'Mutmachbuch', description: 'Für einen Menschen in schwerer Krankheit – Ermutigung, Motivation und gemeinsame Erinnerungen.', nounBook: 'Mutmachbuch',
    v1Label: 'Version 1 – Einzelne Beiträge', v1Filename: 'Mutmachbuch_V1',
    v2Label: 'Version 2 – Nach Themen', v2Filename: 'Mutmachbuch_V2',
    intake: {
      subjectLabel: 'Name der Person *', subjectPlaceholder: 'Vollständiger Name',
      useGender: true, genderLabel: 'Geschlecht *',
      useDate: false,
      useCutoff: false,
      extra: [],
      createHeading: 'Neues Mutmachbuch anlegen',
      createIntro: 'Erstellen Sie ein Mutmachbuch und teilen Sie anschließend den Einladungslink.',
      createButton: 'Mutmachbuch anlegen →',
    },
    contributor: {
      heading: 'Ihre Botschaft', introNoun: 'Mutmachbuch für',
      relationshipLabel: 'Ihre Beziehung zu {name} *', relationshipPlaceholder: 'z.B. Schwester, Freund, Kollegin …',
      consentNoun: 'Mutmachbuchs', interviewButton: '🎙 Sprach-Interview beginnen →',
    },
  }),
}

export const CATEGORY_ORDER = ['memorial', 'birthday', 'anniversary', 'farewell', 'service', 'company', 'newborn', 'encouragement']

export function getCategory(slug) {
  return CATEGORIES[slug] || CATEGORIES[DEFAULT_CATEGORY]
}
