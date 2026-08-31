// scripts/funktionsuebersicht.js
// Interne Funktionsübersicht als A4-PDF — die vollständige Liste dessen, was das
// Produkt kann. Gegenstück zur Kundenfassung, aber ohne Werbetexte und ohne
// Bedienanleitung; Machart (Farben, Zweispalten-Satz) ist dieselbe.
//
//   node scripts/funktionsuebersicht.js [ausgabe.pdf]
//
// PFLEGE: Neue Funktionen als Eintrag [Titel, Beschreibung, neu?] in den passenden
// block() eintragen. Das dritte Feld setzt die rote NEU-Marke — sie bezieht sich
// auf STAND_SEIT. Beim nächsten Stichtag STAND/STAND_SEIT hochsetzen und die dann
// nicht mehr neuen Marken (drittes Feld) entfernen.
//
// Das Logo ist dunkle Schrift auf hellem Grund, deshalb weisser Kopf statt eines
// dunklen Balkens. Läuft im Repo-Verzeichnis (braucht public/ und node_modules/).
const fs = require('fs')
const path = require('path')
const { jsPDF } = require('jspdf')

const OUT = process.argv[2] || 'Funktionsuebersicht_intern.pdf'
const STAND = '23. August 2026'       // Datum in Fusszeile und Kopf
const STAND_SEIT = '1. August 2026'   // worauf sich die NEU-Marken beziehen
const W = 210, H = 297
const ML = 15, MR = 15
const CW = W - ML - MR

const INK = [28, 25, 23]
const MUTED = [120, 113, 108]
const LINE = [231, 229, 228]
const RED = [193, 39, 45]

const doc = new jsPDF({ unit: 'mm', format: 'a4' })
let y = 0
let seite = 0

const setInk = (c) => doc.setTextColor(c[0], c[1], c[2])
const setFill = (c) => doc.setFillColor(c[0], c[1], c[2])
const setDraw = (c) => doc.setDrawColor(c[0], c[1], c[2])

// Kopf: Logo links, Titel rechts. Das Logo ist dunkle Schrift auf hellem Grund —
// deshalb ein weisser Kopf statt des dunklen Balkens der Kundenfassung.
function kopf(unter) {
  const logo = fs.readFileSync(path.join('public', 'logo-lebensgeschichten.png'))
  const lw = 46, lh = lw * 140 / 890
  doc.addImage(logo, 'PNG', ML, 12, lw, lh)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13); setInk(INK)
  doc.text('Funktionsübersicht (intern)', W - MR, 16, { align: 'right' })
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); setInk(MUTED)
  doc.text(unter, W - MR, 21, { align: 'right' })
  setFill(RED); doc.rect(ML, 26, CW, 0.9, 'F')
  y = 34
}

function fuss() {
  setDraw(LINE); doc.setLineWidth(0.3); doc.line(ML, H - 14, W - MR, H - 14)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7); setInk(MUTED)
  doc.text(`lebensgeschichten.ai · Funktionsübersicht (intern) · Stand ${STAND}`, ML, H - 10)
  doc.text(String(seite), W - MR, H - 10, { align: 'right' })
}

function neueSeite(unter) {
  if (seite) { fuss(); doc.addPage() }
  seite += 1
  kopf(unter)
}

// NEU-Marke. Liefert die Breite zurück, damit der Aufrufer weiterrücken kann.
function marke(x, oben, gross) {
  const b = gross ? 9.6 : 8.4
  const h = gross ? 4 : 3.4
  setFill(RED); doc.roundedRect(x, oben, b, h, 0.8, 0.8, 'F')
  doc.setFont('helvetica', 'bold'); doc.setFontSize(gross ? 6 : 5.6); doc.setTextColor(255, 255, 255)
  doc.text('NEU', x + b / 2, oben + h - 1.1, { align: 'center' })
  return b + 2.5
}

function abschnitt(label, notiz, istNeu) {
  // Breite IN der Schrift messen, in der auch gesetzt wird — sonst überlappen
  // Überschrift und Zusatz.
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); setInk(INK)
  const breite = doc.getTextWidth(label)
  doc.text(label, ML, y)
  let x = ML + breite + 3
  if (istNeu) x += marke(x, y - 3, true)
  if (notiz) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.6); setInk(MUTED)
    doc.text(notiz, x, y)
  }
  y += 2
  setDraw(LINE); doc.setLineWidth(0.3); doc.line(ML, y, W - MR, y)
  y += 5
}

const spaltenBreite = () => (CW - 7) / 2

// Höhe je Eintrag — Grundlage für Spaltenaufteilung UND Umbruchentscheidung.
function hoehen(items) {
  const w = spaltenBreite()
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.6)
  return items.map(it => 3.6 + doc.splitTextToSize(it[1], w - 4).length * 3.1 + 2.6)
}

// Zweispaltige Liste. Eintrag: [Titel, Beschreibung, neu?]
// Setzt so viele Eintraege, wie auf die Seite passen, und laeuft dann weiter.
function liste(items, label) {
  let rest = items
  let fortsetzung = false
  while (rest.length) {
    // Auf der Folgeseite die Zugehoerigkeit wiederholen - sonst stehen dort
    // Eintraege ohne erkennbare Ueberschrift.
    if (fortsetzung && label) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8.6); setInk(MUTED)
      doc.text(`${label} (Fortsetzung)`, ML, y)
      y += 1.6
      setDraw(LINE); doc.setLineWidth(0.3); doc.line(ML, y, W - MR, y)
      y += 4.6
      fortsetzung = false
    }
    const h = hoehen(rest)
    const frei = (H - 20) - y
    // Groesster Anfang der Liste, dessen ausgewogene Hoehe noch hinpasst.
    let anzahl = rest.length
    while (anzahl > 0 && teilHoehe(h.slice(0, anzahl)) > frei) anzahl -= 1
    if (anzahl === 0) { neueSeite('Fortsetzung'); continue }
    zeichne(rest.slice(0, anzahl))
    rest = rest.slice(anzahl)
    if (rest.length) { neueSeite('Fortsetzung'); fortsetzung = true }
  }
}

// Hoehe der hoeheren Spalte, wenn diese Eintraege ausgewogen verteilt werden.
function teilHoehe(h) {
  const t = teiler(h)
  const links = h.slice(0, t).reduce((a, b) => a + b, 0)
  const rechts = h.slice(t).reduce((a, b) => a + b, 0)
  return Math.max(links, rechts) + 1.5
}

// An welcher Stelle wird umgebrochen, damit beide Spalten etwa gleich hoch sind?
function teiler(h) {
  const halb = h.reduce((a, b) => a + b, 0) / 2
  let lauf = 0
  for (let i = 0; i < h.length; i++) {
    if (lauf + h[i] / 2 >= halb) return i
    lauf += h[i]
  }
  return h.length
}

function zeichne(items) {
  const w = spaltenBreite()
  const t = teiler(hoehen(items))
  const spalten = [items.slice(0, t), items.slice(t)]
  const startY = y
  let maxY = y
  spalten.forEach((spalte, si) => {
    const x = ML + si * (w + 7)
    let cy = startY
    for (const it of spalte) {
      setFill(RED); doc.circle(x + 1, cy - 1.2, 0.8, 'F')
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8.3); setInk(INK)
      doc.text(it[0], x + 4, cy)
      if (it[2]) marke(x + 4 + doc.getTextWidth(it[0]) + 2, cy - 2.6, false)
      cy += 3.6
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.6); setInk(MUTED)
      for (const l of doc.splitTextToSize(it[1], w - 4)) { doc.text(l, x + 4, cy); cy += 3.1 }
      cy += 2.6
    }
    maxY = Math.max(maxY, cy)
  })
  y = maxY + 1.5
}

// Überschrift und Liste gehören zusammen: Passt beides nicht mehr aufs Blatt,
// wandert der ganze Block auf die nächste Seite — sonst stünde die Überschrift
// allein am Fuss.
function block(label, notiz, items, istNeu) {
  // Nur verhindern, dass eine Ueberschrift allein am Fuss steht - fuer den Rest
  // sorgt liste() selbst, indem sie ueber den Seitenwechsel weiterlaeuft.
  if (y + 26 > H - 20) neueSeite('Fortsetzung')
  abschnitt(label, notiz, istNeu)
  liste(items, label)
}

neueSeite(`Vollständige Funktionsliste · NEU = seit ${STAND_SEIT}`)

block('Produktkategorien', '— elf Anlässe, je eigene Prompts, Formulierungen und Endprodukte', [
  ['Lebenswerk', 'Autobiographie. Eine Person erzählt über sich selbst; der Buchcode ist zugleich ihr Zugang.'],
  ['Anamnese (Reha) und Anamnese KVSW', 'Patientenselbstauskunft mit strukturiertem Bogen statt Buch. Eigene Mandanten-Variante KVSW.'],
  ['Gedenkbuch', 'Trauerversion: viele Angehörige erzählen über eine verstorbene Person.'],
  ['Geburtstag, Hochzeitsjubiläum, Abschied', 'Beitragskategorien mit eigenem Wortlaut und eigener Festrede.'],
  ['Dienstjubiläum, Firmenjubiläum', 'Anlässe im beruflichen Umfeld, inkl. Festrede zum Vortragen.'],
  ['Geburt, Mutmachbuch', 'Willkommensbuch für ein Kind und Zuspruch für eine Person in schwerer Lage.'],
])

block('Interview und Aufnahme', '', [
  ['Sprach-Interview', 'Die KI stellt die Fragen, liest sie vor, hört zu und schreibt mit. Das Gesagte ist die einzige Quelle des Buchs.'],
  ['Vier Mikrofon-Modi', 'Antippen · automatisch nach Sprechpause · Mischform · durchgehendes Live-Sprachgespräch (Azure Voice Live, Sweden Central).'],
  ['Begleitperson-Modus', 'Eine zweite Person führt mit. Ihre Beiträge werden getrennt gekennzeichnet und im Bogen als Fremdanamnese ausgewiesen.'],
  ['Fragenkatalog', 'Feste Kataloge (Lebenswerk: 12 Kapitel à 10 Fragen) mit Fortschrittsanzeige und Positionsmarkern; eigene Kataloge anlegbar. Trauerbuch fragt frei.'],
  ['Zusatzfragen zum Schluss', 'Vier Themenblöcke (Musik, Lieblingsspeisen, Sprichwörter, Zeitgeschehen mit 17 Ereignissen) plus eigene Fragen. Antworten landen als Kasten am Kapitelende, nicht im Fließtext.', true],
  ['Nachfrage-Tiefe', 'Wenig, ausgewogen oder intensiv — von der erzählenden Person im Menü umschaltbar.'],
  ['Gastbeiträge', 'Zweiter Link für Angehörige, die ÜBER die Person erzählen. Freigabe je Beitrag; erscheinen als abgesetzte Stimmen-Kästen.'],
  ['Unterbrechen und fortsetzen', 'Sitzung pausieren, Fortsetzungslink per E-Mail, Weitererzählen auf einem anderen Gerät. Sitzung liegt lokal und in der Datenbank.'],
  ['Transkript sichtbar', 'Mitschrift während des Interviews einblendbar; letzte Antwort löschbar oder neu aufnehmbar.'],
  ['Zeitlimit und Freischaltcode', 'Interviewzeit begrenzbar (Vorführbetrieb); ein Freischaltcode hebt das Limit dauerhaft auf.'],
  ['Foto-Upload', 'Eigene Fotos werden Kapiteln zugeordnet und als gesetzte Doppelseite mit Bildunterschrift gedruckt, statt eines KI-Bildes.'],
  ['Einwilligung nach Art. 9 DSGVO', 'Ausdrückliche Einwilligung vor dem ersten Wort, inkl. besonderer Datenkategorien; Hinweis auf die Namensnennung im Buch.'],
])

block('Sprachen', '— 14 Sprachen in Interview, Vorlesestimme, Oberfläche und Endprodukt', [
  ['Sprachliste', 'Deutsch, Schweizerdeutsch, Englisch, Spanisch, Baskisch, Französisch, Italienisch, Polnisch, Rumänisch, Türkisch, Russisch, Ukrainisch, Hebräisch, Arabisch.'],
  ['Vollständige Oberfläche', 'Alle Bedientexte, alle elf Kategorien und der Probedruck liegen in allen Sprachen vor; kein stiller Rückfall auf Deutsch mehr.', true],
  ['Rechts-nach-links', 'Hebräisch und Arabisch mit gespiegelter Oberfläche. Druck-PDF dort gesperrt (keine Ligaturenbildung), Word-Datei funktioniert.'],
  ['Schweizerdeutsch', 'Mundart wird verstanden, geschrieben wird Schweizer Hochdeutsch ohne Eszett; eigene Stimme und eigene Spracherkennung.'],
  ['Schweizerdeutsch → Hochdeutsch', 'Gemischte Variante zur Wahl: Der Mensch spricht Mundart, die KI antwortet in normalem Hochdeutsch — mit deutscher Vorlesestimme und deutschem Buchtext. Die Mundart betrifft nur die Spracherkennung.', true],
  ['Stimme je Sprache', 'Passende Neural-Stimme je Sprache, für sieben Sprachen dieselbe Stimme wie im Deutschen (durchgehende Sprecheridentität).'],
  ['Buchsprache getrennt', 'Interviewsprache und Zielsprache des Buchs sind unabhängig; die Zielsprache wird beim Erzeugen abgefragt.'],
])

block('Buchtext und Bilder', '', [
  ['Zwei Buchfassungen', 'Variante 1: jede Person ein eigenes Kapitel mit Namen. Variante 2: alle Beiträge thematisch zu Lebensstationen verwoben.'],
  ['Kapitelbild', 'Je Kapitel ein Bild (FLUX.2 pro, 1536 × 1024), im Druck als Doppelseite vor dem Kapitel.'],
  ['Fünf Bildstile', 'Fotorealistisch, Aquarell, Bleistift, Ölgemälde, Nostalgisch — je Buch wählbar.'],
  ['Personenähnlichkeit', 'Optional dient ein hochgeladenes Foto als Vorlage, damit abgebildete Menschen der Wirklichkeit ähneln und in die Zeit des Kapitels versetzt werden.'],
  ['Drei Buchlayouts', 'Klassisch, Modern, Elegant — wirken auf Word-Datei, Druck-PDF, E-Book und Umschlag gleichermaßen.'],
  ['Drei Schreibstile', 'An den Erzählstil angepasst, literarisch-warm, heiter-anekdotisch (nur Lebenswerk).'],
  ['Wiederholungsprüfung', 'Findet ohne KI wortgleiche Passagen und fehlplatzierte Motive über Kapitel hinweg und räumt sie vor der Bilderzeugung aus.', true],
  ['Kapitellänge nach Stoff', 'Das Wortbudget richtet sich nach dem Material, das dem einzelnen Kapitel gehört, statt nach einem gleichmäßigen Durchschnitt.', true],
  ['Motiv-Zuweisung', 'Jede Anekdote, jedes Zitat und jedes wiederkehrende Detail gehört genau einem Kapitel; alle anderen bekommen es als Tabu-Liste.', true],
  ['Inhaltsprüfung', 'KI-Prüfung gegen das Rohmaterial mit Befundliste; Einzelbefunde direkt im Text korrigierbar.'],
  ['Nachbearbeitung', 'Kapiteltexte bearbeiten, einzelne Bilder neu erzeugen, Fotos anders zuordnen, Bildausschnitt wählen.'],
  ['Serverseitige Erzeugung', 'Text- und Bildphase laufen als Auftrag mit Zeitbudget und Wiederaufnahme; der Browser darf geschlossen werden.'],
])

block('Ausgabe und Druck', '', [
  ['Word-Datei', 'Vollständiges Buch mit Bildern zum Weiterbearbeiten beim Kunden.'],
  ['Druck-PDF', '154 × 216 mm mit Beschnitt und Bundzugabe, Leerseiten nach Drucklogik.'],
  ['E-Book-PDF', 'Ohne Drucklogik: keine Leerseiten, Kapiteltext folgt direkt auf das Kapitelbild.'],
  ['Umschlag', 'Mit aus der Seitenzahl berechneter Rückenstärke; Logo auf Rücken und Rückseite abschaltbar.'],
  ['Schriften eingebettet', 'Alle PDFs betten Liberation Serif/Sans als Teilmenge ein, mit vorgeschriebener Kennzeichnung. Eine Sicherung meldet fehlende Einbettung beim Erzeugen.', true],
  ['Abgelegte PDFs', 'Druckdaten können auf dem Server liegen; die Buchkarte zeigt dann einen kurzen Dauer-Link zum Weitergeben.'],
  ['Übersetzter Export', 'Pflegeexzerpt und Rede lassen sich beim Herunterladen in eine andere Sprache übersetzen.'],
])

block('Hörbuch', '— der gespeicherte Buchtext vorgelesen, ohne KI-Textlauf', [
  ['Je Kapitel eine MP3', 'Titel, alle Kapitel samt Kästen, Mitwirkende und Entstehungshinweis.', true],
  ['Stimmenwahl', 'Weiblich, männlich oder gemischt (Kapitel abwechselnd, fremde Stimmen in der Gegenstimme; bei Einzelkapiteln nach Geschlecht der beitragenden Person).', true],
  ['Stimmen-Generation', 'Wortgetreu (klassische Neural-Stimmen, Standard) oder natürlich (generative Stimmen, menschlicher im Klang, gelegentlich ungenau).', true],
  ['Schätzung vorab', 'Tonspuren, Zeichen, Spielzeit, Dateigröße und Kosten stehen vor dem Start im Fenster.', true],
  ['Serverseitiger Auftrag', 'Mit Zeitbudget und Wiederaufnahme zwischen den Spuren; Kosten je Stimme gebucht.', true],
  ['Drei Download-Wege', 'Kapitel einzeln, alle Kapitel als nummeriertes ZIP, oder die Gesamtdatei.', true],
  ['Gesamtdatei auf dem Server', 'Wird serverseitig aus den Kapiteln zusammengesetzt — auch nachträglich, ohne erneute Sprachkosten.', true],
  ['Zwei Links', 'Derselbe Link spielt im Browser ab; mit angehängtem dl=1 lädt er die MP3 herunter.', true],
])

block('Nebenprodukte Lebenswerk', '', [
  ['Stammbaum', 'A3-Poster aus den erzählten Beziehungen, mit Generationen und Lebensdaten.'],
  ['Lebensposter', 'Stationen des Lebens als gestaltetes Poster, fünf Stile (u. a. Reisetagebuch, Alter Atlas, Jugendstil).'],
  ['Vorsorgemappe', 'Ein PDF mit getrennt unterschreibbaren Teilen: Vorsorgevollmacht, Betreuungsverfügung als Ziffer 7, Werteerklärung, plus Hinweisseite zur fehlenden Patientenverfügung.', true],
  ['Rechtsform der Mappe', 'Namen bleiben frei (§ 1816 Abs. 2 BGB), Behandlungsentscheidungen ausgeschlossen (§ 1827 BGB). Jeder Teil beginnt auf eigener Seite und zählt eigene Seiten.', true],
])

block('Anamnese', '', [
  ['Strukturierter Bogen', 'Statt eines Buchs entsteht ein Anamnesebogen für die ärztliche Aufnahme, immer auf Deutsch.'],
  ['Rote Flaggen', 'Akute Warnzeichen werden im Gespräch neutral aufgefangen und im Bogen sichtbar markiert — ohne Bewertung, ohne Triage.'],
  ['Patienten-Review', 'Die Person sieht ihren Bogen in der Anzeigesprache, kann Abschnitte per Sprache ändern; Rückübersetzung ins Deutsche beim Bestätigen.'],
  ['Kurze Aufbewahrung', 'Anamnese-Kategorien löschen vollständig 14 Tage nach Anlage, unabhängig von der Lizenzlaufzeit.'],
])

block('Selbstbedienung der erzählenden Person', '', [
  ['Zwischenstand', 'Erste Textfassung aus den bisherigen Antworten, nur zum Ansehen. Kontingent je Buch einstellbar.'],
  ['Vorläufige Druckversion', 'Vollständiges Buch mit Bildern zum Feinschliff; schließt den Interviewteil ab.'],
  ['Bearbeiten per Sprache', 'Textänderungen und Überschriften per gesprochener Anweisung, mit Markierung des betroffenen Abschnitts.'],
  ['Eigene Einstellungen', 'Name, Geschlecht, Bildstil, Buchlayout und Schreibstil ändert die Person selbst — der Buchcode ist ihr Zugang.'],
  ['Buch abschließen', 'Endgültiges Abschließen mit Bestätigung; danach ist das Projekt schreibgeschützt.'],
])

block('Verwaltung', '', [
  ['Mehrbenutzer mit Rechten', 'Konten mit je freigeschalteten Kategorien; fremde Bücher sind nicht einmal über den Code erreichbar (404 statt 403).'],
  ['Projekt duplizieren', 'Vollständige Kopie mit eigenem Zugangscode und eigenen Bilddateien, nicht mit geteilten.', true],
  ['Kosten je Buch', 'Jede KI-Nutzung einzeln erfasst, Eurobetrag je Buch mit Aufschlüsselung nach Text, Sprache, Bild.'],
  ['Budgetgrenze', 'Ein Buch stoppt bei überschrittenem Budget, bevor weitere Kosten entstehen.'],
  ['Aufbewahrung', 'Automatische Löschung nach Fristende (Standard 90 Tage nach Nutzungszeitraum), inklusive hochgeladener Fotos.'],
  ['DSGVO-Auskunft', 'Datenauskunft nach Art. 15 und 20 als PDF je Beitrag.'],
  ['Freischaltcodes', 'Codes zum Aufheben des Zeitlimits, einzeln einlösbar.'],
  ['Berichte und Rückmeldungen', 'Täglicher Bericht per E-Mail, Rückmeldungen aus dem Interview im Dashboard.'],
  ['Fortschritt an der Karte', 'Erzeugung, Prüfung und Hörbuch zeigen ihren Fortschritt an der jeweiligen Buchkarte; Abbrechen jederzeit.'],
  ['Archiv', 'Abgeschlossene Projekte archivierbar, ohne sie zu löschen.'],
])

block('Betrieb und Datenschutz', '', [
  ['Ausschließlich EU', 'Sprachmodell, Sprachausgabe, Spracherkennung und Bilderzeugung laufen auf Azure in der EU; keine Übermittlung in Drittländer.'],
  ['Azure-Dienste', 'Container Apps (Anwendung und vier Cron-Aufträge), PostgreSQL Flexible Server, Blob Storage mit signierten Leserechten auf Zeit.'],
  ['Live-Sprachgespräch abgesichert', 'Relais auf dem eigenen Server: Schlüssel bleibt serverseitig, Sitzung an Sweden Central gebunden, Nachrichten des Browsers gegen eine Positivliste gefiltert.'],
  ['Zugangscodes', 'Zehn Zeichen aus einem verwechslungsfreien Alphabet; ältere sechsstellige Codes bleiben gültig.'],
  ['Rechtstexte', 'AGB und Widerrufsbelehrung auf der Website, Datenschutzerklärung, AVV, Verfahrensverzeichnis, Folgenabschätzung, Sicherheitskonzept.', true],
  ['Druckerei als Auftragsverarbeiter', 'Dokumentiert in Verfahrensverzeichnis, AVV-Anlage, Folgenabschätzung und Datenschutzerklärung.', true],
  ['Installierbar', 'Als App auf dem Handy installierbar (PWA); Bedienung funktioniert auch ohne JavaScript-Komfortfunktionen.'],
  ['Zugriffsschutz', 'Anmeldung mit signiertem Token und zwölf Stunden Gültigkeit, Ratenbegrenzung auf allen offenen Endpunkten.'],
])

fuss()
fs.writeFileSync(OUT, Buffer.from(doc.output('arraybuffer')))
console.log('geschrieben:', OUT, (fs.statSync(OUT).size / 1024).toFixed(0) + ' kB,', doc.getNumberOfPages(), 'Seiten')
