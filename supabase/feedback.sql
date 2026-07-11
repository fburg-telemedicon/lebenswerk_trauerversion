-- ================================================================
-- Lebenswerk – Beitragenden-Feedback (Qualitätsmanagement)
-- Einmalig ausführen in: Supabase Dashboard → SQL Editor → New query → Run
-- ================================================================
--
-- Nach dem Interview gibt der/die Beitragende optional eine Bewertung
-- (Smiley-Skala 1–5) + Freitext ab. Gespeichert direkt auf dem Beitrag, damit
-- es bei der Aufbewahrungs-Löschung (Art. 17) automatisch mit den übrigen
-- personenbezogenen Beitragsdaten entfernt wird.
--
-- Das QM-Dashboard (GET /api/admin/feedback) listet diese Bewertungen inkl.
-- Zeitpunkt, Name des/der Beitragenden und Bezug zum Buchprojekt.

alter table contributions add column if not exists feedback_rating  smallint;     -- 1..5 (Smiley-Skala)
alter table contributions add column if not exists feedback_text    text;         -- optionaler Freitext
alter table contributions add column if not exists feedback_at      timestamptz;  -- Zeitpunkt der Abgabe

-- Schneller Zugriff aufs QM (nur Beiträge MIT Bewertung).
create index if not exists contributions_feedback_at_idx
  on contributions (feedback_at desc)
  where feedback_at is not null;
