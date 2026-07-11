-- ================================================================
-- Lebenswerk – Transkript-Anzeige im Sprach-Interview (pro Buch)
-- Einmalig ausführen in: Supabase Dashboard → SQL Editor → New query → Run
-- ================================================================
--
-- Steuert, ob Beitragenden im Sprach-Interview das Transkript ihrer Antworten
-- angezeigt wird (inkl. Möglichkeit, eine Antwort vor dem Senden zu prüfen und
-- neu einzusprechen). Standard: EIN. Einstellbar im Expertenmodus bei der
-- Buchanlage bzw. in den Auftragsdaten der Detailseite.

alter table memorials add column if not exists show_transcript boolean not null default true;
