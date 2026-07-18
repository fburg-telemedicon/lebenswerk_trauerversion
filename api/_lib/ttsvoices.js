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

// Erlaubte Werte (Allowlist). Alles außerhalb wird ignoriert → Fallback auf die
// sprachbasierte Standardstimme.
const ALLOWED_TTS_VOICES = new Set([
  VOICE_FEMALE_HD,
  VOICE_MALE_HD,
  'de-DE-KatjaNeural',
  'de-DE-ConradNeural',
  'de-DE-LouisaNeural',
  'de-DE-BerndNeural',
  'de-DE-AmalaNeural',
  'de-DE-ChristophNeural',
])

// Default je Produktkategorie: Anamnese → männlich (HD), sonst → weiblich (HD).
function defaultTtsVoice(category) {
  return category === 'anamnesis' ? VOICE_MALE_HD : VOICE_FEMALE_HD
}

// Eingabe säubern: nur erlaubte Stimmen zulassen, sonst null.
function sanitizeVoice(v) {
  return (typeof v === 'string' && ALLOWED_TTS_VOICES.has(v)) ? v : null
}

// Geschlecht je wählbarer Stimme — damit für andere Interviewsprachen die zur
// Buchstimme passende „Person" (Multilingual-Stimme) gewählt werden kann.
const VOICE_GENDER = {
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
  ALLOWED_TTS_VOICES, VOICE_FEMALE_HD, VOICE_MALE_HD,
  defaultTtsVoice, sanitizeVoice, voiceGender, MULTILINGUAL_VOICE,
}
