-- ================================================================
-- Lebenswerk – Fragenkataloge (question_catalogs)
-- Ausführen in: Supabase Dashboard → SQL Editor → New query → Run
-- ================================================================
--
-- Vordefinierte Fragenkataloge für das Interview. Ein Katalog hat einen
-- Namen, ist einer oder mehreren Produktkategorien zugeordnet und besteht
-- aus Kapiteln (beliebig viele) mit je beliebig vielen Fragen:
--   chapters = [ { "title": "…", "questions": ["…", "…"] }, … ]
--
-- Kataloge legt NUR der Admin an (siehe api/admin/memorials.js ?catalogs).
-- Beim Anlegen eines Buchs wählt der Manager optional einen passenden Katalog
-- und die maximale Zahl KI-Nachfragen pro Frage (memorials.followups, Default 7).
-- Ohne Katalog überlegt die KI die Fragen wie bisher selbst (Default).
--
-- Idempotent: kann gefahrlos mehrfach ausgeführt werden.
-- ================================================================

create extension if not exists pgcrypto;  -- für gen_random_uuid()

create table if not exists question_catalogs (
  id                 uuid         primary key default gen_random_uuid(),
  name               text         not null,
  product_categories text[]       not null default '{}',  -- Slugs aus api/_lib/categories.js
  chapters           jsonb        not null default '[]',  -- [{ title, questions: [text, …] }]
  created_at         timestamptz  default now()
);

-- Verknüpfung am Buch: welcher Katalog + wie viele KI-Nachfragen pro Frage.
alter table memorials add column if not exists catalog_id uuid references question_catalogs(id) on delete set null;
alter table memorials add column if not exists followups  int not null default 7;

create index if not exists memorials_catalog_id_idx on memorials(catalog_id);

-- ----------------------------------------------------------------
-- RLS aktivieren (keine Policies => nur service_role greift zu)
-- ----------------------------------------------------------------
do $$
begin
  if to_regclass('public.question_catalogs') is not null then
    alter table public.question_catalogs enable row level security;
    alter table public.question_catalogs force  row level security;
    revoke all on table public.question_catalogs from anon;
    revoke all on table public.question_catalogs from authenticated;
    raise notice 'RLS aktiviert + Rechte entzogen: question_catalogs';
  end if;
end $$;
