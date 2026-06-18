-- ================================================================
-- Lebenswerk – Zugriffs-/Audit-Log (DSGVO Art. 5 Abs. 2 „Rechenschaft",
-- Art. 32 Sicherheit der Verarbeitung)
-- Einmalig ausführen in: Supabase Dashboard → SQL Editor → New query
-- ================================================================
--
-- Protokolliert sicherheitsrelevante Admin-/Login-Aktionen DAUERHAFT (Vercel-
-- Logs sind auf dem Hobby-Plan flüchtig). Bewusst OHNE sensible Inhalte:
-- nur Akteur (uid), Aktion, Ziel-Code/-ID, IP und Zeit. Geschrieben vom
-- Backend (service_role) über api/_lib/audit.js, fail-open.

create table if not exists audit_log (
  id          bigint      generated always as identity primary key,
  created_at  timestamptz not null default now(),
  actor_uid   uuid,                 -- app_users.id; null beim Env-Superadmin
  actor_name  text,                 -- Benutzername (soweit verfügbar, Lesbarkeit)
  is_admin    boolean,              -- war der Akteur Admin?
  action      text        not null, -- z.B. 'login.success', 'memorial.delete'
  target      text,                 -- Code/ID des betroffenen Objekts
  ip          text,                 -- Client-IP (x-forwarded-for)
  detail      jsonb                 -- optionale, PII-arme Zusatzinfos
);

create index if not exists audit_log_created_at_idx on audit_log (created_at desc);
create index if not exists audit_log_action_idx     on audit_log (action);

-- RLS wie bei allen Tabellen: aktivieren + erzwingen, KEINE Policies
-- (nur service_role/BYPASSRLS greift zu).
alter table audit_log enable row level security;
alter table audit_log force  row level security;
