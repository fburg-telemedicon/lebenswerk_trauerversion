// scripts/kundenpaket.js
// Erzeugt aus den Datenschutz-Dokumenten im Wurzelverzeichnis ein versandfertiges
// Paket für EINEN Kunden:  node scripts/kundenpaket.js valuvita
//
// Warum ein Skript und keine handgepflegten Kopien: Die Kundenfassungen dürfen sich
// nicht von den Originalen wegentwickeln. Wer ein Original ändert, lässt das Skript
// erneut laufen — dann stimmen beide wieder überein.
//
// Zwei Eingriffe gegenüber den Originalen:
//   1. Die Parteien-, Unterschrifts- und Kontaktfelder werden mit den Kundendaten
//      gefüllt.
//   2. Die INTERNEN Projekt-To-dos am Ende von VERFAHRENSVERZEICHNIS.md (Abschnitt
//      „Offene Punkte") und DSFA.md (Abschnitt „Offene To-dos") entfallen. Das sind
//      Projektnotizen, keine Aussagen über die Verarbeitung — sie gehören nicht in ein
//      Dokument, das den Verarbeitungsstand beschreibt. Die Betriebs-Checklisten in
//      BETRIEB-DSGVO.md bleiben ausdrücklich drin: Sie belegen laufende Kontrollen.

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')

const KUNDEN = {
  valuvita: {
    name:      'valuvita GmbH',
    anschrift: 'Ute-Ruhnke-Str. 2, 67125 Dannstadt-Schauernheim',
    register:  'Amtsgericht Ludwigshafen am Rhein, HRB 63660',
    vertreten: 'Manfred Hoffmann und Dr. Christoph Wagner, Geschäftsführer',
    zeichnet:  'Dr. Christoph Wagner',
    kontakt:   'info@valuvita.de · +49 6231 94035-500',
    // Rheinland-Pfalz — für den Beschwerdeweg der Bewohner in der Einwilligung.
    aufsicht:  'Der Landesbeauftragte für den Datenschutz und die Informationsfreiheit Rheinland-Pfalz',
    kurz:      'valuvita',
    umfang:    '15 Lebenswerk-Bücher',
  },
}

// Einen Markdown-Abschnitt ab seiner Überschrift bis zum Dateiende entfernen.
function cutSectionToEnd(md, heading) {
  const i = md.indexOf(heading)
  if (i === -1) { console.warn(`  ! Abschnitt nicht gefunden: ${heading}`); return md }
  return md.slice(0, i).replace(/\n*(---\s*\n*)?$/, '\n')
}

function run(key) {
  const k = KUNDEN[key]
  if (!k) { console.error(`Unbekannter Kunde: ${key}. Bekannt: ${Object.keys(KUNDEN).join(', ')}`); process.exit(1) }
  const out = path.join(ROOT, 'DSGVO_Kunden', key)
  fs.mkdirSync(out, { recursive: true })
  const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8')
  const write = (f, s) => { fs.writeFileSync(path.join(out, f), s); console.log('  ·', f) }
  const heute = new Date().toISOString().slice(0, 10)

  // ── AVV: Parteien und Unterschrift ──────────────────────────────
  let avv = read('AVV.md')
  avv = avv.replace(
    `**Auftraggeber (Verantwortlicher)**

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
  avv = avv.replace(
    `    Ort, Datum: ____________________        Ort, Datum: ____________________

    ______________________________          ______________________________
    Verantwortlicher                        Lebenswerk.AI GmbH`,
    `    Ort, Datum: ____________________        Ort, Datum: ____________________

    ______________________________          ______________________________
    ${k.zeichnet}                  Prof. Dr. med. Tobias D. Gantner
    ${k.name}${' '.repeat(Math.max(1, 30 - k.name.length))}Lebenswerk.AI GmbH`)
  write(`AVV_${key}.md`, avv)

  // ── Deckblatt ───────────────────────────────────────────────────
  let deck = read('KUNDENPAKET-DATENSCHUTZ.md')
  deck = deck.replace(
    '**Für die Prüfung durch die/den Datenschutzbeauftragte:n des Auftraggebers.**\nStand: 2026-08-02 · Anwendung: lebensgeschichten.ai · Auftragnehmerin: Lebenswerk.AI GmbH',
    `**Für die Prüfung durch die/den Datenschutzbeauftragte:n der ${k.name}.**\n` +
    `Stand: ${heute} · Anwendung: lebensgeschichten.ai · Auftragnehmerin: Lebenswerk.AI GmbH\n` +
    `Vorhaben: ${k.umfang}.`)
  deck = deck.replace(/`AVV\.md`/g, `\`AVV_${key}.md\``)
  write(`Deckblatt_${key}.md`, deck)

  // ── Einwilligung ────────────────────────────────────────────────
  let ein = read('EINWILLIGUNG_PFLEGEEINRICHTUNG.md')
  ein = ein.replace(
    `    ____________________________________________   (Name der Einrichtung)
    ____________________________________________   (Anschrift)
    ____________________________________________   (Datenschutzbeauftragte:r, Kontakt)`,
    `    ${k.name}
    ${k.anschrift}
    ____________________________________________   (Datenschutzbeauftragte:r, Kontakt)

    Haus / Einrichtung: _________________________________________`)
  ein = ein.replace(
    'Sie können sich außerdem bei einer\nDatenschutz-Aufsichtsbehörde beschweren.',
    `Sie können sich außerdem bei der zuständigen\nAufsichtsbehörde beschweren: ${k.aufsicht}.`)
  write(`Einwilligung_${key}.md`, ein)

  // ── Nachweise: unverändert bzw. ohne interne Projektnotizen ─────
  write('SICHERHEIT.md', read('SICHERHEIT.md'))
  write('BETRIEB-DSGVO.md', read('BETRIEB-DSGVO.md'))
  write('VERFAHRENSVERZEICHNIS.md', cutSectionToEnd(read('VERFAHRENSVERZEICHNIS.md'), '## 10. Offene Punkte'))
  write('DSFA.md', cutSectionToEnd(read('DSFA.md'), '## 9. Offene To-dos'))

  // ── Inhaltsverzeichnis ──────────────────────────────────────────
  write('00_LIESMICH.md', `# Datenschutz-Paket für ${k.name}

Erzeugt am ${heute} mit \`node scripts/kundenpaket.js ${key}\`.
Vorhaben: ${k.umfang}.

## Zu unterschreiben

| Datei | Was | Wer zeichnet |
|---|---|---|
| \`AVV_${key}.md\` | Auftragsverarbeitungsvertrag nach Art. 28 DSGVO samt drei Anlagen | ${k.zeichnet} für ${k.name}, Prof. Dr. Gantner für Lebenswerk.AI |

Das ist **das einzige** Dokument mit Unterschrift. Art. 28 Abs. 9 verlangt Schrift-
oder elektronische Form; beidseitig zeichnen, je ein Exemplar für beide Seiten.

## Zur Prüfung durch die/den Datenschutzbeauftragte:n

| Datei | Inhalt |
|---|---|
| \`Deckblatt_${key}.md\` | Rollenverteilung, Dokumentenliste, Pflichten des Verantwortlichen, Prüfleitfaden |
| \`SICHERHEIT.md\` | Technische und organisatorische Maßnahmen (Art. 32) |
| \`VERFAHRENSVERZEICHNIS.md\` | Verarbeitungstätigkeiten, Datenflusskarte, Empfänger, Fristen (Art. 30) |
| \`DSFA.md\` | Datenschutz-Folgenabschätzung, Risikoregister R1–R11 (Art. 35) |
| \`BETRIEB-DSGVO.md\` | Meldeprozess bei Datenpannen (Art. 33/34) und laufende Kontrollen |

## Zur Verwendung im Haus

| Datei | Inhalt |
|---|---|
| \`Einwilligung_${key}.md\` | Papier-Einwilligung der Bewohner samt Betroffeneninformation (Art. 13, Art. 9 Abs. 2 lit. a), mit Variante für gesetzliche Vertretung |

Diese Vorlage wird ausgedruckt und im Haus unterschrieben; die unterzeichneten
Erklärungen verbleiben bei ${k.kurz} und werden uns nicht übermittelt.

## Hinweise

- \`VERFAHRENSVERZEICHNIS.md\` und \`DSFA.md\` sind gegenüber unseren internen Fassungen
  um die Abschnitte mit **internen Projektnotizen** gekürzt. Inhaltlich zur
  Verarbeitung ist nichts entfernt worden.
- Ändert sich ein Original im Wurzelverzeichnis, dieses Paket mit dem Skript neu
  erzeugen, damit beide Fassungen übereinstimmen.
`)

  console.log(`\nPaket für ${k.name} liegt in DSGVO_Kunden/${key}/`)
}

run(process.argv[2] || 'valuvita')
