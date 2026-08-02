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
       .join('\n').replace(/\n{3,}/g, '\n\n').trim()
  return s
}

const OUT = path.resolve(process.argv[2] || '.')
fs.mkdirSync(OUT, { recursive: true })
const src = fs.readFileSync(SRC, 'utf8')

for (const [comp, file, titel] of [
  ['Datenschutz', 'Datenschutzerklaerung.md', 'Datenschutzerklärung'],
  ['Impressum', 'Impressum.md', 'Impressum'],
]) {
  const md = `# ${titel}\n\n> Erzeugt aus der Anwendung (\`src/LegalPages.jsx\`) am ${new Date().toISOString().slice(0, 10)}.\n> Maßgeblich ist die jeweils unter lebensgeschichten.ai veröffentlichte Fassung.\n\n${jsxToMarkdown(componentBody(src, comp))}\n`
  fs.writeFileSync(path.join(OUT, file), md)
  console.log('  ·', file, `(${md.length} Zeichen)`)
}
