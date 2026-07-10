-- supabase/transcript-check.sql — Transkriptions-Prüfung je Beitrag.
-- Einmalig im Supabase-SQL-Editor ausführen (idempotent).
--   transcript_checked_at   : wann der Beitrag auf Transkriptions-Rauschen geprüft
--                             wurde (NULL = noch nicht geprüft → wird beim nächsten
--                             Öffnen der Buch-Detailseite geprüft).
--   transcript_corrections  : Liste der vorgenommenen Änderungen (für Bericht + Undo):
--                             [{ id, message_index, before, after, reason, applied }]
alter table contributions add column if not exists transcript_checked_at timestamptz;
alter table contributions add column if not exists transcript_corrections jsonb not null default '[]';
