// api/metric.js — anonymer Tageszähler (Technik-Telemetrie).
//
// Zweck: messen, wie oft das Mikrofon tatsächlich blockiert ist — bezogen auf die
// Zahl der begonnenen Interviews. Ohne diesen Bezug ist „5-mal blockiert" nicht
// deutbar; erst der Anteil sagt etwas.
//
// DSGVO: Es wird ausschließlich ein AGGREGAT hochgezählt (Tag × Ereignis ×
// Plattform). Kein Buch-Code, keine IP, keine Sitzungskennung, kein Zeitstempel
// unterhalb des Tages, keine Einzelzeile — es entsteht nichts, was sich einer
// Person zuordnen ließe, auch nicht im Nachhinein. Deshalb braucht dieser
// Endpunkt auch keinen gültigen Code (der wäre ein Personenbezug, den wir
// gerade NICHT wollen).
//
// Missbrauch: Die Schlüssel sind fest verdrahtet, die Tabelle kann also nicht
// wachsen (Tage × 4 Ereignisse × 4 Plattformen). Ein Angreifer könnte höchstens
// die Zahlen verfälschen — dagegen ein grobes Rate-Limit. Fehler werden
// verschluckt: Eine Statistik darf niemals ein Interview stören.

const { pool } = require('./_lib/store')
const { enforce } = require('./_lib/ratelimit')

const KINDS = new Set([
  'interview_start',  // Interview begonnen (Bezugsgröße/Nenner)
  'mic_ok',           // Aufnahme erfolgreich gestartet
  'mic_blocked',      // Berechtigung verweigert/blockiert
  'mic_missing',      // kein Mikrofon gefunden / von anderer App belegt
])
const PLATFORMS = new Set(['android', 'android_pwa', 'ios', 'ios_pwa', 'desktop', 'other'])

let schemaReady = false
async function ensureSchema() {
  if (schemaReady) return
  await pool().query(`
    create table if not exists usage_daily (
      day      date    not null,
      kind     text    not null,
      platform text    not null default 'other',
      count    integer not null default 0,
      primary key (day, kind, platform)
    )`)
  await pool().query('create index if not exists usage_daily_day_idx on usage_daily(day desc)')
  schemaReady = true
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  // Großzügig, aber gedeckelt: Ein normaler Nutzer sendet pro Sitzung 2–3 Zähler.
  if (!(await enforce(req, res, { name: 'metric', limit: 60, windowSeconds: 3600 }))) return

  const kind = String(req.body?.kind || '')
  const platform = String(req.body?.platform || 'other')
  if (!KINDS.has(kind)) return res.status(400).json({ error: 'Unbekannte Kennzahl.' })
  const plat = PLATFORMS.has(platform) ? platform : 'other'

  try {
    await ensureSchema()
    // Tagesgrenze bewusst in Berlin-Zeit, damit die Zahl zum Tagesreport passt.
    await pool().query(`
      insert into usage_daily (day, kind, platform, count)
      values ((now() at time zone 'Europe/Berlin')::date, $1, $2, 1)
      on conflict (day, kind, platform) do update set count = usage_daily.count + 1`,
      [kind, plat])
    return res.json({ ok: true })
  } catch (e) {
    console.error('metric:', e.message)
    // Bewusst 200: Der Client soll nichts nachreichen und nichts anzeigen.
    return res.json({ ok: false })
  }
}
