-- ================================================================
-- Lebenswerk – Aufbewahrungs-Löschung: Protokoll der gelöschten Beiträge
-- Einmalig ausführen in: Supabase Dashboard → SQL Editor → New query
-- ================================================================
--
-- Bei der automatischen 90-Tage-Löschung werden nur noch die einzelnen
-- Beiträge (personenbezogene Interview-Daten) gelöscht; das Gedenkbuch selbst
-- (Buch, Rede, Bilder, Dashboard-Eintrag) bleibt erhalten. Pro gelöschtem
-- Beitrag wird hier ein Eintrag (wann + warum) abgelegt:
--   { purged_at, reason, contributions: [ { ref, deleted_at, reason }, ... ] }
-- ref = Zufallstoken der Beitrags-ID (keine personenbezogenen Daten).

alter table memorials add column if not exists purge_info jsonb;
