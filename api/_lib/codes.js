// api/_lib/codes.js
// Erzeugt einen 6-stelligen Code aus einem verwechslungsarmen Alphabet
// (ohne 0/O, 1/I). Dient als Gedenkbuch-Code (memorials.id) und als Fallback
// für Beitrags-IDs.

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function genCode() {
  return Array.from({ length: 6 }, () =>
    ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
  ).join('')
}

module.exports = { genCode }
