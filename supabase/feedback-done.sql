-- ================================================================
-- Lebenswerk – Feedback-Einträge als „erledigt" markieren (QM)
-- Einmalig ausführen in: Supabase Dashboard → SQL Editor → New query → Run
-- ================================================================
--
-- Erlaubt im Qualitätsmanagement, eine Bewertung per Haken als „erledigt" zu
-- kennzeichnen (bleibt sichtbar, wird nur markiert). Löschen entfernt die
-- Bewertung von der Contribution (feedback_* wieder NULL) – die Contribution
-- selbst bleibt bestehen.

alter table contributions add column if not exists feedback_done boolean not null default false;
