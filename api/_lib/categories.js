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
  mamazone:      'mamazone Edition',
  anamnesis_kvsw:'Anamnese KVSW',
  career:        'Lebenslauf',
}

const CATEGORY_SLUGS = Object.keys(CATEGORY_LABELS)

const DEFAULT_CATEGORY = 'memorial'

// Endnutzer-Kategorien: EIN Endnutzer/Patient spricht über sich selbst (eigener
// Zugang), niemand sammelt Beiträge Dritter. Anamnese-Kategorien: die beiden
// medizinischen Aufnahme-Produkte (Reha + Krankenhaus KVSW). Beide Prädikate sind
// die BACKEND-Entsprechung zu isAnamnesis() im Frontend (src/categories.js) — wenn
// hier ein Slug ergänzt wird, dort ebenfalls prüfen.
const ANAMNESIS_CATEGORIES = ['anamnesis', 'anamnesis_kvsw']
// Lebenswerk-FAMILIE: das Lebenswerk und die mamazone Edition. Technisch dasselbe
// Produkt (ein Mensch erzaehlt ueber sich selbst, der Buch-Code ist die
// Berechtigung); sie unterscheiden sich nur in Fragenkatalog und Haltung. Muss mit
// isLifework() in src/categories.js uebereinstimmen.
const LIFEWORK_CATEGORIES = ['lifework', 'mamazone']

// Lebenslauf: EIN Mensch erzaehlt seinen eigenen Berufsweg — also ebenfalls eine
// Endnutzer-Kategorie (eigener Zugang, Code = Berechtigung). Eine eigene FAMILIE
// bildet sie NICHT: Sie erbt nichts vom Lebenswerk und nichts von der Anamnese,
// sondern steht fuer sich (Pruefung ueber den Slug bzw. isCareer() im Frontend).
const ENDUSER_CATEGORIES = ['lifework', 'mamazone', 'anamnesis', 'anamnesis_kvsw', 'career']

const CAREER_CATEGORY = 'career'
function isCareerCategory(slug) {
  return slug === CAREER_CATEGORY
}

function isValidCategory(slug) {
  return CATEGORY_SLUGS.includes(slug)
}
function isAnamnesisCategory(slug) {
  return ANAMNESIS_CATEGORIES.includes(slug)
}
function isLifeworkCategory(slug) {
  return LIFEWORK_CATEGORIES.includes(slug)
}
function isEnduserCategory(slug) {
  return ENDUSER_CATEGORIES.includes(slug)
}

module.exports = { CATEGORY_LABELS, CATEGORY_SLUGS, DEFAULT_CATEGORY, isValidCategory, isAnamnesisCategory, isEnduserCategory, isLifeworkCategory, isCareerCategory, CAREER_CATEGORY, ANAMNESIS_CATEGORIES, LIFEWORK_CATEGORIES, ENDUSER_CATEGORIES }
