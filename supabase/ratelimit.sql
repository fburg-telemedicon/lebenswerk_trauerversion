-- ================================================================
-- Lebenswerk – Rate-Limiting (Schutz der offenen KI-Proxies + Login)
-- Einmalig ausführen in: Supabase Dashboard → SQL Editor → New query
-- ================================================================
--
-- Vercel-Funktionen sind zustandslos; um Anfragen pro IP/Zeitfenster zu zählen,
-- brauchen wir einen gemeinsamen Speicher. Diese kleine Tabelle + eine atomare
-- Funktion erledigen das. Die Funktion wird von api/_lib/ratelimit.js per RPC
-- aufgerufen (service_role, umgeht RLS).

create table if not exists rate_limits (
  bucket    text        primary key,      -- z.B. "ask:84.12.0.1" oder "login:ip:…"
  count     integer     not null default 0,
  reset_at  timestamptz not null          -- Ende des aktuellen Zeitfensters
);

-- Index für die Aufräum-Abfrage (abgelaufene Eimer).
create index if not exists rate_limits_reset_at_idx on rate_limits (reset_at);

-- Atomarer „Treffer": zählt den Eimer hoch (bzw. setzt ihn zurück, wenn das
-- Fenster abgelaufen ist) und liefert TRUE = erlaubt / FALSE = Limit erreicht.
-- Ein einzelnes UPSERT mit RETURNING -> race-condition-frei.
create or replace function rate_limit_hit(
  p_bucket          text,
  p_limit           integer,
  p_window_seconds  integer
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

-- RLS wie bei allen Tabellen: aktivieren + erzwingen, KEINE Policies.
-- Dadurch kommen anon/authenticated über die öffentliche API nicht heran;
-- nur das Backend (service_role, BYPASSRLS) nutzt die Funktion.
alter table rate_limits enable row level security;
alter table rate_limits force  row level security;
