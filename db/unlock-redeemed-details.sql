-- Migration: Beim Einlösen eines Freischaltcodes zusätzlich festhalten, WER ihn
-- eingelöst hat — Name des Buchs und Konto des Inhabers.
--
-- Ausführen ist optional: api/_lib/unlockcodes.js legt die Spalten beim ersten
-- Zugriff selbst an (ensureUnlockSchema, `add column if not exists`). Diese
-- Datei dokumentiert die Änderung und kann einmalig ausgeführt werden:
--   psql "$DATABASE_URL" -f db/unlock-redeemed-details.sql
--
-- Beide Werte sind eine MOMENTAUFNAHME aus dem Zeitpunkt des Einlösens
-- (siehe api/redeem.js) — bewusst kopiert statt über redeemed_memorial gejoint,
-- damit die Zuordnung erhalten bleibt, wenn das Buch später gelöscht
-- (Aufbewahrungsfrist) oder umbenannt wird. Bereits eingelöste Altcodes bleiben
-- leer; für sie gab es die Angaben nie.

alter table unlock_codes
  add column if not exists redeemed_name  text,
  add column if not exists redeemed_owner text;
