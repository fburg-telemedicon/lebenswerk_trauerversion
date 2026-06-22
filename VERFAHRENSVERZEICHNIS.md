# Verzeichnis von Verarbeitungstätigkeiten (Art. 30 Abs. 1 DSGVO)

Gedenkbuch-/Lebensgeschichten-App. **Entwurf — juristisch zu prüfen.**
Stand: 2026-06-22. Produktion: lebensgeschichten.vercel.app.

Dieses Dokument erfüllt zusammen mit `SICHERHEIT.md` (technische und organisatorische
Maßnahmen, Art. 32) und `BETRIEB-DSGVO.md` (Betriebs-Runbook, Art. 33/34) die
Dokumentationspflichten der Rechenschaftspflicht (Art. 5 Abs. 2).

> **Begleitende Pflichten (Phase 0 der DSGVO-Roadmap), die NICHT durch dieses
> Dokument abgedeckt sind:**
> - **DSFA (Art. 35)** — erstellt als `DSFA.md` (Entwurf, durch DSB/Jurist:in freizugeben).
> - **AVV/DPA herunterladen & archivieren** — siehe Abschnitt 6 (Checkliste).

---

## 1. Verantwortlicher & Kontakt (Art. 30 Abs. 1 lit. a)

| Feld | Angabe |
|---|---|
| Verantwortlicher | **HealthCare Futurists GmbH** |
| Sitz | Köln |
| Vertretung | Geschäftsführer Dr. Gantner |
| Kontakt Datenschutz | info@healthcarefuturists.com |
| Datenschutzbeauftragter | _[falls bestellt, hier eintragen — sonst Begründung der Nicht-Bestellung dokumentieren]_ |
| Zuständige Aufsichtsbehörde | Landesbeauftragte für Datenschutz und Informationsfreiheit NRW (LDI NRW) |

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
- **Widerruf:** jederzeit per E-Mail an info@healthcarefuturists.com; das Team löscht
  Beitrag/Buch manuell. Dokumentiert in der Datenschutzerklärung (Abschnitt 7+8).
- **Datenfluss-Landkarte:** siehe Abschnitt 7.

---

## 5. Kategorien von Empfängern / Auftragsverarbeitern (Art. 30 Abs. 1 lit. d)

Alle eingesetzten Dienste verarbeiten **ausschließlich in der EU**. Es gibt **keine
US-Fallbacks** mehr (Anthropic-LLM- und OpenAI-Sprach-Fallback am 2026-06-22 aus dem
Code entfernt).

| Auftragsverarbeiter | Leistung | Region / Standort |
|---|---|---|
| **Microsoft** (Azure OpenAI) | Interviewführung + Synthese Buch/Rede (gpt-4.1) | EU (westeurope / DataZone) |
| **Microsoft** (Azure AI Speech) | Text-to-Speech + Speech-to-Text | EU (z. B. westeurope) |
| **Microsoft** (Azure AI Foundry – FLUX.2 [pro]) | Bilderzeugung; Modell von Black Forest Labs läuft **innerhalb Azure**, keine Weitergabe an BFL | EU |
| **Supabase** | Datenbank + Bildspeicher (`memorial-images`) | EU (Frankfurt, AWS eu-central-1) |
| **Vercel** | Hosting + Auslieferung + Serverless-Functions | EU (Funktionsregion `fra1`) |
| **GitHub** (Actions) | Auslöser des täglichen Lösch-Cron (HTTP-Trigger, **keine personenbezogenen Inhalte** – nur Anstoß) | — |

> **Black Forest Labs (FLUX)** ist Modellanbieter, **erhält die Daten aber nicht** –
> die Verarbeitung findet in Microsoft Azure statt. Daher kein eigener Datenfluss zu BFL.

---

## 6. Übermittlung in Drittländer (Art. 30 Abs. 1 lit. e) + AVV-Checkliste

**Drittlandübermittlung: keine.** Sämtliche Verarbeitung und Speicherung erfolgen in
der EU/EWR. Folglich keine Stützung auf Art. 44 ff. (SCC, Angemessenheitsbeschluss,
Art. 49) erforderlich.

### AVV/DPA herunterladen, prüfen, archivieren (← „das Runterladen")

Mit **jedem** aktiven Auftragsverarbeiter muss ein AVV nach **Art. 28** bestehen. Die
Anbieter stellen Standard-DPAs bereit; jeweils die **aktuelle Fassung herunterladen,
prüfen und revisionssicher ablegen** (z. B. in einem geschützten Ordner / DMS).
URLs ändern sich — vor dem Download verifizieren.

| Anbieter | Was herunterladen | Wo (vor Download verifizieren) | Status |
|---|---|---|---|
| Microsoft (Azure) | „Microsoft Products and Services Data Protection Addendum (DPA)" | Microsoft Trust Center / Lizenzportal | ✅ Fassung Mai 2026 (DE), abgelegt 2026-06-22 in `DSGVO_AVV/` |
| Supabase | Supabase Data Processing Addendum (DPA) | Supabase-Dashboard bzw. supabase.com/legal/dpa (ggf. anfordern/gegenzeichnen) | ✅ signiert (Zertifikat), abgelegt 2026-06-22 in `DSGVO_AVV/` |
| Vercel | Vercel Data Processing Addendum (DPA) | vercel.com/legal/dpa (Pro: automatisch einbezogen) | ✅ Pro-Tarif, DPA-PDF abgelegt 2026-06-22 in `DSGVO_AVV/` |
| GitHub | GitHub Data Protection Agreement | GitHub/Microsoft Trust Center | ✅ Fassung Okt 2025 abgelegt 2026-06-22 in `DSGVO_AVV/`. **Hinweis:** GitHub ist nur Cron-Auslöser (HTTP-Trigger, keine personenbezogenen Inhalte), AVV daher vorsorglich/belt-and-suspenders archiviert. |
| Black Forest Labs | **kein eigener AVV nötig**, solange die Verarbeitung in Azure bleibt (durch Microsoft-DPA abgedeckt) | — | n/a |

**Nach dem Download festhalten:** Anbieter, Dokumenttitel, Versions-/Datumsstand,
Ablageort, ggf. Unterzeichnungsdatum. Jährliche Aktualitätsprüfung ist bereits in
`BETRIEB-DSGVO.md` (Abschnitt 2, „Jährlich") verankert.

---

## 7. Datenfluss-Landkarte

```
Beitragende/r (Browser)
   │  ?code=XXXXXX  (+ optional ?session=YYY)
   ▼
[ Vercel SPA + /api/* Functions, Region fra1 (EU) ]
   ├─ Sprache rein  → /api/transcribe → Azure AI Speech (EU)      → Text
   ├─ Frage/Antwort → /api/ask        → Azure OpenAI gpt-4.1 (EU) → Text
   ├─ Vorlesen      → /api/speak       → Azure AI Speech (EU)      → Audio
   ├─ Beitrag speichern/abrufen → Supabase (Frankfurt, EU)
   └─ Buch/Rede (Admin) → /api/ask (Azure) + /api/admin/generate-image
                                          → Azure Foundry FLUX (EU) → Bild → Supabase-Bucket
Aufbewahrung: GitHub Actions (täglich) → /api/cron/purge → Löschung nach Frist (Supabase)
```

Kein Pfeil verlässt die EU. Sekundärdaten (IP/Audit/Kosten) bleiben in Supabase (EU).

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
Supabase-RLS (kein anon/authenticated-Zugriff, nur service_role im Backend);
HMAC-signierte Admin-Tokens mit 12 h TTL, keine Default-Credentials; Mehrbenutzer-
Isolation (IDOR-geschützt); Rate-Limiting + Brute-Force-Schutz; Passwortrichtlinie;
dauerhaftes Audit-Logging; Secrets nur serverseitig.

---

## 10. Offene Punkte (Phase 0)

- [x] **DSFA (Art. 35)** erstellt als `DSFA.md` (Entwurf 2026-06-22) — finale Freigabe durch DSB/Jurist:in offen.
- [x] AVVs gemäß Abschnitt 6 herunterladen, prüfen, archivieren — **erledigt 2026-06-22** (Microsoft, Supabase [signiert], Vercel [Pro], GitHub). Alle in `DSGVO_AVV/`.
- [ ] DSB-Frage klären (bestellt? sonst Nicht-Bestellung begründen) und Abschnitt 1 vervollständigen.
- [ ] LDI-NRW-Meldewege in `BETRIEB-DSGVO.md` eintragen.
- [ ] Gesamtes Dokument **juristisch prüfen** lassen.
