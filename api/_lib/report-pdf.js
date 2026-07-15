// api/_lib/report-pdf.js
// Baut den PDF-Tagesbericht: jede Seite wird als ganzseitige SVG (A4 hoch, 150 DPI)
// gestaltet, via sharp zu PNG gerastert und in ein jsPDF gelegt. So haben wir volle
// Layout-Kontrolle (KPI-Kacheln, Tabellen, Diagramme) und nutzen die gebündelten
// Serif-Fonts (setupFonts). Rückgabe: { buffer, base64, filename }.

const { setupFonts } = require('./fonts')
const charts = require('./report-charts')
const { catLabel, langLabel, moduleLabel, eur, int } = require('./report-labels')

setupFonts()

const W = 1240, H = 1754           // A4 hoch @ 150 DPI
const MARGIN = 70
const F = 'DejaVu Serif, Georgia, serif'
const INK = '#2b2723', MUTED = '#9a9187', LINE = '#e7e2d9', BG = '#ffffff', TILE = '#f7f4ef'
const POS = '#5f7d5a', NEG = '#a85a4a'
const esc = charts.escapeXml

function txt(x, y, s, { size = 22, fill = INK, anchor = 'start', bold = false } = {}) {
  return `<text x="${x}" y="${y}" font-family="${F}" font-size="${size}" fill="${fill}" text-anchor="${anchor}"${bold ? ' font-weight="bold"' : ''}>${esc(s)}</text>`
}

function header(title, subtitle) {
  let s = `<rect x="0" y="0" width="${W}" height="${H}" fill="${BG}"/>`
  s += `<rect x="0" y="0" width="${W}" height="8" fill="#8a7a5e"/>`
  s += txt(MARGIN, 92, 'Lebensgeschichten', { size: 26, fill: '#8a7a5e', bold: true })
  s += txt(MARGIN, 138, title, { size: 40, bold: true })
  if (subtitle) s += txt(MARGIN, 176, subtitle, { size: 22, fill: MUTED })
  s += `<line x1="${MARGIN}" y1="200" x2="${W - MARGIN}" y2="200" stroke="${LINE}" stroke-width="1.5"/>`
  return s
}
function footer(pageNo, pages) {
  let s = `<line x1="${MARGIN}" y1="${H - 70}" x2="${W - MARGIN}" y2="${H - 70}" stroke="${LINE}" stroke-width="1"/>`
  s += txt(MARGIN, H - 44, 'Nur aggregierte Kennzahlen · keine personenbezogenen Daten (DSGVO)', { size: 16, fill: MUTED })
  s += txt(W - MARGIN, H - 44, `Seite ${pageNo}/${pages}`, { size: 16, fill: MUTED, anchor: 'end' })
  return s
}
function sectionTitle(x, y, s) { return txt(x, y, s, { size: 26, bold: true }) }

function deltaStr(d, { money = false } = {}) {
  if (d == null || d === 0) return null
  const sign = d > 0 ? '▲' : '▼'
  const val = money ? eur(Math.abs(d)) : int(Math.abs(d))
  return { text: `${sign} ${val}`, color: d > 0 ? POS : NEG }
}

// KPI-Kachel.
function tile(x, y, w, h, { label, value, sub, delta }) {
  let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="${TILE}"/>`
  s += txt(x + 24, y + 42, label, { size: 20, fill: MUTED })
  s += txt(x + 24, y + 96, value, { size: 46, bold: true })
  let subY = y + 132
  if (delta) { s += txt(x + 24, subY, delta.text, { size: 19, fill: delta.color }); subY += 30 }
  if (sub) s += txt(x + 24, subY, sub, { size: 18, fill: MUTED })
  return s
}

// Einfache Zwei-Spalten-Tabelle (Label | Wert).
function table(x, y, w, rows, { rowH = 40, headL, headR } = {}) {
  let s = ''
  let cy = y
  if (headL || headR) {
    s += txt(x, cy, headL || '', { size: 18, fill: MUTED, bold: true })
    s += txt(x + w, cy, headR || '', { size: 18, fill: MUTED, bold: true, anchor: 'end' })
    cy += rowH * 0.7
    s += `<line x1="${x}" y1="${cy - rowH * 0.4}" x2="${x + w}" y2="${cy - rowH * 0.4}" stroke="${LINE}" stroke-width="1"/>`
  }
  for (const r of rows) {
    s += txt(x, cy + rowH * 0.6, r.label, { size: 20, fill: INK })
    s += txt(x + w, cy + rowH * 0.6, r.value, { size: 20, fill: INK, anchor: 'end' })
    cy += rowH
    s += `<line x1="${x}" y1="${cy}" x2="${x + w}" y2="${cy}" stroke="${LINE}" stroke-width="0.75"/>`
  }
  return s
}

// ── Changelog-Paginierung ─────────────────────────────────────────
// Der Changelog ("Gestern umgesetzt") ist beliebig lang. Damit durch den festen
// Seitenraster NICHTS verloren geht, wird er zeilengenau umgebrochen und über so
// viele (Fortsetzungs-)Seiten verteilt, wie nötig.
const CL_MAXCH = 96          // Zeichen pro Zeile (grobe Umbruchheuristik)
const CL_LINE_H = 30         // Zeilenhöhe
const CL_ITEM_GAP = 8        // Abstand nach einem Eintrag
const PAGE_BOTTOM = H - 95   // unterste Baseline für Inhalt (über dem Footer bei H-70)

// Wandelt Changelog-Einträge in eine flache Liste umgebrochener Zeilen. `first`
// markiert die erste Zeile eines Eintrags (bekommt Aufzählungspunkt + INK-Farbe),
// `gapAfter` die letzte (danach kleiner Abstand).
function changelogLines(items) {
  const out = []
  for (const it of items) {
    const words = String(it).split(/\s+/); let ln = ''; const wrapped = []
    for (const w of words) { if ((ln + ' ' + w).trim().length > CL_MAXCH) { wrapped.push(ln.trim()); ln = w } else ln += ' ' + w }
    if (ln.trim()) wrapped.push(ln.trim())
    const ws = wrapped.length ? wrapped : ['']
    ws.forEach((l, k) => out.push({ text: l, first: k === 0, gapAfter: k === ws.length - 1 }))
  }
  return out
}

// Rendert Zeilen ab `startY`, bis die Seite voll ist. Gibt { svg, rest } zurück;
// `rest` sind die noch nicht gerenderten Zeilen (→ nächste Seite).
function renderChangelog(lines, startY) {
  let s = ''; let ry = startY; let i = 0
  for (; i < lines.length; i++) {
    if (ry + CL_LINE_H > PAGE_BOTTOM) break
    const l = lines[i]
    if (l.first) s += `<circle cx="${MARGIN + 6}" cy="${ry - 6}" r="4" fill="#8a7a5e"/>`
    s += txt(MARGIN + 26, ry, l.text, { size: 20, fill: l.first ? INK : MUTED })
    ry += CL_LINE_H
    if (l.gapAfter) ry += CL_ITEM_GAP
  }
  return { svg: s, rest: lines.slice(i) }
}

// ── Seiten ────────────────────────────────────────────────────────
// Oberer Teil der ersten Seite (KPIs + Kennzahlen + Changelog-Überschrift).
// Gibt zusätzlich die Start-Y-Position für die Changelog-Liste zurück.
function page1Top(d) {
  const y = d.yesterday
  let s = header('Tagesreport', d.dateLabel)
  // KPI-Kacheln (3×2)
  const gx = MARGIN, gw = (W - 2 * MARGIN - 2 * 30) / 3, gh = 168
  const col = i => gx + (i % 3) * (gw + 30)
  const row = i => 240 + Math.floor(i / 3) * (gh + 30)
  const tiles = [
    { label: 'Neue Gedenkbücher', value: int(y.newMemorials), delta: deltaStr(y.delta.memorials) },
    { label: 'Neue Beiträge', value: int(y.newContributions), delta: deltaStr(y.delta.contributions) },
    { label: 'Kosten gestern', value: eur(y.costEur), delta: deltaStr(y.delta.costEur, { money: true }) },
    { label: 'Neu erzeugte Bücher', value: d.genTimestamps ? int(y.newBooks) : '–', sub: d.genTimestamps ? 'inkl. beider Varianten' : 'ab Migration' },
    { label: 'Neue Nachrufe', value: d.genTimestamps ? int(y.newEulogies) : '–' },
    { label: 'Neue Fotos', value: int(y.newPhotos) },
  ]
  tiles.forEach((t, i) => { s += tile(col(i), row(i), gw, gh, t) })
  // Weitere Zahlen + Wortvolumen
  let ry = row(5) + gh + 46
  s += sectionTitle(MARGIN, ry, 'Weitere Kennzahlen (gestern)')
  ry += 24
  s += table(MARGIN, ry, W - 2 * MARGIN, [
    { label: 'Neue Manager', value: int(y.newManagers) },
    { label: 'Fertig abgeschlossen (drucken!)', value: `${int(y.finalizedBooks)}${d.totals.finalizedBooks ? ` · offen gesamt ${int(d.totals.finalizedBooks)}` : ''}` },
    { label: 'Beigetragene Textmenge', value: `${int(y.words)} Wörter · ${int(y.chars)} Zeichen` },
    { label: 'Kosten Monat bisher', value: eur(d.mtd.costEur) },
    { label: 'Kosten Vormonat (gesamt)', value: eur(d.mtd.prevMonthCostEur) },
  ], { rowH: 44 })
  // Changelog-Überschrift (die Liste selbst wird paginiert angehängt)
  ry += 44 * 4 + 40
  s += sectionTitle(MARGIN, ry, 'Gestern umgesetzt (Entwicklung)')
  ry += 34
  return { svg: s, startY: ry }
}

function page2(d) {
  let s = header('Aktivität', d.dateLabel)
  const x = MARGIN, w = W - 2 * MARGIN
  s += charts.lineChart({ x, y: 250, w, h: 380, title: 'Beiträge pro Tag (letzte 30 Tage)', labels: d.series.days, values: d.series.contributionsPerDay })
  const catItems = Object.entries(d.series.memByCat30).map(([k, v]) => ({ label: catLabel(k), value: v })).sort((a, b) => b.value - a.value)
  s += charts.hBarsChart({ x, y: 680, w: w * 0.48, h: 360, title: 'Neue Gedenkbücher je Kategorie (30 Tage)', items: catItems })
  s += charts.barsChart({ x: x + w * 0.52, y: 680, w: w * 0.48, h: 360, title: 'Beiträge nach Uhrzeit (gestern)', labels: d.yesterday.peakHours.map((_, i) => String(i)), values: d.yesterday.peakHours, color: charts.SERIES[2], everyLabel: 3 })
  // Kennzahlenzeile
  let ry = 1110
  s += sectionTitle(MARGIN, ry, 'Nutzung')
  ry += 24
  s += table(MARGIN, ry, w, [
    { label: 'Ø Beiträge pro Gedenkbuch', value: d.totals.memorials ? (d.totals.contributions / d.totals.memorials).toFixed(1) : '0' },
    { label: 'Gedenkbücher mit fertigem Buch', value: `${int(d.totals.books)} von ${int(d.totals.memorials)}` },
    { label: 'Erstellte Nachrufe gesamt', value: int(d.totals.eulogies) },
  ], { rowH: 46 })
  return s
}

function page3(d) {
  let s = header('Kosten', d.dateLabel)
  const x = MARGIN, w = W - 2 * MARGIN
  const y = d.yesterday
  s += charts.donutChart({
    x, y: 250, w: w * 0.5, h: 340, title: 'Kosten gestern nach Modul',
    segments: [
      { label: moduleLabel('llm'), value: y.costByModule.llm },
      { label: moduleLabel('tts'), value: y.costByModule.tts },
      { label: moduleLabel('stt'), value: y.costByModule.stt },
      { label: moduleLabel('image'), value: y.costByModule.image },
    ],
  })
  s += charts.barsChart({
    x: x + w * 0.54, y: 250, w: w * 0.46, h: 340, title: 'Monatsvergleich', color: charts.SERIES[1],
    labels: ['Vormonat', 'akt. Monat'], values: [d.mtd.prevMonthCostEur, d.mtd.costEur], valueFmt: v => eur(v), everyLabel: 1,
  })
  s += charts.lineChart({ x, y: 640, w, h: 360, title: 'Kosten pro Tag (letzte 30 Tage)', labels: d.series.days, values: d.series.costPerDay, color: charts.SERIES[4], valueFmt: v => `${(Math.round(v * 100) / 100).toString().replace('.', ',')} €` })
  // Tabelle Provider/Modell
  let ry = 1070
  s += sectionTitle(MARGIN, ry, 'Kosten gestern nach Provider / Modell')
  ry += 30
  const rows = Object.entries(y.costByModel).slice(0, 8).map(([k, v]) => ({ label: k, value: eur(v) }))
  s += table(MARGIN, ry, w, rows.length ? rows : [{ label: '— keine Kosten —', value: '' }], { rowH: 40, headL: 'Provider · Modell', headR: 'Kosten' })
  return s
}

function page4(d) {
  let s = header('Bestand & Betrieb', d.dateLabel)
  const gx = MARGIN, gw = (W - 2 * MARGIN - 3 * 24) / 4, gh = 150
  const totals = [
    { label: 'Gedenkbücher', value: int(d.totals.memorials) },
    { label: 'Beiträge', value: int(d.totals.contributions) },
    { label: 'Manager', value: int(d.totals.managers) },
    { label: 'Fotos hochgeladen', value: int(d.totals.photos) },
  ]
  totals.forEach((t, i) => { s += tile(gx + i * (gw + 24), 240, gw, gh, t) })

  const x = MARGIN, w = W - 2 * MARGIN
  const langItems = Object.entries(d.distributions.langDist).map(([k, v]) => ({ label: langLabel(k), value: v })).sort((a, b) => b.value - a.value)
  const catItems = Object.entries(d.distributions.catDist).map(([k, v]) => ({ label: catLabel(k), value: v })).sort((a, b) => b.value - a.value)
  s += charts.hBarsChart({ x, y: 440, w: w * 0.48, h: 300, title: 'Kategorien (Bestand)', items: catItems })
  s += charts.hBarsChart({ x: x + w * 0.52, y: 440, w: w * 0.48, h: 300, title: 'Angebotene Sprachen', items: langItems, color: charts.SERIES[3] })

  // Systemstatus (laufen die geplanten Jobs?)
  let ry = 800
  s += sectionTitle(MARGIN, ry, 'Systemstatus')
  ry += 40
  const statusRow = (label, ok, detail) => {
    const color = ok === true ? POS : ok === false ? NEG : MUTED
    const mark = ok === true ? '●' : ok === false ? '▲' : '○'
    let r = txt(MARGIN, ry + 4, mark, { size: 22, fill: color })
    r += txt(MARGIN + 34, ry + 4, label, { size: 20, fill: INK })
    r += txt(W - MARGIN, ry + 4, detail, { size: 19, fill: MUTED, anchor: 'end' })
    r += `<line x1="${MARGIN}" y1="${ry + 22}" x2="${W - MARGIN}" y2="${ry + 22}" stroke="${LINE}" stroke-width="0.75"/>`
    ry += 46
    return r
  }
  for (const j of d.health.jobs) {
    let detail
    if (j.lastRunAt == null) detail = 'noch kein Lauf erfasst'
    else if (!j.ok) detail = `überfällig – zuletzt vor ${j.ageHours} h${j.status !== 'ok' ? ` (${j.status})` : ''}`
    else detail = `läuft – zuletzt vor ${j.ageHours} h`
    s += statusRow(j.label, j.ok, detail)
  }
  s += statusRow('Überfällige DSGVO-Löschungen', d.health.retentionOverdue === 0, d.health.retentionOverdue === 0 ? 'keine' : `${int(d.health.retentionOverdue)} überfällig`)

  ry += 34
  s += sectionTitle(MARGIN, ry, 'Betrieb')
  ry += 24
  s += table(MARGIN, ry, w, [
    { label: 'Automatische Löschungen in den nächsten 7 Tagen', value: int(d.retention.next7) },
    { label: 'Automatische Löschungen in den nächsten 30 Tagen', value: int(d.retention.next30) },
    { label: 'KI-generierte Bilder gesamt', value: int(d.totals.images) },
    { label: 'Hochgeladene Fotos gesamt', value: int(d.totals.photos) },
  ], { rowH: 44 })

  return s
}

async function svgToPng(sharp, svg) {
  return await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${svg}</svg>`)).png().toBuffer()
}

// Baut die Liste der Seiten-Bodies (ohne Footer). Seite 1 = KPIs + Changelog-Anfang;
// je nach Changelog-Länge folgen 0..n Fortsetzungsseiten; danach Aktivität/Kosten/
// Bestand. So gehen durch Seitenumbrüche keine Changelog-Einträge verloren.
function assemblePages(d) {
  const lines = changelogLines(d.changelog && d.changelog.length ? d.changelog : ['— keine Einträge —'])
  const top = page1Top(d)
  const first = renderChangelog(lines, top.startY)
  const pages = [top.svg + first.svg]
  let rest = first.rest
  while (rest.length) {
    const chunk = renderChangelog(rest, 240)
    pages.push(header('Gestern umgesetzt (Fortsetzung)', d.dateLabel) + chunk.svg)
    rest = chunk.rest
  }
  pages.push(page2(d), page3(d), page4(d))
  return pages
}

async function buildReportPdf(d) {
  const sharp = require('sharp')
  const { jsPDF } = require('jspdf')
  const pages = assemblePages(d)
  const total = pages.length
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' })
  const pw = doc.internal.pageSize.getWidth(), ph = doc.internal.pageSize.getHeight()
  for (let i = 0; i < pages.length; i++) {
    const svg = pages[i] + footer(i + 1, total)
    const png = await svgToPng(sharp, svg)
    const dataUrl = 'data:image/png;base64,' + png.toString('base64')
    if (i > 0) doc.addPage()
    doc.addImage(dataUrl, 'PNG', 0, 0, pw, ph, undefined, 'FAST')
  }
  const ab = doc.output('arraybuffer')
  const buffer = Buffer.from(ab)
  return { buffer, base64: buffer.toString('base64'), filename: `Lebensgeschichten-Report-${d.date}.pdf` }
}

// Nur für lokale Layout-Prüfung: liefert die ganzseitigen SVG-Strings.
function _debugPageSvgs(d) {
  const pages = assemblePages(d)
  return pages.map((body, i) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body + footer(i + 1, pages.length)}</svg>`)
}

module.exports = { buildReportPdf, _debugPageSvgs }
