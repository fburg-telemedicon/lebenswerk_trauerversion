-- ================================================================
-- Lebenswerk – Sammelbestellungs-/Abholadresse für gedruckte Bücher
-- Einmalig ausführen in: Supabase Dashboard → SQL Editor → New query
-- ================================================================
--
-- Optionale Adresse, an die die gedruckten Bücher eines Gedenkbuchs gesammelt
-- geliefert/abgeholt werden. Als jsonb gespeichert mit den Feldern:
--   { name, addon, street, zip, city, country }
-- Leeres/kein Eintrag => NULL.

alter table memorials add column if not exists pickup_address jsonb;
