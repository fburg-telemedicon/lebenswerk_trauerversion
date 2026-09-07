# Produktkategorie „Lebenslauf" (`career`) — Produktdefinition

Stand 7. September 2026. **Alle drei Ausbaustufen sind gebaut und live.** Kategorie, Fragenkatalog,
Interview, Lebenslauf mit fünf Vorlagen, Gesprächsleitfaden, Kompetenzprofil, Auslesung hochgeladener
Zeugnisse, Fragen an das Profil und Abgleich mit einer Stellenausschreibung. Ein vollständiger
Testlauf liegt vor: Demo-Zugang `DZMXP8UPEC`, Katrin Berger (Demo), 47 Antworten, jedes Erzeugnis am
echten Material geprüft.

**Nicht gebaut — und warum:** Die Übergabe an die AVOCA-Kompass-App (Abschnitt 8, Stufe 3) hat kein
Gegenüber; von dort kommen weder Rubrik noch Schnittstelle. Das Exportformat des Kompetenzprofils ist
so geschnitten, dass es dorthin passen würde (Stufe, Belegstärke, Belege, Gegenbelege je Dimension) —
angeschlossen ist nichts.

Grundlage: das externe Briefing „Lebenswerk Talent Edition" (Version 3) — **als Inspiration, nicht
als Vorgabe**. Dieses Dokument definiert stattdessen ein Produkt, das sich als **13. Produktkategorie
in das bestehende Setup einfügt**, nach demselben Muster wie `anamnesis` und `mamazone`. Was aus dem
Briefing bewusst nicht übernommen wird, steht in Abschnitt 6 mit Begründung.

---

## 1. Was es ist

Ein Mensch erzählt seinen **beruflichen Weg** — per Sprache oder Text, im eigenen Tempo, entlang
eines kuratierten Fragenkatalogs. Daraus entstehen drei Dokumente:

1. ein **Lebenslauf** in wählbarer Vorlage (PDF/DOCX),
2. ein **Kompetenzprofil** entlang der fünf AVOCA Future Skills — jede Ausprägung mit Belegstellen
   aus dem Gespräch,
3. ein **Gesprächsleitfaden** für ein biografisches Interview.

Zielgruppen: Personalberatung, Outplacement-Beratung, Unternehmen (Personalentwicklung), sowie
Menschen, die ihren Berufsweg selbst dokumentieren. Der Auftraggeber ist — wie bei allen anderen
Kategorien — ein **Manager** (`app_users`); die erzählende Person ist die **Endnutzerin** mit
eigenem Zugangscode.

Das Produkt beschreibt **beobachtbares Handeln in erzählten Situationen**. Es ist kein
psychologisches Verfahren, vergibt keine Persönlichkeitsmerkmale, keine Perzentile, keine
Normwerte, keine Rangfolgen.

## 2. Einordnung ins Bestandssystem

Die Kategorie ist **anamnese-förmig**, nicht lebenswerk-förmig:

| Eigenschaft | `career` | wie bei |
|---|---|---|
| Ein Mensch erzählt über sich selbst, Code = Zugang | ja | `anamnesis`, `lifework` |
| Endnutzer-Kategorie (`isEnduserCategory`) | ja | `anamnesis`, `lifework` |
| Fester Standard-Fragenkatalog (`question_catalogs`) | ja | `anamnesis`, `mamazone` |
| Erzeugt ein Buch | **nein** | wie `anamnesis` |
| Erzeugt KI-Bilder, Hörbuch, Stammbaum, Poster | **nein** | wie `anamnesis` |
| Erzeugt strukturierte Dokumente aus JSON + Renderer | ja | wie Lebensposter / Vorsorgemappe |
| Eigene Familie/Prädikat nötig | nein — eigenständiger Slug | wie `anamnesis` zu Beginn |

Es entsteht **keine neue Familie**. `career` steht für sich; wo der Code kategoriespezifisch
verzweigt, geschieht das über einen einzelnen Slug-Vergleich bzw. ein kleines `isCareer()`, analog
zu `isAnamnesis()`.

## 3. Ablauf

1. **Manager legt an** (`create`-Ansicht): Name der Person (optional), Geschlecht, Anredeform,
   Sprache, E-Mail für die Einladung — plus zwei kategoriespezifische Felder (`intake.extra`):
   - **Anlass** (Select, steuert den Fragenast): Bewerbung · Outplacement · Standortbestimmung /
     Personalentwicklung · Interim-Mandat
   - **Zielrichtung** (Freitext, optional): angestrebte Position, Branche, Umfeld
2. **Person erhält Zugang** (`?code=…`) und erzählt — Sprachdialog, Diktat oder Tippen, alle vier
   Mikrofonmodi wie gehabt, Pausieren und Fortsetzen über die bestehende Session-Wiederaufnahme.
3. **Dokumente** (Ausbaustufe 2): Zeugnisse und Zertifikate werden hochgeladen, per OCR gelesen,
   der Person zur Bestätigung vorgelegt und danach als Beleg geführt.
4. **Manager erzeugt die Produkte** im Dashboard, wie heute Bogen bzw. Buch: pro Produkt ein Job,
   serverseitig, mit Fortschrittsanzeige.
5. **Ausgabe**: Die Person sieht und lädt ihre Dokumente selbst; der Manager ebenfalls. Weitergabe
   an Dritte geschieht durch die Person, indem sie das PDF weitergibt — die Anwendung verschickt
   nichts von sich aus.

## 4. Die drei Produkte im Detail

### 4.1 Lebenslauf → neue Spalte `cv` (jsonb)

Der Generator erzeugt **strukturierte Daten**, kein Fließtextdokument: Kopfdaten, Stationen
(Zeitraum, Organisation, Rolle, Verantwortung, Ergebnisse), Ausbildung, Sprachen, Kompetenzen —
jeweils mit Beleg-Referenz auf die Beitrags-ID, aus der die Angabe stammt.

Ein **deterministischer Renderer** (`src/cvExport.js`, Muster: `src/powerOfAttorney.js`) zeichnet
daraus fünf Vorlagen:

| Vorlage | Form |
|---|---|
| Klassisch | chronologisch, zwei Seiten, tabellarisch |
| Kompakt | Executive-Einseiter |
| Interim | Mandatsliste: Ausgangslage · Auftrag · Ergebnis |
| Kurzprofil | halbe Seite zur Vorstellung |
| Narrativ | Ich-Form, ein bis zwei Seiten, Stimme der Person |

Die Vorlage ist eine **Layout**-Entscheidung und gehört deshalb in den Renderer — nicht in die
`finalText.styles`, die im Bestand die *Tonalität* eines Textes steuern. Die Vorlage lässt sich
jederzeit wechseln, ohne neu zu generieren; das kostet nichts und ist der eigentliche Charme.

Sprachen: Deutsch und Englisch aus derselben Datenbasis (die Sprachwahl der Generierung existiert
bereits).

**Aktuell halten**: Ein „Was ist seitdem passiert?"-Kurzinterview ergänzt nur neue Stationen. Das
ist derselbe Mechanismus wie ein zweites Interview auf denselben Code; die Neugenerierung des CV
übernimmt die neuen Beiträge automatisch.

### 4.2 Kompetenzprofil AVOCA → neue Spalte `avoca` (jsonb)

Pro Dimension (Agilität, Vision, Offenheit, Curiosity, Ambiguitätstoleranz):

- Ausprägungsstufe nach Rubrik
- Belegstärke (niedrig / mittel / hoch), abgeleitet aus Anzahl und Vielfalt der Belege
- drei bis fünf **Belegstellen** mit Zitat und Quellenangabe (Beitrags-ID)
- Gegenprobe: Situationen, die gegen die Einstufung sprechen
- ein beschreibender Absatz in Handlungssprache
- Ansatzpunkte für Entwicklung

Fester Hinweis auf jedem Profil: *„Beschreibt Handeln in Situationen, die die Person erzählt hat.
Kein psychologisches Verfahren, keine Aussage über Persönlichkeit oder Eignung. Grundlage sind
ausschließlich die zitierten Belege."*

Verbotene Wortliste im Prompt (Persönlichkeit, Charakter, Trait, Typ, Stabilität, Belastbarkeit,
Intelligenz, Motiv, Neigung sowie Begriffe gängiger Persönlichkeitsmodelle) plus ein Ausgabe-Check,
der Aussagen ohne Beleg und Vergleiche mit Dritten abfängt.

**Die Rubrik liefert Tobias.** Bis dahin: Platzhalter-Rubrik gleicher Struktur, jedes Ergebnis
sichtbar als „Entwurfs-Rubrik" markiert. Die Rubrik-Version wird im Dokument mitgeführt.

Darstellung als PDF/DOCX über einen Renderer im selben Muster wie 4.1; kein Radar, keine Farbcodes.

### 4.3 Gesprächsleitfaden → bestehender `finalText`-Slot (`eulogy_text`)

Nutzt die vorhandene Abschnitts-Pipeline unverändert — Generierung, Nachbearbeitung, PDF und DOCX
funktionieren damit ohne eine Zeile neuen Ausgabecode. Abschnitte:

1. Rote Fäden der Erzählung
2. Brüche, Wendepunkte, Umwege
3. Stellen, an denen die Erzählung dünn bleibt
4. Acht bis zwölf offene Fragen für das Gespräch

Formuliert als Beobachtungen zum **Erzählten**, nie als Hypothesen über die Person. Zwei bis drei
Tonalitäten als `styles` (sachlich · ausführlich · Kurzfassung für ein 30-Minuten-Gespräch).

### 4.4 Fragen an das Profil (Ausbaustufe 3)

Freie Frage an die eigene Erzählung, Antwort mit Quellenverweis, „dazu liegt nichts vor", wenn
nichts vorliegt. Ein Filter lenkt unzulässige Fragen um („Ist er belastbar?" → „Welche Situationen
mit hoher Belastung hat er geschildert?"). Technisch ein schlanker neuer Endpunkt im Muster von
`/api/ask`, gegen die Beiträge desselben Codes.

## 5. Fragenkatalog

Als Standardkatalog in `question_catalogs` (Muster `api/_lib/lifework.js` / `api/_lib/mamazone.js`),
Name „Lebenslauf – Standardfragen". Blöcke:

- **Selbstbild** (4): Beschreibung durch andere, Selbstbeschreibung jenseits von Titeln, geschätzte
  Eigenschaft, hinderliche Eigenschaft
- **Berufsbiografie** (chronologisch geführt, offen in der Anzahl): Anfang und was dorthin führte;
  je Station Aufgabe, Veränderung, Grund des Wechsels; Brüche, Umwege, Pausen und was dort gelernt
  wurde
- **Herausforderungen** (3): größte berufliche Herausforderung, bevorzugte Art von Problemen,
  Entscheidung, die man heute anders träfe
- **AVOCA-Vertiefung** (2–3 Erzählimpulse je Dimension, 10–15 gesamt) — Entwurf steht, Tobias
  schärft ihn gegen die Rubrik
- **Anlassblock**, gesteuert von `intake.focus`:
  - *Bewerbung*: was an der Aufgabe anspricht, eigene Qualifikation, erste 100 Tage, selbst
    gesehene Lücke
  - *Outplacement*: was in der letzten Station hielt und was fehlte; nicht gebrauchte Stärken;
    passende und unpassende Organisationsformen; was anders werden soll. **Keine Fragen zu den
    Umständen der Trennung** über das hinaus, was die Person von sich aus erzählt
  - *Interim*: Verfügbarkeit; Mandate als Ausgangslage/Auftrag/Ergebnis/Übergabe; erster Tag in
    fremder Organisation; was der Auftraggeber liefern muss. **Keine Konditionen**
  - *Standortbestimmung*: keine Zusatzfragen

**AGG-Filter** als Pflicht über allen Fragen und über Abschnitt 4.4: regelbasiert plus
LLM-Prüfung gegen Fragen, die direkt oder mittelbar auf Alter, Herkunft, Geschlecht, Religion,
Behinderung, sexuelle Identität, Familienplanung, Gesundheit oder Gewerkschaftszugehörigkeit
zielen. Im Lebenslauf erscheinen weder Geburtsdatum noch Foto, Familienstand oder
Staatsangehörigkeit, es sei denn, die Person trägt sie selbst ein.

## 6. Bewusst nicht übernommen

Diese Punkte aus dem Briefing würden das Bestandssystem umbauen und bleiben deshalb draußen. Falls
sie gebraucht werden, sind sie eine eigene Anwendung, keine Kategorie.

| Briefing | Entscheidung hier |
|---|---|
| `Organization`, `Case`, `CaseParticipant`, Einladungen in Fälle | Der Manager (`app_users`) ist die Organisation, ein Zugang ist der Fall. Kein zweites Mandantenmodell. |
| `ShareGrant` — Freigabe je Artefakt und Empfänger, widerrufbar | Kein neues Berechtigungsmodell. Die Person gibt ihr PDF selbst weiter. |
| Personen-Konten mit Magic-Link | Der Zugangscode bleibt das Credential — wie bei Lebenswerk und Anamnese. |
| Vier-Augen-Schritt als Workflow mit Prüfformular | Für Stufe 1 genügt der bestehende Freigabe-/Finalisierungsmechanismus. |
| Match zwischen Stellenanzeige und Profil | Später, eigener Ausbauschritt (Abschnitt 8). |
| Übergabe an AVOCA Kompass per API | Später. Das Exportformat wird aber schon jetzt so geschnitten, dass es dorthin passt. |
| Vollständige Hochrisiko-Compliance-Spur des AI Act | Siehe Abschnitt 9 — offene Rechtsfrage, keine Bauentscheidung. |
| „Keine KI-generierten Stimmen im Produkt" | Nicht haltbar: Das Interview *ist* eine KI-Stimme (Azure Neural TTS), das ist der Kern der Engine. Sinnvoll ist die engere Regel: keine geklonten Stimmen realer Menschen, keine KI-Bilder von Personen. Diese Kategorie erzeugt ohnehin keine Bilder. |

## 7. Technische Einpassung

| Baustein | Datei | Art |
|---|---|---|
| Slug, Label, Farbe, Reihenfolge | `src/categories.js`, `api/_lib/categories.js` | additiv, je ein Eintrag |
| Kategorie-Definition (intake, contributor, interviewSystem) | `src/categories.js` | additiv, neuer Block |
| Interview-Prompt | `src/categories.js` | neu, Muster `anamnesisInterview` |
| Standardkatalog (Seed) | `api/_lib/career.js` | neu, Muster `api/_lib/lifework.js` |
| Zwei Spalten `cv`, `avoca` (jsonb) | `db/schema.sql`, `SELECT_COLS`, `JSONB_COLS` in `store.js` | additiv, bestehende Zeilen bleiben `NULL` |
| Feld-Allowlist beim PATCH | `api/admin/memorials.js` | additiv, zwei Werte |
| Generierung | keine Änderung | `resultType:'json'` des Workers trägt beide Produkte |
| Renderer Lebenslauf + Kompetenzprofil | `src/cvExport.js`, `src/avocaExport.js` | neu, Muster `powerOfAttorney.js` |
| Gesprächsleitfaden | keine Änderung | nutzt `finalText`-Pipeline |
| Dashboard: Kacheln ein-/ausblenden | `src/adminViews.jsx` | additiv, ein `isCareer()`-Gate neben `isAnamnesis()` |
| OCR für Zeugnisse (Stufe 2) | neu | einziger echt neuer technischer Baustein |

### Änderungen, die den Bestand berühren — bitte freigeben

Alles Übrige ist rein additiv. Diese drei Punkte fassen geteilten Code an:

1. **`ENDUSER_CATEGORIES` / `isEnduserCategory` um `career` erweitern.** Nötig, damit der Code als
   Credential gilt und der Endnutzer eigene Einstellungen ändern darf. Ein Slug in einer Liste —
   aber es ist eine geteilte Weiche.
2. **Zwei neue Spalten auf `memorials`.** Additiv, mit der üblichen Rückfall-Logik für den Fall,
   dass die Migration noch nicht gelaufen ist. Kein Effekt auf bestehende Bücher.
3. **`isCareer()`-Gate im Dashboard**, an denselben Stellen, an denen heute schon `isAnamnesis()`
   Buch, Bilder, Stammbaum und Poster ausblendet. Bestehende Kategorien behalten ihr Verhalten.

Nicht angefasst werden: die zwölf bestehenden Kategorie-Definitionen, `isLifework`, `isAnamnesis`,
Buchgenerierung, Bildpfad, Hörbuch, Retention, Kostenerfassung, Beitragenden-Flow.

## 8. Ausbaustufen

**Stufe 1 — Erzählen und Lebenslauf.** Kategorie, Fragenkatalog, Interview, Spalte `cv`, Generator,
fünf Vorlagen, PDF/DOCX, Deutsch und Englisch. Fertig, wenn eine Testperson auf dem Handy in
mehreren Sitzungen erzählt und daraus fünf Vorlagen ohne erfundene Angaben entstehen.
*Grobe Größenordnung: 6–9 Tage.*

**Stufe 2 — Kompetenzprofil und Dokumente.** Rubrik einlesen, Belegsuche, Einstufung mit
Konsistenzprüfung, Gegenprobe, Ausgabe-Check, Renderer; Upload von Zeugnissen mit OCR und
Bestätigung durch die Person; Gesprächsleitfaden. Fertig, wenn ein Profil keine Aussage ohne Beleg
und kein verbotenes Wort enthält.
*Grobe Größenordnung: 8–12 Tage (ohne Evaluationskorpus).*

**Stufe 3 — Fragen ans Profil, Match, Kompass-Übergabe.** Je nach Bedarf einzeln.
*Grobe Größenordnung: 6–10 Tage.*

## 9. Offene Punkte

1. ~~**AVOCA-Rubrik** von Tobias.~~ **Erledigt, aber anders als geplant:** Es kommt keine Rubrik mehr.
   Sie ist deshalb hausintern formuliert und liegt als `src/avocaRubric.js` vor — fünf Dimensionen mit
   je fünf Stufen in Handlungssprache, Belegsituationen und Gegenbelegen, Version 1.0. Jedes erzeugte
   Profil trägt die Version sichtbar, damit eine spätere Rubrik sie ersetzen kann, ohne bereits
   erzeugte Profile zweideutig zu machen.
2. **Produktname und Slug.** Arbeitsname hier: Kategorie „Lebenslauf", Slug `career`.
3. **Rechtliche Einordnung.** Der EU AI Act stuft KI-Systeme für Auswahlentscheidungen als
   Hochrisiko ein (Anhang III Nr. 4, Pflichten ab 2. Dezember 2027). Ob das hier greift, hängt an
   der **Zweckbestimmung**: Ein Werkzeug, mit dem eine Person ihren eigenen Lebenslauf erstellt und
   selbst weitergibt, ist etwas anderes als ein Werkzeug, das einer Personalberatung Kandidaten
   bewertet. Der Zuschnitt dieser Kategorie — die Person erzählt über sich, bekommt alles, gibt
   selbst weiter, es gibt keine Rangfolge, keinen Schwellenwert und keine automatische Entscheidung
   — zielt bewusst auf die erste Lesart. Das ist eine **Bauentscheidung, keine Rechtsauskunft**; vor
   dem Vertrieb an Personalberatungen gehört die Frage anwaltlich geklärt. Die Vermarktung sollte
   bis dahin nicht mit Auswahl- oder Eignungsaussagen arbeiten.
4. **Konsistenz-Toleranz für die Einstufung.** Wiederholte Einstufung derselben Erzählung streut.
   Es braucht eine benannte Toleranz (Vorschlag: höchstens eine Stufe), sonst ist keine
   Qualitätsschwelle prüfbar.
5. **Kosten je Profil.** Mehrfach-Einstufung über fünf Dimensionen mit Gegenprobe und Ausgabe-Check
   ist der dominante Kostenposten. Wird über `cost_events` wie gehabt erfasst; die Kalkulation
   sollte vor Stufe 2 stehen.
