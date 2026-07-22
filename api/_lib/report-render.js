// api/_lib/report-render.js
// Baut Betreff + HTML- und Text-Body des Tagesreports aus den Kennzahlen.
// Kurz und scannbar; Details stehen im PDF-Anhang.

const { catLabel, eur, int } = require('./report-labels')

// Plattform-Kürzel der Telemetrie in Klartext (siehe api/metric.js).
const PLAT_LABEL = {
  android: 'Android (Browser)', android_pwa: 'Android (installierte App)',
  ios: 'iPhone/iPad (Browser)', ios_pwa: 'iPhone/iPad (installierte App)',
  desktop: 'Computer', other: 'sonstige',
}
// „Mikrofon blockiert" als Anteil an den begonnenen Interviews. Erst der Anteil
// ist deutbar — und die Aufschlüsselung zeigt, ob es an der installierten App liegt.
function micLines(d) {
  const m = d.micStats
  if (!m || (!m.last30.starts && !m.last30.blocked)) return null
  const y = m.yesterday, l = m.last30
  const pct = v => (v == null ? '–' : `${String(v).replace('.', ',')} %`)
  const worst = Object.entries(m.byPlatform || {})
    .filter(([, v]) => v.starts >= 5 && v.sharePct != null)
    .sort((a, b) => b[1].sharePct - a[1].sharePct)[0]
  return {
    yday: `${int(y.blocked)} von ${int(y.starts)} begonnenen Interviews (${pct(y.sharePct)})`,
    d30: `${int(l.blocked)} von ${int(l.starts)} (${pct(l.sharePct)})`,
    missing: l.missing,
    worst: worst ? `${PLAT_LABEL[worst[0]] || worst[0]}: ${pct(worst[1].sharePct)}` : '',
  }
}

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

function subject(d, note) {
  const base = `Lebensgeschichten – Tagesreport ${d.dateLabel}`
  return note ? `[Korrektur] ${base}` : base
}

function htmlBody(d, note) {
  const y = d.yesterday
  const mic = micLines(d)
  const catStr = Object.entries(y.newMemorialsByCat).map(([k, v]) => `${catLabel(k)} ${v}`).join(' · ')
  const kpi = [
    ['📖 Neue Gedenkbücher', int(y.newMemorials) + deltaHtml(d.yesterday.delta.memorials), catStr],
    ['✍️ Neue Beiträge', int(y.newContributions) + deltaHtml(d.yesterday.delta.contributions), ''],
    ['🏭 Neu erzeugte Bücher / Nachrufe', d.genTimestamps ? `${int(y.newBooks)} / ${int(y.newEulogies)}` : '–', ''],
    ['📕 Fertig abgeschlossen (drucken!)', int(y.finalizedBooks), d.totals.finalizedBooks ? `insgesamt zu drucken: ${int(d.totals.finalizedBooks)}` : ''],
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

  const mark = ok => ok === true ? '<span style="color:#5f7d5a">✓</span>' : ok === false ? '<span style="color:#a85a4a">⚠</span>' : '<span style="color:#9a9187">•</span>'
  const statusItems = (d.health?.jobs || []).map(j => {
    const detail = j.lastRunAt == null ? 'noch kein Lauf' : (!j.ok ? `überfällig (vor ${j.ageHours} h)` : `zuletzt vor ${j.ageHours} h`)
    return `<li style="margin:4px 0">${mark(j.ok)} ${esc(j.label)} – <span style="color:#6b645c">${detail}</span></li>`
  })
  statusItems.push(`<li style="margin:4px 0">${mark((d.health?.retentionOverdue || 0) === 0)} Überfällige DSGVO-Löschungen – <span style="color:#6b645c">${(d.health?.retentionOverdue || 0) === 0 ? 'keine' : d.health.retentionOverdue + ' überfällig'}</span></li>`)

  return `<div style="font-family:Georgia,'Times New Roman',serif;max-width:640px;margin:0 auto;color:#2b2723">
    <div style="border-top:6px solid #8a7a5e;padding-top:16px">
      <div style="color:#8a7a5e;font-weight:bold;font-size:14px">LEBENSGESCHICHTEN</div>
      <h1 style="font-size:22px;margin:6px 0 2px">Tagesreport</h1>
      <div style="color:#9a9187;font-size:14px">${esc(d.dateLabel)}</div>
    </div>
    ${note ? `<div style="background:#f7f1e4;border:1px solid #d8c9a6;border-radius:6px;padding:12px 14px;margin:16px 0;font-size:14px;color:#6b5a3a"><b>Korrektur:</b> ${esc(note)}</div>` : ''}
    <h2 style="font-size:16px;margin:22px 0 6px">Kurzüberblick gestern</h2>
    <table style="width:100%;border-collapse:collapse;font-size:15px">${rows}</table>
    <p style="font-size:14px;color:#6b645c;margin:16px 0">
      <b>Monat bisher:</b> ${eur(d.mtd.costEur)} Kosten &nbsp;·&nbsp;
      <b>Bestand:</b> ${int(d.totals.memorials)} Gedenkbücher, ${int(d.totals.contributions)} Beiträge, ${int(d.totals.managers)} Manager
    </p>
    <h2 style="font-size:16px;margin:22px 0 6px">⚙️ Systemstatus</h2>
    <ul style="font-size:14px;padding-left:20px;margin:0;list-style:none">${statusItems.join('')}</ul>
    ${mic ? `<h2 style="font-size:16px;margin:22px 0 6px">🎙️ Mikrofon blockiert</h2>
    <ul style="font-size:14px;padding-left:20px;margin:0;color:#2b2723">
      <li style="margin:4px 0">Gestern: <b>${esc(mic.yday)}</b></li>
      <li style="margin:4px 0">Letzte 30 Tage: ${esc(mic.d30)}${mic.missing ? ` · zusätzlich ${int(mic.missing)}× kein Mikrofon gefunden` : ''}</li>
      ${mic.worst ? `<li style="margin:4px 0">Höchster Anteil: ${esc(mic.worst)}</li>` : ''}
    </ul>` : ''}
    <h2 style="font-size:16px;margin:22px 0 6px">🛠️ Gestern umgesetzt</h2>
    <ul style="font-size:14px;padding-left:20px;margin:0">${changelog}</ul>
    <p style="font-size:13px;color:#9a9187;margin:22px 0 8px;border-top:1px solid #eee;padding-top:12px">
      Ausführlicher Bericht mit Diagrammen im PDF-Anhang.<br>
      Nur aggregierte Kennzahlen · keine personenbezogenen Daten (DSGVO).
    </p>
  </div>`
}

function textBody(d, note) {
  const y = d.yesterday
  const L = []
  L.push(`LEBENSGESCHICHTEN – Tagesreport`)
  L.push(d.dateLabel)
  L.push('')
  if (note) { L.push(`KORREKTUR: ${note}`); L.push('') }
  L.push('Kurzüberblick gestern:')
  L.push(`  Neue Gedenkbücher: ${int(y.newMemorials)}${deltaText(y.delta.memorials)}`)
  L.push(`  Neue Beiträge: ${int(y.newContributions)}${deltaText(y.delta.contributions)}`)
  L.push(`  Neu erzeugte Bücher/Nachrufe: ${d.genTimestamps ? `${int(y.newBooks)} / ${int(y.newEulogies)}` : '–'}`)
  L.push(`  Fertig abgeschlossen (drucken!): ${int(y.finalizedBooks)}${d.totals.finalizedBooks ? ` (insgesamt zu drucken: ${int(d.totals.finalizedBooks)})` : ''}`)
  L.push(`  Neue Fotos: ${int(y.newPhotos)}`)
  L.push(`  Neue Manager: ${int(y.newManagers)}`)
  L.push(`  Kosten gestern: ${eur(y.costEur)}${deltaText(y.delta.costEur, true)}`)
  L.push('')
  L.push(`Monat bisher: ${eur(d.mtd.costEur)} · Bestand: ${int(d.totals.memorials)} Gedenkbücher, ${int(d.totals.contributions)} Beiträge, ${int(d.totals.managers)} Manager`)
  L.push('')
  L.push('Systemstatus:')
  for (const j of (d.health?.jobs || [])) {
    const detail = j.lastRunAt == null ? 'noch kein Lauf' : (!j.ok ? `ÜBERFÄLLIG (vor ${j.ageHours} h)` : `ok, zuletzt vor ${j.ageHours} h`)
    L.push(`  ${j.ok === false ? '[!]' : '[ok]'} ${j.label}: ${detail}`)
  }
  {
    const ov = d.health?.retentionOverdue || 0
    L.push(`  ${ov === 0 ? '[ok]' : '[!]'} Überfällige DSGVO-Löschungen: ${ov === 0 ? 'keine' : ov}`)
  }
  {
    const mic = micLines(d)
    if (mic) {
      L.push('')
      L.push('Mikrofon blockiert:')
      L.push(`  Gestern: ${mic.yday}`)
      L.push(`  Letzte 30 Tage: ${mic.d30}${mic.missing ? ` (zusätzlich ${int(mic.missing)}x kein Mikrofon gefunden)` : ''}`)
      if (mic.worst) L.push(`  Höchster Anteil: ${mic.worst}`)
    }
  }
  L.push('')
  L.push('Gestern umgesetzt:')
  for (const it of (d.changelog.length ? d.changelog : ['— keine Einträge —'])) L.push(`  - ${it}`)
  L.push('')
  L.push('Ausführlicher Bericht mit Diagrammen im PDF-Anhang.')
  L.push('Nur aggregierte Kennzahlen, keine personenbezogenen Daten (DSGVO).')
  return L.join('\n')
}

module.exports = { subject, htmlBody, textBody }
