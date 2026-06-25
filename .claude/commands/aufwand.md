---
description: Aufwandsschätzungen (Spalten N & O) aus dem Master-Sheet als .xlsx erzeugen
---

Ziel: Für das Master-Backlog die zwei Aufwandsspalten schätzen und eine .xlsx zum
manuellen Übertragen erzeugen. Bezug zur Ursprungstabelle über Spalte A (Nr.) +
Kurzbeschreibung, damit Florian bemerkt, falls sich das Master-Sheet zwischenzeitlich
geändert hat.

Spaltendefinition (laut Florian, nicht nach Kopfzeilentext):
- Spalte N = **Florians Aufwand**: prompten, Rückfragen beantworten, Nebenaufgaben
  (z. B. DPAs runterladen), rudimentäres Testen (nur ob das Richtige gebaut wurde).
- Spalte O = **mein Coding-Aufwand** inkl. Rückfragen etc.

Dezimalstellen IMMER mit Komma (z. B. `0,4`), nicht mit Punkt.
Schätzungen tendenziell eher knapp halten.

Ablauf:
1. Master-Sheet lesen. **Maßgebliche Quelle ist die SharePoint-Tabelle** (M365,
   `/s/FlorianBurgData`) — hier wird gearbeitet:
   `https://hcfuturists.sharepoint.com/:x:/s/FlorianBurgData/IQBYBWwSJ3wWQ7Q8YqD9TRNWAQfnVY2G2GRMh0ctlTsfH2o?e=TDvq2z`
   - Lesen geht nur mit autorisierter **Microsoft-365-Anbindung** (MCP via `/mcp`).
     Ohne diese liefert der Freigabelink **403** (kein anonymer Zugriff).
   - Ist keine M365-Anbindung verfügbar: Florian um die aktuellen Daten bitten
     (lokal exportierte/synchronisierte .xlsx-Datei mit Pfad, oder Backlog-Zeilen
     A/N/O als Text/Screenshot) — **nicht raten**.
   - Das frühere Google-Sheet (`docs.google.com/.../11s1sb8…/export?format=csv`) ist
     nur noch ein **veralteter Spiegel** und darf NICHT als Wahrheit dienen.
2. Nur Backlog-Zeilen mit einer echten `Nr.` betrachten. **Nur dort schätzen, wo N und O
   noch leer sind** (bestehende Einträge nicht überschreiben).
3. Für jede solche Zeile N und O in Stunden (Komma-Dezimal) schätzen; Ausreißer kurz
   begründen.
4. `data.json` im Scratchpad schreiben:
   `{ "rows": [ ["<Nr>","<Kurzbeschreibung>","<N>","<O>"], ... ] }`
5. Generator laufen lassen:
   `node tools/aufwand-xlsx.mjs <scratchpad>/data.json "Aufwandsschaetzung_Spalten_N_O.xlsx"`
   (schreibt die .xlsx ins Projekt-Stammverzeichnis; benötigt kein npm-Paket).
6. Die geschätzten Werte zusätzlich als Markdown-Tabelle in die Antwort schreiben.
