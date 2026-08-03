// scripts/kundenpaket.js
// Erzeugt aus den Datenschutz-Dokumenten im Wurzelverzeichnis ein versandfertiges
// Kundenpaket als PDF:  node scripts/kundenpaket.js valuvita
//
// Warum ein Skript und keine handgepflegten Kopien: Die Kundenfassungen dürfen sich
// nicht von den Originalen wegentwickeln. Wer ein Original ändert, lässt das Skript
// erneut laufen — dann stimmen beide wieder überein.
//
// DREI EINGRIFFE gegenüber den Originalen:
//   1. Parteien-, Unterschrifts- und Kontaktfelder werden mit den Kundendaten gefüllt.
//   2. Die INTERNEN Projekt-To-dos am Ende von Verfahrensverzeichnis und DSFA
//      entfallen — Projektnotizen, keine Aussagen über die Verarbeitung.
//   3. ENTINTERNALISIERUNG: Quellcode-Pfade, Dateinamen und Betriebsgeheimnisse
//      (Endpunkte, Secret-Namen, einzuspielende SQL-Skripte) fliegen raus. Sie sagen
//      einem Datenschutzbeauftragten nichts und verraten unnötig Innenleben. Was
//      entfernt wurde, sammelt das Skript in „Nur zur internen Verwendung" — dort
//      geht nichts verloren, es landet nur nicht beim Kunden.
//
// Die Betriebs-Checklisten im Runbook bleiben ausdrücklich drin: Sie belegen
// laufende Kontrollen. Nur der eine Punkt mit Endpunkt und Secret wird entschärft.

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const { legalMarkdown } = require('./legal2md')

const ROOT = path.resolve(__dirname, '..')

const KUNDEN = {
  valuvita: {
    name:      'valuvita GmbH',
    anschrift: 'Ute-Ruhnke-Str. 2, 67125 Dannstadt-Schauernheim',
    register:  'Amtsgericht Ludwigshafen am Rhein, HRB 63660',
    vertreten: 'Manfred Hoffmann und Dr. Christoph Wagner, Geschäftsführer',
    zeichnet:  'Dr. Christoph Wagner',
    kontakt:   'info@valuvita.de · +49 6231 94035-500',
    aufsicht:  'Der Landesbeauftragte für den Datenschutz und die Informationsfreiheit Rheinland-Pfalz',
    kurz:      'valuvita',
    umfang:    '15 Lebenswerk-Bücher',
    // Beauftragte Produktkategorien. `nurLebenswerk` schneidet das ganze Paket auf
    // die Selbsterzählung zu — siehe Abschnitt „Zuschnitt" weiter unten.
    nurLebenswerk: true,
  },
}

// Quelldatei → kundentauglicher Dateiname (ohne Endung). Aus `SICHERHEIT.md` wird
// kein „SICHERHEIT.pdf" — ein Kundendokument heißt nicht wie eine Repo-Datei.
const DOC = {
  'AVV.md':                            'Auftragsverarbeitungsvertrag',
  'SICHERHEIT.md':                     'Sicherheitskonzept (TOM)',
  'VERFAHRENSVERZEICHNIS.md':          'Verzeichnis der Verarbeitungstaetigkeiten',
  'DSFA.md':                           'Datenschutz-Folgenabschaetzung',
  'BETRIEB-DSGVO.md':                  'Betriebs-Runbook Datenschutz',
  'EINWILLIGUNG_PFLEGEEINRICHTUNG.md': 'Einwilligung der Bewohner',
  'KUNDENPAKET-DATENSCHUTZ.md':        'Deckblatt',
  'AGB.md':                            'Allgemeine Geschaeftsbedingungen',
}

// ── Entinternalisierung ───────────────────────────────────────────
// Sammelt jede Entfernung in `weg`, damit sie im internen Dokument nachlesbar ist.
// Sätze, bei denen der Code-Verweis nicht bloß in einer Klammer steht, sondern im
// Satzbau hängt. Die allgemeine Regel zerreißt sie („Geschrieben über der Anwendung",
// „in api/ , und src/"); deshalb hier von Hand, VOR der allgemeinen Regel.
const FIXUPS = [
  [/Dauerhaftes Audit-Log in der Datenbank \(`audit_log`\)/,
   'Dauerhaftes Audit-Log in der Datenbank'],
  [/Geschrieben über `api\/_lib\/audit\.js` \(fail-open:/,
   'Geschrieben über eine eigene Protokollfunktion (fail-open:'],
  [/\(alle ausgehenden Verbindungen in\s*\n?`api\/`, `server\.js` und `src\/`\)/,
   '(sämtliche ausgehenden Verbindungen)'],
  [/\*\*Modell-Allowlist \(`EU_RESIDENT_MODELS` in `api\/_lib\/voicelive\.js`\)\.\*\*/,
   '**Modell-Allowlist.**'],
  [/`consent_version` auf `contributions` \(Migration `supabase\/consent\.sql`\)/,
   'Fassungsnummer der Einwilligung am jeweiligen Beitrag'],
]

function deIntern(md, quelle, weg) {
  let s = md
  const merke = (was, text) => weg.push({ quelle, was, text: String(text).replace(/\s+/g, ' ').trim() })

  for (const [re, ersatz] of FIXUPS) {
    const t = s.match(re)
    if (t) { merke('Quellcode-Verweis im Satzbau', t[0]); s = s.replace(re, ersatz) }
  }

  // 1. Ganze interne Abschnitte
  const sqlIdx = s.indexOf('## Einzuspielende SQL-Skripte')
  if (sqlIdx !== -1) {
    merke('Abschnitt „Einzuspielende SQL-Skripte"', s.slice(sqlIdx))
    s = s.slice(0, sqlIdx).replace(/\n+$/, '\n')
  }

  // 2. Betriebspunkt mit Endpunkt + Secret-Name entschärfen
  s = s.replace(
    /- \[ \] Dry-Run der Löschung prüfen:[\s\S]*?erwartet\?/,
    m => { merke('Prüfschritt mit Endpunkt und Secret-Namen', m)
           return '- [ ] Löschlauf prüfen: Kommen die fälligen Buchprojekte wie erwartet in der\n      Übersicht an?' })

  // 3. Verweise auf Quelldateien. Erst Klammer-Einschübe komplett, dann Reste.
  const codeRef = /`(?:api|src|supabase|scripts)\/[^`]+`|`[A-Za-z0-9_.-]+\.(?:js|jsx|sql|sh)`/g
  s = s.replace(/\s*\(([^()]*)\)/g, (voll, innen) => {
    if (!codeRef.test(innen)) { codeRef.lastIndex = 0; return voll }
    codeRef.lastIndex = 0
    // Klammer enthält NUR Code-Verweise und Bindewörter → ganz weg.
    const rest = innen.replace(codeRef, '').replace(/[,;·]|\bund\b|\bin\b|\bangehängt\b|\bSQL:\b|\bMigration\b|\s/g, '')
    if (rest === '') { merke('Quellcode-Verweis', voll); return '' }
    // Sonst nur die Verweise herauslösen, erklärender Text bleibt stehen.
    merke('Quellcode-Verweis', innen.match(codeRef).join(', '))
    const neu = innen.replace(codeRef, '').replace(/^[\s,;·]+|[\s,;·]+$/g, '').replace(/\s{2,}/g, ' ')
    return neu ? ` (${neu})` : ''
  })
  s = s.replace(codeRef, m => { merke('Quellcode-Verweis', m); return 'der Anwendung' })

  // 4. Verweise auf unsere Dokumente → kundentaugliche Titel
  for (const [datei, titel] of Object.entries(DOC)) {
    s = s.split('`' + datei + '`').join(`„${titel}"`).split(datei).join(`„${titel}"`)
  }
  return s
}

// ── Zuschnitt auf die beauftragten Produktkategorien ──────────────
// Die Originale beschreiben die ganze Anwendung mit ihren elf Anlässen. Wer nur
// einen davon einsetzt, soll auch nur davon Unterlagen bekommen: Sonst prüft
// die/der DSB Verarbeitungen, die es in diesem Auftragsverhältnis gar nicht gibt
// — Beitragende, Verstorbene, Anamnesebögen —, und der AVV verspricht Dinge, die
// niemand bestellt hat.
//
// Der Zuschnitt arbeitet mit wörtlichen Ersetzungen statt mit Mustern. Das ist
// Absicht: Ändert sich ein Original, findet die Ersetzung ihren Text nicht mehr
// und das Skript sagt es (`! Zuschnitt`), statt still eine veraltete Fassung
// auszuliefern.
const ZUSCHNITT_HINWEIS = k => `> **Zuschnitt auf die ${k.name}.** Im Auftrag der ${k.name} wird ausschließlich die
> Produktkategorie **Lebenswerk** eingesetzt: Die erzählende Person berichtet ihr
> eigenes Leben und erhält dafür einen eigenen Zugang. Die Anwendung beherrscht
> weitere Anlässe — Gedenkbuch, Geburtstag, Jubiläum, Abschied, Geburt, Mutmachbuch,
> Anamnesebogen —, die hier **nicht beauftragt** und deshalb aus dieser Fassung
> entfernt sind. Maßgeblich für das Auftragsverhältnis ist diese Fassung.`

const nurLebenswerk = k => ({
  'Auftragsverarbeitungsvertrag': [
    [`sprachgeführten Interviews persönliche Werke entstehen — je nach Anlass eine
Lebensgeschichte („Lebenswerk"), ein Gedenkbuch, ein Buch zu Geburtstag, Jubiläum,
Abschied oder Geburt, ein Mutmachbuch, eine Rede oder ein Anamnesebogen. Der`,
     `sprachgeführten Interviews persönliche Werke entstehen. Gegenstand dieses
Vertrages ist ausschließlich die Kategorie **„Lebenswerk"**: Die erzählende Person
berichtet ihr eigenes Leben, daraus entsteht ihr Buch. Der`],

    [`**(1a) Beauftragte Kategorien.** Welche dieser Anlässe der Verantwortliche tatsächlich
einsetzt, ergibt sich aus dem Hauptvertrag. Für nicht beauftragte Anlässe entsteht
keine Verarbeitung im Auftrag.`,
     `**(1a) Beauftragte Kategorie.** Der Verantwortliche setzt ausschließlich die
Kategorie „Lebenswerk" ein. Weitere Anlässe der Anwendung — Gedenkbuch, Geburtstag,
Jubiläum, Abschied, Geburt, Mutmachbuch, Anamnesebogen — sind **nicht beauftragt**;
für sie entsteht keine Verarbeitung im Auftrag. Sämtliche Bestimmungen und Anlagen
dieses Vertrages sind auf die Kategorie „Lebenswerk" zugeschnitten. Eine Ausweitung
auf weitere Kategorien bedarf einer Weisung in Textform.`],

    [`- Erstellung der daraus abgeleiteten Werke: Buch, Gedenkbuch, Trauerrede, Anamnesebogen,
  Kapitelbilder, Stammbaum und Lebensposter,`,
     `- Erstellung des daraus abgeleiteten Werkes: das Lebenswerk-Buch samt Kapitelbildern,
  auf Wunsch zusätzlich Stammbaum, Lebensposter, Pflegeexzerpt sowie
  Betreuungsverfügung und Vorsorgevollmacht als Entwurf — **keine Rede**, die gehört
  zum Gedenkbuch,`],

    [`| Erzählende Personen | Menschen, die ihre eigene Lebensgeschichte erzählen (Kategorie „Lebenswerk") |
| Beitragende | Angehörige, Freundinnen, Weggefährten, die zu einem Gedenkbuch beitragen |
| Verstorbene | Personen, über die berichtet wird (nicht mehr von der DSGVO erfasst, aber schutzwürdig) |`,
     `| Erzählende Personen | Menschen, die ihre eigene Lebensgeschichte erzählen — die einzige Gruppe, die in dieser Kategorie ein Interview führt |`],

    [`Kategorien ab. Da Menschen frei erzählen, **können** dennoch Angaben zu Gesundheit,
Religion, Weltanschauung oder sexueller Orientierung fallen; in den Kategorien
„Anamnese" sind Gesundheitsdaten sogar der Zweck. Die Parteien behandeln solche Daten`,
     `Kategorien ab. Da Menschen frei ihr Leben erzählen, **ist** mit Angaben zu
Gesundheit, Religion, Weltanschauung oder sexueller Orientierung zu rechnen. Die
Parteien behandeln solche Daten`],

    ['| Auskunft und Datenübertragbarkeit (Art. 15, 20) | Beitragende erhalten ihre Daten als PDF-Datenauskunft |',
     '| Auskunft und Datenübertragbarkeit (Art. 15, 20) | Die erzählende Person erhält ihre Daten als PDF-Datenauskunft |'],

    [`Betrieb automatisch: **90 Tage nach Ende der Nutzungsdauer**. Die Nutzungsdauer endet
mit dem hinterlegten Anlass-Termin; ohne Anlass-Termin sechs Monate nach Anlage des
Projekts (Lizenzlaufzeit). Für Anamnese-Projekte wird der gesamte Datensatz bereits
14 Tage nach der Aufnahme gelöscht. Erfasst sind Beiträge, Aufnahmen,`,
     `Betrieb automatisch: **90 Tage nach Ende der Nutzungsdauer**. Beim Lebenswerk ist
in aller Regel kein Anlass-Termin hinterlegt; die Nutzungsdauer endet dann sechs
Monate nach Anlage des Projekts (Lizenzlaufzeit), gelöscht wird mithin rund neun
Monate nach Anlage. Erfasst sind Beiträge, Aufnahmen,`],
  ],

  'Verzeichnis der Verarbeitungstätigkeiten': [
    ['Lebensgeschichten-App. **Vom Verantwortlichen in Kraft gesetzt.**',
     'Lebensgeschichten-App, Kategorie **Lebenswerk**. **Vom Verantwortlichen in Kraft gesetzt.**'],

    [`Erstellung eines individuellen **Erinnerungs-, Lebens- oder Gedenkwerks** (Buch,
Rede bzw. Anamnesebogen) aus dem, was die erzählenden Personen berichten. **Elf
Produktkategorien**, die sich in zwei Formen teilen:

| Form | Kategorien | Wer erzählt |
|---|---|---|
| **Selbsterzählung** | Lebenswerk, Anamnesebogen (Reha), Anamnese KVSW (Krankenhausaufnahme) | die betroffene Person über sich selbst, mit eigenem Zugang |
| **Beiträge mehrerer** | Gedenken, Geburtstag, Hochzeitsjubiläum, Abschied & Ruhestand, Dienstjubiläum, Betriebsjubiläum, Geburt (Willkommensbuch), Ermutigung (Mutmachbuch) | Angehörige, Freundinnen, Kolleginnen über eine Person (bzw. beim Betriebsjubiläum über die Organisation) |

Die Unterscheidung ist datenschutzrechtlich erheblich: Bei der Selbsterzählung gibt
es keine Beitragenden-Gruppe, und der Zugangscode ist der Zugang der erzählenden
Person selbst.`,
     `Erstellung eines individuellen **Lebenswerks** — eines autobiographischen Buches
aus dem, was die erzählende Person selbst berichtet. Es ist die einzige
Produktkategorie, die im Auftrag der ${k.name} eingesetzt wird.

Das ist eine **Selbsterzählung**: Es gibt keine Gruppe von Beitragenden, die über
eine dritte Person berichtet, und der Zugangscode ist der Zugang der erzählenden
Person selbst.`],

    [`| **Beitragende** (geben das Interview) | Name, Beziehung, Geschlecht, Anrede; **Stimmaufnahme**; Interviewinhalt (Freitext); Einwilligungs-Zeitstempel + -Version | \`contributions\` |
| **Gewürdigte Person** (z. B. Verstorbene/r) | Name, Geburts-/Sterbejahr, Geschlecht, Lebensgeschichte (im Buchtext) | \`memorials\`, \`book_v1/v2\`, \`eulogy_text\` |`,
     `| **Erzählende Person** (erzählt ihr eigenes Leben) | Name, Geschlecht, Anrede, Geburtsjahr; **Stimmaufnahme**; Interviewinhalt (Freitext); Einwilligungs-Zeitstempel + -Version; die Lebensgeschichte im fertigen Buchtext | \`contributions\`, \`memorials\`, \`book_v1/v2\` |`],

    ['Beitragende/r (Browser)', 'Erzählende Person (Browser)'],

    // „Rede" gibt es beim Lebenswerk nicht — sie gehört zum Gedenkbuch.
    ['4. **Synthese** von Buch/Rede aus den gesammelten Beiträgen (LLM).',
     '4. **Synthese** des Buches aus dem Erzählten (LLM); auf Wunsch ebenso Stammbaum, Lebensposter, Pflegeexzerpt, Betreuungsverfügung und Vorsorgevollmacht.'],
    ['**Keine wissenschaftliche Nutzung.** Beiträge, Bücher und Reden werden derzeit nicht',
     '**Keine wissenschaftliche Nutzung.** Beiträge und Bücher werden derzeit nicht'],
    ['| Interviewführung + Synthese Buch/Rede | EU |',
     '| Interviewführung + Synthese des Buchtextes | EU |'],
    ['Bücher, Reden, Fotos — zwischen Shop und Anwendung besteht keine Datenverbindung;',
     'Bücher, Fotos — zwischen Shop und Anwendung besteht keine Datenverbindung;'],
    ['**Anwendung (Interview, Buch, Rede, Bilder, Speicherung): keine Drittlandübermittlung.**',
     '**Anwendung (Interview, Buch, Bilder, Speicherung): keine Drittlandübermittlung.**'],
    [`vertragliche Lizenzlaufzeit). Erhalten bleiben dann nur noch das fertige Buch/die
  Rede (ohne Interview-Rohdaten); pro Beitrag wird ein Tombstone in`,
     `vertragliche Lizenzlaufzeit). Erhalten bleibt dann nur noch das fertige Buch
  (ohne Interview-Rohdaten); pro Beitrag wird ein Tombstone in`],
  ],

  'Datenschutz-Folgenabschätzung': [
    ['Lebensgeschichten-App. **Vom Verantwortlichen durchgeführt und in Kraft gesetzt.**',
     'Lebensgeschichten-App, Kategorie **Lebenswerk**. **Vom Verantwortlichen durchgeführt und in Kraft gesetzt.**'],

    ['| Verarbeitung von Daten **schutzbedürftiger Personen** | **Ja** | Trauernde/Hinterbliebene; emotional belastende Ausnahmesituation |',
     '| Verarbeitung von Daten **schutzbedürftiger Personen** | **Ja** | Hochbetagte, teils pflegebedürftige und kognitiv eingeschränkte Menschen; Abhängigkeitsverhältnis zur Einrichtung (Art. 7 Abs. 4) |'],

    ['| Zusammenführung/Anreicherung aus mehreren Quellen | Teilweise | Mehrere Beitragende zu einer Person zu einem Werk verknüpft |',
     '| Zusammenführung/Anreicherung aus mehreren Quellen | Nein | Beim Lebenswerk erzählt eine Person über sich selbst; Beiträge Dritter werden nicht zusammengeführt |'],

    [`- **Zweck:** Erstellung eines individuellen Erinnerungs-, Lebens- oder Gedenkwerks
  (Buch, Rede bzw. Anamnesebogen); **elf Produktkategorien** in zwei Formen —
  Selbsterzählung (Lebenswerk, beide Anamnese-Kategorien) und Beiträge mehrerer
  Personen (VVT Abschnitt 2).
- **Ablauf:** Beitragende/r bzw. erzählende Person ruft per 10-stelligem Code die App
  auf → optionales Einführungsvideo (nur beim Gedenkbuch) → Sprach- oder
  Text-Interview → KI-Rückfragen → Speicherung → das Dashboard erzeugt das Werk
  (LLM) und die Kapitelbilder (FLUX), beim Lebenswerk auf Wunsch zusätzlich
  Stammbaum, Lebensposter, Pflegeexzerpt sowie Betreuungsverfügung und
  Vorsorgevollmacht als Entwurf → KI-gestützte Inhalts-/Datenschutzprüfung →
  menschliche Endfreigabe → Export (DOCX/PDF).`,
     `- **Zweck:** Erstellung eines individuellen **Lebenswerks** — eines
  autobiographischen Buches aus dem, was die erzählende Person selbst berichtet
  (VVT Abschnitt 2).
- **Ablauf:** Die erzählende Person ruft per 10-stelligem Code die App auf →
  Sprach- oder Text-Interview → KI-Rückfragen → Speicherung → die Einrichtung
  erzeugt im Dashboard das Buch (LLM) und die Kapitelbilder (FLUX), auf Wunsch
  zusätzlich Stammbaum, Lebensposter, Pflegeexzerpt sowie Betreuungsverfügung und
  Vorsorgevollmacht als Entwurf → KI-gestützte Inhalts-/Datenschutzprüfung →
  menschliche Endfreigabe → Export (DOCX/PDF). Eine Rede entsteht beim Lebenswerk
  nicht — sie gehört zum Gedenkbuch.`],

    [`- **Speicherdauer:** automatische Löschung der Beiträge **90 Tage nach Ende der
  Nutzungsdauer** (Anlass-Termin, sonst Anlage + 6 Monate Lizenzlaufzeit); Anamnese
  vollständig nach 14 Tagen; vollständige manuelle Löschung jederzeit möglich
  (VVT Abschnitt 8).`,
     `- **Speicherdauer:** automatische Löschung der Beiträge **90 Tage nach Ende der
  Nutzungsdauer**; beim Lebenswerk regelmäßig ohne Anlass-Termin, also Anlage
  + 6 Monate Lizenzlaufzeit + 90 Tage; vollständige manuelle Löschung jederzeit
  möglich (VVT Abschnitt 8).`],

    ['(90 Tage nach Ende der Nutzungsdauer; Anamnese 14 Tage vollständig) + Housekeeping',
     '(90 Tage nach Ende der Nutzungsdauer) + Housekeeping'],

    ['| **Speicherbegrenzung** | Automatische Löschung der Interview-Rohdaten nach Frist; Buch/Rede bleibt ohne Rohdaten erhalten',
     '| **Speicherbegrenzung** | Automatische Löschung der Interview-Rohdaten nach Frist; das Buch bleibt ohne Rohdaten erhalten'],

    [`- **R6 (Daten Dritter):** Beitragende können lebende Hinterbliebene namentlich/mit
  Anschrift erwähnen, ohne dass diese selbst eingewilligt haben.`,
     `- **R6 (Daten Dritter):** Wer sein Leben erzählt, nennt andere Menschen —
  Angehörige, frühere Kolleginnen, mitunter Mitbewohner oder Pflegekräfte —, ohne
  dass diese selbst eingewilligt haben.`],
  ],

  'Betriebs-Runbook Datenschutz': [
    [`  **90 Tage nach Ende der Nutzungsdauer** — Nutzungsdauer = \`funeral_date\`, sonst
  \`created_at\` + \`LICENSE_MONTHS\` (6). Anamnese-Projekte werden 14 Tage nach der
  Anlage vollständig gelöscht (Beiträge, Kosten-Events, Storage-Bilder, Zeile).`,
     `  **90 Tage nach Ende der Nutzungsdauer** — beim Lebenswerk ohne Anlass-Termin
  also \`created_at\` + \`LICENSE_MONTHS\` (6) + 90 Tage.`],
  ],
})

// Die Rechtstexte (AGB, Datenschutzerklärung, Impressum) werden NICHT zugeschnitten:
// Sie sind unsere veröffentlichten Fassungen und gelten für alle Anlässe. Eine
// gekürzte Fassung wäre keine Kopie mehr, sondern eine zweite Wahrheit.
const OHNE_ZUSCHNITT = ['Allgemeine Geschäftsbedingungen', 'Datenschutzerklärung', 'Impressum', 'Inhaltsverzeichnis', 'Deckblatt', 'Einwilligung der Bewohner']

function zuschneiden(md, quelle, k) {
  if (!k.nurLebenswerk || OHNE_ZUSCHNITT.includes(quelle)) return md
  let s = md
  for (const [alt, neu] of (nurLebenswerk(k)[quelle] || [])) {
    if (!s.includes(alt)) { console.warn(`  ! Zuschnitt greift nicht mehr in „${quelle}": ${alt.split('\n')[0].slice(0, 60)}…`); continue }
    s = s.split(alt).join(neu)
  }
  // Hinweis direkt hinter den Kopf, vor die erste Trennlinie.
  const i = s.indexOf('\n---\n')
  return i === -1 ? `${ZUSCHNITT_HINWEIS(k)}\n\n${s}` : `${s.slice(0, i + 1)}\n${ZUSCHNITT_HINWEIS(k)}\n${s.slice(i)}`
}

function cutSectionToEnd(md, heading) {
  const i = md.indexOf(heading)
  if (i === -1) { console.warn(`  ! Abschnitt nicht gefunden: ${heading}`); return md }
  return md.slice(0, i).replace(/\n*(---\s*\n*)?$/, '\n')
}

function run(key) {
  const k = KUNDEN[key]
  if (!k) { console.error(`Unbekannter Kunde: ${key}. Bekannt: ${Object.keys(KUNDEN).join(', ')}`); process.exit(1) }
  const out = path.join(ROOT, 'DSGVO_Kunden', key)
  const intern = path.join(ROOT, 'DSGVO_Kunden', '_intern')
  fs.mkdirSync(out, { recursive: true }); fs.mkdirSync(intern, { recursive: true })
  const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8')
  const heute = new Date().toISOString().slice(0, 10)
  const weg = []
  const dateien = []
  const schreibe = (basename, md, quelle) => {
    const p = path.join(out, basename + '.md')
    fs.writeFileSync(p, deIntern(zuschneiden(md, quelle, k), quelle, weg))
    dateien.push(basename)
  }

  // ── AVV ─────────────────────────────────────────────────────────
  let avv = read('AVV.md')
    .replace(`**Auftraggeber (Verantwortlicher)**

    Firma:      ______________________________________________
    Anschrift:  ______________________________________________
    Vertreten:  ______________________________________________
    Kontakt:    ______________________________________________`,
      `**Auftraggeber (Verantwortlicher)**

    Firma:      ${k.name}
    Anschrift:  ${k.anschrift}
    Register:   ${k.register}
    Vertreten:  ${k.vertreten}
    Kontakt:    ${k.kontakt}
    Datenschutzbeauftragte:r: ______________________________________`)
    .replace(`    ______________________________          ______________________________
    Verantwortlicher                        Lebenswerk.AI GmbH`,
      `    ______________________________          ______________________________
    ${k.zeichnet}
    ${k.name}                          Prof. Dr. med. Tobias D. Gantner
                                            Lebenswerk.AI GmbH`)
  schreibe(`Auftragsverarbeitungsvertrag_${k.kurz}`, avv, 'Auftragsverarbeitungsvertrag')

  // ── Deckblatt ───────────────────────────────────────────────────
  let deck = read('KUNDENPAKET-DATENSCHUTZ.md').replace(
    '**Für die Prüfung durch die/den Datenschutzbeauftragte:n des Auftraggebers.**\nStand: 2026-08-02 · Anwendung: lebensgeschichten.ai · Auftragnehmerin: Lebenswerk.AI GmbH',
    `**Für die Prüfung durch die/den Datenschutzbeauftragte:n der ${k.name}.**\n` +
    `Stand: ${heute} · Anwendung: lebensgeschichten.ai · Auftragnehmerin: Lebenswerk.AI GmbH\n` +
    `Vorhaben: ${k.umfang}.` +
    (k.nurLebenswerk
      ? `\n\n> **Eine Produktkategorie.** Eingesetzt wird ausschließlich das **Lebenswerk**:
> Die Bewohnerin oder der Bewohner erzählt das eigene Leben und hat dafür einen
> eigenen Zugang. Es gibt in dieser Kategorie **keine Gruppe von Beitragenden**, die
> über eine dritte Person berichtet. Die Nachweisdokumente in diesem Paket sind
> darauf zugeschnitten; nicht beauftragte Anlässe der Anwendung — Gedenkbuch,
> Jubiläum, Anamnesebogen und die übrigen — kommen darin nicht mehr vor. Nur die
> drei Rechtstexte am Ende (AGB, Datenschutzerklärung, Impressum) sind unverändert:
> Sie sind unsere veröffentlichten Fassungen und gelten für alle Anlässe.`
      : ''))
  // „Sie" ist im Deckblatt an einer Stelle nicht eindeutig — der Absatz spricht in
  // einem Satz über uns und über den Auftraggeber. In der Kundenfassung steht
  // deshalb der Firmenname, nicht das Fürwort.
  deck = deck.replace(
    `Angebot, bei dem wir Verantwortliche sind — etwa gegenüber Besucherinnen unserer
Website und Kundinnen unseres Shops. Für die Bücher **Ihrer** Endkundinnen und
Endkunden sind **Sie** Verantwortliche; dort gilt die Betroffeneninformation in
Teil A der beiliegenden Einwilligungsvorlage.`,
    `Angebot der Lebenswerk.AI GmbH, bei dem **die Lebenswerk.AI GmbH** Verantwortliche
ist — etwa gegenüber Besucherinnen unserer Website und Kundinnen unseres Shops.
Für die Bücher der Bewohnerinnen und Bewohner der ${k.name} ist dagegen
**die ${k.name} Verantwortliche** und die Lebenswerk.AI GmbH Auftragsverarbeiterin;
dort gilt die Betroffeneninformation in Teil A der beiliegenden Einwilligungsvorlage.`)
  schreibe(`Deckblatt_${k.kurz}`, deck, 'Deckblatt')

  // ── Einwilligung ────────────────────────────────────────────────
  let ein = read('EINWILLIGUNG_PFLEGEEINRICHTUNG.md')
    .replace(`    ____________________________________________   (Name der Einrichtung)
    ____________________________________________   (Anschrift)
    ____________________________________________   (Datenschutzbeauftragte:r, Kontakt)`,
      `    ${k.name}
    ${k.anschrift}
    ____________________________________________   (Datenschutzbeauftragte:r, Kontakt)

    Haus / Einrichtung: _________________________________________`)
    .replace('Sie können sich außerdem bei einer\nDatenschutz-Aufsichtsbehörde beschweren.',
      `Sie können sich außerdem bei der zuständigen\nAufsichtsbehörde beschweren: ${k.aufsicht}.`)
  schreibe(`Einwilligung_${k.kurz}`, ein, 'Einwilligung der Bewohner')

  // ── Vertrags- und Rechtstexte ───────────────────────────────────
  schreibe('AGB', read('AGB.md'), 'Allgemeine Geschäftsbedingungen')
  // Datenschutzerklärung und Impressum werden AUS DEM QUELLTEXT erzeugt, nicht aus
  // einer zweiten gepflegten Fassung — sonst driftet das Kundenexemplar von dem ab,
  // was Betroffene tatsächlich zu sehen bekommen. Genau das war schon einmal der
  // Fall (eine Fassung von Mai 2026 nannte noch Supabase und Vercel).
  const einordnung = `> **Für wen diese Erklärung gilt.** Sie beschreibt unser eigenes Angebot, bei dem
> die Lebenswerk.AI GmbH Verantwortliche ist — Website, Shop, eigene Kundschaft.
> **Für die Werke der Endkundinnen und Endkunden der ${k.name} ist die ${k.name}
> Verantwortliche**; dort gilt die Betroffeneninformation in Teil A der
> Einwilligungsvorlage. Beigelegt, damit sich prüfen lässt, ob unsere öffentliche
> Erklärung zu den Zusagen des Auftragsverarbeitungsvertrags passt.`
  schreibe('Datenschutzerklaerung', legalMarkdown('Datenschutz', einordnung), 'Datenschutzerklärung')
  schreibe('Impressum', legalMarkdown('Impressum'), 'Impressum')

  // ── Nachweise ───────────────────────────────────────────────────
  schreibe('Sicherheitskonzept_TOM', read('SICHERHEIT.md'), 'Sicherheitskonzept (TOM)')
  schreibe('Betriebs-Runbook_Datenschutz', read('BETRIEB-DSGVO.md'), 'Betriebs-Runbook Datenschutz')
  schreibe('Verzeichnis_Verarbeitungstaetigkeiten',
    cutSectionToEnd(read('VERFAHRENSVERZEICHNIS.md'), '## 10. Offene Punkte'), 'Verzeichnis der Verarbeitungstätigkeiten')
  schreibe('Datenschutz-Folgenabschaetzung',
    cutSectionToEnd(read('DSFA.md'), '## 9. Offene To-dos'), 'Datenschutz-Folgenabschätzung')

  // ── Inhaltsverzeichnis ──────────────────────────────────────────
  schreibe('00_Inhalt', `# Datenschutz-Paket für ${k.name}

Stand ${heute}. Vorhaben: ${k.umfang}.
${k.nurLebenswerk ? `
**Produktkategorie: ausschließlich Lebenswerk.** Die erzählende Person berichtet ihr
eigenes Leben. Vertrag und Nachweisdokumente sind darauf zugeschnitten — nicht
beauftragte Anlässe der Anwendung kommen darin nicht vor. Unverändert bleiben die
drei Rechtstexte (AGB, Datenschutzerklärung, Impressum): Sie sind die
veröffentlichten Fassungen und gelten für alle Anlässe.
` : ''}
## Zu unterschreiben

| Dokument | Wer zeichnet |
|---|---|
| Auftragsverarbeitungsvertrag_${k.kurz}.pdf | ${k.zeichnet} für ${k.name}, Prof. Dr. med. Tobias D. Gantner für Lebenswerk.AI |

Das ist **das einzige** Dokument mit Unterschrift. Art. 28 Abs. 9 DSGVO verlangt
Schrift- oder elektronische Form; beidseitig zeichnen, je ein Exemplar für beide Seiten.

## Zur Prüfung durch die/den Datenschutzbeauftragte:n

| Dokument | Inhalt |
|---|---|
| Deckblatt_${k.kurz}.pdf | Rollenverteilung, Dokumentenliste, Pflichten des Verantwortlichen, Prüfleitfaden |
| Sicherheitskonzept_TOM.pdf | Technische und organisatorische Maßnahmen (Art. 32) |
| Verzeichnis_Verarbeitungstaetigkeiten.pdf | Verarbeitungstätigkeiten, Datenflusskarte, Empfänger, Fristen (Art. 30) |
| Datenschutz-Folgenabschaetzung.pdf | Risikoregister R1–R12 (Art. 35) |
| Betriebs-Runbook_Datenschutz.pdf | Meldeprozess bei Datenpannen (Art. 33/34), laufende Kontrollen |
| Datenschutzerklaerung.pdf | Die öffentliche Erklärung der Anwendung, unverändert aus dem Quelltext erzeugt |
| Impressum.pdf | Anbieterkennzeichnung, Haftungsausschlüsse |

Datenschutzerklärung und Impressum beschreiben das **eigene Angebot der
Lebenswerk.AI GmbH**, bei dem die Lebenswerk.AI GmbH Verantwortliche ist. Für die
Werke der Bewohnerinnen und Bewohner der ${k.name} ist dagegen **die ${k.name}
Verantwortliche**; dort gilt die Betroffeneninformation in Teil A der
Einwilligungsvorlage. Beide Texte liegen bei, damit sich prüfen lässt, ob unsere
öffentliche Erklärung zu den Zusagen des Auftragsverarbeitungsvertrags passt.

## Vertragsgrundlage

| Dokument | Inhalt |
|---|---|
| AGB.pdf | Leistungsumfang, **Nutzungsdauer sechs Monate ab Lizenzerwerb**, Fristen und Löschung, Mitwirkung, Rechte am Werk, Haftung; mit Widerrufsbelehrung und Muster-Widerrufsformular für Verbraucher |

Die Widerrufsbelehrung betrifft **Verbraucherinnen und Verbraucher**; für Verträge
mit der ${k.name} als Unternehmen gilt sie nicht.

## Zur Verwendung im Haus

| Dokument | Inhalt |
|---|---|
| Einwilligung_${k.kurz}.pdf | Einwilligung der Bewohner samt Betroffeneninformation (Art. 13, Art. 9 Abs. 2 lit. a), mit Variante für gesetzliche Vertretung |

Diese Vorlage wird ausgedruckt und im Haus unterschrieben; die unterzeichneten
Erklärungen verbleiben bei ${k.kurz} und werden uns nicht übermittelt.

## Rückfragen

Fachliche wie technische Rückfragen an **support@lebensgeschichten.ai**; wir antworten
schriftlich, in der Regel innerhalb eines Werktages.
`, 'Inhaltsverzeichnis')

  // ── PDFs erzeugen, Markdown wieder entfernen ────────────────────
  const mds = dateien.map(d => path.join(out, d + '.md'))
  execFileSync(process.execPath, [path.join(__dirname, 'md2pdf.js'), ...mds], { stdio: 'inherit' })
  // Das Markdown ist nur Zwischenstufe und wird entfernt — sonst liegen zwei
  // Fassungen desselben Dokuments beim Kunden. `KEEP_MD=1` behält es, um nach einer
  // Änderung nachlesen zu können, was die Entinternalisierung wirklich gemacht hat
  // (im PDF ist der Text wegen der Font-Untermenge nicht durchsuchbar).
  if (!process.env.KEEP_MD) for (const m of mds) fs.unlinkSync(m)

  // ── Was herausgenommen wurde ────────────────────────────────────
  const proQuelle = {}
  for (const w of weg) (proQuelle[w.quelle] ||= []).push(w)
  const internMd = `# Nur zur internen Verwendung

Herausgenommen aus dem Kundenpaket **${k.name}**, erzeugt am ${heute}.

Diese Angaben stehen in den internen Fassungen im Projektverzeichnis weiterhin
vollständig. Sie wurden aus den Kundendokumenten entfernt, weil sie einer/einem
Datenschutzbeauftragten nichts sagen und unnötig Innenleben preisgeben — Quellcode-
Pfade, Namen von Endpunkten und Zugangsgeheimnissen, Betriebsanweisungen.

**${weg.length} Stellen** in ${Object.keys(proQuelle).length} Dokumenten.

${Object.entries(proQuelle).map(([q, items]) => `## ${q}

| Art | Entfernter Inhalt |
|---|---|
${items.map(i => `| ${i.was} | \`${i.text.slice(0, 300).replace(/\|/g, '\\|')}\` |`).join('\n')}
`).join('\n')}
## Hinweis

Diese Datei liegt bewusst **außerhalb** des Kundenordners
(\`DSGVO_Kunden/_intern/\`), damit sie beim Versand nicht versehentlich mitgeht.
`
  const internMdPath = path.join(intern, 'Nur zur internen Verwendung.md')
  fs.writeFileSync(internMdPath, internMd)
  execFileSync(process.execPath, [path.join(__dirname, 'md2pdf.js'), internMdPath], { stdio: 'inherit' })
  fs.unlinkSync(internMdPath)

  console.log(`\nKundenpaket: DSGVO_Kunden/${key}/  (${dateien.length} PDFs)`)
  console.log(`Intern:      DSGVO_Kunden/_intern/Nur zur internen Verwendung.pdf  (${weg.length} Stellen)`)
}

// Nur als Werkzeug laufen lassen. Ohne diese Bedingung baut schon ein `require`
// dieser Datei das ganze Paket neu — beim Syntaxcheck einmal passiert.
if (require.main === module) run(process.argv[2] || 'valuvita')

module.exports = { run, deIntern, KUNDEN }
