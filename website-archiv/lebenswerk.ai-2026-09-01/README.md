# Archiv: lebenswerk.ai, Stand 2026-09-01

Wortgetreue Kopie der Seite, wie sie an diesem Tag bei **Netlify** online stand
— gezogen mit `curl` von `https://lebenswerk.ai/`. Zweck: Sobald die Domain
umzieht, ist der bisherige Auftritt nicht verloren, und man kann nachsehen, was
dort einmal stand.

**Dieser Ordner wird nicht ausgeliefert.** Das `Dockerfile` kopiert nur
`api/`, `public-site/`, `scripts/`, `server.js`, `changelog.json` und `dist/`
ins Laufzeit-Image.

## Was drin ist

| Datei | |
|---|---|
| `index.html` | Einstiegsdokument |
| `assets/index-K4CUZZhm.js` | die gesamte Anwendung (kompilierte React-SPA, 634 KB) |
| `assets/index-CiCJ3mtA.css` | Stylesheet (130 KB) |
| `lovable-uploads/*.png` | Bilder |
| `favicon.png`, `robots.txt`, `sitemap.xml` | |

## Was man daraus NICHT machen kann

Es ist ein **Build, kein Quelltext**. Die Seite wurde mit *Lovable* gebaut; der
Quelltext liegt woanders. Aus diesen Dateien lässt sich die Seite anzeigen,
aber nicht sinnvoll weiterentwickeln. Außerdem hängt der Build an fremden
Diensten, die wir nicht kontrollieren:

* `cdn.gpteng.co/gptengineer.js` (Lovable-Editor-Skript)
* `xipdzbnxfpxhaxydvcpa.supabase.co` (Warteliste/Newsletter — fremdes
  Supabase-Projekt; unsere Produktion nutzt seit dem Azure-Umzug kein Supabase mehr)
* `plausible.io` (Zugriffsstatistik)
* `app.ecwid.com` (Shop, Filiale 126140019)

Deshalb wird dieser Build **nicht** weiterbetrieben. Die gepflegte Fassung der
Seite steht in `public-site/lebenswerk/`; sie gibt denselben Inhalt wieder und
teilt sich Rechtstexte, Shop und Kontaktformular mit lebensgeschichten.ai.

## Inhalt der Seite zu diesem Zeitpunkt

* **Startseite** — Wort-Bild-Marke, „Unsere Website wird derzeit überarbeitet.
  Unser Shop bleibt weiterhin für Sie geöffnet.", Schaltfläche *Zum Shop*,
  Fußzeile mit Impressum / Datenschutz / AGB / Widerruf / Cookie-Einstellungen.
* **/kaufen** — Ecwid-Shop (u. a. „Lebenswerk.AI Demo – Nutzung bis zu
  3 Minuten" 0,00 €, „Lebenswerk.AI – inkl. 1 gedrucktes Buch" 249,00 €,
  „ein Lebenswerk spenden – inkl. 1 gedrucktes Buch" 249,00 €) plus
  Warteliste/Newsletter-Formular.
* **/impressum, /datenschutz, /agb, /widerruf** — Rechtstexte der
  Lebenswerk.AI GmbH, inhaltlich dieselben wie in `src/LegalPages.jsx` und
  `AGB.md`; die AGB verweisen ausdrücklich auf die Anwendung
  lebensgeschichten.ai.
* `robots.txt` sperrt die ganze Seite für Suchmaschinen
  („Die Website ist derzeit auf eine minimale Webpräsenz reduziert.").
* Mehrsprachig angelegt (de/en/fr/it/es/nl/pl/tr).

Domain-, DNS- und E-Mail-Bestand: `infra/DOMAIN-LEBENSWERK-AI.md`.
