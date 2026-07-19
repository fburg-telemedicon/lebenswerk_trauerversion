-- ================================================================
-- Lebenswerk – Beitrags-Statistik pro Gedenkbuch (Dashboard-Optimierung)
-- Einmalig ausführen in: Supabase Dashboard → SQL Editor → New query → Run
-- ================================================================
--
-- Das Admin-Dashboard (GET /api/admin/memorials) braucht je Gedenkbuch die
-- Anzahl Beiträge, die Anzahl Antworten (User-Nachrichten) und den Zeitpunkt der
-- letzten Aktivität ("zuletzt gearbeitet"). Bisher wurden dafür ALLE
-- contributions.messages (komplette Transkripte) geladen und im Node gezählt.
-- Diese Funktion zählt/aggregiert stattdessen serverseitig in Postgres und
-- überträgt nur wenige Werte pro Gedenkbuch.
--
-- Der Endpunkt nutzt die Funktion automatisch, sobald sie existiert; solange
-- sie fehlt, greift der bisherige Fallback (kein Deploy-Zwang).
--
-- Aufruf per service_role (RPC) aus api/admin/memorials.js.

-- Zeitpunkt der letzten Bearbeitung je Beitrag. Wird beim Speichern (Upsert in
-- api/contributions.js) bei jedem Schreibvorgang aktualisiert; bestehende Zeilen
-- ohne Wert fallen per coalesce auf created_at zurück.
alter table contributions add column if not exists updated_at timestamptz;

-- Der Rückgabetyp der Funktion ändert sich (neue Spalte last_activity), daher
-- muss die alte Funktion vor dem Neuanlegen entfernt werden.
drop function if exists memorial_contrib_stats();

create or replace function memorial_contrib_stats()
returns table (
  memorial_id       text,
  contribution_count bigint,
  answer_count       bigint,
  last_activity      timestamptz
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
    )), 0) as answer_count,
    max(coalesce(c.updated_at, c.created_at)) as last_activity
  from contributions c
  group by c.memorial_id
$$;
