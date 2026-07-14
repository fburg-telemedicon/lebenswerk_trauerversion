-- Migration: Produktkategorie „Lebenswerk" (Autobiographie) + Endnutzer-Konten.
--
-- Ausführen ist optional: api/_lib/lifework.js legt die Spalten beim ersten
-- Zugriff selbst an (ensureLifeworkSchema, `add column if not exists`). Diese
-- Datei hält den Stand nachvollziehbar fest:
--   psql "$DATABASE_URL" -f db/lifework.sql
--
-- Rollen: Admin → Manager (app_users) → Beitragende → NEU: Endnutzer.
-- Ein Endnutzer ist der Mensch, dessen Autobiographie entsteht: eigenes Login,
-- aber KEIN Dashboard — er landet nach dem Login direkt in seinem Interview.
--   is_enduser        markiert das Konto als Endnutzer-Konto
--   enduser_memorial  bindet es an genau EIN Buch (memorials.id, 6-stelliger Code)
--   lang              vom Admin vorgegebene Sprache; NULL = der Endnutzer wählt
--                     beim ersten Start selbst
--
-- Der Standard-Fragenkatalog der Kategorie (12 Sitzungen à 10 Fragen) wird beim
-- ersten Anlegen eines Lebenswerks als Zeile in question_catalogs erzeugt
-- (ensureLifeworkCatalog) und ist danach im Dashboard normal bearbeitbar.

alter table app_users
  add column if not exists is_enduser       boolean not null default false,
  add column if not exists enduser_memorial varchar(6),
  add column if not exists lang             text;
