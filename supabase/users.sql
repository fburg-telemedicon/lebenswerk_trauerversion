-- ================================================================
-- Lebenswerk – Benutzer & Produktkategorien
-- Ausführen in: Supabase Dashboard → SQL Editor → New query → Run
-- ================================================================
--
-- Führt das Mehrbenutzer-System ein:
--   - app_users : einzelne Login-Benutzer. Jeder Benutzer hat seine eigene
--                 Liste freigeschalteter Produktkategorien
--                 (allowed_categories). Passwörter werden als scrypt-Hash +
--                 Salt gespeichert (siehe api/_lib/auth.js).
--
-- Der Env-Admin (ADMIN_USERNAME/PASSWORD) bleibt davon unberührt – er ist
-- Superuser und sieht alle Kategorien, ohne in app_users zu stehen.
--
-- Hinweis: Das frühere Kundengruppen-Modell (customer_groups + group_id +
-- memorials.owner_group) wird hier entfernt; Berechtigungen hängen jetzt
-- direkt am Benutzer (allowed_categories) und Bücher am Ersteller
-- (memorials.owner_user).
--
-- Idempotent: kann gefahrlos mehrfach ausgeführt werden.
-- ================================================================

create extension if not exists pgcrypto;  -- für gen_random_uuid()

create table if not exists app_users (
  id                 uuid         primary key default gen_random_uuid(),
  username           text         unique not null,
  pw_hash            text         not null,
  pw_salt            text         not null,
  allowed_categories text[]       not null default '{}',  -- Slugs aus api/_lib/categories.js
  is_admin           boolean      not null default false,
  created_at         timestamptz  default now()
);

-- Migration bestehender Installationen (vom Gruppen- aufs Benutzer-Modell)
alter table app_users add    column if not exists allowed_categories text[] not null default '{}';
alter table app_users drop   column if exists group_id;

-- ----------------------------------------------------------------
-- Produktkategorie + Ersteller auf bestehenden memorials
-- ----------------------------------------------------------------
alter table memorials add  column if not exists product_category text not null default 'memorial';
alter table memorials add  column if not exists owner_user uuid references app_users(id) on delete set null;
alter table memorials add  column if not exists intake jsonb;
alter table memorials add  column if not exists languages text[] not null default '{de}';  -- angebotene Sprachen (de/pl/en)
alter table memorials add  column if not exists note text;  -- interne Bemerkung zum Buch (bei Anlage + Bucherstellung sichtbar)
alter table memorials drop column if exists owner_group;

create index if not exists memorials_owner_user_idx on memorials(owner_user);

-- Altes Gruppen-Modell aufräumen
drop table if exists customer_groups;

-- ----------------------------------------------------------------
-- RLS aktivieren (keine Policies => nur service_role greift zu)
-- ----------------------------------------------------------------
do $$
begin
  if to_regclass('public.app_users') is not null then
    alter table public.app_users enable row level security;
    alter table public.app_users force  row level security;
    revoke all on table public.app_users from anon;
    revoke all on table public.app_users from authenticated;
    raise notice 'RLS aktiviert + Rechte entzogen: app_users';
  end if;
end $$;
