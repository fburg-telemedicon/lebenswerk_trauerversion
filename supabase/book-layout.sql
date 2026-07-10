-- supabase/book-layout.sql — Buchlayout (Typografie) pro Gedenkbuch.
-- Einmalig im Supabase-SQL-Editor ausführen (idempotent).
-- Werte: 'classic' | 'modern' | 'elegant' (siehe src/bookLayouts.js).
-- Bestehende Bücher bleiben NULL → werden wie 'classic' behandelt (keine Änderung).
alter table memorials add column if not exists book_layout text default 'classic';
