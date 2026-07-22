// api/_lib/ttsvoices.js
// Kanonische Liste der wählbaren DEUTSCHEN Sprachausgabe-Stimmen (Azure Neural)
// samt Defaults. Wird von der Buch-Anlage/-Bearbeitung (Validierung, Default) und
// von der Sprachausgabe (Allowlist) genutzt. Die pro Buch gewählte Stimme gilt
// NUR für die deutsche Ausgabe; andere Sprachen behalten ihre Standardstimme
// (siehe TTS_VOICES in api/speak.js). Die passende UI-Liste (mit Labels) steht in
// src/categories.js (TTS_VOICE_OPTIONS) — Werte hier und dort identisch halten.

// HD („Dragon")-Stimmen der neuesten Generation = die natürlichsten. Sie ignorieren
// zwar SSML-Feineinstellungen wie das Sprechtempo, klingen dafür am menschlichsten.
const VOICE_FEMALE_HD = 'de-DE-Seraphina:DragonHDLatestNeural'
const VOICE_MALE_HD   = 'de-DE-Florian:DragonHDLatestNeural'

// MAI-Voice-2: Microsofts neueste Generation, ebenfalls NeuralHD (gleicher Preis-
// Meter wie HD). Standard für NEUE Bücher. Bestehende Bücher behalten ihre
// gespeicherte Stimme — mitten im Projekt die Erzählstimme zu wechseln wäre für
// den Erzähler ein Bruch.
const VOICE_FEMALE_MAI = 'de-DE-Mia:MAI-Voice-2'
const VOICE_MALE_MAI   = 'de-DE-Klaus:MAI-Voice-2'

// Zweitsprachen der MAI-Stimmen (aus der Stimmenliste der Region abgefragt).
// Bewusst als Sprachcode der App, nicht als Locale: Nur für diese Sprachen darf
// eine MAI-Stimme auch die fremdsprachige Ausgabe übernehmen. Für alle anderen
// (pl, eu, he, ar, uk, de-CH) kann sie es NICHT — dort greift die bisherige
// Multilingual-Stimme bzw. die Standardstimme der Sprache.
const MAI_SECONDARY_LANGS = new Set(['en', 'es', 'it', 'fr', 'ro', 'tr', 'ru'])
function isMaiVoice(v) { return /:MAI-Voice/i.test(String(v || '')) }

// Erlaubte Werte (Allowlist). Alles außerhalb wird ignoriert → Fallback auf die
// sprachbasierte Standardstimme.
const ALLOWED_TTS_VOICES = new Set([
  VOICE_FEMALE_MAI,
  VOICE_MALE_MAI,
  VOICE_FEMALE_HD,
  VOICE_MALE_HD,
  'de-DE-KatjaNeural',
  'de-DE-ConradNeural',
  'de-DE-LouisaNeural',
  'de-DE-BerndNeural',
  'de-DE-AmalaNeural',
  'de-DE-ChristophNeural',
])

// Default je Produktkategorie: Anamnese (Reha + KVSW) → männlich, sonst → weiblich.
// Seit 2026-07-22 die MAI-Stimmen (natürlicher, gleicher Preis wie HD).
const { isAnamnesisCategory } = require('./categories')
function defaultTtsVoice(category) {
  return isAnamnesisCategory(category) ? VOICE_MALE_MAI : VOICE_FEMALE_MAI
}

// Eingabe säubern: nur erlaubte Stimmen zulassen, sonst null.
function sanitizeVoice(v) {
  return (typeof v === 'string' && ALLOWED_TTS_VOICES.has(v)) ? v : null
}

// Geschlecht je wählbarer Stimme — damit für andere Interviewsprachen die zur
// Buchstimme passende „Person" (Multilingual-Stimme) gewählt werden kann.
const VOICE_GENDER = {
  [VOICE_FEMALE_MAI]: 'f',
  [VOICE_MALE_MAI]:   'm',
  [VOICE_FEMALE_HD]: 'f',
  [VOICE_MALE_HD]:   'm',
  'de-DE-KatjaNeural':    'f',
  'de-DE-ConradNeural':   'm',
  'de-DE-LouisaNeural':   'f',
  'de-DE-BerndNeural':    'm',
  'de-DE-AmalaNeural':    'f',
  'de-DE-ChristophNeural':'m',
}
function voiceGender(v) { return VOICE_GENDER[v] || null }

// Mehrsprachige Stimmen: EINE „Person" spricht viele Sprachen (konsistente Stimme
// über Sprachgrenzen). Für Nicht-Deutsch-Sprachen passend zum Geschlecht der
// deutschen Buchstimme. Beste verfügbare i18n-Option.
const MULTILINGUAL_VOICE = {
  f: 'de-DE-SeraphinaMultilingualNeural',
  m: 'de-DE-FlorianMultilingualNeural',
}

module.exports = {
  ALLOWED_TTS_VOICES, VOICE_FEMALE_HD, VOICE_MALE_HD, VOICE_FEMALE_MAI, VOICE_MALE_MAI,
  MAI_SECONDARY_LANGS, isMaiVoice,
  defaultTtsVoice, sanitizeVoice, voiceGender, MULTILINGUAL_VOICE,
}
