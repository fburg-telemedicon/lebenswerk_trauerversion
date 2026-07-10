// src/transcript.js  (Frontend)
// Undo/Redo-Helfer für den Transkript-Bericht. Die eigentliche Prüfung läuft
// serverseitig im Cron (api/cron/transcript-check.js, api/_lib/transcript.js);
// hier wird nur eine bereits vorgenommene Korrektur rückgängig gemacht bzw.
// wieder angewandt (jeweils erste Fundstelle im Ziel-Antworttext).

// after → before (Korrektur rückgängig machen).
export function revertCorrectionInMessages(messages, corr) {
  const arr = Array.isArray(messages) ? messages.map(m => ({ ...m })) : []
  const m = arr[corr.message_index]
  if (!m || typeof m.content !== 'string' || !corr.after) return { messages: arr, ok: false }
  const pos = m.content.indexOf(corr.after)
  if (pos < 0) return { messages: arr, ok: false }
  m.content = m.content.slice(0, pos) + corr.before + m.content.slice(pos + corr.after.length)
  return { messages: arr, ok: true }
}

// before → after (Korrektur wieder anwenden).
export function applyCorrectionToMessages(messages, corr) {
  const arr = Array.isArray(messages) ? messages.map(m => ({ ...m })) : []
  const m = arr[corr.message_index]
  if (!m || typeof m.content !== 'string' || !corr.before) return { messages: arr, ok: false }
  const pos = m.content.indexOf(corr.before)
  if (pos < 0) return { messages: arr, ok: false }
  m.content = m.content.slice(0, pos) + corr.after + m.content.slice(pos + corr.before.length)
  return { messages: arr, ok: true }
}
