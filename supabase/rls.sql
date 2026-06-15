-- ================================================================
-- Lebenswerk – Row Level Security (RLS) aktivieren
-- Ausführen in: Supabase Dashboard → SQL Editor → New query → Run
-- ================================================================
--
-- Hintergrund:
--   Die App spricht Supabase ausschließlich über den service_role-Key an
--   (alle /api/* Functions). service_role UMGEHT RLS. Das Frontend nutzt
--   keinen anon-Key für Tabellenzugriffe.
--
-- Dadurch ist dieses Skript risikolos:
--   - RLS einschalten + KEINE Policies  => anon/authenticated bekommen über
--     die öffentliche PostgREST-API NULL Zugriff (default-deny).
--   - service_role arbeitet weiter wie bisher (Bypass).
--
-- Zusätzlich werden den öffentlichen Rollen die Tabellenrechte entzogen
-- (Defense in Depth – greift selbst dann, wenn versehentlich eine Policy
--  hinzukommt).
--
-- Idempotent: kann gefahrlos mehrfach ausgeführt werden.
-- ================================================================

do $$
declare
  t text;
  tables text[] := array['memorials', 'contributions', 'cost_events'];
begin
  foreach t in array tables loop
    if to_regclass('public.' || t) is not null then
      -- RLS aktivieren (und erzwingen, auch für Tabelleneigentümer)
      execute format('alter table public.%I enable row level security;', t);
      execute format('alter table public.%I force  row level security;', t);
      -- Öffentlichen Rollen alle Tabellenrechte entziehen
      execute format('revoke all on table public.%I from anon;', t);
      execute format('revoke all on table public.%I from authenticated;', t);
      raise notice 'RLS aktiviert + Rechte entzogen: %', t;
    else
      raise notice 'Tabelle nicht gefunden, übersprungen: %', t;
    end if;
  end loop;
end $$;

-- ----------------------------------------------------------------
-- Kontrolle: rowsecurity sollte für alle drei Tabellen = true sein
-- ----------------------------------------------------------------
select relname            as tabelle,
       relrowsecurity     as rls_aktiv,
       relforcerowsecurity as rls_erzwungen
from   pg_class
where  relnamespace = 'public'::regnamespace
  and  relname in ('memorials', 'contributions', 'cost_events')
order  by relname;
