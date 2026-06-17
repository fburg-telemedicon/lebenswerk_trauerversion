-- ================================================================
-- Lebenswerk – Kundengruppen, Benutzer & Produktkategorien
-- Ausführen in: Supabase Dashboard → SQL Editor → New query → Run
-- ================================================================
--
-- Führt das Mehrbenutzer-System ein:
--   - customer_groups : eine Kundengruppe (z. B. Bestatter, Verein, Klinik)
--                       mit der Liste der für sie freigeschalteten
--                       Produktkategorien.
--   - app_users       : einzelne Login-Benutzer, jeweils einer Gruppe
--                       zugeordnet. Passwörter werden als scrypt-Hash +
--                       Salt gespeichert (siehe api/_lib/auth.js).
--
-- Der Env-Admin (ADMIN_USERNAME/PASSWORD) bleibt davon unberührt – er ist
-- Superuser und sieht alle Kategorien, ohne in app_users zu stehen.
--
-- Idempotent: kann gefahrlos mehrfach ausgeführt werden.
-- ================================================================

create extension if not exists pgcrypto;  -- für gen_random_uuid()

create table if not exists customer_groups (
  id                 uuid         primary key default gen_random_uuid(),
  name               text         not null,
  allowed_categories text[]       not null default '{}',  -- Slugs aus api/_lib/categories.js
  created_at         timestamptz  default now()
);

create table if not exists app_users (
  id         uuid         primary key default gen_random_uuid(),
  username   text         unique not null,
  pw_hash    text         not null,
  pw_salt    text         not null,
  group_id   uuid         references customer_groups(id) on delete set null,
  is_admin   boolean      not null default false,
  created_at timestamptz  default now()
);

create index if not exists app_users_group_id_idx on app_users(group_id);

-- ----------------------------------------------------------------
-- Produktkategorie + Eigentümer-Gruppe auf bestehenden memorials
-- ----------------------------------------------------------------
alter table memorials
  add column if not exists product_category text not null default 'memorial';

alter table memorials
  add column if not exists owner_group uuid references customer_groups(id) on delete set null;

alter table memorials
  add column if not exists intake jsonb;

create index if not exists memorials_owner_group_idx on memorials(owner_group);

-- ----------------------------------------------------------------
-- RLS aktivieren (keine Policies => nur service_role greift zu)
-- ----------------------------------------------------------------
do $$
declare
  t text;
  tables text[] := array['customer_groups', 'app_users'];
begin
  foreach t in array tables loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I enable row level security;', t);
      execute format('alter table public.%I force  row level security;', t);
      execute format('revoke all on table public.%I from anon;', t);
      execute format('revoke all on table public.%I from authenticated;', t);
      raise notice 'RLS aktiviert + Rechte entzogen: %', t;
    end if;
  end loop;
end $$;
