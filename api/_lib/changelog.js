// api/_lib/changelog.js
// Liest das Entwicklungs-Changelog (changelog.json im Repo-Wurzelverzeichnis) und
// liefert die Einträge eines Tages für den "Gestern umgesetzt"-Abschnitt des
// Tagesreports. Fehlertolerant: fehlt/defekt die Datei, kommen leere Einträge.
//
// Geladen wird per require('../../changelog.json') – so packt Vercel die Datei
// über die Dependency-Erkennung automatisch ins Function-Bundle (kein
// includeFiles nötig). fs-Fallback nur fürs lokale Entwickeln.

const fs = require('fs')
const path = require('path')

function loadChangelog() {
  try {
    const parsed = require('../../changelog.json')
    if (parsed && Array.isArray(parsed.entries)) return parsed
  } catch { /* Fallback unten */ }
  const candidates = [
    path.join(process.cwd(), 'changelog.json'),
    path.join(__dirname, '..', '..', 'changelog.json'),
  ]
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const parsed = JSON.parse(fs.readFileSync(p, 'utf8'))
        if (parsed && Array.isArray(parsed.entries)) return parsed
      }
    } catch (e) {
      console.warn('changelog.json nicht lesbar:', p, e.message)
    }
  }
  return { entries: [] }
}

// Items eines bestimmten Tages (dateStr = 'YYYY-MM-DD').
function changelogForDate(dateStr) {
  const cl = loadChangelog()
  const entry = (cl.entries || []).find(e => e && e.date === dateStr)
  return (entry && Array.isArray(entry.items)) ? entry.items : []
}

module.exports = { loadChangelog, changelogForDate }
