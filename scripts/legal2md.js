// scripts/legal2md.js
// Zieht Datenschutzerklärung und Impressum aus src/LegalPages.jsx nach Markdown.
//   node scripts/legal2md.js <zielordner>
//
// WARUM AUS DEM CODE und nicht aus einer gepflegten Datei: Die Datenschutzerklärung,
// die Betroffene tatsächlich sehen, steht in der App. Eine zweite, handgepflegte
// Fassung würde davon abdriften — und genau dieser Fall ist eingetreten: In
// `Lebenswerk_AI\AGB\Datenschutzerklärung.pdf` liegt eine Fassung vom Mai 2026, die
// noch Supabase/Vercel nennt und den Live-Modus nicht kennt. Wer sie einem
// Kunden-DSB schickt, liefert ihm einen Widerspruch zum AVV frei Haus.
//
// Der Extraktor ist bewusst grob: Er kennt genau die Bausteine, die LegalPages.jsx
// benutzt (h2, p, ul/li, strong, a, br). Ändert sich dort die Struktur grundlegend,
// fällt das hier sofort auf, weil das Ergebnis leer oder zerrissen ist.

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'src', 'LegalPages.jsx')

// Den Rumpf EINER exportierten Komponente ausschneiden.
//
// ACHTUNG: „bis zur nächsten `export function`" heißt wörtlich das. Wer zwischen
// zwei exportierte Komponenten Hilfsfunktionen legt, schiebt deren Quelltext in
// das Kundendokument — einmal passiert, als der Markdown-Renderer der AGB-Seite
// zwischen `Datenschutz` und `AGB` lag. Hilfsfunktionen gehören deshalb VOR die
// erste exportierte Komponente.
function componentBody(src, name) {
  const start = src.indexOf(`export function ${name}()`)
  if (start === -1) throw new Error(`Komponente nicht gefunden: ${name}`)
  const next = src.indexOf('\nexport function ', start + 1)
  return src.slice(start, next === -1 ? src.length : next)
}

function jsxToMarkdown(jsx) {
  let s = jsx

  // JS-Ausdrücke, die wir kennen, vorher auflösen.
  s = s.replace(/\{CONSENT_VERSION\}/g, require(path.join(ROOT, 'src', 'constants.js')).CONSENT_VERSION || '')

  // Alles vor dem eigentlichen Inhalt abschneiden (Layout-Kopf).
  const i = s.indexOf('>')
  s = s.slice(s.indexOf('\n', i) + 1)

  s = s
    .replace(/<h2[^>]*>/g, '\n## ').replace(/<\/h2>/g, '\n')
    .replace(/<h3[^>]*>/g, '\n### ').replace(/<\/h3>/g, '\n')
    .replace(/<li[^>]*>/g, '\n- ').replace(/<\/li>/g, '')
    .replace(/<\/?ul[^>]*>/g, '\n').replace(/<\/?ol[^>]*>/g, '\n')
    .replace(/<p[^>]*>/g, '\n\n').replace(/<\/p>/g, '\n')
    .replace(/<br\s*\/?>/g, '  \n')
    .replace(/<strong>/g, '**').replace(/<\/strong>/g, '**')
    .replace(/<em>/g, '*').replace(/<\/em>/g, '*')
    .replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g, '[$2]($1)')
    // Restliche Tags und JSX-Gerüst entfernen.
    .replace(/<\/?(div|span|LegalLayout|button)[^>]*>/g, '')
    .replace(/^\s*(return|\)|\};?|\{)\s*$/gm, '')
    .replace(/\{'([^']*)'\}/g, '$1')
    .replace(/&nbsp;/g, ' ')
    // JSX-Entities, die als Text gemeint sind
    .replace(/\{'’'\}/g, '’')

  // Zeilen aufräumen: Einrückung weg, Mehrfach-Leerzeilen zusammenfassen.
  s = s.split('\n').map(l => l.replace(/^\s+/, '').replace(/\s+$/, m => m.includes('  ') ? '  ' : ''))
       // Quelltext-Kommentare fliegen raus. Sie stehen zwischen den Komponenten und
       // landeten sonst im Kundendokument — genau so ist der Kommentar über
       // `LegalFooter` einmal hinter dem Beschwerderecht aufgetaucht.
       .filter(l => !/^\/\//.test(l))
       .join('\n').replace(/\n{3,}/g, '\n\n').trim()
  return s
}

const DOKUMENTE = [
  ['Datenschutz', 'Datenschutzerklaerung.md', 'Datenschutzerklärung'],
  ['Impressum', 'Impressum.md', 'Impressum'],
]

// Ein Rechtstext als Markdown, mit Kopfzeile. `vorspann` hängt eine Einordnung
// darunter — im Kundenpaket muss dort stehen, für wen die Erklärung gilt.
function legalMarkdown(comp, vorspann = '') {
  const eintrag = DOKUMENTE.find(d => d[0] === comp)
  if (!eintrag) throw new Error(`Unbekanntes Dokument: ${comp}`)
  const src = fs.readFileSync(SRC, 'utf8')
  const heute = new Date().toISOString().slice(0, 10)
  return `# ${eintrag[2]}\n\n> Erzeugt aus der Anwendung am ${heute}.\n` +
    `> Maßgeblich ist die jeweils unter lebensgeschichten.ai veröffentlichte Fassung.\n` +
    (vorspann ? `\n${vorspann}\n` : '') +
    `\n${jsxToMarkdown(componentBody(src, comp))}\n`
}

module.exports = { legalMarkdown, jsxToMarkdown, componentBody, DOKUMENTE }

// Als Werkzeug aufgerufen: beide Texte in einen Ordner schreiben.
if (require.main === module) {
  const OUT = path.resolve(process.argv[2] || '.')
  fs.mkdirSync(OUT, { recursive: true })
  for (const [comp, file] of DOKUMENTE) {
    const md = legalMarkdown(comp)
    fs.writeFileSync(path.join(OUT, file), md)
    console.log('  ·', file, `(${md.length} Zeichen)`)
  }
}
