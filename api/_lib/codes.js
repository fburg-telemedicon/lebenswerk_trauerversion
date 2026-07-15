// api/_lib/codes.js
// Erzeugt einen Code aus einem verwechslungsarmen Alphabet (ohne 0/O, 1/I).
// Dient als Gedenkbuch-Code (memorials.id) und als Fallback für Beitrags-IDs.
//
// SICHERHEIT: Der Code ist die (einzige) Berechtigung für den Beitragenden-Flow.
// Deshalb KRYPTOGRAPHISCH sicher würfeln (crypto.randomInt) statt Math.random –
// Math.random ist vorhersagbar: Aus wenigen beobachteten Codes ließe sich der
// PRNG-Zustand rekonstruieren und weitere Codes ableiten. randomInt ist zudem
// unverzerrt (kein Modulo-Bias über die 32 Zeichen).

const crypto = require('crypto')

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'   // 32 Zeichen
const DEFAULT_LEN = 6

function genCode(len = DEFAULT_LEN) {
  let out = ''
  for (let i = 0; i < len; i++) out += ALPHABET[crypto.randomInt(ALPHABET.length)]
  return out
}

module.exports = { genCode, ALPHABET, CODE_LEN: DEFAULT_LEN }
