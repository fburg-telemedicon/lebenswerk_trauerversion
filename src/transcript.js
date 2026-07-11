// src/transcript.js  (Frontend, ESM)
// Undo/Redo-Helfer für den Transkript-Bericht. Die eigentliche Prüfung läuft
// serverseitig (api/cron/transcript-check.js).
//
// HINWEIS: Diese beiden Funktionen sind eine bewusste, kleine Kopie von
// api/_lib/transcript-core.js (findNeedle/apply/revert). Ein gemeinsames Modul
// scheitert an der Laufzeitgrenze (Backend = CommonJS/Node, Frontend = ESM/Vite;
// Vite bündelt keine CJS-Quelldateien). Bei Änderungen an der Logik BEIDE Stellen
// gleich halten – die Funktionen sind absichtlich winzig und rein.

// Findet needle im Text: erst wörtlich, dann groß-/kleinschreibungs-tolerant
// (gleiche Länge) – rettet Stellen, deren 'before'/'after' durch eine zuvor
// angewandte Auto-Korrektur nur in der Groß-/Kleinschreibung abweicht.
function findNeedle(content, needle) {
  if (!needle) return -1
  const exact = content.indexOf(needle)
  if (exact >= 0) return exact
  return content.toLowerCase().indexOf(needle.toLowerCase())
}

// after → before (Korrektur rückgängig machen).
export function revertCorrectionInMessages(messages, corr) {
  const arr = Array.isArray(messages) ? messages.map(m => ({ ...m })) : []
  const m = arr[corr.message_index]
  if (!m || typeof m.content !== 'string' || !corr.after) return { messages: arr, ok: false }
  const pos = findNeedle(m.content, corr.after)
  if (pos < 0) return { messages: arr, ok: false }
  m.content = m.content.slice(0, pos) + corr.before + m.content.slice(pos + corr.after.length)
  return { messages: arr, ok: true }
}

// before → after (Korrektur anwenden).
export function applyCorrectionToMessages(messages, corr) {
  const arr = Array.isArray(messages) ? messages.map(m => ({ ...m })) : []
  const m = arr[corr.message_index]
  if (!m || typeof m.content !== 'string' || !corr.before) return { messages: arr, ok: false }
  const pos = findNeedle(m.content, corr.before)
  if (pos < 0) return { messages: arr, ok: false }
  m.content = m.content.slice(0, pos) + corr.after + m.content.slice(pos + corr.before.length)
  return { messages: arr, ok: true }
}
