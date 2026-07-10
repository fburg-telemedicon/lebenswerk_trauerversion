// api/_lib/book-layouts.js
// Backend-Validierung des Buchlayouts (die eigentliche Typografie liegt im
// Frontend, src/bookLayouts.js – Rendering von DOCX/PDF/Leseansicht ist clientseitig).
const LAYOUT_KEYS = ['classic', 'modern', 'elegant']
const DEFAULT_BOOK_LAYOUT = 'classic'
function normalizeLayout(key) {
  return LAYOUT_KEYS.includes(key) ? key : null
}
module.exports = { LAYOUT_KEYS, DEFAULT_BOOK_LAYOUT, normalizeLayout }
