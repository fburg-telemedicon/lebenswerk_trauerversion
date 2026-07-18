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
  service:       'Dienstjubiläum',
  company:       'Betriebsjubiläum',
  newborn:       'Willkommensbuch',
  encouragement: 'Mutmachbuch',
  lifework:      'Lebenswerk',
  anamnesis:     'Anamnesebogen',
  anamnesis_kvsw:'Anamnese KVSW',
}

const CATEGORY_SLUGS = Object.keys(CATEGORY_LABELS)

const DEFAULT_CATEGORY = 'memorial'

// Endnutzer-Kategorien: EIN Endnutzer/Patient spricht über sich selbst (eigener
// Zugang), niemand sammelt Beiträge Dritter. Anamnese-Kategorien: die beiden
// medizinischen Aufnahme-Produkte (Reha + Krankenhaus KVSW). Beide Prädikate sind
// die BACKEND-Entsprechung zu isAnamnesis() im Frontend (src/categories.js) — wenn
// hier ein Slug ergänzt wird, dort ebenfalls prüfen.
const ANAMNESIS_CATEGORIES = ['anamnesis', 'anamnesis_kvsw']
const ENDUSER_CATEGORIES = ['lifework', 'anamnesis', 'anamnesis_kvsw']

function isValidCategory(slug) {
  return CATEGORY_SLUGS.includes(slug)
}
function isAnamnesisCategory(slug) {
  return ANAMNESIS_CATEGORIES.includes(slug)
}
function isEnduserCategory(slug) {
  return ENDUSER_CATEGORIES.includes(slug)
}

module.exports = { CATEGORY_LABELS, CATEGORY_SLUGS, DEFAULT_CATEGORY, isValidCategory, isAnamnesisCategory, isEnduserCategory, ANAMNESIS_CATEGORIES, ENDUSER_CATEGORIES }
