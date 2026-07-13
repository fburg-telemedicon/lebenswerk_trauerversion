-- Migration: Namensliste der Beitragenden am Buchende ein-/ausschaltbar machen.
-- Einmalig gegen die Azure-Postgres-Datenbank ausführen:
--   psql "$DATABASE_URL" -f db/show-contributors.sql
-- Default = true, damit bestehende Bücher sich unverändert verhalten.

alter table memorials
  add column if not exists show_contributors boolean not null default true;
