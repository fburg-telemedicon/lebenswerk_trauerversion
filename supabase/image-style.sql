-- supabase/image-style.sql — Grafikstil pro Gedenkbuch.
-- Einmalig im Supabase-SQL-Editor ausführen (idempotent).
-- Werte: 'realistic' | 'watercolor' | 'pencil' (siehe api/_lib/image-styles.js).
-- Bestehende Bücher bleiben NULL → werden wie 'realistic' behandelt (keine Änderung).
alter table memorials add column if not exists image_style text default 'realistic';
