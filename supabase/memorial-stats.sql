-- ================================================================
-- Lebenswerk – Beitrags-Statistik pro Gedenkbuch (Dashboard-Optimierung)
-- Einmalig ausführen in: Supabase Dashboard → SQL Editor → New query → Run
-- ================================================================
--
-- Das Admin-Dashboard (GET /api/admin/memorials) braucht je Gedenkbuch die
-- Anzahl Beiträge und die Anzahl Antworten (User-Nachrichten). Bisher wurden
-- dafür ALLE contributions.messages (komplette Transkripte) geladen und im
-- Node gezählt. Diese Funktion zählt stattdessen serverseitig in Postgres und
-- überträgt nur zwei Zahlen pro Gedenkbuch.
--
-- Der Endpunkt nutzt die Funktion automatisch, sobald sie existiert; solange
-- sie fehlt, greift der bisherige Fallback (kein Deploy-Zwang).
--
-- Aufruf per service_role (RPC) aus api/admin/memorials.js.

create or replace function memorial_contrib_stats()
returns table (
  memorial_id       text,
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
