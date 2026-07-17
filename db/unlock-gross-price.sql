-- Migration: Bruttopreis (inkl. MwSt.) je Freischaltcode/Gutschein festhalten.
--
-- Ausführen ist optional: api/_lib/unlockcodes.js legt die Spalte beim ersten
-- Zugriff selbst an (ensureUnlockSchema, `add column if not exists`). Diese
-- Datei dokumentiert die Änderung und kann einmalig ausgeführt werden:
--   psql "$DATABASE_URL" -f db/unlock-gross-price.sql
--
-- Der Preis liegt in CENT (ganzzahlig), damit keine Rundungsfehler entstehen —
-- 49,90 € = 4990. Er ist eine reine Kaufmanns-Notiz am Code (wie `note`); das
-- Einlösen (api/redeem.js) prüft ihn nicht. Altcodes bleiben leer (NULL).

alter table unlock_codes
  add column if not exists gross_price_cents integer;
