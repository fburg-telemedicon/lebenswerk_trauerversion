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
}

// ── Entinternalisierung ───────────────────────────────────────────
// Sammelt jede Entfernung in `weg`, damit sie im internen Dokument nachlesbar ist.
// Sätze, bei denen der Code-Verweis nicht bloß in einer Klammer steht, sondern im
// Satzbau hängt. Die allgemeine Regel zerreißt sie („Geschrieben über der Anwendung",
// „in api/ , und src/"); deshalb hier von Hand, VOR der allgemeinen Regel.
const FIXUPS = [
  [/Dauerhaftes Audit-Log in Supabase \(`audit_log`, SQL: `supabase\/audit\.sql`\),/,
   'Dauerhaftes Audit-Log in der Datenbank,'],
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
    fs.writeFileSync(p, deIntern(md, quelle, weg))
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
    `Vorhaben: ${k.umfang}.`)
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

## Zu unterschreiben

| Dokument | Wer zeichnet |
|---|---|
| Auftragsverarbeitungsvertrag_${k.kurz}.pdf | ${k.zeichnet} für ${k.name}, Prof. Dr. Gantner für Lebenswerk.AI |

Das ist **das einzige** Dokument mit Unterschrift. Art. 28 Abs. 9 DSGVO verlangt
Schrift- oder elektronische Form; beidseitig zeichnen, je ein Exemplar für beide Seiten.

## Zur Prüfung durch die/den Datenschutzbeauftragte:n

| Dokument | Inhalt |
|---|---|
| Deckblatt_${k.kurz}.pdf | Rollenverteilung, Dokumentenliste, Pflichten des Verantwortlichen, Prüfleitfaden |
| Sicherheitskonzept_TOM.pdf | Technische und organisatorische Maßnahmen (Art. 32) |
| Verzeichnis_Verarbeitungstaetigkeiten.pdf | Verarbeitungstätigkeiten, Datenflusskarte, Empfänger, Fristen (Art. 30) |
| Datenschutz-Folgenabschaetzung.pdf | Risikoregister R1–R11 (Art. 35) |
| Betriebs-Runbook_Datenschutz.pdf | Meldeprozess bei Datenpannen (Art. 33/34), laufende Kontrollen |

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

run(process.argv[2] || 'valuvita')
