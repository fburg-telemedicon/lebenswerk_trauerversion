// api/_lib/categories.js
// Einzige Quelle der Produktkategorie-Slugs/Labels für das BACKEND
// (Validierung, Berechtigungsprüfung). Die ausführlichen, kategorie-
// spezifischen Texte und KI-Prompts liegen im Frontend (src/categories.js).
//
// Slugs müssen mit src/categories.js übereinstimmen.

const CATEGORY_LABELS = {
  memorial:      'Gedenkbuch',
  birthday:      'Geburtstagsbuch',
  anniversary:   'Hochzeitsjubiläum',
  farewell:      'Abschied & Ruhestand',
  company:       'Betriebsjubiläum',
  newborn:       'Willkommensbuch',
  encouragement: 'Mutmachbuch',
}

const CATEGORY_SLUGS = Object.keys(CATEGORY_LABELS)

const DEFAULT_CATEGORY = 'memorial'

function isValidCategory(slug) {
  return CATEGORY_SLUGS.includes(slug)
}

module.exports = { CATEGORY_LABELS, CATEGORY_SLUGS, DEFAULT_CATEGORY, isValidCategory }
