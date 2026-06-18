-- ================================================================
-- Lebenswerk – Inhaltsprüfberichte für generierte Texte
-- Einmalig ausführen in: Supabase Dashboard → SQL Editor → New query
-- ================================================================
--
-- Speichert je generiertem Text (book_v1 / book_v2 / eulogy_text) das Ergebnis
-- der automatischen Inhalts-/Datenschutzprüfung als jsonb, keyed by Feldname:
--   { "book_v1": { checked_at, model, summary, findings: [...] }, ... }
-- Bewusst eine eigene Spalte (nicht im Buch-JSON), damit der DOCX-Export
-- unberührt bleibt und alle Textarten einheitlich behandelt werden.

alter table memorials add column if not exists content_reports jsonb;
