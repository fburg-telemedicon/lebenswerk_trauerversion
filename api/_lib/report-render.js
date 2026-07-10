// api/_lib/report-render.js
// Baut Betreff + HTML- und Text-Body des Tagesreports aus den Kennzahlen.
// Kurz und scannbar; Details stehen im PDF-Anhang.

const { catLabel, eur, int } = require('./report-labels')

function esc(s) { return String(s == null ? '' : s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])) }
function deltaHtml(d, money) {
  if (d == null || d === 0) return ''
  const up = d > 0
  const v = money ? eur(Math.abs(d)) : int(Math.abs(d))
  return ` <span style="color:${up ? '#5f7d5a' : '#a85a4a'};font-size:13px">${up ? '▲' : '▼'} ${v}</span>`
}
function deltaText(d, money) {
  if (d == null || d === 0) return ''
  const v = money ? eur(Math.abs(d)) : int(Math.abs(d))
  return ` (${d > 0 ? '+' : '−'}${v})`
}

function subject(d) {
  return `Lebensgeschichten – Tagesreport ${d.dateLabel}`
}

function htmlBody(d) {
  const y = d.yesterday
  const catStr = Object.entries(y.newMemorialsByCat).map(([k, v]) => `${catLabel(k)} ${v}`).join(' · ')
  const kpi = [
    ['📖 Neue Gedenkbücher', int(y.newMemorials) + deltaHtml(d.yesterday.delta.memorials), catStr],
    ['✍️ Neue Beiträge', int(y.newContributions) + deltaHtml(d.yesterday.delta.contributions), ''],
    ['🏭 Neu erzeugte Bücher / Nachrufe', d.genTimestamps ? `${int(y.newBooks)} / ${int(y.newEulogies)}` : '–', ''],
    ['🖼️ Neue Fotos', int(y.newPhotos), ''],
    ['👤 Neue Manager', int(y.newManagers), ''],
    ['💶 Kosten gestern', eur(y.costEur) + deltaHtml(d.yesterday.delta.costEur, true), ''],
  ]
  const rows = kpi.map(([label, value, sub]) => `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #eee;color:#2b2723">${label}</td>
      <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;color:#2b2723;font-weight:bold">${value}${sub ? `<div style="font-weight:normal;color:#9a9187;font-size:12px">${esc(sub)}</div>` : ''}</td>
    </tr>`).join('')
  const changelog = (d.changelog.length ? d.changelog : ['— keine Einträge —'])
    .map(it => `<li style="margin:4px 0;color:#2b2723">${esc(it)}</li>`).join('')

  return `<div style="font-family:Georgia,'Times New Roman',serif;max-width:640px;margin:0 auto;color:#2b2723">
    <div style="border-top:6px solid #8a7a5e;padding-top:16px">
      <div style="color:#8a7a5e;font-weight:bold;font-size:14px">LEBENSGESCHICHTEN</div>
      <h1 style="font-size:22px;margin:6px 0 2px">Tagesreport</h1>
      <div style="color:#9a9187;font-size:14px">${esc(d.dateLabel)}</div>
    </div>
    <h2 style="font-size:16px;margin:22px 0 6px">Kurzüberblick gestern</h2>
    <table style="width:100%;border-collapse:collapse;font-size:15px">${rows}</table>
    <p style="font-size:14px;color:#6b645c;margin:16px 0">
      <b>Monat bisher:</b> ${eur(d.mtd.costEur)} Kosten &nbsp;·&nbsp;
      <b>Bestand:</b> ${int(d.totals.memorials)} Gedenkbücher, ${int(d.totals.contributions)} Beiträge, ${int(d.totals.managers)} Manager
    </p>
    <h2 style="font-size:16px;margin:22px 0 6px">🛠️ Gestern umgesetzt</h2>
    <ul style="font-size:14px;padding-left:20px;margin:0">${changelog}</ul>
    <p style="font-size:13px;color:#9a9187;margin:22px 0 8px;border-top:1px solid #eee;padding-top:12px">
      Ausführlicher Bericht mit Diagrammen im PDF-Anhang.<br>
      Nur aggregierte Kennzahlen · keine personenbezogenen Daten (DSGVO).
    </p>
  </div>`
}

function textBody(d) {
  const y = d.yesterday
  const L = []
  L.push(`LEBENSGESCHICHTEN – Tagesreport`)
  L.push(d.dateLabel)
  L.push('')
  L.push('Kurzüberblick gestern:')
  L.push(`  Neue Gedenkbücher: ${int(y.newMemorials)}${deltaText(y.delta.memorials)}`)
  L.push(`  Neue Beiträge: ${int(y.newContributions)}${deltaText(y.delta.contributions)}`)
  L.push(`  Neu erzeugte Bücher/Nachrufe: ${d.genTimestamps ? `${int(y.newBooks)} / ${int(y.newEulogies)}` : '–'}`)
  L.push(`  Neue Fotos: ${int(y.newPhotos)}`)
  L.push(`  Neue Manager: ${int(y.newManagers)}`)
  L.push(`  Kosten gestern: ${eur(y.costEur)}${deltaText(y.delta.costEur, true)}`)
  L.push('')
  L.push(`Monat bisher: ${eur(d.mtd.costEur)} · Bestand: ${int(d.totals.memorials)} Gedenkbücher, ${int(d.totals.contributions)} Beiträge, ${int(d.totals.managers)} Manager`)
  L.push('')
  L.push('Gestern umgesetzt:')
  for (const it of (d.changelog.length ? d.changelog : ['— keine Einträge —'])) L.push(`  - ${it}`)
  L.push('')
  L.push('Ausführlicher Bericht mit Diagrammen im PDF-Anhang.')
  L.push('Nur aggregierte Kennzahlen, keine personenbezogenen Daten (DSGVO).')
  return L.join('\n')
}

module.exports = { subject, htmlBody, textBody }
