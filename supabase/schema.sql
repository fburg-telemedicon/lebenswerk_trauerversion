-- ================================================================
-- Lebenswerk – Supabase Schema
-- Ausführen in: Supabase Dashboard → SQL Editor → New query
-- ================================================================

create table if not exists memorials (
  id          varchar(6)   primary key,          -- 6-stelliger Einladungscode
  name        text         not null,             -- Name der verstorbenen Person
  birth_year  text,
  death_year  text,
  organizer   text         not null,             -- Name des Organisators
  created_at  timestamptz  default now()
);

create table if not exists contributions (
  id               varchar(6)   primary key,
  memorial_id      varchar(6)   not null references memorials(id) on delete cascade,
  contributor_name text         not null,
  relationship     text         not null,
  messages         jsonb        not null default '[]',  -- Interview-Verlauf
  created_at       timestamptz  default now()
);

-- Index für schnelles Laden aller Beiträge eines Gedenkbuchs
create index if not exists contributions_memorial_id_idx
  on contributions(memorial_id);
