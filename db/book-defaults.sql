-- Migration: anwendungsweite Einstellungen (app_settings).
-- Aktuell einzige Zeile: key = 'book_defaults' — die Standardwerte, mit denen die
-- Maske „Neues Buch anlegen" vorbelegt wird (siehe api/_lib/book-defaults.js).
--
-- Ausführen ist optional: api/admin/settings.js legt die Tabelle beim ersten
-- Zugriff selbst an (create table if not exists). Diese Datei hält den Stand
-- nachvollziehbar fest und kann gegen die Azure-Postgres-Datenbank laufen:
--   psql "$DATABASE_URL" -f db/book-defaults.sql
--
-- Ohne Zeile in dieser Tabelle gelten die Fallback-Werte aus dem Code — die
-- Anlage-Maske verhält sich dann genau wie vorher.

create table if not exists app_settings (
  key        text        primary key,
  value      jsonb       not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
