// api/_lib/languages.js
// EINE Liste der unterstützten Sprachen fürs Backend. Vorher stand sie an drei
// Stellen (`memorials.js` zweimal, `book-defaults.js`) — beim Ergänzen einer
// Sprache wurde zuverlässig eine davon vergessen.
//
// Muss mit LANGUAGES in src/i18n.js übereinstimmen (dort steht zusätzlich die
// Beschriftung und die Schreibrichtung fürs Frontend).
//
// `de-CH` ist bewusst ein eigener Code, kein Alias von `de`: Spracherkennung
// (Mundart) und Stimme sind schweizerisch, geschrieben wird Schweizer Hochdeutsch.
// `he`/`ar` laufen von rechts nach links.
const ALLOWED_LANGS = ['de', 'de-CH', 'en', 'pl', 'es', 'it', 'eu', 'he', 'ar']
const RTL_LANGS = ['he', 'ar']
const DEFAULT_LANG = 'de'

const isLang = l => ALLOWED_LANGS.includes(l)
const isRTL = l => RTL_LANGS.includes(l)

// Eingehende Sprachlisten säubern: unbekannte Codes fliegen raus, leer → Deutsch.
function sanitizeLangs(list) {
  const langs = Array.isArray(list) ? [...new Set(list.filter(isLang))] : []
  return langs.length ? langs : [DEFAULT_LANG]
}

module.exports = { ALLOWED_LANGS, RTL_LANGS, DEFAULT_LANG, isLang, isRTL, sanitizeLangs }
