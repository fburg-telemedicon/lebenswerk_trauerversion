// scripts/md2pdf.js
// Markdown → PDF, für die Dokumente, die an Kunden gehen.
//   node scripts/md2pdf.js <datei.md|ordner> [...]
//
// Weg: Markdown → HTML (hier) → Edge/Chrome im Kopflos-Modus → PDF. Bewusst kein
// jsPDF wie bei den Formularen: Diese Dokumente leben von TABELLEN, und die von Hand
// zu setzen wäre viel Aufwand für ein schlechteres Ergebnis. Der Browser kann Tabellen,
// Seitenumbrüche und Silbentrennung von Haus aus.
//
// Der Markdown-Umfang ist bewusst klein gehalten — genau das, was in unseren
// Dokumenten vorkommt: Überschriften, Tabellen, Listen samt Ankreuzkästchen, fett/
// kursiv/Code, Zitatblöcke, Trennlinien, eingerückte Formularblöcke und Links.

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
]
const browser = () => {
  const b = BROWSERS.find(p => fs.existsSync(p))
  if (!b) throw new Error('Weder Edge noch Chrome gefunden — für die PDF-Ausgabe nötig.')
  return b
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Zeichenformatierung INNERHALB einer Zeile. Reihenfolge zählt: Code zuerst, damit
// Sternchen in `code` nicht als Fettschrift gelesen werden.
//
// `**Fettdruck**` darf über einen Zeilenumbruch gehen — im Fließtext tut er das
// ständig. Deshalb bekommt inline() IMMER den ganzen Block (Absatz, Listenpunkt,
// Tabellenzelle) auf einer Zeile; die Blöcke werden vorher zusammengefügt.
function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/☐/g, '<span class="box"></span>')
    // Der einzige rohe HTML-Tag, den unsere Dokumente benutzen (Abstand vor
    // Unterschriftszeilen). Ohne das steht wörtlich „<br>" im PDF.
    .replace(/&lt;br\s*\/?&gt;/g, '<br>')
}

const splitRow = r => r.replace(/^\||\|$/g, '').split('|').map(c => c.trim())

function mdToHtml(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const out = []
  let i = 0
  // Offene Listen als Stapel {einzug, schluss} — damit eingerückte Unterlisten
  // auch als Unterlisten erscheinen und nicht auf eine Ebene fallen.
  const closeList = st => { while (st.length) out.push(st.pop().schluss) }
  const listStack = []

  while (i < lines.length) {
    const l = lines[i]

    // Tabelle: Kopfzeile + Trennzeile + Datenzeilen
    if (/^\|/.test(l) && /^\|[\s:|-]+\|?\s*$/.test(lines[i + 1] || '')) {
      closeList(listStack)
      const head = splitRow(l)
      i += 2
      const rows = []
      while (i < lines.length && /^\|/.test(lines[i])) { rows.push(splitRow(lines[i])); i++ }
      out.push('<table><thead><tr>' + head.map(c => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>' +
        rows.map(r => '<tr>' + r.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') +
        '</tbody></table>')
      continue
    }

    // Eingerückter Block (Formularfelder, Unterschriftszeilen) → vorformatiert
    if (/^ {4}\S/.test(l)) {
      closeList(listStack)
      const buf = []
      while (i < lines.length && (/^ {4}/.test(lines[i]) || lines[i].trim() === '')) {
        if (lines[i].trim() === '' && !/^ {4}/.test(lines[i + 1] || '')) break
        buf.push(lines[i].replace(/^ {4}/, '')); i++
      }
      out.push(`<pre>${esc(buf.join('\n'))}</pre>`)
      continue
    }

    const h = l.match(/^(#{1,4})\s+(.*)$/)
    if (h) { closeList(listStack); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue }

    if (/^(---|___|\*\*\*)\s*$/.test(l)) { closeList(listStack); out.push('<hr>'); i++; continue }

    if (/^>\s?/.test(l)) {
      closeList(listStack)
      const buf = []
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++ }
      out.push(`<blockquote>${mdToHtml(buf.join('\n'))}</blockquote>`)
      continue
    }

    const li = l.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/)
    if (li) {
      const einzug = li[1].length
      const ordered = /\d/.test(li[2])
      const tag = ordered ? 'ol' : 'ul'
      while (listStack.length && einzug < listStack[listStack.length - 1].einzug) out.push(listStack.pop().schluss)
      if (!listStack.length || einzug > listStack[listStack.length - 1].einzug) {
        out.push(`<${tag}>`); listStack.push({ einzug, schluss: `</${tag}>` })
      }

      // FORTSETZUNGSZEILEN einsammeln. Ein Listenpunkt über mehrere Zeilen ist der
      // Normalfall in diesen Dokumenten. Ohne das hier passierte zweierlei: über den
      // Umbruch gehender **Fettdruck** blieb als wörtliches „**" stehen, und eine mit
      // vier Leerzeichen eingerückte Fortsetzung (Unterlisten) landete im
      // Formularblock-Zweig — also mitten im Fließtext ein Kasten in Schreibmaschine.
      const buf = [li[3]]
      i++
      while (i < lines.length) {
        const n = lines[i]
        if (n.trim() === '' || !/^\s/.test(n)) break
        if (/^\s*([-*]|\d+\.)\s/.test(n)) break
        if (/^\s*(#{1,4}\s|>|\||---)/.test(n)) break
        buf.push(n.trim()); i++
      }

      // Ankreuzkästchen als echtes Kästchen, nicht als „[ ]". Reihenfolge zählt:
      // erst maskieren, DANN das HTML einsetzen — andersherum escapt inline() das
      // Kästchen und im PDF steht wörtlich „<span class=…>".
      const text = buf.join(' ')
      const cb = text.match(/^\[( |x|X)\]\s*/)
      const box = cb ? `<span class="box${/x/i.test(cb[1]) ? ' on' : ''}"></span> ` : ''
      out.push(`<li>${box}${inline(cb ? text.slice(cb[0].length) : text)}</li>`)
      continue
    }

    if (l.trim() === '') { closeList(listStack); i++; continue }

    // Absatz: Folgezeilen anhängen, bis eine Leerzeile oder ein Blockanfang kommt
    const buf = [l]; i++
    while (i < lines.length && lines[i].trim() !== '' && !/^(#{1,4}\s|>|\||\s*([-*]|\d+\.)\s|---)/.test(lines[i]) && !/^ {4}\S/.test(lines[i])) {
      buf.push(lines[i]); i++
    }
    closeList(listStack)
    out.push(`<p>${inline(buf.join(' '))}</p>`)
  }
  closeList(listStack)
  return out.join('\n')
}

const CSS = `
@page { size: A4; margin: 20mm 18mm 18mm; }
* { box-sizing: border-box; }
body { font: 10.5pt/1.5 "Segoe UI", Arial, sans-serif; color: #1c1917; margin: 0; hyphens: auto; }
h1 { font-size: 19pt; margin: 0 0 4mm; line-height: 1.25; }
h2 { font-size: 13pt; margin: 8mm 0 3mm; padding-bottom: 1.5mm; border-bottom: 1px solid #d6d3d1; break-after: avoid; }
h3 { font-size: 11.5pt; margin: 6mm 0 2mm; break-after: avoid; }
h4 { font-size: 10.5pt; margin: 5mm 0 2mm; break-after: avoid; }
p { margin: 0 0 3mm; }
ul, ol { margin: 0 0 3mm; padding-left: 6mm; }
ul ul, ul ol, ol ul, ol ol { margin: 1.5mm 0 0; }
li { margin-bottom: 1.5mm; }
hr { border: none; border-top: 1px solid #e7e5e4; margin: 6mm 0; }
code { font-family: Consolas, monospace; font-size: 9pt; background: #f5f5f4; padding: 0 1mm; border-radius: 2px; }
a { color: #1c1917; text-decoration: underline; }
/* Formularfelder und Unterschriftszeilen: Ausrichtung muss erhalten bleiben. */
pre { font-family: Consolas, monospace; font-size: 9.5pt; line-height: 1.7; background: #fafaf9;
      border-left: 2px solid #d6d3d1; padding: 3mm 4mm; margin: 0 0 4mm; white-space: pre-wrap;
      break-inside: avoid; }
blockquote { margin: 0 0 4mm; padding: 2.5mm 4mm; background: #fffbeb; border-left: 3px solid #fbbf24; }
blockquote p:last-child { margin-bottom: 0; }
table { width: 100%; border-collapse: collapse; margin: 0 0 4mm; font-size: 9.5pt; break-inside: auto; }
th, td { border: 1px solid #d6d3d1; padding: 1.8mm 2.2mm; text-align: left; vertical-align: top; }
th { background: #f5f5f4; font-weight: 600; }
tr { break-inside: avoid; }
thead { display: table-header-group; }
/* Ankreuzkästchen zum Ausfüllen auf Papier */
.box { display: inline-block; width: 3.4mm; height: 3.4mm; border: 0.4mm solid #57534e;
       vertical-align: -0.4mm; margin-right: 0.8mm; }
.box.on { background: #57534e; }
`

function convert(mdPath) {
  const md = fs.readFileSync(mdPath, 'utf8')
  const title = (md.match(/^#\s+(.*)$/m) || [, path.basename(mdPath, '.md')])[1]
  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8">
<title>${esc(title)}</title><style>${CSS}</style></head><body>${mdToHtml(md)}</body></html>`

  const tmp = mdPath.replace(/\.md$/, '.tmp.html')
  const pdf = mdPath.replace(/\.md$/, '.pdf')
  fs.writeFileSync(tmp, html, 'utf8')

  // Eigenes Profilverzeichnis je Aufruf. Ohne das klinkt sich der Aufruf in eine
  // schon laufende Browser-Instanz ein, kehrt sofort zurück — und hinterlässt eine
  // PDF-Datei mit 0 Byte. Genau das ist beim Stapellauf passiert.
  const profile = path.join(require('os').tmpdir(), `md2pdf-${process.pid}-${Math.random().toString(36).slice(2)}`)

  // Zeitmarke VOR dem ersten Versuch. Die Prüfung unten verlangt eine Datei, die
  // NACH dieser Marke geschrieben wurde — „existiert und ist ein gültiges PDF"
  // genügt nicht: Lässt sich die alte Datei nicht löschen (etwa weil sie in einem
  // PDF-Betrachter offen ist) und schreibt der Browser deshalb nichts, besteht das
  // ALTE PDF alle inhaltlichen Prüfungen. Genau so sind zwei Dokumente mit
  // Erfolgsmeldung im veralteten Stand liegen geblieben.
  const start = Date.now()

  try {
    for (let versuch = 1; versuch <= 3; versuch++) {
      try {
        fs.unlinkSync(pdf)
      } catch (e) {
        if (e.code !== 'ENOENT') {
          throw new Error(`${path.basename(pdf)} lässt sich nicht überschreiben (${e.code}) — ` +
            'vermutlich in einem PDF-Betrachter geöffnet. Bitte schließen und erneut laufen lassen.')
        }
      }
      execFileSync(browser(), [
        '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
        '--no-pdf-header-footer', `--user-data-dir=${profile}`,
        `--print-to-pdf=${pdf}`, 'file:///' + tmp.replace(/\\/g, '/'),
      ], { stdio: 'ignore', timeout: 90000 })
      // Nicht nur „existiert", sondern „ist ein frisch geschriebenes PDF mit Inhalt".
      if (fs.existsSync(pdf) && fs.statSync(pdf).size > 1000 &&
          fs.statSync(pdf).mtimeMs >= start &&
          fs.readFileSync(pdf, { encoding: 'latin1', flag: 'r' }).slice(0, 5) === '%PDF-') return pdf
      if (versuch < 3) console.warn(`    (kein frisches PDF, Versuch ${versuch + 1}: ${path.basename(pdf)})`)
    }
    throw new Error(`PDF blieb leer nach drei Versuchen: ${pdf}`)
  } finally {
    try { fs.unlinkSync(tmp) } catch {}
    try { fs.rmSync(profile, { recursive: true, force: true }) } catch {}
  }
}

module.exports = { mdToHtml, convert }

// Nur als Werkzeug laufen lassen — sonst baut schon ein `require` dieser Datei
// (etwa aus einer Prüfung des Markdown-Umbaus) sofort PDFs.
if (require.main === module) {
  const targets = []
  for (const arg of process.argv.slice(2)) {
    const p = path.resolve(arg)
    if (fs.statSync(p).isDirectory()) {
      for (const f of fs.readdirSync(p)) if (f.endsWith('.md')) targets.push(path.join(p, f))
    } else targets.push(p)
  }
  if (!targets.length) { console.error('Nichts zu tun. Aufruf: node scripts/md2pdf.js <datei.md|ordner>'); process.exit(1) }

  for (const t of targets) {
    const pdf = convert(t)
    console.log(`  · ${path.basename(pdf)}  (${(fs.statSync(pdf).size / 1024).toFixed(0)} kB)`)
  }
  console.log(`\n${targets.length} PDF${targets.length === 1 ? '' : 's'} erzeugt.`)
}
