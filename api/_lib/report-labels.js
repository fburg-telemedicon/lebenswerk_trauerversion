// api/_lib/report-labels.js — deutsche Beschriftungen für Slugs im Report.
const CAT_LABELS = {
  memorial: 'Gedenken', birthday: 'Geburtstag', anniversary: 'Jubiläum',
  farewell: 'Abschied', service: 'Ruhestand', company: 'Firma',
  newborn: 'Geburt', encouragement: 'Ermutigung',
  lifework: 'Lebenswerk', mamazone: 'mamazone Edition', anamnesis: 'Anamnese', anamnesis_kvsw: 'Anamnese KVSW',
}
const LANG_LABELS = { de: 'Deutsch', pl: 'Polnisch', en: 'Englisch' }
const MODULE_LABELS = { llm: 'Text / KI', tts: 'Sprachausgabe', stt: 'Transkription', image: 'Bilder' }
const catLabel = s => CAT_LABELS[s] || s || '—'
const langLabel = s => LANG_LABELS[s] || (s || '').toUpperCase()
const moduleLabel = s => MODULE_LABELS[s] || s
const eur = n => (Number(n) || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
const int = n => (Number(n) || 0).toLocaleString('de-DE')
module.exports = { catLabel, langLabel, moduleLabel, eur, int, CAT_LABELS, LANG_LABELS, MODULE_LABELS }
