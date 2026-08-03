# Betriebs-Runbook DSGVO (Phase 5)

Praktische Abläufe für den laufenden Betrieb der Lebensgeschichten-App.
Verantwortlicher: **Lebenswerk.AI GmbH**, Seegebiet Mansfelder Land (GF Prof. Dr. med. Tobias D. Gantner).
Stand: 2026-08-03.

> Zuständige Aufsichtsbehörde (Unternehmenssitz Seegebiet Mansfelder Land,
> Sachsen-Anhalt): **Landesbeauftragte für den Datenschutz Sachsen-Anhalt**,
> Otto-von-Guericke-Straße 34a, 39104 Magdeburg (Postfach 1947, 39009 Magdeburg).
> - **Meldung nach Art. 33** über das Online-Formular „Datenschutzverletzung":
>   `datenschutz.sachsen-anhalt.de/service/online-formulare/datenschutzverletzung`
> - Telefon 0391 81803-0, Fax 0391 81803-33. Erreichbar Mo–Do 8–12 und 14–15:30 Uhr,
>   Fr 8–13 Uhr — die 72-Stunden-Frist läuft auch außerhalb dieser Zeiten, deshalb
>   ist das Formular der Regelweg.

---

## 1. Data-Breach-Prozess (Art. 33 / 34 DSGVO)

Eine „Verletzung des Schutzes personenbezogener Daten" ist jede Vernichtung,
Verlust, Veränderung oder unbefugte Offenlegung von / unbefugter Zugang zu
Daten — z. B. Datenleck, Hack, fehlgeleitete Daten, Ransomware, verlorenes
Gerät mit Zugriff, kompromittierter Admin-Account.

**Die 72-Stunden-Frist (Art. 33) läuft ab Kenntnisnahme.** Lieber früh und
unvollständig melden als zu spät.

### Sofortmaßnahmen (Stunde 0–4) — Eindämmen
1. **Vorfall festhalten:** Wer hat wann was bemerkt? (Zeitstempel notieren.)
2. **Eindämmen:** betroffene Zugänge sperren. Konkret möglich:
   - `ADMIN_TOKEN_SECRET` in der Container-App neu setzen → invalidiert **alle** Admin-Sessions.
   - Verdächtige `app_users` im Admin-Panel löschen/Passwort zurücksetzen.
   - Bei Key-Verdacht: `AZURE_OPENAI_KEY` / `AZURE_SPEECH_KEY` / `AZURE_FLUX_KEY` / `AZURE_STORAGE_KEY` / `DATABASE_URL` beim Anbieter rotieren und als Container-App-Secret ersetzen.
3. **Beweise sichern:** Audit-Log (Admin → „Audit-Log") sowie die Protokolle der Container-App und der Datenbank sichten und exportieren, bevor sie rotieren.

### Bewerten (Stunde 4–24)
4. **Art & Umfang:** Welche Daten? (Hier potenziell Art.-9-Daten: Stimme,
   Gesundheits-/Todesumstände, ggf. Religion.) Wie viele Betroffene?
5. **Risiko für die Betroffenen** einschätzen (gering / hoch). Bei sensiblen
   Daten ist „hoch" der Regelfall.

### Melden
6. **An die Aufsichtsbehörde (Art. 33):** binnen **72 h**, außer die Verletzung
   führt „voraussichtlich nicht zu einem Risiko". Im Zweifel melden.
   Inhalt: Art der Verletzung, betroffene Kategorien/Anzahl, wahrscheinliche
   Folgen, ergriffene Maßnahmen, Kontaktstelle.
7. **An die Betroffenen (Art. 34):** unverzüglich, wenn **hohes Risiko**.
   In klarer Sprache: was ist passiert, mögliche Folgen, Empfehlungen,
   Kontaktstelle. (Kontaktdaten: aus `app_users` / `contributions`.)
8. **Dokumentieren (Art. 33 Abs. 5):** **jede** Verletzung intern festhalten
   (auch nicht gemeldete), inkl. Begründung der Melde-Entscheidung →
   Vorfallregister (siehe unten).

### Nach dem Vorfall
9. Ursache beheben, Maßnahme in `SICHERHEIT.md` / dieser Datei nachziehen,
   ggf. DSFA aktualisieren.

---

## 2. Regelmäßige Reviews & Löschläufe

### Automatisch (bereits aktiv)
- **Aufbewahrungs-Löschung:** `api/cron/purge.js`, täglich 03:00 als
  Container-Apps-Job (`lebenswerk-web-cron-purge`). Löscht die Eingangsdaten
  **90 Tage nach Ende der Nutzungsdauer** — Nutzungsdauer = `funeral_date`, sonst
  `created_at` + `LICENSE_MONTHS` (6). Anamnese-Projekte werden 14 Tage nach der
  Anlage vollständig gelöscht (Beiträge, Kosten-Events, Storage-Bilder, Zeile).
- **Housekeeping:** derselbe Lauf entfernt abgelaufene `rate_limits` und
  `audit_log`-Einträge > 365 Tage.

### Manuell – Checkliste

**Monatlich**
- [ ] Audit-Log sichten (Admin → „Audit-Log"): auffällige Login-Fehlschläge,
      unerwartete Löschungen, fremde IPs?
- [ ] Dry-Run der Löschung prüfen: `GET /api/cron/purge?dry=1` (mit Bearer
      `CRON_SECRET`) — kommen die fälligen Bücher wie erwartet?
- [ ] Aktive `app_users` durchsehen: nur benötigte Konten, korrekte Kategorien.

**Quartalsweise**
- [ ] Zugriffsrechte/Personal: ausgeschiedene Personen → Konten löschen,
      Secrets rotieren.
- [ ] Abhängigkeiten aktualisieren (`npm outdated`), bekannte Lücken prüfen.
- [ ] Backup-/Restore der Datenbank (Point-in-Time-Wiederherstellung) stichprobenartig verifizieren.

**Jährlich**
- [ ] DSFA und Verzeichnis der Verarbeitungstätigkeiten (Art. 30) aktualisieren.
- [ ] AVV mit allen aktiven Auftragsverarbeitern auf Aktualität prüfen: Microsoft
      (Azure OpenAI, AI Speech, Foundry/FLUX, Datenbank, Blob Storage, Container
      Apps, Microsoft 365/Graph, GitHub) sowie Ecwid/Lightspeed für den Online-Shop.
      Keine US-Pfade in der Anwendung.
- [ ] `SICHERHEIT.md` (TOM) und dieses Runbook überprüfen.

---

## 3. Vorfallregister (Art. 33 Abs. 5)

Jeden Vorfall hier oder in einem separaten geschützten Dokument festhalten:

| Datum | Entdeckt von | Art des Vorfalls | Betroffene Daten/Anzahl | Risiko | Behörde gemeldet? (Datum) | Betroffene informiert? | Maßnahmen |
|---|---|---|---|---|---|---|---|
| | | | | | | | |
