// api/_lib/retention.js
// Aufbewahrungsfristen an EINER Stelle — genutzt vom Cron (api/cron/purge.js),
// von der Buchliste (api/admin/memorials.js) und vom Aufräum-Endpunkt
// (api/admin/purge-memorial.js).
//
// ZWEI VERSCHIEDENE REGIME, das ist der Kern:
//
//   ANAMNESE (anamnesis, anamnesis_kvsw) — medizinische Daten. Nach 14 Tagen
//   wird der Datensatz VOLLSTÄNDIG und AUTOMATISCH gelöscht, Bogen inklusive.
//   Daran ändert sich nichts; hier wäre ein „bitte demnächst mal klicken"
//   das falsche Werkzeug.
//
//   ALLE ÜBRIGEN — nach RETENTION_DAYS (Standard 90) wird nicht mehr
//   automatisch gelöscht, sondern das Dashboard weist darauf hin und der
//   Manager stößt das Aufräumen selbst an (Eingangsdaten weg, Endprodukt
//   bleibt). Umgestellt am 2026-08-02 auf Wunsch des Betreibers.
//
// ACHTUNG, bewusste Abwägung: Ohne automatische Löschung bleiben Beiträge
// Dritter liegen, bis jemand den Knopf drückt. Das ist datenschutzrechtlich
// schwächer als vorher — der Hinweis im Dashboard ist damit keine Bequemlichkeit,
// sondern die tragende Maßnahme. Er darf nicht wieder verschwinden.
//
// Eine zweite, längere Frist als Rückfalllösung (nach der doch automatisch
// gelöscht wird, falls niemand klickt) wurde am 2026-08-02 vorgeschlagen und vom
// Betreiber ausdrücklich ABGELEHNT. Bitte nicht erneut einbauen, ohne das mit ihm
// zu klären — die Entscheidung ist getroffen, nicht übersehen.

const { isAnamnesisCategory } = require('./categories')

const DAY_MS = 24 * 60 * 60 * 1000
const RETENTION_DAYS = parseInt(process.env.RETENTION_DAYS || '90', 10)
const ANAMNESIS_RETENTION_DAYS = parseInt(process.env.ANAMNESIS_RETENTION_DAYS || '14', 10)

const retentionDaysFor = m => isAnamnesisCategory(m?.product_category) ? ANAMNESIS_RETENTION_DAYS : RETENTION_DAYS

// Anker der Frist: der Anlass (Bestattung, Feier …), sonst die Anlage. Ohne
// Anlassdatum liefe die Frist sonst nie an.
function retentionAnchor(m) {
  const raw = m?.funeral_date || m?.created_at
  if (!raw) return null
  const d = new Date(raw)
  return isNaN(d.getTime()) ? null : d
}

// Zeitpunkt, ab dem aufgeräumt werden soll (ISO-String) — null, wenn unbestimmbar.
function purgeDueAt(m) {
  const anchor = retentionAnchor(m)
  if (!anchor) return null
  return new Date(anchor.getTime() + retentionDaysFor(m) * DAY_MS).toISOString()
}

// Ist die Frist abgelaufen und noch nicht aufgeräumt worden?
function isPurgeDue(m, now = Date.now()) {
  if (m?.purge_info?.purged_at) return false
  const due = purgeDueAt(m)
  return !!due && new Date(due).getTime() < now
}

// Tage bis zur Fälligkeit (negativ = überfällig); null, wenn unbestimmbar.
function daysUntilDue(m, now = Date.now()) {
  const due = purgeDueAt(m)
  if (!due) return null
  return Math.ceil((new Date(due).getTime() - now) / DAY_MS)
}

module.exports = {
  DAY_MS, RETENTION_DAYS, ANAMNESIS_RETENTION_DAYS,
  retentionDaysFor, retentionAnchor, purgeDueAt, isPurgeDue, daysUntilDue,
}
