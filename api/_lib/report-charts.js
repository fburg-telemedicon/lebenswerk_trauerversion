// api/_lib/report-charts.js
// Erzeugt Diagramme als SVG-Fragmente (<g>…</g>) innerhalb einer Box (x,y,w,h).
// Werden in report-pdf.js in eine ganzseitige SVG gesetzt und via sharp zu PNG
// gerastert. Warme, gedämpfte Palette passend zum Erinnerungs-/Trauerkontext.

const INK = '#2b2723', MUTED = '#9a9187', GRID = '#ece7de', AXIS = '#cfc7ba'
const SERIES = ['#8a7a5e', '#b08968', '#6f8f74', '#8a7ca8', '#c0876a', '#a0968a']

function escapeXml(s) {
  return String(s == null ? '' : s).replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]))
}
function niceMax(v) {
  if (!(v > 0)) return 1
  const p = Math.pow(10, Math.floor(Math.log10(v)))
  const n = v / p
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10
  return step * p
}
const F = 'DejaVu Serif, Georgia, serif'
function txt(x, y, s, { size = 20, fill = INK, anchor = 'start', bold = false } = {}) {
  return `<text x="${x}" y="${y}" font-family="${F}" font-size="${size}" fill="${fill}" text-anchor="${anchor}"${bold ? ' font-weight="bold"' : ''}>${escapeXml(s)}</text>`
}
function ddmm(iso) { const p = String(iso).split('-'); return p.length === 3 ? `${p[2]}.${p[1]}` : iso }

// Gemeinsames Achsengerüst; ruft draw(plot) mit den Plot-Maßen auf.
function frame({ x, y, w, h, title }, draw) {
  const titleSize = Math.max(16, Math.round(w * 0.03))
  const padL = Math.round(w * 0.10), padR = Math.round(w * 0.03)
  const padT = title ? Math.round(titleSize * 2.0) : 10
  const padB = Math.round(h * 0.14)
  const plot = { x: x + padL, y: y + padT, w: w - padL - padR, h: h - padT - padB }
  let s = ''
  if (title) s += txt(x, y + titleSize * 1.1, title, { size: titleSize, bold: true })
  s += draw(plot, { titleSize })
  return `<g>${s}</g>`
}

// Liniendiagramm mit sanfter Flächenfüllung.
function lineChart({ x, y, w, h, title, labels, values, color = SERIES[0], valueFmt = v => String(Math.round(v)) }) {
  return frame({ x, y, w, h, title }, (p) => {
    const n = values.length
    const max = niceMax(Math.max(0, ...values))
    const sx = i => p.x + (n <= 1 ? 0 : (i / (n - 1)) * p.w)
    const sy = v => p.y + p.h - (v / max) * p.h
    let s = ''
    // Gridlines + Y-Beschriftung (0, max/2, max)
    for (const f of [0, 0.5, 1]) {
      const yy = p.y + p.h - f * p.h
      s += `<line x1="${p.x}" y1="${yy}" x2="${p.x + p.w}" y2="${yy}" stroke="${GRID}" stroke-width="1"/>`
      s += txt(p.x - 8, yy + 6, valueFmt(max * f), { size: Math.round(p.w * 0.028), fill: MUTED, anchor: 'end' })
    }
    const pts = values.map((v, i) => `${sx(i)},${sy(v)}`).join(' ')
    s += `<polygon points="${p.x},${p.y + p.h} ${pts} ${p.x + p.w},${p.y + p.h}" fill="${color}" fill-opacity="0.12"/>`
    s += `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`
    // letzter Punkt betont
    if (n) s += `<circle cx="${sx(n - 1)}" cy="${sy(values[n - 1])}" r="4" fill="${color}"/>`
    // X-Ticks: ~6 Beschriftungen
    const ticks = 5
    for (let t = 0; t <= ticks; t++) {
      const i = Math.round((t / ticks) * (n - 1))
      s += txt(sx(i), p.y + p.h + Math.round(p.w * 0.045), ddmm(labels[i]), { size: Math.round(p.w * 0.026), fill: MUTED, anchor: 'middle' })
    }
    s += `<line x1="${p.x}" y1="${p.y + p.h}" x2="${p.x + p.w}" y2="${p.y + p.h}" stroke="${AXIS}" stroke-width="1.5"/>`
    return s
  })
}

// Säulendiagramm (auch für 24h-Verteilung). everyLabel = jedes n-te Label zeigen.
function barsChart({ x, y, w, h, title, labels, values, color = SERIES[0], valueFmt = v => String(Math.round(v)), everyLabel = 1 }) {
  return frame({ x, y, w, h, title }, (p) => {
    const n = values.length
    const max = niceMax(Math.max(0, ...values))
    const gap = p.w / n * 0.28
    const bw = p.w / n - gap
    let s = ''
    for (const f of [0, 0.5, 1]) {
      const yy = p.y + p.h - f * p.h
      s += `<line x1="${p.x}" y1="${yy}" x2="${p.x + p.w}" y2="${yy}" stroke="${GRID}" stroke-width="1"/>`
      s += txt(p.x - 8, yy + 6, valueFmt(max * f), { size: Math.round(p.w * 0.028), fill: MUTED, anchor: 'end' })
    }
    for (let i = 0; i < n; i++) {
      const bh = (values[i] / max) * p.h
      const bx = p.x + i * (p.w / n) + gap / 2
      const by = p.y + p.h - bh
      s += `<rect x="${bx}" y="${by}" width="${Math.max(1, bw)}" height="${Math.max(0, bh)}" rx="2" fill="${color}" fill-opacity="0.9"/>`
      if (i % everyLabel === 0) s += txt(bx + bw / 2, p.y + p.h + Math.round(p.w * 0.045), labels[i], { size: Math.round(p.w * 0.026), fill: MUTED, anchor: 'middle' })
    }
    s += `<line x1="${p.x}" y1="${p.y + p.h}" x2="${p.x + p.w}" y2="${p.y + p.h}" stroke="${AXIS}" stroke-width="1.5"/>`
    return s
  })
}

// Horizontale Balken (für Rangordnungen, z. B. Memorials je Kategorie).
function hBarsChart({ x, y, w, h, title, items, color = SERIES[1], valueFmt = v => String(Math.round(v)) }) {
  return frame({ x, y, w, h, title }, (p) => {
    const rows = items.slice(0, 8)
    const max = niceMax(Math.max(0, ...rows.map(r => r.value)))
    const rowH = p.h / Math.max(1, rows.length)
    const labelW = p.w * 0.34
    const barX = p.x + labelW
    const barW = p.w - labelW
    let s = ''
    rows.forEach((r, i) => {
      const cy = p.y + i * rowH + rowH / 2
      s += txt(p.x, cy + 6, r.label, { size: Math.round(p.w * 0.03), fill: INK })
      const bw = (r.value / max) * barW
      s += `<rect x="${barX}" y="${cy - rowH * 0.28}" width="${Math.max(1, bw)}" height="${rowH * 0.56}" rx="3" fill="${color}" fill-opacity="0.9"/>`
      s += txt(barX + bw + 8, cy + 6, valueFmt(r.value), { size: Math.round(p.w * 0.03), fill: MUTED })
    })
    return s
  })
}

// Donut mit Legende rechts.
function donutChart({ x, y, w, h, title, segments }) {
  return frame({ x, y, w, h, title }, (p) => {
    const segs = (segments || []).map((s, i) => ({ ...s, color: s.color || SERIES[i % SERIES.length] })).filter(s => s.value > 0)
    const total = segs.reduce((a, b) => a + b.value, 0)
    const cx = p.x + p.h * 0.5, cy = p.y + p.h * 0.5
    const R = p.h * 0.46, r = R * 0.6
    let s = ''
    if (total <= 0) {
      s += `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${GRID}" stroke-width="${R - r}"/>`
      s += txt(cx, cy + 6, '–', { size: Math.round(p.h * 0.12), fill: MUTED, anchor: 'middle' })
      return s
    }
    let a0 = -Math.PI / 2
    const polar = (ang, rad) => [cx + rad * Math.cos(ang), cy + rad * Math.sin(ang)]
    for (const seg of segs) {
      const a1 = a0 + (seg.value / total) * Math.PI * 2
      const large = (a1 - a0) > Math.PI ? 1 : 0
      const [x0, y0] = polar(a0, R), [x1, y1] = polar(a1, R)
      const [xi1, yi1] = polar(a1, r), [xi0, yi0] = polar(a0, r)
      s += `<path d="M ${x0} ${y0} A ${R} ${R} 0 ${large} 1 ${x1} ${y1} L ${xi1} ${yi1} A ${r} ${r} 0 ${large} 0 ${xi0} ${yi0} Z" fill="${seg.color}"/>`
      a0 = a1
    }
    // Legende
    const lx = p.x + p.h + Math.round(p.w * 0.04)
    const ls = Math.round(p.w * 0.03)
    segs.forEach((seg, i) => {
      const ly = p.y + i * (ls * 1.9) + ls
      s += `<rect x="${lx}" y="${ly - ls * 0.8}" width="${ls}" height="${ls}" rx="2" fill="${seg.color}"/>`
      s += txt(lx + ls * 1.5, ly, `${seg.label}  ${(seg.value / total * 100).toFixed(0)} %`, { size: ls, fill: INK })
    })
    return s
  })
}

module.exports = { lineChart, barsChart, hBarsChart, donutChart, escapeXml, SERIES, INK, MUTED, GRID, AXIS }
