-- ================================================================
-- Lebenswerk – Einwilligung protokollieren (DSGVO Art. 7 Abs. 1)
-- Ausführen in: Supabase Dashboard → SQL Editor → New query → Run
-- ================================================================
-- Speichert pro Beitrag, WANN und auf Basis WELCHER Textversion der/die
-- Beitragende eingewilligt hat (Nachweisbarkeit der Einwilligung).
-- Idempotent.
-- ================================================================

alter table contributions add column if not exists consent_at      timestamptz;
alter table contributions add column if not exists consent_version text;
