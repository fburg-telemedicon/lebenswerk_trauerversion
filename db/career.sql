-- Migration: Produktkategorie „Lebenslauf" (career).
--
-- Ausführen ist optional: api/_lib/lifework.js legt die Spalte beim ersten
-- Zugriff selbst an (ensureLifeworkSchema, `add column if not exists`). Diese
-- Datei hält den Stand nachvollziehbar fest:
--   psql "$DATABASE_URL" -f db/career.sql
--
-- Ein Mensch erzählt seinen eigenen Berufsweg; der Zugangscode ist seine
-- Berechtigung (Endnutzer-Kategorie wie Lebenswerk und Anamnese). Die Kategorie
-- erzeugt kein Buch — das erste Produkt ist der Lebenslauf, den die KI als
-- STRUKTUR liefert und den der Browser in fünf Vorlagen zeichnet.
--
-- Der Standard-Fragenkatalog der Kategorie wird beim ersten Anlegen als Zeile in
-- question_catalogs erzeugt (api/_lib/career.js, ensureCareerCatalog) und ist
-- danach im Dashboard normal bearbeitbar.

alter table memorials
  add column if not exists cv jsonb;
