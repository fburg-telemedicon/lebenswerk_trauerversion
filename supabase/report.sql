-- supabase/report.sql — Tagesreport: Empfängerverwaltung + Generierungs-Zeitstempel.
-- Einmalig im Supabase SQL-Editor ausführen (idempotent).

-- Empfänger des täglichen Reports (im Dashboard verwaltbar).
create table if not exists report_recipients (
  id         uuid primary key default gen_random_uuid(),
  email      text not null unique,
  name       text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- RLS an, KEINE Policies -> nur das Backend (service_role) hat Zugriff,
-- wie bei allen anderen Tabellen (siehe supabase/rls.sql).
alter table report_recipients enable row level security;

-- Heartbeat geplanter Jobs (Purge, Report …): jeder Job schreibt nach dem Lauf
-- Zeitpunkt + Status hierher. Der Tagesreport liest daraus den "Systemstatus"
-- (ist der Purge gelaufen? läuft alles, was laufen soll?).
create table if not exists job_heartbeats (
  job         text primary key,
  last_run_at timestamptz not null default now(),
  last_status text,
  detail      jsonb,
  updated_at  timestamptz not null default now()
);
alter table job_heartbeats enable row level security;

-- Generierungs-Zeitstempel, damit der Report "neu erzeugte Bücher/Nachrufe
-- gestern" exakt zählen kann. Werden serverseitig in api/admin/memorials.js beim
-- PATCH gesetzt. Für vor dieser Migration erzeugte Inhalte bleiben sie NULL
-- (der Report zählt sie dann nicht als "neu", was korrekt ist).
alter table memorials add column if not exists book_v1_at timestamptz;
alter table memorials add column if not exists book_v2_at timestamptz;
alter table memorials add column if not exists eulogy_at  timestamptz;
