// api/_lib/text-styles.js
// Serverseitige Validierung des Buch-Textstils. Muss mit der Verfügbarkeitslogik
// in src/categories.js (TEXT_STYLES / textStylesFor) übereinstimmen.
//  - literary  = Standard (bisheriges Verhalten)
//  - narrative = NUR Lebenswerk (ein Erzähler → sein eigener Duktus)
//  - light     = feierliche Kategorien (heiter & anekdotisch)
// Das Trauerbuch (memorial) bietet nur „literary".

const TEXT_STYLE_KEYS = ['narrative', 'literary', 'light']

function textStylesFor(category) {
  if (category === 'lifework') return ['narrative', 'literary', 'light']
  if (category === 'memorial') return ['literary']
  return ['literary', 'light']
}

function defaultTextStyle(category) { return textStylesFor(category)[0] }

// Normalisiert den Textstil. Ist die Kategorie bekannt, wird auf die dort erlaubten
// Stile beschränkt (Default sonst). Ohne Kategorie genügt ein bekannter Schlüssel.
function normalizeTextStyle(category, v) {
  if (category) {
    const a = textStylesFor(category)
    return a.includes(v) ? v : a[0]
  }
  return TEXT_STYLE_KEYS.includes(v) ? v : 'literary'
}

module.exports = { TEXT_STYLE_KEYS, textStylesFor, defaultTextStyle, normalizeTextStyle }
