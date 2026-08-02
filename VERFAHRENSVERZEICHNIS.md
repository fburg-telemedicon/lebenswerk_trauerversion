# Verzeichnis von Verarbeitungstätigkeiten (Art. 30 Abs. 1 DSGVO)

Gedenkbuch-/Lebensgeschichten-App. **Vom Verantwortlichen in Kraft gesetzt.**
Stand: 2026-08-02. Produktion: lebensgeschichten.ai.

Dieses Dokument erfüllt zusammen mit `SICHERHEIT.md` (technische und organisatorische
Maßnahmen, Art. 32) und `BETRIEB-DSGVO.md` (Betriebs-Runbook, Art. 33/34) die
Dokumentationspflichten der Rechenschaftspflicht (Art. 5 Abs. 2).

> **Begleitende Pflichten (Phase 0 der DSGVO-Roadmap), die NICHT durch dieses
> Dokument abgedeckt sind:**
> - **DSFA (Art. 35)** — erstellt als `DSFA.md`.
> - **AVV/DPA herunterladen & archivieren** — siehe Abschnitt 6 (Checkliste).

---

## 1. Verantwortlicher & Kontakt (Art. 30 Abs. 1 lit. a)

| Feld | Angabe |
|---|---|
| Verantwortlicher | **Lebenswerk.AI GmbH** |
| Sitz | Köln |
| Vertretung | Geschäftsführer Dr. Gantner |
| Kontakt Datenschutz | support@lebensgeschichten.ai |
| Datenschutzbeauftragter | _[falls bestellt, hier eintragen — sonst Begründung der Nicht-Bestellung dokumentieren]_ |
| Zuständige Aufsichtsbehörde | Landesbeauftragter für den Datenschutz Sachsen-Anhalt, Magdeburg (Unternehmenssitz Seegebiet Mansfelder Land) |

---

## 2. Zwecke der Verarbeitung (Art. 30 Abs. 1 lit. b)

Erstellung eines individuellen **Erinnerungs-/Gedenkwerks** (Buch bzw. Rede) aus
Beiträgen mehrerer Personen. Acht Produktkategorien: Gedenken (memorial),
Geburtstag, Jubiläum, Abschied, (Trauer-)Feier, Firma, Geburt, Ermutigung.

Teilzwecke:
1. **KI-gestütztes Interview** (Sprache oder Text) zur Sammlung von Erinnerungen.
2. **Transkription** gesprochener Beiträge (Speech-to-Text).
3. **Sprachausgabe** der KI-Rückfragen (Text-to-Speech).
4. **Synthese** von Buch/Rede aus den gesammelten Beiträgen (LLM).
5. **Bilderzeugung** für Buchkapitel (KI).
6. **Inhalts-/Datenschutzprüfung** des erzeugten Textes (LLM).
7. **Kosten- und Zugriffsprotokollierung** (Betrieb, Sicherheit, Abrechnung).

---

## 3. Kategorien betroffener Personen und personenbezogener Daten (Art. 30 Abs. 1 lit. c)

| Betroffenenkategorie | Datenkategorien | Speicherort (Tabelle/Bucket) |
|---|---|---|
| **Beitragende** (geben das Interview) | Name, Beziehung, Geschlecht, Anrede; **Stimmaufnahme**; Interviewinhalt (Freitext); Einwilligungs-Zeitstempel + -Version | `contributions` |
| **Gewürdigte Person** (z. B. Verstorbene/r) | Name, Geburts-/Sterbejahr, Geschlecht, Lebensgeschichte (im Buchtext) | `memorials`, `book_v1/v2`, `eulogy_text` |
| **In Beiträgen genannte Dritte** | Namen, ggf. Beziehungen/Anschriften lebender Hinterbliebener (im Freitext) | `contributions`, Buchtext |
| **Admin-/Kundennutzer** | Benutzername, **scrypt-Passwort-Hash + Salt**, erlaubte Kategorien, Admin-Flag | `app_users` |
| **Technische Protokolle** | IP-Adresse (Rate-Limiting, Audit), Aktions-/Login-Ereignisse (PII-arm), Kosten-Events (ohne PII) | `rate_limits`, `audit_log`, `cost_events` |

> **Besondere Kategorien (Art. 9):** Stimmaufnahmen sowie Interview-/Buchinhalte
> können **Gesundheitsdaten, Angaben zu Todesumständen und religiöse
> Überzeugungen** enthalten. → Rechtsgrundlage Art. 9 Abs. 2 lit. a (ausdrückliche
> Einwilligung), siehe Abschnitt 4.

---

## 4. Rechtsgrundlage & Einwilligung

- **Art. 6 Abs. 1 lit. a** (Einwilligung) und für besondere Kategorien
  **Art. 9 Abs. 2 lit. a** (ausdrückliche Einwilligung).
- **Protokollierung:** Pflicht-Häkchen vor dem Interview; gespeichert als
  `consent_at` + `consent_version` auf `contributions` (Migration `supabase/consent.sql`).
  Die jeweils gültige Textfassung steuert `CONSENT_VERSION` (aktuell **1.4**, 2026-06-22).
- **Widerruf:** jederzeit per E-Mail an support@lebensgeschichten.ai; das Team löscht
  Beitrag/Buch manuell. Dokumentiert in der Datenschutzerklärung (Abschnitt 7+8).
- **Datenfluss-Landkarte:** siehe Abschnitt 7.

---

## 5. Kategorien von Empfängern / Auftragsverarbeitern (Art. 30 Abs. 1 lit. d)

Stand 1. August 2026, geprüft gegen den Code (alle ausgehenden Verbindungen in
`api/`, `server.js` und `src/`). Sämtliche Dienste verarbeiten **in der EU**. Es gibt
**keine US-Fallbacks** (Anthropic- und OpenAI-Fallbacks am 2026-06-22 entfernt).

| Auftragsverarbeiter | Leistung | Region / Standort |
|---|---|---|
| **Microsoft** (Azure OpenAI, `gpt-4.1` über Foundry) | Interviewführung + Synthese Buch/Rede | EU |
| **Microsoft** (Azure AI Speech) | Text-to-Speech + Speech-to-Text | `westeurope` |
| **Microsoft** (Azure AI Speech „Voice Live") | Live-Sprachgespräch — von der erzählenden Person **frei wählbar, nie voreingestellt** | `swedencentral` (einzige EU-Region) |
| **Microsoft** (Azure AI Foundry – FLUX.2 [pro]) | Bilderzeugung; Modell von Black Forest Labs läuft **innerhalb Azure** | EU |
| **Microsoft** (Azure Database for PostgreSQL Flexible Server) | Datenbank: Bücher, Beiträge, Konten, Kosten, Audit | North Europe |
| **Microsoft** (Azure Blob Storage) | Kapitelbilder, hochgeladene Fotos, abgelegte Druck-PDFs | EU |
| **Microsoft** (Azure Container Apps + Jobs) | Betrieb der Anwendung und der vier Cron-Jobs | EU |
| **Microsoft** (Microsoft 365 / Graph API) | **E-Mail-Versand**: Zugangs- und Einladungslinks, Wiederaufnahme-Links, Tagesreport, Support-Antworten | M365-Tenant (EU) |
| **Microsoft** (GitHub Actions + Azure Container Registry) | Auslieferung neuer Programmstände — **keine personenbezogenen Inhalte** | — |

**Ein einziger Anbieter.** Nach dem Wegfall des externen QR-Dienstes (siehe unten)
verlässt kein personenbezogenes Datum den Microsoft-Verbund.

**Entfallen** (Stand hier zuvor falsch, seit der Azure-Migration am 2026-07-13 ohne
Funktion): *Supabase* (Datenbank/Bildspeicher) und *Vercel* (Hosting) sind aus der
Produktion entfernt; im Repository verbliebene Artefakte sind Rollback-Referenzen.

**Ebenfalls entfallen:** `api.qrserver.com` erzeugte bis zum 1. August 2026 die
QR-Codes im Dashboard. Dabei ging die vollständige Einladungs-URL **samt Buch-Code**
an einen Dritten — beim Lebenswerk ist dieser Code die gesamte Berechtigung des
Endnutzers. QR-Codes entstehen seither im Browser (`qrCodeDataUrl` in
`src/shared.js`); der Dienst ist aus dem Code entfernt.

> **Black Forest Labs (FLUX)** ist Modellanbieter, **erhält die Daten aber nicht** —
> die Verarbeitung findet in Microsoft Azure statt. Kein eigener Datenfluss zu BFL.

---

## 6. Übermittlung in Drittländer (Art. 30 Abs. 1 lit. e) + AVV-Checkliste

**Drittlandübermittlung: keine.** Sämtliche Verarbeitung und Speicherung erfolgen in
der EU/EWR. Folglich keine Stützung auf Art. 44 ff. (SCC, Angemessenheitsbeschluss).

### Eingehende AVVs (wir als Verantwortlicher gegenüber unseren Dienstleistern)

| Anbieter | Dokument | Status |
|---|---|---|
| Microsoft (Azure, Microsoft 365, GitHub) | „Microsoft Products and Services Data Protection Addendum (DPA)" | ✅ Fassung Mai 2026 (DE), abgelegt 2026-06-22 in `DSGVO_AVV/`. Deckt Azure-Dienste, M365/Graph und GitHub ab. |
| Black Forest Labs | kein eigener AVV nötig, solange die Verarbeitung in Azure bleibt | n/a |
| ~~Supabase~~, ~~Vercel~~ | DPAs 2026-06-22 archiviert | historisch — Dienste nicht mehr im Einsatz |

### Ausgehender AVV (wir als Auftragsverarbeiter gegenüber unseren Kunden)

Betreut ein Kunde — etwa ein Bestattungshaus, eine Klinik oder ein Unternehmen —
eigene Endkunden über die Plattform, ist **er** der Verantwortliche und die
Lebenswerk.AI GmbH **Auftragsverarbeiterin** nach Art. 28 DSGVO. Der zugehörige
Vertragsentwurf samt TOM- und Unterauftragnehmer-Anlage liegt in **`AVV.md`** und ist
vor dem ersten produktiven Kundeneinsatz zu unterzeichnen.

---

## 7. Datenfluss-Landkarte

```
Beitragende/r (Browser)
   │  lebensgeschichten.ai/?code=XXXXXXXXXX   (+ optional &session=YYY)
   ▼
[ Azure Container Apps – Express (server.js) + /api/*, EU ]
   ├─ Sprache rein   → /api/transcribe → Azure AI Speech (westeurope)     → Text
   ├─ Frage/Antwort  → /api/ask        → Azure OpenAI gpt-4.1 (EU)        → Text
   ├─ Vorlesen       → /api/speak      → Azure AI Speech (westeurope)     → Audio
   ├─ Live-Gespräch  → /api/voicelive-relay → Azure Voice Live (Schweden) → Audio
   │                   (nur wenn am Buch freigeschaltet; Default aus)
   ├─ Beitrag/Buch   → Azure Database for PostgreSQL (North Europe)
   ├─ Bilder/Uploads → Azure Blob Storage (EU, privat, SAS-signierte Lesezugriffe)
   ├─ Buch/Bilder (Manager) → /api/ask + /api/admin/generate-image
   │                          → Azure Foundry FLUX (EU) → Blob Storage
   └─ E-Mail         → Microsoft Graph (M365) → Zugangslink, Wiederaufnahme,
                       Tagesreport, Support
Aufbewahrung: Container-Apps-Job (täglich 03:00) → Löschung nach Frist (DB + Blob)
```

Kein Pfeil verlässt die EU. Sekundärdaten (IP-Rate-Limits, Audit, Kostenerfassung)
liegen in derselben Datenbank (EU). QR-Codes und Buch-PDFs entstehen im Browser der
Nutzerin bzw. des Nutzers, ohne weitere Empfänger.

---

## 8. Aufbewahrung / Löschfristen (Art. 30 Abs. 1 lit. f)

- **Beiträge (PII):** automatische Löschung nach `funeral_date` (sonst `created_at`)
  + `RETENTION_DAYS` (Standard **90 Tage**) via `api/cron/purge.js` (GitHub Actions,
  täglich 03:00 UTC). Erhalten bleiben dann nur noch das fertige Buch/die Rede
  (ohne Interview-Rohdaten); pro Beitrag wird ein Tombstone in `memorials.purge_info`
  vermerkt.
- **`audit_log`:** 365 Tage (Housekeeping im selben Cron).
- **`rate_limits`:** kurzlebig (Housekeeping).
- **Manuelle Voll-Löschung** (Admin) entfernt Buch, Beiträge, Kosten-Events und
  Storage-Bilder vollständig (`api/_lib/delete-memorial.js`).
- **Betroffenenrechte:** Auskunft/Export (Art. 15/20) als ZIP (PDF + JSON) pro
  Beitrag im Admin; Löschung (Art. 17) vollständig inkl. Storage.

---

## 9. Allgemeine Beschreibung der TOMs (Art. 30 Abs. 1 lit. g)

Vollständig in **`SICHERHEIT.md`**. Kurzfassung: TLS in transit + AES-256 at rest;
Datenbank NUR aus dem Backend erreichbar (eigener DB-Benutzer, kein oeffentlicher Endpunkt);
HMAC-signierte Admin-Tokens mit 12 h TTL, keine Default-Credentials; Mehrbenutzer-
Isolation (IDOR-geschützt); Rate-Limiting + Brute-Force-Schutz; Passwortrichtlinie;
dauerhaftes Audit-Logging; Secrets nur serverseitig.

---

## 10. Offene Punkte (Phase 0)

- [x] **DSFA (Art. 35)** erstellt als `DSFA.md` (2026-06-22, fortgeschrieben 2026-08-02).
- [x] Eingehende AVVs archiviert — **2026-06-22** (Microsoft; Supabase/Vercel historisch). Alle in `DSGVO_AVV/`.
- [x] **Abschnitte 5–7 gegen den Code geprueft und berichtigt** — 2026-08-01 (Supabase/Vercel entfernt, Datenbank/Blob/Container Apps/Graph-Mailversand/Voice Live ergaenzt, externer QR-Dienst abgeschafft).
- [ ] **Ausgehenden AVV** (`AVV.md`) mit dem ersten Kunden unterzeichnen, bevor dessen Endkunden erzaehlen.
- [ ] DSB-Frage klären (bestellt? sonst Nicht-Bestellung begründen) und Abschnitt 1 vervollständigen.
- [ ] Meldewege der Aufsichtsbehörde Sachsen-Anhalt in `BETRIEB-DSGVO.md` eintragen (Formular/Kontakt pruefen).
- [ ] Gesamtes Dokument **juristisch prüfen** lassen.
