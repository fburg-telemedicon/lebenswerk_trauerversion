-- ================================================================
-- Lebenswerk – Foto-Upload als Tab im Interview (pro Buch)
-- Einmalig ausführen in: Supabase Dashboard → SQL Editor → New query → Run
-- ================================================================
--
-- Steuert, ob der Foto-Upload den Beitragenden WÄHREND des Interviews als eigener
-- Tab (Interview | Foto-Upload) angeboten wird. Ist die Option gesetzt, erscheint
-- die untere Tab-Leiste mit dem Foto-Upload. Ist sie NICHT gesetzt, gibt es gar
-- keine Möglichkeit, Fotos hochzuladen (auch nicht nach dem Interview). Standard:
-- AUS. Einstellbar im Expertenmodus bei der Buchanlage bzw. in den Auftragsdaten
-- der Detailseite.

alter table memorials add column if not exists photo_upload_tab boolean not null default false;
