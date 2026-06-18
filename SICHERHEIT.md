# Sicherheit & technische Maßnahmen (TOM)

Kurzdokumentation der technischen Schutzmaßnahmen der Gedenkbuch-App
(DSGVO Art. 32). Stand: 2026-06-18. Produktion: lebensgeschichten.vercel.app.

## 1. Verschlüsselung

**In Transit (Übertragung)**
- Die App wird ausschließlich über HTTPS/TLS ausgeliefert (von Vercel erzwungen).
- Alle Backend-Aufrufe an Drittanbieter laufen über HTTPS:
  - Anthropic (Claude): `https://api.anthropic.com`
  - OpenAI (TTS/STT/Bild): `https://api.openai.com`
  - Supabase: TLS-gesicherte Verbindung
- Keine unverschlüsselten (`http://`) Produktivverbindungen im Code.

**At Rest (Speicherung)**
- Supabase-Datenbank (Postgres) und Storage-Bucket `memorial-images`:
  serverseitig AES-256-verschlüsselt (Supabase-Standard).
- Vercel-Umgebungsvariablen (Secrets): verschlüsselt gespeichert.

## 2. Secret-Management

- Secrets liegen ausschließlich in Vercel-Umgebungsvariablen (Production), lokal
  in einer nicht versionierten `.env`.
- `.gitignore` schließt `.env` / `.env.*` aus; eine `.env` wurde nie committet
  (Git-History geprüft).
- **Das Frontend referenziert keine einzige Umgebungsvariable** — alle
  Geheimnisse bleiben serverseitig in den `/api/*`-Functions. Der Browser
  spricht nur die eigene API an, nie direkt Anthropic/OpenAI/Supabase.
- Service-Role-Key: nur im Backend, umgeht RLS bewusst (siehe RLS unten).
- Pflicht-Secrets siehe `CLAUDE.md` → „Required environment variables".

**Rotation (organisatorisch):** Bei Verdacht oder Personalwechsel die Keys beim
jeweiligen Anbieter neu erzeugen und in Vercel (Production + Preview) ersetzen;
`ADMIN_TOKEN_SECRET`-Wechsel invalidiert alle laufenden Admin-Sessions.

## 3. Zugriffs-/Audit-Logging

- Dauerhaftes Audit-Log in Supabase (`audit_log`, SQL: `supabase/audit.sql`),
  da Vercel-Logs auf dem Hobby-Plan flüchtig sind.
- Geschrieben über `api/_lib/audit.js` (fail-open: ein Logging-Fehler bricht
  nie die eigentliche Aktion ab). **PII-arm**: nur Akteur (uid), Aktion,
  Ziel-Code/-ID, IP, Zeitstempel — keine Inhalte, kein Passwort-Material.
- Protokollierte Aktionen:
  - `login.success`, `login.failure`
  - `memorial.create`, `memorial.delete`, `memorial.update`
  - `contribution.delete`
  - `user.create`, `user.update`, `user.delete`
- **Auswertung:** über das Supabase-Dashboard (Tabelle `audit_log`).
- **Aufbewahrung:** Einträge älter als 365 Tage werden vom täglichen
  Cron-Lauf (`api/cron/purge.js`) automatisch entfernt.

## 4. Zugriffskontrolle (Kurzüberblick)

- Admin-Endpunkte: HMAC-signierter Bearer-Token mit 12 h Ablauf
  (`api/_lib/auth.js`), keine unsicheren Defaults.
- Mehrbenutzer-Isolation: Nicht-Admins sehen/bearbeiten nur eigene
  Gedenkbücher (`api/_lib/access.js`).
- Öffentlicher Beitragenden-Flow: ein Beitrag nur per geheimer Beitrags-ID
  (Capability); `/api/memorial` liefert nur eine Feld-Allowlist.
- Offene KI-Proxies an gültigen Code gebunden + Rate-Limiting
  (`api/_lib/ratelimit.js`), Login zusätzlich Brute-Force-gebremst.
- RLS auf allen Tabellen aktiviert, keine Policies → nur `service_role`
  (Backend) greift zu (`supabase/rls.sql`).

## Einzuspielende SQL-Skripte (Supabase SQL-Editor)

Einmalig in Produktion auszuführen (idempotent):
`schema.sql`, `users.sql`, `consent.sql`, `rls.sql`, `ratelimit.sql`,
`audit.sql`.
