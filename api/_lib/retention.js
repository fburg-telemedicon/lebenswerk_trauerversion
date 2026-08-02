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
// HISTORIE, damit niemand im Kreis läuft: Am 2026-08-02 war die automatische
// Löschung vorübergehend durch „Hinweis + Knopf" ersetzt und am selben Tag wieder
// zurückgebaut. Grund für den Rückbau: Den Kunden ist in den AGB eine Löschung
// nach Frist ZUGESAGT. Eine Zusage, die davon abhängt, ob jemand im Dashboard
// klickt, ist keine. Der Knopf bleibt zusätzlich bestehen (früher löschen), das
// Archiv ebenfalls — nur ersetzen sie die automatische Löschung nicht mehr.

// Wie viele Tage vor der Löschung das Dashboard warnt. Sieben Tage sind genug,
// um ein Buch noch fertigzustellen oder die Daten zu exportieren, und kurz genug,
// dass die Warnung nicht monatelang danebensteht und ignoriert wird.
const WARN_DAYS = 7

const { isAnamnesisCategory } = require('./categories')

const DAY_MS = 24 * 60 * 60 * 1000
const RETENTION_DAYS = parseInt(process.env.RETENTION_DAYS || '90', 10)
const ANAMNESIS_RETENTION_DAYS = parseInt(process.env.ANAMNESIS_RETENTION_DAYS || '14', 10)

// Vertragliche Nutzungsdauer einer Lizenz: sechs Monate ab Erwerb (= Anlage des
// Buchprojekts). Erst DANACH läuft die Aufbewahrungsfrist an.
//
// Warum nicht wie früher stur „Anlage + 90 Tage": Die Nutzungsdauer beträgt sechs
// Monate. Eine Löschung nach 90 Tagen hätte mitten in der bezahlten Laufzeit die
// Eingangsdaten entfernt — der Kunde hätte noch drei Monate Anspruch gehabt, aber
// nichts mehr, woraus sich ein Buch bauen ließe. Die Frist wird dadurch nur
// LÄNGER, nie kürzer; niemand verliert Daten früher als bisher zugesagt.
// Rechtfertigung gegenüber Art. 5 Abs. 1 lit. e: Solange erzählt werden darf,
// sind die Beiträge für den Zweck erforderlich.
const LICENSE_MONTHS = parseInt(process.env.LICENSE_MONTHS || '6', 10)

const retentionDaysFor = m => isAnamnesisCategory(m?.product_category) ? ANAMNESIS_RETENTION_DAYS : RETENTION_DAYS

const parseDate = raw => {
  if (!raw) return null
  const d = new Date(raw)
  return isNaN(d.getTime()) ? null : d
}

// Monate addieren, ohne in den Folgemonat zu rutschen: 31.08. + 6 Monate ist der
// 28./29.02., nicht der 03.03. (`setMonth` rechnet sonst den Überhang weiter).
//
// Durchgehend in UTC gerechnet. Mit den lokalen Gettern verschiebt die
// Sommerzeit den Zeitpunkt um eine Stunde — bei einem Zeitstempel um Mitternacht
// UTC kippt er damit auf den Vortag, und die Frist endete einen Tag zu früh.
function addMonths(d, months) {
  const r = new Date(d.getTime())
  const tag = r.getUTCDate()
  r.setUTCDate(1)
  r.setUTCMonth(r.getUTCMonth() + months)
  const letzter = new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate()
  r.setUTCDate(Math.min(tag, letzter))
  return r
}

// Ende der Nutzungsdauer — ab hier läuft die Aufbewahrungsfrist.
//   • Anlassdatum gesetzt (Bestattung, Feier, Verabschiedung): der Anlass ist der
//     Endpunkt, danach ist das Werk fertig. Unverändert gegenüber früher.
//   • sonst (Lebenswerk, Firma, Ermutigung …): Anlage + Nutzungsdauer.
//   • Anamnese: keine Lizenzlaufzeit, hier zählt allein die Anlage.
function usageEndsAt(m) {
  const anlass = parseDate(m?.funeral_date)
  if (anlass) return anlass
  const angelegt = parseDate(m?.created_at)
  if (!angelegt) return null
  return isAnamnesisCategory(m?.product_category) ? angelegt : addMonths(angelegt, LICENSE_MONTHS)
}

// Alter Name, weiter benutzt von Aufrufern, die nur den Startpunkt brauchen.
const retentionAnchor = usageEndsAt

// Zeitpunkt, ab dem aufgeräumt werden soll (ISO-String) — null, wenn unbestimmbar.
function purgeDueAt(m) {
  const ende = usageEndsAt(m)
  if (!ende) return null
  return new Date(ende.getTime() + retentionDaysFor(m) * DAY_MS).toISOString()
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

// Steht die Löschung unmittelbar bevor? Für die Vorwarnung im Dashboard.
// Bereits bereinigte Bücher sind nie „bald fällig".
function isPurgeSoon(m, now = Date.now()) {
  if (m?.purge_info?.purged_at) return false
  const d = daysUntilDue(m, now)
  return d !== null && d >= 0 && d <= WARN_DAYS
}

module.exports = {
  DAY_MS, RETENTION_DAYS, ANAMNESIS_RETENTION_DAYS, WARN_DAYS, LICENSE_MONTHS,
  retentionDaysFor, retentionAnchor, usageEndsAt, addMonths,
  purgeDueAt, isPurgeDue, isPurgeSoon, daysUntilDue,
}
