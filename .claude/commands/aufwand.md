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
1. Master-Sheet lesen (Google Sheets CSV-Export, Redirect folgen):
   `https://docs.google.com/spreadsheets/d/11s1sb8MfCwuIcQByJJQra5XnHblRivnv/export?format=csv`
   Alternativ, falls die Microsoft-365-Anbindung autorisiert ist, dieselbe Tabelle aus
   SharePoint (`/s/FlorianBurgData`) lesen.
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
