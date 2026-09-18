# Produktkategorie „Vorsorgevollmacht" (`precaution`) — Produktdefinition

Stand 18. September 2026. **Gebaut und auf `main`.** Kategorie, Fragenkatalog, Interview,
Vorsorgen-Mappe mit acht Formularen, Prüfliste, Beiblatt, Gesprächsleitfaden fürs
Beratungsgespräch und der Endnutzer-Reiter, über den die Person ihre eigenen Unterlagen
herunterlädt.

Grundlage: **„Die VORSORGEN! Mappe" der Deutschen PalliativStiftung**, 13. Auflage,
Rechtslage 2026, Stand 09/2026
([PDF](https://palliativstiftung.com/images/downloads/vorsorgemappe/vorsorgenmappe-2026/2026_09_07%20Die%20Vorsorgen%20Mappe.pdf)).
Ihre acht Formulare sind Gliederung und Wortlaut-Vorbild; Reihenfolge und Zuschnitt der
Fragen folgen ihnen, damit am Ende wirklich jedes Feld gefüllt werden kann.

Die Kategorie fügt sich als **14. Produktkategorie** in das bestehende Setup ein, nach
demselben Muster wie `career` (siehe `PRODUKTKATEGORIE_LEBENSLAUF.md`).

---

## 1. Was es ist

Ein Mensch beantwortet — per Sprache oder Text, im eigenen Tempo — gezielt die Fragen, aus
denen **seine eigene Vorsorgen-Mappe** entsteht. Endprodukt ist **kein Buch**, sondern ein
PDF mit acht getrennt unterschreibbaren Urkunden plus Prüfliste und Beiblatt.

Zielgruppen: Vorsorgeberatung, Hospiz- und Palliativdienste, Betreuungsvereine, Seniorenarbeit,
Pflegeeinrichtungen — und Menschen, die ihre Vorsorge selbst regeln wollen. Auftraggeber ist
wie überall ein **Manager** (`app_users`); die vorsorgende Person ist **Endnutzerin** mit
eigenem Zugangscode.

## 2. Der Unterschied zur Vorsorgemappe des Lebenswerks

Das Lebenswerk erzeugt seit 2026-08-07 ebenfalls eine Vorsorgemappe (`src/provisionFolder.js`,
`src/powerOfAttorney.js`). Sie bleibt unverändert. Der Unterschied ist grundsätzlich:

| | Lebenswerk (`poa`) | Vorsorgevollmacht (`vorsorge`) |
|---|---|---|
| Woher die Angaben kommen | **Abgeleitet** aus einer erzählten Lebensgeschichte | **Diktiert** — ausdrücklich für dieses Dokument erfragt |
| Namen im Dokument | **Nie.** Die KI benennt niemanden | **Ja**, wörtlich wie genannt, plus Prüfliste |
| Behandlungsentscheidungen | **Nie** (§ 1827 BGB verlangt konkrete Situationen) | **Ja** — die Situationen werden einzeln abgefragt |
| Umfang | 3 Teile (Vollmacht mit Betreuungsverfügung als Ziffer 7, ausgewiesene Fehlstelle Patientenverfügung, Werteerklärung) | 8 Teile + Prüfliste + Beiblatt |
| Ankreuzfelder | leer, füllt der Mensch | **ausgefüllt**, dreiwertig |

Der Grund für beide Sperren im Lebenswerk fällt hier weg: Eine Schlussfolgerung darf keine
Vollmacht erteilen — eine Aussage schon. Was **nicht** wegfällt: Die KI erfindet nichts,
deutet nichts und rät zu nichts. Sie ist Schreibkraft, nicht Beraterin.

## 3. Die drei Regeln, auf denen alles ruht

1. **Drei Zustände, nicht zwei.** Jede Ja/Nein-Festlegung ist `true`, `false` **oder `null`**.
   `null` heißt: nicht gefragt, nicht beantwortet oder ausdrücklich offengelassen („das sollen
   andere entscheiden" — die Formulare der PalliativStiftung sehen dafür überall ein eigenes
   Feld vor). Im Dokument bleiben dann **beide** Kästchen leer. Ein irrtümliches „Nein" wäre
   eine Ablehnung, die dieser Mensch nie erklärt hat — und sie würde im Ernstfall befolgt.
   Umgesetzt in `tri()` (Renderer) und als Regel 1 des Prompts.

2. **Wörtlich bei harten Angaben.** Namen, Geburtsdaten, Anschriften, Telefonnummern und
   E-Mail-Adressen werden exakt übernommen. Keine ergänzte Postleitzahl, kein
   vervollständigter Vorname, keine korrigierte Schreibweise. Was unvollständig blieb, bleibt
   unvollständig und wandert in `open_points`.

3. **Jede harte Angabe trägt ihren Beleg.** `verify` sammelt sie mit dem wörtlichen Zitat.
   Daraus entsteht die **Prüfliste**, die der Mappe vorangeht. Sie ist die eigentliche
   Sicherheitsvorkehrung des Produkts: Spracherkennung verhört genau das — Eigennamen,
   Ziffern, Straßennamen. Ohne diese Liste wäre das Produkt ein Risiko statt einer Hilfe.

Dazu drei Interview-Regeln, die im Prompt einzeln ausformuliert sind: **Angaben zurücklesen**
(jeder Name, jedes Datum wird wiederholt und bestätigt), **keine Beratung, keine Empfehlung**
(mit Ausweichformel auf Ärztin bzw. Rechtsberatung) und **kein Drängen** („weiß ich nicht" ist
beim ersten Mal eine vollwertige Antwort). Ein **Krisenprotokoll** nach dem Vorbild der
mamazone-Edition kommt hinzu — dieses Gespräch führt über Sterben und Abschied.

## 4. Die acht Teile der Mappe

| Teil | Dokument | Wer unterschreibt |
|---|---|---|
| Prüfliste | jede übernommene Angabe mit Zitat | niemand (zum Abhaken) |
| 1 | Vorsorgevollmacht | die vorsorgende Person |
| 2 | Betreuungsverfügung | die vorsorgende Person |
| 3 | Patientenverfügung | die vorsorgende Person |
| 4 | Meine Wertvorstellungen | die vorsorgende Person |
| 5 | Bestattungsverfügung | die vorsorgende Person |
| 6 | Palliativ-Ampel | Patient, Bevollmächtigter oder Arzt |
| 7 | Untervollmacht (Vordruck) | **die bevollmächtigte Person** |
| 8 | Vertreterverfügung (Vordruck) | **die Vertretung** |
| Beiblatt | Belehrungen, offene Punkte, Checkliste | niemand (zum Abtrennen) |

Teile 7 und 8 sind in der Vorlage vollwertige Formulare, werden aber **von anderen Menschen**
unterschrieben. Sie bleiben deshalb bewusst weitgehend leer: vorbelegt ist nur, was feststeht
(die betroffene Person, der Umfang der Hauptvollmacht), dazu ein Kasten, der erklärt, wer sie
ausfüllt und wann sie überhaupt gebraucht werden. Teil 7 warnt zusätzlich, wenn die Hauptvollmacht
die Erteilung einer Untervollmacht gar nicht gestattet.

**Eine bewusste Abweichung von der Vorlage:** Dort steht die Betreuungsverfügung an siebter
Stelle. Hier folgt sie unmittelbar auf die Vollmacht, weil sie deren Rückfallebene ist — sie
greift genau dann, wenn die Vollmacht nicht greift.

Jeder Teil beginnt auf einer eigenen Seite und zählt seine Seiten selbst („Teil 1 · Seite 2
von 4", `footerSections`): Die Teile werden verschiedenen Leuten vorgelegt — die Vollmacht der
Bank, die Patientenverfügung der Klinik, die Ampel hängt am Bett.

## 5. Ablauf

1. **Manager legt an** (`create`): Name (optional), Geschlecht, Anredeform, Sprache, E-Mail für
   die Einladung. **Kein kategoriespezifisches Anlege-Feld** — der Katalog gilt für alle, und
   jede Frage lässt sich mit „weiter" überspringen. Ein Feld, das Teile der Mappe abwählt, wäre
   eine Weiche, die der Fragenkatalog nicht abbilden kann.
2. **Person erhält den Zugang** (`?code=…`) und antwortet — Sprachdialog, Diktat oder Tippen,
   alle Mikrofonmodi, Pausieren und Fortsetzen über die bestehende Session-Wiederaufnahme.
3. **Manager erzeugt die Mappe** im Dashboard (eine Karte, ein Job, ein KI-Lauf).
4. **Ausgabe**: Der Manager lädt das PDF im Dashboard, die Person über den Reiter „Meine
   Vorsorge" im Beitragenden-Flow (`api/enduser-precaution.js`). Bei dieser Kategorie ist das
   keine Nettigkeit: Die Mappe IST die Erklärung der Person, unterschreiben kann nur sie selbst.

**Ein KI-Lauf für alle acht Urkunden.** Acht Läufe wären teurer und — schlimmer — sie würden
acht Fassungen desselben Namens erzeugen, die auseinanderlaufen. Die Mappe muss in sich
stimmen: derselbe Mensch, dieselbe bevollmächtigte Person, dieselben Daten überall.

## 6. Der Fragenkatalog

Standardkatalog in `question_catalogs`, Name **„Vorsorgevollmacht – Standardfragen"**, geseedet
aus `api/_lib/precaution.js` (Muster `api/_lib/career.js`). Elf Blöcke, rund 100 Fragen:

1. **Wer du bist** (6) — Stammdaten, vorhandene Dokumente, Anlass
2. **Wem du vertraust** (11) — bevollmächtigte Person, Ersatzpersonen, Einzel-/Gesamtvertretung, Ausschluss
3. **Wofür die Vollmacht gelten soll** (15) — die sieben Bereiche, die vier Sonderbefugnisse, die weiteren Festlegungen
4. **Wie entschieden werden soll** (6) — Innenverhältnis, Rechenschaft, Alltag
5. **Falls doch ein Gericht entscheidet** (5) — Betreuungsverfügung
6. **In welchen Situationen deine Patientenverfügung gelten soll** (8) — A bis F der Vorlage
7. **Was behandelt werden soll und was nicht** (19) — Krankenhaus, Symptomlinderung, Ernährung, Reanimation, Einzelmaßnahmen, reine Palliation
8. **Organspende, Geltung und Durchsetzung** (8)
9. **Was dir wichtig ist** (12) — Wertvorstellungen, Sterbeort, Beistand
10. **Deine Bestattung** (12)
11. **Für den Notfall und zum Schluss** (7) — Palliativ-Ampel, Aufbewahrung, Notfallkontakt

Der Katalog **berät nicht** (keine Frage legt eine Antwort nahe) und **drängt nicht** (zu jeder
Festlegung ist „das sollen andere entscheiden" eine vollwertige Antwort).

## 7. Technische Einpassung

| Baustein | Datei | Art |
|---|---|---|
| Slug, Label, Farbe, Reihenfolge | `src/categories.js`, `api/_lib/categories.js` | additiv, je ein Eintrag |
| Kategorie-Definition + Interview-Prompt | `src/categories.js` | additiv, neuer Block |
| Standardkatalog (Seed) | `api/_lib/precaution.js` | neu, Muster `api/_lib/career.js` |
| KI-Prompt + geteilte Konstanten | `src/precaution.js` | neu |
| Renderer der Mappe | `src/precautionExport.js` | neu, Muster `src/provisionFolder.js` |
| Formular-Baukasten | `src/legalForms.js` | **erweitert**: `checkbox`, `decision`, `choice`, `yesNo({value})` |
| Spalte `precaution` (jsonb) | `db/schema.sql`, `ensureLifeworkSchema`, `SELECT_COLS`, `JSONB_COLS`, `SAVE_FIELDS`, PATCH-Allowlist | additiv |
| Generierungsart `vorsorge` | `api/admin/generate-job.js` | additiv, ein Wert |
| Generierung | keine Änderung | `resultType:'json'` des Workers trägt sie |
| Gesprächsleitfaden | keine Änderung | nutzt die `finalText`-Pipeline |
| Dashboard-Karte | `src/adminViews.jsx` | additiv, ein `isPrecaution`-Gate |
| Endnutzer-Reiter | `api/enduser-precaution.js`, `src/api.js`, `src/contributor.jsx` | neu bzw. additiv |

### Änderungen, die den Bestand berühren

Alles Übrige ist rein additiv. Drei Punkte fassen geteilten Code an:

1. **`ENDUSER_CATEGORIES` / `isEnduserCategory` um `precaution` erweitert.** Nötig, damit der
   Code als Berechtigung gilt.
2. **`src/legalForms.js` erweitert.** `bullet()` kennt jetzt `checked`, `yesNo()` einen
   dreiwertigen `value`; neu sind `checkbox()`, `decision()` und `choice()`. Alle Ergänzungen
   haben Defaults, die das bisherige Verhalten exakt erhalten — Betreuungsverfügung und
   Vorsorgemappe des Lebenswerks zeichnen unverändert.
3. **`tabOk` im Beitragenden-Flow um `results` ergänzt.** Das war ein **Fehler im Bestand**:
   Der Reiter mit den eigenen Erzeugnissen war in `tabOk` nicht aufgeführt, `cur` fiel deshalb
   immer auf `interview` zurück — beim Lebenslauf war der Reiter damit seit seiner Einführung
   nicht erreichbar. Die Zeile repariert beide Kategorien.

Nicht angefasst: die dreizehn bestehenden Kategorie-Definitionen, `isLifework`, `isAnamnesis`,
`isCareer`, Buchgenerierung, Bildpfad, Hörbuch, Retention, Kostenerfassung, Beitragenden-Flow
im Übrigen.

## 8. Rechtliche Einordnung — Bauentscheidungen, keine Rechtsauskunft

- **Die Mappe ist ein Entwurf.** Jede Urkunde trägt den Hinweis; wirksam wird sie erst mit
  eigenhändiger Unterschrift. Das steht im Deckblatt, in jedem Teil und im Beiblatt.
- **Keine Rechts- und keine medizinische Beratung.** Das Interview verweigert jede Empfehlung,
  der Prompt verbietet Paragraphen und Einordnungen, das Beiblatt sagt ausdrücklich, dass die
  Bedeutung der Festlegungen in ein ärztliches Gespräch gehört. Der Gesprächsleitfaden ist
  genau dafür gemacht.
- **§ 1816 Abs. 2 BGB** (Bindung des Gerichts an den Betreuungsvorschlag) gilt unverändert —
  deshalb steht im Beiblatt der Hinweis, gerade diesen Namen besonders sorgfältig zu prüfen.
- **§ 1827 BGB** verlangt hinreichend konkrete Festlegungen. Deshalb sind Situationen und
  Einzelmaßnahmen einzeln aufgeführt und einzeln angekreuzt, statt einer Generalformel.
- **§ 1829, §§ 1831/1832 BGB und Immobilien** sind eigene Kästchen und werden im Beiblatt
  einzeln erklärt, einschließlich der Warnung, dass Immobiliengeschäfte zwingend zum Notar
  müssen.
- **Deutsches Recht.** Die Vorlagen richten sich danach; das steht auf dem Deckblatt.

## 9. Offene Punkte

1. **Fachliche Durchsicht der Formulartexte.** Der Wortlaut lehnt sich eng an die Vorlage der
   PalliativStiftung an, ist aber nicht identisch (eigene Gliederung, eigene Nummerierung,
   sieben statt acht Vollmachtsbereiche). Vor dem Vertrieb sollte eine Vorsorgeberatung oder
   ein Anwalt die Fassung einmal durchgehen.
2. **Verhältnis zur Vorlage klären.** Die Deutsche PalliativStiftung stellt ihre Mappe
   kostenfrei bereit; ob und wie auf sie verwiesen werden soll (und ob eine Abstimmung
   sinnvoll ist), ist eine Frage an den Vertrieb, keine technische.
3. **Testlauf am echten Gespräch.** Es gibt noch keinen vollständigen Durchlauf wie bei
   `career` (Demo-Zugang, ~50 Antworten, jedes Erzeugnis am Material geprüft). Besonders zu
   prüfen: ob das Modell die Dreiwertigkeit wirklich durchhält und die Prüfliste vollständig
   füllt.
4. **Mehrsprachigkeit.** Interview und Mappe sind auf Deutsch ausgelegt (deutsches Recht). Der
   Endnutzer-Reiter hat de/en; die Urkunden selbst bleiben deutsch.
5. **Aktualisierung.** Eine Vorsorge veraltet. Ein zweites Gespräch auf denselben Code und ein
   erneutes Erzeugen ersetzt die Mappe — ein „Was hat sich geändert?"-Kurzinterview wie beim
   Lebenslauf ist noch nicht gebaut.
