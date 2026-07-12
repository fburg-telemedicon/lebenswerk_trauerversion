-- ================================================================
-- Lebenswerk – Serverseitige Generierungs-Jobs (Buch / Bilder / Rede)
-- Einmalig ausführen in: Supabase Dashboard → SQL Editor → New query → Run
-- ================================================================
--
-- Grundlage für die serverseitige, verbindungs-robuste Erstellung: Statt dass der
-- Browser die vielen KI-/Bild-Schritte selbst orchestriert (bricht bei Verbindungs-
-- abbruch ab), wird ein Job angelegt und ein Worker (Cron mit Selbst-Fortsetzung,
-- analog api/cron/transcript-check.js) arbeitet ihn schrittweise ab und speichert
-- nach jedem Schritt den Fortschritt. Das UI pollt nur noch den Status.
--
-- RLS an, KEINE Policy → nur das Backend (service_role) hat Zugriff (wie die
-- übrigen Tabellen, siehe supabase/rls.sql).

create table if not exists generation_jobs (
  id           uuid primary key default gen_random_uuid(),
  memorial_id  text references memorials(id) on delete cascade,
  kind         text not null,                          -- 'book_v1' | 'book_v2' | 'eulogy' | 'images'
  status       text not null default 'queued',         -- queued | running | done | error | canceled
  params       jsonb,                                  -- Eingaben (lang, style, variant, …)
  progress     jsonb not null default '{}'::jsonb,     -- { phase, step, total, message }
  result       jsonb,                                  -- Ergebnis (z. B. Buch-JSON) oder null
  error        text,
  owner_user   uuid,                                   -- auslösende:r Benutzer:in oder null (Env-Admin)
  attempts     integer not null default 0,
  chain        integer not null default 0,
  locked_at    timestamptz,                            -- Worker-Lock gegen Doppelverarbeitung
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists generation_jobs_pending_idx on generation_jobs (status, created_at);
create index if not exists generation_jobs_memorial_idx on generation_jobs (memorial_id);

alter table generation_jobs enable row level security;
