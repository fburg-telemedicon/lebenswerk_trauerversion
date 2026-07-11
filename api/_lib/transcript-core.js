// api/_lib/transcript-core.js
// GEMEINSAME, laufzeit-neutrale Transkript-Helfer (reine String-Operationen,
// KEINE Node-Builtins wie Buffer/crypto), damit sie sowohl im Backend (CJS,
// api/cron/transcript-check.js über api/_lib/transcript.js) ALS AUCH im Frontend
// (Vite/ESM, über src/transcript.js) aus EINER Quelle stammen und nicht mehr
// auseinanderlaufen können. Node-spezifisches (crypto.randomUUID, Prompt-Bau)
// bleibt in api/_lib/transcript.js.

// Findet needle im Text: erst wörtlich, dann als Fallback rein Groß-/Klein-
// schreibungs-tolerant (gleiche Länge). Rettet Stellen, deren gespeichertes
// 'before'/'after' durch eine zuvor angewandte Auto-Korrektur nur in der
// Groß-/Kleinschreibung abweicht (z. B. „ähm" → „Ähm").
function findNeedle(content, needle) {
  if (!needle) return -1
  const exact = content.indexOf(needle)
  if (exact >= 0) return exact
  return content.toLowerCase().indexOf(needle.toLowerCase())
}

// after → before (Korrektur rückgängig machen).
function revertCorrectionInMessages(messages, corr) {
  const arr = Array.isArray(messages) ? messages.map(m => ({ ...m })) : []
  const m = arr[corr.message_index]
  if (!m || typeof m.content !== 'string' || !corr.after) return { messages: arr, ok: false }
  const pos = findNeedle(m.content, corr.after)
  if (pos < 0) return { messages: arr, ok: false }
  m.content = m.content.slice(0, pos) + corr.before + m.content.slice(pos + corr.after.length)
  return { messages: arr, ok: true }
}

// before → after (Korrektur anwenden).
function applyCorrectionToMessages(messages, corr) {
  const arr = Array.isArray(messages) ? messages.map(m => ({ ...m })) : []
  const m = arr[corr.message_index]
  if (!m || typeof m.content !== 'string' || !corr.before) return { messages: arr, ok: false }
  const pos = findNeedle(m.content, corr.before)
  if (pos < 0) return { messages: arr, ok: false }
  m.content = m.content.slice(0, pos) + corr.after + m.content.slice(pos + corr.before.length)
  return { messages: arr, ok: true }
}

// Repariert seltenes „Mojibake" (UTF-8-Bytes, die als Latin-1 gelesen wurden,
// z. B. „Ã¤" statt „ä"). Nur bei typischer Signatur (Ã/Â + Folgebyte), damit
// korrekt kodierter Text unangetastet bleibt. Buffer-frei (TextDecoder), damit
// auch im Browser lauffähig; identisch zu Buffer.from(s,'latin1').toString('utf8').
function fixMojibake(s) {
  const str = String(s || '')
  if (!/[\u00c2\u00c3][\u0080-\u00bf]/.test(str)) return str
  try {
    const bytes = Uint8Array.from(Array.from(str, ch => ch.charCodeAt(0) & 0xff))
    const repaired = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
    return repaired.includes('\ufffd') ? str : repaired
  } catch { return str }
}

// Sucht `needle` in `content` und gibt den EXAKT dort stehenden Ausschnitt
// zurück (oder null). Toleriert Groß-/Kleinschreibung und Mojibake – damit lässt
// sich ein leicht abweichendes 'before' auf den wörtlich vorhandenen Text
// verankern (der gespeicherte Vorschlag bleibt so anwendbar).
function anchorInText(content, needle) {
  if (typeof content !== 'string') return null
  for (const cand of [String(needle || ''), fixMojibake(needle || '')]) {
    if (!cand) continue
    let pos = content.indexOf(cand)
    if (pos < 0) pos = content.toLowerCase().indexOf(cand.toLowerCase())
    if (pos >= 0) return content.slice(pos, pos + cand.length)
  }
  return null
}

module.exports = { findNeedle, revertCorrectionInMessages, applyCorrectionToMessages, fixMojibake, anchorInText }
