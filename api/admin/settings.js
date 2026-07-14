// api/admin/settings.js
// Anwendungsweite Einstellungen. Aktuell: die Standardwerte, mit denen die Maske
// „Neues Buch anlegen" vorbelegt wird (Namensliste im Buch, Transkript-Anzeige,
// Sprachen, Grafikstil, Layout, Sammeladresse …).
//
//   GET /api/admin/settings?key=book_defaults   → { defaults, saved }
//        Jeder eingeloggte Benutzer — die Anlage-Maske braucht die Werte.
//   PUT /api/admin/settings?key=book_defaults   { defaults }  → { defaults }
//        Nur Admins — die Werte gelten für ALLE künftigen Bücher.
//
// Gespeicherte Werte wirken nur auf NEUE Bücher; bestehende bleiben unberührt.

const { pool } = require('../_lib/store')
const { checkAuth } = require('../_lib/auth')
const { audit } = require('../_lib/audit')
const { sanitizeBookDefaults, FALLBACK } = require('../_lib/book-defaults')

const KEY = 'book_defaults'

// Die Tabelle wird beim ersten Zugriff angelegt: Das Projekt kennt keine
// Migrationsläufe, und ein vergessenes `psql -f db/book-defaults.sql` würde das
// Dashboard sonst mit einem 500er begrüßen. `if not exists` ist idempotent.
let ensured = false
async function ensureTable() {
  if (ensured) return
  await pool().query(`
    create table if not exists app_settings (
      key        text        primary key,
      value      jsonb       not null,
      updated_at timestamptz not null default now(),
      updated_by uuid
    )
  `)
  ensured = true
}

async function readDefaults() {
  const { rows } = await pool().query('select value from app_settings where key = $1', [KEY])
  const saved = rows.length > 0
  // Auch gespeicherte Werte laufen durch den Sanitizer: Ein Feld, das erst später
  // dazukommt, fehlt in einer alten Zeile und muss seinen Fallback bekommen.
  return { defaults: sanitizeBookDefaults(saved ? rows[0].value : FALLBACK), saved }
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (!checkAuth(req, res)) return

  const key = String(req.query.key || KEY)
  if (key !== KEY) return res.status(400).json({ error: `Unbekannte Einstellung: ${key}` })

  try {
    await ensureTable()

    if (req.method === 'GET') {
      return res.json(await readDefaults())
    }

    if (req.method === 'PUT' || req.method === 'PATCH') {
      if (!req.auth.admin) return res.status(403).json({ error: 'Nur Administratoren dürfen die Standardwerte ändern.' })
      const defaults = sanitizeBookDefaults((req.body || {}).defaults)
      await pool().query(
        `insert into app_settings (key, value, updated_at, updated_by)
              values ($1, $2, now(), $3)
         on conflict (key) do update
                set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by`,
        [KEY, JSON.stringify(defaults), req.auth.uid || null],
      )
      await audit(req, { actor: req.auth, action: 'settings.book_defaults', target: KEY, detail: defaults })
      return res.json({ defaults, saved: true })
    }

    // Zurück auf den Auslieferungszustand.
    if (req.method === 'DELETE') {
      if (!req.auth.admin) return res.status(403).json({ error: 'Nur Administratoren dürfen die Standardwerte ändern.' })
      await pool().query('delete from app_settings where key = $1', [KEY])
      await audit(req, { actor: req.auth, action: 'settings.book_defaults_reset', target: KEY })
      return res.json({ defaults: sanitizeBookDefaults(FALLBACK), saved: false })
    }

    return res.status(405).end()
  } catch (e) {
    console.error('/api/admin/settings:', e)
    res.status(500).json({ error: e.message })
  }
}
