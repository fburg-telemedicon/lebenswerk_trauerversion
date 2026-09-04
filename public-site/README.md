# public-site/ — die Websites

In diesem Ordner liegen die **öffentlichen Websites**, die `server.js` auf „/"
ausliefert. Die Anwendung selbst (SPA aus `dist/`) liegt auf derselben Herkunft
unter `/app` bzw. auf „/" mit einem der App-Parameter (`?code=`, `?zugang`, …).

    public-site/
      index.html          ← Startseite lebensgeschichten.ai
      mamazone.html       ← Projektseite mamazone Edition (nur lebensgeschichten.ai)
      kontakt.html        ← Kontaktformular (beide Domains)
      img/                ← Bilder der Lebensgeschichten-Startseite
      lebenswerk/
        index.html        ← Startseite lebenswerk.ai
      _shared/
        site.css          ← gemeinsames Stylesheet
        kaufen.html       ← Shop (eine Ecwid-Filiale, beide Domains)

## Was sich beide Websites teilen

Alles, was es aus rechtlichen oder kaufmännischen Gründen nur **einmal** geben
darf, existiert genau einmal:

| Sache | Wo sie lebt | Wie beide Seiten sie nutzen |
|---|---|---|
| Impressum, Datenschutzerklärung | `src/LegalPages.jsx` | Link auf `/app#impressum` bzw. `/app#datenschutz` |
| AGB, Widerrufsbelehrung | `AGB.md` (dieselbe Datei baut auch das Kunden-PDF) | Link auf `/app#agb`, `/app#widerruf` |
| Shop | Ecwid-Filiale **126140019**, eingebunden in `_shared/kaufen.html` | Route `/kaufen` unter beiden Domains |
| Kontakt | `kontakt.html` → `POST /api/support` | Route `/kontakt` unter beiden Domains |
| Aussehen | `_shared/site.css` | `<link rel="stylesheet" href="/_shared/site.css">` |

Zusätzlich leitet `server.js` die **alten lebenswerk.ai-Adressen**
`/impressum`, `/datenschutz`, `/agb`, `/widerruf` auf die `/app#…`-Seiten
weiter. Diese Adressen stehen in der `sitemap.xml` der alten Seite und damit im
Google-Index; sie dürfen beim Umzug nicht ins Leere laufen.

## mamazone-Seite

`mamazone.html` ist die Projektseite zur **mamazone Edition** (Lebensgeschichten
für Frauen mit Brustkrebs, gemeinsam mit mamazone e. V.). Sie hängt im Menü von
lebensgeschichten.ai; auf lebenswerk.ai ist sie bewusst nicht verlinkt.

Erzeugt wird sie von `.lwab/mamazone-seite.mjs` (untracked). Das Skript **kopiert
den `<style>`-Block und die Fusszeile aus `index.html`**, statt sie abzutippen —
so kann die Seite optisch nicht auseinanderlaufen. Nach Änderungen an der
Startseite das Skript erneut laufen lassen.

Bewusst **nicht** übernommen aus der Arbeitsfassung, die als Vorlage diente:
* das **Anmeldeformular** — es erhebt Gesundheitsdaten (Behandlungsstatus,
  metastasiert ja/nein). Das ist Art. 9 DSGVO und braucht einen definierten
  Verantwortlichen, eine Rechtsgrundlage, ein Ziel für die Daten und einen
  eigenen Datenschutzhinweis. Bis das geklärt ist, führt der Handlungsaufruf auf
  `/kontakt`.
* das **mamazone-Logo** — fremde Wort-Bild-Marke, liegt uns nicht vor.

**Offen:** `index.html` und `kontakt.html` tragen ihr CSS noch inline. Sie sind
beim Anlegen der zweiten Domain bewusst unangetastet geblieben (kein Risiko für
die laufende Website) und können später auf `_shared/site.css` umgestellt
werden.

## Welche Website wird ausgeliefert?

`server.js` entscheidet am **Host** (`X-Forwarded-Host`, sonst `Host`):

* `lebenswerk.ai` / `www.lebenswerk.ai` → `lebenswerk/index.html`
* alles andere → `index.html`

Solange lebenswerk.ai noch bei Netlify liegt, ist die Weiche wirkungslos. Die
Lebenswerk-Startseite lässt sich trotzdem jederzeit unter
`https://lebensgeschichten.ai/lebenswerk` ansehen.

## Beim Umschalten der Domain zu erledigen

1. `<meta name="robots" content="noindex" />` aus `lebenswerk/index.html` und
   `_shared/kaufen.html` entfernen — der Schutz verhindert nur, dass die
   Vorschau-Adressen doppelt in den Google-Index geraten.
2. Custom Domain + Managed Certificate für `lebenswerk.ai` und
   `www.lebenswerk.ai` auf der Container App anlegen (wie bei
   lebensgeschichten.ai, siehe `infra/MIGRATION.md`).
3. DNS umstellen — Bestand und Checkliste: `infra/DOMAIN-LEBENSWERK-AI.md`.
4. Prüfen, ob die Startseite weiterhin nur der Überarbeitungs-Hinweis sein soll
   oder durch eine richtige Website ersetzt wird.
