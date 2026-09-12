# Lebenswerk – KI-Biograph für Lebensgeschichten

Eine Web-App, in der ein KI-Biograph Menschen durch ein einfühlsames Interview
führt und daraus ein fertiges Buch entsteht — als gemeinsames Gedenkbuch
(mehrere Beitragende über einen geteilten Link) oder als Autobiographie
(ein Mensch erzählt sein eigenes Leben). Zwölf Produktkategorien, vierzehn
Sprachen, alle KI-Verarbeitung in der EU.

Für Entwicklung und Betrieb ist **`CLAUDE.md` die maßgebliche Dokumentation**
(Architektur, Kategorien, alle Umgebungsvariablen). Dieses README ist nur der
Einstieg.

---

## Technischer Stack

| Schicht    | Technologie                                                        |
|------------|--------------------------------------------------------------------|
| Frontend   | React + Vite (SPA ohne Router, `view`-State-Machine)               |
| Backend    | Express (`server.js`) auf **Azure Container Apps**                 |
| Datenbank  | **Azure Database for PostgreSQL** Flexible Server (North Europe)   |
| Speicher   | **Azure Blob Storage** (private Container, SAS-signierte Lesezugriffe) |
| Crons      | **Azure Container Apps Jobs** (`scripts/cron-run.js`)              |
| KI         | Azure OpenAI gpt-4.1 (Interviews + Synthese, EU) – einziges LLM, kein Fallback |
| Stimme     | Azure AI Speech (Neural TTS + Fast Transcription, EU) – einziges TTS/STT, kein Fallback |
| Bilder     | FLUX.2 [pro] via Microsoft Foundry (EU) – einziges Bildmodul, kein Fallback |

Supabase und Vercel sind seit dem Cutover am 2026-07-13 **nicht mehr im
Einsatz**. Handler rufen weiterhin `createClient()` auf, das ist aber
`api/_lib/store.js` — ein hauseigener Ersatz für `@supabase/supabase-js`, der
auf Postgres und Azure Blob aufsetzt.

---

## Lokal starten

```bash
npm install
npm run build          # Vite-Build nach dist/
node server.js         # API + dist/ auf Port 8080 (oder $PORT)
```

`server.js` registriert **jede Datei unter `api/` automatisch als Route** unter
`/api/<pfad>` (Verzeichnisse mit `_` werden übersprungen) und serviert danach
`dist/` statisch. Ein neuer Endpunkt = eine neue Datei, keine Routentabelle.

Dafür braucht es eine `.env` mit mindestens `DATABASE_URL`,
`AZURE_STORAGE_ACCOUNT` / `AZURE_STORAGE_KEY`, den Azure-KI-Keys und den
Admin-Variablen. **Die vollständige Liste mit Erklärung steht in `CLAUDE.md`**
(Abschnitt „Required environment variables") — sie ist die einzige Quelle, hier
absichtlich nicht dupliziert.

Es gibt **keine Tests, keinen Linter und keinen Typechecker**.

---

## Schema einspielen

```bash
psql "$DATABASE_URL" -f db/schema.sql
```

`db/schema.sql` ist das vollständige, idempotente Schema und kann jederzeit
erneut gefahren werden. Es ist die **einzige** Schemaquelle; neue Spalten und
Tabellen gehören dorthin.

---

## Deployen

**Push auf `main` deployt in die Produktion.**
`.github/workflows/deploy.yml` baut das Image per OIDC in der Azure Container
Registry und aktualisiert die Container App *und* alle vier Cron-Jobs auf
dasselbe Image.

Erstmalige Provisionierung bzw. Änderungen an Umgebungsvariablen laufen manuell:

```bash
infra/provision.sh     # Ressourcen anlegen (einmalig)
infra/deploy.sh        # Env-Vars/Secrets + Cron-Jobs (die Action fasst sie bewusst nicht an)
```

Runbook der Migration und des Betriebs: **`infra/MIGRATION.md`**.
Domains, DNS und Mail: **`infra/DOMAIN-LEBENSWERK-AI.md`**.

---

## Projektstruktur

```
lebenswerk/
├── server.js               ← Express: /api-Autorouting, Marketing-Sites, SPA-Fallback
├── api/
│   ├── _lib/               ← gemeinsame Module (store, llm, cost, auth, access …)
│   ├── admin/              ← /api/admin/* (Bearer-Token-Auth)
│   ├── cron/               ← purge | report | transcript-check | generate
│   └── ask.js, speak.js, transcribe.js, memorial.js, contributions.js …
├── src/
│   ├── App.jsx             ← Boot, Admin-State-Machine, Generierungs-Orchestrierung
│   ├── contributor.jsx     ← der komplette Beitragenden-/Endnutzer-Flow
│   ├── adminViews.jsx      ← die Dashboard-Ansichten
│   ├── categories.js       ← alle kategoriespezifischen Texte + KI-Prompts
│   └── bookExport.js, coverExport.js, audiobook.js … ← PDF/DOCX/E-Book/Hörbuch
├── public-site/            ← die beiden Marketing-Websites (nach Host getrennt)
├── db/schema.sql           ← kanonisches Datenbankschema
├── infra/                  ← Provisionierung, Deploy, Runbooks
├── scripts/                ← cron-run.js + Dokument-/Paketgeneratoren
└── CLAUDE.md               ← maßgebliche Architektur- und Betriebsdokumentation
```

---

## Datenschutz

Die gesamte KI-Verarbeitung läuft **in der EU** (Azure OpenAI, Azure AI Speech,
FLUX via Foundry) — kein Drittlandtransfer, keine US-Fallbacks. Die
Rechtsdokumente liegen im Repo: `DSFA.md`, `VERFAHRENSVERZEICHNIS.md`, `AVV.md`,
`BETRIEB-DSGVO.md`, `SICHERHEIT.md`, `AGB.md` sowie die Einwilligungsvorlagen.
Aufbewahrungsfristen und die automatische Löschung: `api/_lib/retention.js` —
die einzige Quelle für die Frist, sie wird nirgends sonst neu berechnet.
