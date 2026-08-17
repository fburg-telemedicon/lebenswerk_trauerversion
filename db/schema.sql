-- ============================================================================
-- Lebenswerk – Konsolidiertes Schema für Azure Database for PostgreSQL
-- (Flexible Server). Ausführen mit psql gegen die Ziel-DB:
--     psql "$DATABASE_URL" -f db/schema.sql
--
-- Vereint die zuvor inkrementellen supabase/*.sql-Dateien in EIN idempotentes
-- Skript. KEINE Row Level Security mehr: Azure Postgres ist nicht über eine
-- öffentliche PostgREST-API erreichbar; ausschließlich das Backend verbindet
-- sich (mit einem dedizierten DB-Benutzer). Der frühere RLS-als-Firewall-Schutz
-- (gegen anon/authenticated über Supabase) entfällt damit ersatzlos.
--
-- Idempotent: kann gefahrlos mehrfach ausgeführt werden.
-- ============================================================================

-- Hinweis: KEINE Extension nötig — gen_random_uuid() ist ab PostgreSQL 13 im
-- Core enthalten (Azure Flexible Server läuft auf PG 16). pgcrypto müsste auf
-- Azure erst per azure.extensions-Allowlist freigeschaltet werden; wird hier
-- bewusst vermieden.

-- ----------------------------------------------------------------------------
-- app_users (Login-Benutzer / „Manager")
-- ----------------------------------------------------------------------------
create table if not exists app_users (
  id                 uuid        primary key default gen_random_uuid(),
  username           text        unique not null,
  pw_hash            text,
  pw_salt            text,
  allowed_categories text[]      not null default '{}',
  is_admin           boolean     not null default false,
  logo               text,
  invite_token       text,
  invite_expires     timestamptz,
  created_at         timestamptz default now()
);
create unique index if not exists app_users_invite_token_idx
  on app_users(invite_token) where invite_token is not null;

-- ----------------------------------------------------------------------------
-- question_catalogs (Fragenkataloge)
-- ----------------------------------------------------------------------------
create table if not exists question_catalogs (
  id                 uuid        primary key default gen_random_uuid(),
  name               text        not null,
  product_categories text[]      not null default '{}',
  chapters           jsonb       not null default '[]',
  created_at         timestamptz default now()
);

-- ----------------------------------------------------------------------------
-- memorials (Gedenkbücher / Projekte)
-- ----------------------------------------------------------------------------
create table if not exists memorials (
  -- Zugangscode. genCode() liefert 10 Zeichen (api/_lib/codes.js); varchar(6)
  -- stammt aus der Anfangszeit und haette bei einer Neuinstallation jeden Code
  -- abgeschnitten. Bestehende Installationen wurden per api/admin/db-maint.js
  -- verbreitert. Alte 6-stellige Codes bleiben gueltig.
  id               varchar(16) primary key,
  name             text        not null,
  birth_year       text,
  death_year       text,
  organizer        text        not null,
  created_at       timestamptz default now(),
  -- nachträglich ergänzte Spalten (früher per ALTER):
  gender           text,
  book_variant     text,
  book_v1          jsonb,
  book_v2          jsonb,
  eulogy_text      text,
  funeral_date     date,
  cutoff_days      integer,
  product_category text        not null default 'memorial',
  owner_user       uuid        references app_users(id) on delete set null,
  intake           jsonb,
  languages        text[]      not null default '{de}',
  note             text,
  uploaded_images  jsonb       not null default '[]'::jsonb,
  content_reports  jsonb,
  book_layout      text        default 'classic',
  image_style      text        default 'realistic',
  photo_upload_tab boolean     not null default false,
  show_intro_video boolean     not null default true,
  show_transcript  boolean     not null default true,
  show_contributors boolean    not null default true,  -- Namensliste der Beitragenden am Buchende drucken
  pickup_address   jsonb,
  purge_info       jsonb,
  book_v1_at       timestamptz,
  book_v2_at       timestamptz,
  eulogy_at        timestamptz,
  catalog_id       uuid        references question_catalogs(id) on delete set null,
  followups        integer     not null default 7,
  -- Gastbeitraege zum Lebenswerk: eigener Zugangscode fuer weitere Beitragende.
  -- Bewusst NICHT der Buch-Code — der ist beim Lebenswerk die einzige
  -- Berechtigung des Endnutzers (Einstellungen, Korrekturabzug, Buchbearbeitung).
  guest_enabled    boolean,
  guest_code       varchar(16),
  -- Zusatzfragen ans Interview-Ende (nur Lebenswerk, Standard aus):
  -- { enabled, own: [Freitext-Fragen], presets: [Themenbloecke], events: [Zeitgeschehen] }
  -- Siehe EXTRA_QUESTION_PRESETS in src/categories.js.
  extra_questions  jsonb,
  -- Hoerbuch je Buchfassung: { book_v1|book_v2: { voice_mode, voices:{f,m}, language,
  -- title, created_at, chars, tracks:[{index,title,path,chars,bytes}] } }. Die
  -- MP3-Spuren liegen im Bild-Container unter <CODE>/audio/, die Links werden beim
  -- Laden signiert (nie gespeichert).
  audiobooks       jsonb,
  -- Fortlaufende Projektnummer fuers Dashboard und fuer Rueckfragen ("Projekt 42").
  -- Global aufsteigend aus einer Sequenz; eine Nummer gehoert dauerhaft zu genau
  -- einem Projekt (nach Loeschungen entstehen Luecken, das ist gewollt).
  project_no       integer
);
create index if not exists memorials_owner_user_idx on memorials(owner_user);
-- Nummernvergabe als eigene Sequenz (nicht als IDENTITY), damit Neuinstallation und
-- der Nachzieher zur Laufzeit (api/_lib/lifework.js) exakt gleich aussehen.
create sequence if not exists memorials_project_no_seq owned by memorials.project_no;
alter table memorials alter column project_no set default nextval('memorials_project_no_seq');
create unique index if not exists memorials_project_no_uidx
  on memorials (project_no) where project_no is not null;
-- Der Gast-Code wird wie ein Zugangscode nachgeschlagen und muss eindeutig sein;
-- Buecher ohne Gastlink (NULL) bleiben ausserhalb des Teilindex.
create unique index if not exists memorials_guest_code_uidx
  on memorials (guest_code) where guest_code is not null;
create index if not exists memorials_catalog_id_idx on memorials(catalog_id);

-- ----------------------------------------------------------------------------
-- contributions (Interview-Beiträge)
-- ----------------------------------------------------------------------------
create table if not exists contributions (
  id                     text        primary key,   -- „geheime" Beitrags-ID, 6–14 Zeichen (deshalb text, nicht varchar)
  memorial_id            varchar(16) not null references memorials(id) on delete cascade,
  contributor_name       text        not null,
  relationship           text        not null,
  messages               jsonb       not null default '[]',
  created_at             timestamptz default now(),
  contributor_gender     text,
  contributor_address    text,
  feedback_rating        smallint,
  feedback_text          text,
  feedback_at            timestamptz,
  feedback_done          boolean     not null default false,
  transcript_checked_at  timestamptz,
  transcript_corrections jsonb       not null default '[]',
  consent_at             timestamptz,
  consent_version        text,
  -- Gastbeiträge zum Lebenswerk: true = über den Gast-Link erzählt (jemand
  -- anders spricht ÜBER die Person), NULL/false = die Person selbst bzw. ein
  -- normaler Beitragender. Steuert Prompt und Buchsynthese.
  is_guest               boolean,
  -- Kuratierung des Managers, nur für Gastbeiträge: 'pending' (jeder neue
  -- Gastbeitrag) | 'approved' | 'rejected'. NULL bei allen anderen Beiträgen.
  guest_status           text
);
create index if not exists contributions_memorial_id_idx on contributions(memorial_id);
create index if not exists contributions_feedback_at_idx
  on contributions(feedback_at desc) where feedback_at is not null;

-- ----------------------------------------------------------------------------
-- cost_events (Kostenerfassung; Spalten aus api/_lib/cost.js recordCost)
-- ----------------------------------------------------------------------------
create table if not exists cost_events (
  id              bigint      generated always as identity primary key,
  memorial_id     text,
  contribution_id text,
  kind            text,
  provider        text,
  model           text,
  input_tokens    integer,
  output_tokens   integer,
  audio_seconds   numeric,
  characters      integer,
  images          integer,
  cost_usd        numeric,
  cost_eur        numeric,
  metadata        jsonb,
  created_at      timestamptz not null default now()
);
create index if not exists cost_events_memorial_id_idx on cost_events(memorial_id);
create index if not exists cost_events_created_at_idx  on cost_events(created_at);

-- ----------------------------------------------------------------------------
-- generation_jobs (serverseitige Buch-/Bild-/Rede-Erstellung)
-- ----------------------------------------------------------------------------
create table if not exists generation_jobs (
  id          uuid        primary key default gen_random_uuid(),
  memorial_id text        references memorials(id) on delete cascade,
  kind        text        not null,
  status      text        not null default 'queued',
  params      jsonb,
  progress    jsonb       not null default '{}'::jsonb,
  result      jsonb,
  error       text,
  owner_user  uuid,
  attempts    integer     not null default 0,
  chain       integer     not null default 0,
  locked_at   timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists generation_jobs_pending_idx  on generation_jobs(status, created_at);
create index if not exists generation_jobs_memorial_idx on generation_jobs(memorial_id);

-- ----------------------------------------------------------------------------
-- rate_limits (+ atomare Funktion) – Schutz der offenen KI-Proxies + Login
-- ----------------------------------------------------------------------------
create table if not exists rate_limits (
  bucket   text        primary key,
  count    integer     not null default 0,
  reset_at timestamptz not null
);
create index if not exists rate_limits_reset_at_idx on rate_limits(reset_at);

create or replace function rate_limit_hit(
  p_bucket         text,
  p_limit          integer,
  p_window_seconds integer
) returns boolean
language plpgsql
as $$
declare
  v_now   timestamptz := now();
  v_count integer;
begin
  insert into rate_limits (bucket, count, reset_at)
    values (p_bucket, 1, v_now + make_interval(secs => p_window_seconds))
  on conflict (bucket) do update
    set count    = case when rate_limits.reset_at <= v_now then 1
                        else rate_limits.count + 1 end,
        reset_at = case when rate_limits.reset_at <= v_now
                        then v_now + make_interval(secs => p_window_seconds)
                        else rate_limits.reset_at end
  returning count into v_count;
  return v_count <= p_limit;
end;
$$;

-- ----------------------------------------------------------------------------
-- audit_log (Zugriffs-/Audit-Protokoll, DSGVO Art. 5(2)/32)
-- ----------------------------------------------------------------------------
create table if not exists audit_log (
  id         bigint      generated always as identity primary key,
  created_at timestamptz not null default now(),
  actor_uid  uuid,
  actor_name text,
  is_admin   boolean,
  action     text        not null,
  target     text,
  ip         text,
  detail     jsonb
);
create index if not exists audit_log_created_at_idx on audit_log(created_at desc);
create index if not exists audit_log_action_idx     on audit_log(action);

-- ----------------------------------------------------------------------------
-- report_recipients + job_heartbeats (Tagesreport)
-- ----------------------------------------------------------------------------
create table if not exists report_recipients (
  id         uuid        primary key default gen_random_uuid(),
  email      text        not null unique,
  name       text,
  active     boolean     not null default true,
  created_at timestamptz not null default now()
);

create table if not exists job_heartbeats (
  job         text        primary key,
  last_run_at timestamptz not null default now(),
  last_status text,
  detail      jsonb,
  updated_at  timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- usage_daily – anonyme Tageszähler (Technik-Telemetrie, KEINE Personendaten)
-- ----------------------------------------------------------------------------
-- Bewusst NUR ein Aggregat: je Tag/Ereignis/Plattform ein Zähler, der hochgezählt
-- wird. Es gibt keine Einzelzeile, keinen Buch-Code, keine IP, keinen Zeitstempel
-- unterhalb des Tages — damit ist ein Rückschluss auf eine Person nicht möglich,
-- auch nicht theoretisch. Zweck: messen, wie häufig das Mikrofon blockiert ist
-- (mic_blocked) im Verhältnis zu den begonnenen Interviews (interview_start).
create table if not exists usage_daily (
  day      date    not null,
  kind     text    not null,
  platform text    not null default 'other',
  count    integer not null default 0,
  primary key (day, kind, platform)
);
create index if not exists usage_daily_day_idx on usage_daily(day desc);

-- ----------------------------------------------------------------------------
-- memorial_contrib_stats() – Beitrags-/Antwortzahlen je Buch fürs Dashboard
-- ----------------------------------------------------------------------------
create or replace function memorial_contrib_stats()
returns table (
  memorial_id        text,
  contribution_count bigint,
  answer_count       bigint
)
language sql
stable
as $$
  select
    c.memorial_id,
    count(*) as contribution_count,
    coalesce(sum((
      select count(*)
      from jsonb_array_elements(
        case when jsonb_typeof(c.messages) = 'array' then c.messages else '[]'::jsonb end
      ) as e
      where e->>'role' = 'user'
    )), 0) as answer_count
  from contributions c
  group by c.memorial_id
$$;
