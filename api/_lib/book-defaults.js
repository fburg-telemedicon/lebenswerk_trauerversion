// api/_lib/book-defaults.js
// Standardwerte, mit denen die Maske „Neues Buch anlegen" vorbelegt wird.
//
// Bisher steckten diese Werte fest im Frontend (EMPTY_CREATE in src/App.jsx).
// Sie liegen jetzt zusätzlich in der DB (app_settings, key = 'book_defaults') und
// sind im Dashboard änderbar. FALLBACK ist genau der bisherige Stand — solange
// nichts gespeichert wurde, verhält sich die Anlage-Maske also unverändert.
//
// Bewusst NICHT enthalten sind projektspezifische Felder (Name, Organisator,
// Geschlecht, Datum, Bemerkung) — ein Standardwert ergäbe dort keinen Sinn.

const { normalizeStyle, DEFAULT_STYLE } = require('./image-styles')
const { normalizeLayout, DEFAULT_BOOK_LAYOUT } = require('./book-layouts')

const ALLOWED_LANGS = ['de', 'pl', 'en']

const FALLBACK = {
  bookVariant: 1,
  cutoffDays: 7,
  showIntroVideo: false,
  showTranscript: true,
  showContributors: true,
  photoUploadTab: false,
  languages: ['de'],
  followups: 7,
  imageStyle: DEFAULT_STYLE,
  bookLayout: DEFAULT_BOOK_LAYOUT,
  pickupAddress: null,
}

function clampInt(v, min, max, fallback) {
  const n = parseInt(v, 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function sanitizeAddress(addr) {
  if (!addr || typeof addr !== 'object') return null
  const clean = {}
  for (const key of ['name', 'addon', 'street', 'zip', 'city', 'country']) {
    clean[key] = typeof addr[key] === 'string' ? addr[key].trim().slice(0, 200) : ''
  }
  const hasAny = ['name', 'addon', 'street', 'zip', 'city'].some(k => clean[k])
  if (!hasAny) return null
  if (!clean.country) clean.country = 'Deutschland'
  return clean
}

// Beliebige Eingabe → vollständiges, gültiges Defaults-Objekt. Unbekannte Felder
// fallen weg, ungültige Werte fallen auf FALLBACK zurück; das Ergebnis ist immer
// direkt als Vorbelegung der Anlage-Maske verwendbar.
function sanitizeBookDefaults(input) {
  const d = input && typeof input === 'object' ? input : {}
  const langs = Array.isArray(d.languages)
    ? [...new Set(d.languages.filter(l => ALLOWED_LANGS.includes(l)))]
    : []
  return {
    bookVariant: (d.bookVariant === 2 || d.bookVariant === '2') ? 2 : 1,
    cutoffDays: clampInt(d.cutoffDays, 0, 90, FALLBACK.cutoffDays),
    showIntroVideo: d.showIntroVideo === true,
    showTranscript: d.showTranscript !== false,
    showContributors: d.showContributors !== false,
    photoUploadTab: d.photoUploadTab === true,
    languages: langs.length ? langs : [...FALLBACK.languages],
    followups: clampInt(d.followups, 0, 30, FALLBACK.followups),
    imageStyle: normalizeStyle(d.imageStyle) || FALLBACK.imageStyle,
    bookLayout: normalizeLayout(d.bookLayout) || FALLBACK.bookLayout,
    pickupAddress: sanitizeAddress(d.pickupAddress),
  }
}

module.exports = { FALLBACK, ALLOWED_LANGS, sanitizeBookDefaults }
