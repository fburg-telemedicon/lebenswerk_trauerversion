-- ================================================================
-- Seed: Fragenkatalog „25 Jahre Lutherhof" (Kategorie company = Betriebsjubiläum)
-- Ausführen in: Supabase Dashboard → SQL Editor → New query → Run
-- Voraussetzung: supabase/catalogs.sql wurde bereits ausgeführt
-- (legt die Tabelle question_catalogs an).
--
-- Idempotent: Wird der Katalog (per Name) schon gefunden, passiert nichts.
-- ================================================================

insert into question_catalogs (name, product_categories, chapters)
select
  '25 Jahre Lutherhof',
  array['company']::text[],
  '[
    {
      "title": "Mein Anfang im Lutherhof",
      "questions": [
        "Wann und wie bist Du zum Lutherhof gekommen?",
        "Was war Dein erster Eindruck von der Einrichtung?",
        "Was hat Dich damals überzeugt zu bleiben?"
      ]
    },
    {
      "title": "Der Alltag im Lutherhof",
      "questions": [
        "Wie würdest Du den Alltag im Lutherhof jemandem beschreiben, der das Haus nicht kennt?",
        "Welche Momente machen Deine Arbeit besonders schön?",
        "Wann spürst Du besonders, warum Deine Arbeit wichtig ist?"
      ]
    },
    {
      "title": "Erinnerungen, die bleiben",
      "questions": [
        "Gibt es eine Begegnung mit Bewohnerinnen oder Bewohnern, die Du nie vergessen wirst?",
        "Welche gemeinsamen Erlebnisse im Team sind Dir besonders in Erinnerung geblieben?",
        "Welche Momente haben Dich stolz gemacht, Teil des Lutherhofs zu sein?"
      ]
    },
    {
      "title": "Wandel und Entwicklung",
      "questions": [
        "Wie hat sich der Lutherhof seit Deinem Beginn verändert?",
        "Was hat sich in der Pflege oder im Miteinander besonders entwickelt?",
        "Was ist über die Jahre gleich geblieben?"
      ]
    },
    {
      "title": "Zusammenarbeit & Teamgeist",
      "questions": [
        "Wie würdest Du den Zusammenhalt im Team beschreiben?",
        "Wann hast Du erlebt, dass man sich hier besonders unterstützt?",
        "Was macht das Arbeiten hier menschlich besonders?"
      ]
    },
    {
      "title": "Wünsche für die Zukunft",
      "questions": [
        "Was wünschst Du dem Lutherhof für die nächsten Jahre?",
        "Was sollte unbedingt erhalten bleiben?",
        "Welche Botschaft möchtest Du zum Jubiläum mitgeben?"
      ]
    }
  ]'::jsonb
where not exists (select 1 from question_catalogs where name = '25 Jahre Lutherhof');
