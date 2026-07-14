// src/lifeworkExtras.js
// Die beiden grafischen Nebenprodukte des Lebenswerks:
//
//   1. STAMMBAUM   – aus der Biographie extrahierte Familie, als Baum gezeichnet
//   2. LEBENSPOSTER – Lebensstationen und Themen auf einem DIN-A2-Poster (quer)
//
// Beide entstehen in zwei Schritten:
//   a) Die KI liest das Interview und gibt STRUKTURIERTES JSON zurück (Prompts
//      hier unten). Das JSON wird am Buch gespeichert (family_tree / life_poster)
//      und ist damit reproduzierbar und nachbearbeitbar.
//   b) Aus dem JSON zeichnet jsPDF das fertige Dokument (Renderer hier unten) —
//      kein KI-Layout, damit das Ergebnis verlässlich und druckbar ist.
//
// Maße in mm, Ursprung oben links (wie coverExport.js).

import { jsPDF } from 'jspdf'

// ════════════════════════════════════════════════════════════════
// 1) STAMMBAUM
// ════════════════════════════════════════════════════════════════

export function treeSystem(memorial, contributions) {
  const lines = contributions.flatMap(c => (c.messages || []).map(m => m.role === 'assistant' ? `F: ${m.content}` : `A: ${m.content}`))
  return `Du bist Genealoge. Du liest das folgende autobiographische Interview mit ${memorial.name} und extrahierst daraus die FAMILIE als Datenstruktur für einen Stammbaum.

Gib REINES, GÜLTIGES JSON aus (kein Markdown, keine Erklärungen):
{
  "root": "p1",
  "people": [
    { "id": "p1", "name": "Vollständiger Name", "role": "Hauptperson", "born": "1943", "died": "", "note": "max. 6 Wörter, z. B. Beruf oder Wesenszug" }
  ],
  "couples": [ { "a": "p1", "b": "p2" } ],
  "parents": [ { "parent": "p3", "child": "p1" } ]
}

Regeln:
- "root" ist IMMER die Hauptperson (${memorial.name}).
- Nimm nur Personen auf, die das Interview WIRKLICH nennt: Eltern, Großeltern, Geschwister, Partner/Partnerin, Kinder, Enkel. Keine Freunde, Kollegen, Bekannte.
- Erfinde NICHTS. Unbekannter Vorname/Nachname: nimm, was dasteht („Mutter", „Opa Karl"). Unbekanntes Jahr: leerer String.
- "role": kurz und eindeutig, z. B. "Hauptperson", "Mutter", "Vater", "Ehefrau", "Ehemann", "Tochter", "Sohn", "Schwester", "Bruder", "Großmutter", "Enkel".
- "couples": Paare (Ehe/Partnerschaft), je Paar EIN Eintrag.
- "parents": jede Eltern-Kind-Beziehung EINZELN (ein Elternteil + ein Kind pro Eintrag).
- "note": höchstens 6 Wörter, nur wenn das Interview etwas hergibt; sonst leerer String.
- Höchstens 24 Personen. Gibt das Interview keine Familie her, gib eine leere "people"-Liste zurück.
- Namen und Rollen auf Deutsch.
- Gültiges JSON, keine trailing commas.

Interview:\n\n${lines.join('\n')}`
}

// Personen nach Generationen anordnen: Die Hauptperson ist Generation 0, ihre
// Eltern −1, deren Eltern −2, Kinder +1 usw. Personen ohne Eltern-Kind-Bezug zur
// Hauptperson (z. B. der Partner) erben die Generation ihres Paar-Partners.
function layoutTree(data) {
  const people = Array.isArray(data?.people) ? data.people : []
  if (people.length === 0) return null
  const byId = new Map(people.map(p => [p.id, p]))
  const couples = (Array.isArray(data?.couples) ? data.couples : []).filter(c => byId.has(c.a) && byId.has(c.b))
  const parents = (Array.isArray(data?.parents) ? data.parents : []).filter(p => byId.has(p.parent) && byId.has(p.child))
  const root = byId.has(data?.root) ? data.root : people[0].id

  const gen = new Map([[root, 0]])
  const parentsOf = id => parents.filter(p => p.child === id).map(p => p.parent)
  const childrenOf = id => parents.filter(p => p.parent === id).map(p => p.child)
  const partnersOf = id => couples.filter(c => c.a === id || c.b === id).map(c => (c.a === id ? c.b : c.a))

  // Breitensuche über alle drei Kantenarten, bis sich nichts mehr ändert.
  for (let pass = 0; pass < people.length + 2; pass++) {
    let changed = false
    for (const p of people) {
      if (!gen.has(p.id)) continue
      const g = gen.get(p.id)
      const put = (id, v) => { if (!gen.has(id)) { gen.set(id, v); changed = true } }
      parentsOf(p.id).forEach(x => put(x, g - 1))
      childrenOf(p.id).forEach(x => put(x, g + 1))
      partnersOf(p.id).forEach(x => put(x, g))
    }
    if (!changed) break
  }
  // Nicht verbundene Personen hängen wir auf die Generation der Hauptperson.
  for (const p of people) if (!gen.has(p.id)) gen.set(p.id, 0)

  // Paare nebeneinander stellen: Reihenfolge innerhalb einer Generation so, dass
  // Partner direkt beieinander stehen.
  const rows = new Map()
  for (const p of people) {
    const g = gen.get(p.id)
    if (!rows.has(g)) rows.set(g, [])
    rows.get(g).push(p)
  }
  for (const [g, list] of rows) {
    const seen = new Set(), ordered = []
    for (const p of list) {
      if (seen.has(p.id)) continue
      ordered.push(p); seen.add(p.id)
      for (const partnerId of partnersOf(p.id)) {
        const partner = byId.get(partnerId)
        if (partner && gen.get(partnerId) === g && !seen.has(partnerId)) { ordered.push(partner); seen.add(partnerId) }
      }
    }
    rows.set(g, ordered)
  }
  return { rows: [...rows.entries()].sort((a, b) => a[0] - b[0]), couples, parents, byId, root }
}

const TREE = {
  W: 420, H: 297,            // DIN A3 quer
  margin: 18,
  boxW: 52, boxH: 22, gapX: 10, gapY: 34,
  ink: [28, 25, 23], line: [168, 162, 158], soft: [120, 113, 108], accent: [21, 128, 61],
}

// Zeichnet den Baum. `draw` kapselt die wenigen Primitive, die Vorschau (Canvas)
// und PDF gemeinsam brauchen — so ist die Vorschau garantiert das PDF.
function paintTree(d, layout, memorial) {
  const { W, H, margin, boxW, boxH, gapX, gapY } = TREE
  const rows = layout.rows
  const usableH = H - 2 * margin - 16
  const rowH = Math.min(boxH + gapY, usableH / Math.max(1, rows.length))
  const pos = new Map()

  d.text(`Stammbaum ${memorial.name}`, W / 2, margin + 2, { size: 15, bold: true, align: 'center', color: TREE.ink })

  rows.forEach(([g, list], ri) => {
    const y = margin + 12 + ri * rowH
    const totalW = list.length * boxW + (list.length - 1) * gapX
    const x0 = (W - totalW) / 2
    list.forEach((p, i) => {
      const x = x0 + i * (boxW + gapX)
      pos.set(p.id, { x, y, cx: x + boxW / 2, cy: y + boxH / 2 })
    })
  })

  // Verbindungen zuerst (liegen hinter den Kästen).
  for (const c of layout.couples) {
    const a = pos.get(c.a), b = pos.get(c.b)
    if (!a || !b) continue
    d.line(Math.min(a.x + boxW, b.x + boxW), a.cy, Math.max(a.x, b.x), b.cy, TREE.line)
  }
  for (const rel of layout.parents) {
    const p = pos.get(rel.parent), c = pos.get(rel.child)
    if (!p || !c) continue
    const midY = (p.y + boxH + c.y) / 2
    d.line(p.cx, p.y + boxH, p.cx, midY, TREE.line)
    d.line(p.cx, midY, c.cx, midY, TREE.line)
    d.line(c.cx, midY, c.cx, c.y, TREE.line)
  }

  // Kästen
  for (const [, list] of rows) {
    for (const p of list) {
      const at = pos.get(p.id)
      const isRoot = p.id === layout.root
      d.box(at.x, at.y, boxW, boxH, isRoot ? TREE.accent : TREE.line, isRoot ? 0.8 : 0.3)
      const years = [p.born, p.died].filter(Boolean).join(' – ')
      d.text(p.name || '—', at.cx, at.y + 8, { size: 8.5, bold: true, align: 'center', color: TREE.ink, maxW: boxW - 4 })
      d.text(p.role || '', at.cx, at.y + 13, { size: 6.5, align: 'center', color: TREE.soft, maxW: boxW - 4 })
      if (years) d.text(years, at.cx, at.y + 17.5, { size: 6.5, align: 'center', color: TREE.soft, maxW: boxW - 4 })
    }
  }
}

// jsPDF-Adapter für paintTree/paintPoster.
function pdfDraw(doc) {
  return {
    // Halbtransparente Flächen brauchen die GState-Erweiterung von jsPDF.
    alpha: typeof doc.GState === 'function',
    line(x1, y1, x2, y2, color) {
      doc.setDrawColor(color[0], color[1], color[2]); doc.setLineWidth(0.3)
      doc.line(x1, y1, x2, y2)
    },
    box(x, y, w, h, color, lw) {
      doc.setDrawColor(color[0], color[1], color[2]); doc.setLineWidth(lw)
      doc.setFillColor(255, 255, 255)
      doc.roundedRect(x, y, w, h, 2, 2, 'FD')
    },
    // Transparenz braucht die GState-Erweiterung von jsPDF. Fehlt sie, wird der
    // Streifen deckend gezeichnet — der Verlauf über dem Motiv wirkt dann härter,
    // aber das Poster entsteht trotzdem.
    rect(x, y, w, h, color, alpha) {
      const gs = alpha != null && typeof doc.GState === 'function'
      if (gs) doc.setGState(new doc.GState({ opacity: alpha }))
      doc.setFillColor(color[0], color[1], color[2])
      doc.rect(x, y, w, h, 'F')
      if (gs) doc.setGState(new doc.GState({ opacity: 1 }))
    },
    circle(cx, cy, r, color) {
      doc.setFillColor(color[0], color[1], color[2])
      doc.circle(cx, cy, r, 'F')
    },
    image(data, x, y, w, h) { doc.addImage(data, 'PNG', x, y, w, h, undefined, 'FAST') },
    text(str, x, y, o = {}) {
      const c = o.color || [0, 0, 0]
      doc.setTextColor(c[0], c[1], c[2])
      doc.setFont(o.font || 'helvetica', o.bold ? 'bold' : (o.italic ? 'italic' : 'normal'))
      doc.setFontSize(o.size || 10)
      const lines = o.maxW ? doc.splitTextToSize(String(str), o.maxW) : [String(str)]
      const lh = (o.size || 10) * 0.3528 * 1.25
      lines.slice(0, o.maxLines || 99).forEach((ln, i) => {
        doc.text(ln, x, y + i * lh, { align: o.align || 'left' })
      })
      return lines.length * lh
    },
  }
}

export function downloadTreePdf(filename, data, memorial) {
  const layout = layoutTree(data)
  if (!layout) throw new Error('Der Stammbaum enthält keine Personen — das Interview gibt (noch) keine Familie her.')
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [TREE.W, TREE.H] })
  paintTree(pdfDraw(doc), layout, memorial)
  doc.save(filename)
}

// ════════════════════════════════════════════════════════════════
// 2) LEBENSPOSTER (DIN A2 quer, 594 × 420 mm)
// ════════════════════════════════════════════════════════════════

export function posterSystem(memorial, contributions) {
  const lines = contributions.flatMap(c => (c.messages || []).map(m => m.role === 'assistant' ? `F: ${m.content}` : `A: ${m.content}`))
  return `Du bist Kurator und Informationsdesigner. Aus dem folgenden autobiographischen Interview mit ${memorial.name} destillierst du ein LEBENSPOSTER (DIN A2 quer): eine Landkarte dieses Lebens — Stationen, Themen, Orte, Werte, Sätze, die bleiben.

Gib REINES, GÜLTIGES JSON aus (kein Markdown, keine Erklärungen):
{
  "title": "Titel des Posters, kurz und stark (max. 5 Wörter)",
  "subtitle": "Untertitel, max. 12 Wörter",
  "person": { "name": "${memorial.name}", "years": "z. B. 1943 – heute, leer wenn unbekannt" },
  "milestones": [
    { "year": "1943", "title": "max. 4 Wörter", "text": "EIN Satz, konkret, max. 16 Wörter" }
  ],
  "themes": [
    { "title": "max. 3 Wörter", "text": "1–2 Sätze, was dieses Thema im Leben bedeutet, max. 28 Wörter" }
  ],
  "values": ["max. 2 Wörter je Eintrag"],
  "places": ["Ort"],
  "quotes": ["wörtlicher oder eng am Wortlaut liegender Satz der Person, max. 20 Wörter"],
  "background_prompt": "English, 15–30 words: one atmospheric scene that captures this life as a whole (landscape, no text, no people portraits); describe ONLY motif, scene and era — no medium, no technique, no art style"
}

Regeln:
- "milestones": 10–16 Stück, CHRONOLOGISCH aufsteigend, mit Jahreszahl. Nur Stationen, die das Interview wirklich hergibt (Geburt, Kindheit, Schule, Ausbildung, erster Job, Liebe, Hochzeit, Kinder, Umzüge, Wendepunkte, Verluste, Erfolge, Ruhestand …).
- "themes": 4–6 Stück — die roten Fäden dieses Lebens (z. B. Handwerk, Musik, Glaube, Fürsorge, Aufbruch).
- "values": 6–10 Stück. "places": 3–8 Stück. "quotes": 2–3 Stück.
- Erfinde NICHTS: keine Jahre, keine Orte, keine Sätze, die nicht im Interview stehen. Lieber weniger Einträge.
- Kurz, konkret, bildhaft — dies ist ein Poster, kein Fließtext.
- Alles auf Deutsch (außer "background_prompt").
- Gültiges JSON, keine trailing commas.

Interview:\n\n${lines.join('\n')}`
}

const P = {
  W: 594, H: 420,             // DIN A2 quer
  margin: 24,
  ink: [24, 22, 20], white: [255, 255, 255], soft: [120, 113, 108],
  accent: [21, 128, 61], sand: [250, 250, 249], rule: [214, 211, 209],
}

// Bild formatfüllend rechnen (nie verzerren, Überstand wird beschnitten).
function coverFit(iw, ih, bw, bh) {
  const s = Math.max(bw / iw, bh / ih)
  const w = iw * s, h = ih * s
  return { x: (bw - w) / 2, y: (bh - h) / 2, w, h }
}

// Das Poster: oben ein vollflächiges Motiv mit Titel darauf, darunter die
// Zeitleiste (Stationen abwechselnd über/unter der Achse), unten die Themen,
// Werte, Orte und Zitate. Alles aus dem JSON — nichts wird erfunden.
function paintPoster(d, data, images) {
  const { W, H, margin } = P
  const M = Array.isArray(data.milestones) ? data.milestones.slice(0, 16) : []
  const themes = Array.isArray(data.themes) ? data.themes.slice(0, 6) : []
  const values = Array.isArray(data.values) ? data.values.slice(0, 10) : []
  const places = Array.isArray(data.places) ? data.places.slice(0, 8) : []
  const quotes = Array.isArray(data.quotes) ? data.quotes.slice(0, 3) : []

  // Grundfläche
  d.rect(0, 0, W, H, P.sand)

  // ── Kopfzone mit Motiv (Höhe 150 mm) ──
  const headH = 150
  if (images.bg) {
    const fit = coverFit(images.bg.w, images.bg.h, W, headH)
    d.image(images.bg.data, fit.x, fit.y, fit.w, fit.h)
    if (d.alpha) {
      // Verlauf simulieren: mehrere halbtransparente Streifen, unten am dunkelsten,
      // damit die Typografie auf jedem Motiv sicher lesbar bleibt.
      for (let i = 0; i < 14; i++) {
        const t = i / 13
        d.rect(0, headH - (i + 1) * (headH / 14), W, headH / 14 + 0.4, [10, 10, 10], 0.06 + t * 0.5)
      }
    } else {
      // Ohne Transparenz nur ein deckendes Band unter der Typografie — sonst würde
      // ein „Verlauf" aus deckenden Streifen das ganze Motiv zudecken.
      d.rect(0, headH - 58, W, 58, [16, 15, 14])
    }
  } else {
    d.rect(0, 0, W, headH, P.ink)
  }

  const title = String(data.title || 'Ein Leben')
  d.text(title.toUpperCase(), margin, headH - 42, { size: 54, bold: true, color: P.white, maxW: W - 2 * margin, maxLines: 1 })
  if (data.subtitle) d.text(String(data.subtitle), margin, headH - 26, { size: 16, italic: true, color: [235, 235, 235], maxW: W - 2 * margin, maxLines: 1 })
  const who = [data.person?.name, data.person?.years].filter(Boolean).join('  ·  ')
  if (who) d.text(who, margin, headH - 12, { size: 12, color: [225, 225, 225], maxW: W - 2 * margin, maxLines: 1 })

  // ── Zeitleiste ──
  const axisY = headH + 78
  d.line(margin, axisY, W - margin, axisY, P.accent)
  const usable = W - 2 * margin
  const step = M.length > 1 ? usable / (M.length - 1) : 0
  M.forEach((m, i) => {
    const x = M.length > 1 ? margin + i * step : W / 2
    const up = i % 2 === 0                       // abwechselnd über/unter der Achse
    d.circle(x, axisY, 2.2, P.accent)
    d.line(x, axisY, x, up ? axisY - 12 : axisY + 12, P.rule)
    // Der nächste Nachbar sitzt auf der ANDEREN Achsenseite; kollidieren kann ein
    // Textblock also erst mit dem übernächsten — er darf entsprechend breit sein.
    const boxW = step ? Math.min(72, Math.max(30, step * 2 - 8)) : 72
    const tx = Math.max(margin, Math.min(W - margin - boxW, x - boxW / 2))
    if (up) {
      d.text(String(m.year || ''), tx, axisY - 32, { size: 13, bold: true, color: P.accent, maxW: boxW, maxLines: 1 })
      d.text(String(m.title || ''), tx, axisY - 25, { size: 9.5, bold: true, color: P.ink, maxW: boxW, maxLines: 2 })
      d.text(String(m.text || ''), tx, axisY - 15, { size: 7.5, color: P.soft, maxW: boxW, maxLines: 3 })
    } else {
      d.text(String(m.year || ''), tx, axisY + 20, { size: 13, bold: true, color: P.accent, maxW: boxW, maxLines: 1 })
      d.text(String(m.title || ''), tx, axisY + 27, { size: 9.5, bold: true, color: P.ink, maxW: boxW, maxLines: 2 })
      d.text(String(m.text || ''), tx, axisY + 37, { size: 7.5, color: P.soft, maxW: boxW, maxLines: 3 })
    }
  })

  // ── Themen (Karten) ──
  const cardsY = axisY + 62
  const cardH = 54
  const n = Math.max(1, themes.length)
  const cardW = (usable - (n - 1) * 6) / n
  themes.forEach((t, i) => {
    const x = margin + i * (cardW + 6)
    d.box(x, cardsY, cardW, cardH, P.rule, 0.3)
    d.rect(x, cardsY, cardW, 3, P.accent)
    d.text(String(t.title || ''), x + 5, cardsY + 13, { size: 12, bold: true, color: P.ink, maxW: cardW - 10, maxLines: 1 })
    d.text(String(t.text || ''), x + 5, cardsY + 21, { size: 8, color: P.soft, maxW: cardW - 10, maxLines: 5 })
  })

  // ── Fußzone: Werte + Orte links, Zitate rechts ──
  const footY = cardsY + cardH + 16
  const colW = usable * 0.46
  if (values.length) {
    d.text('WERTE', margin, footY, { size: 9, bold: true, color: P.accent })
    d.text(values.join('   ·   '), margin, footY + 8, { size: 11, color: P.ink, maxW: colW, maxLines: 2 })
  }
  if (places.length) {
    d.text('ORTE', margin, footY + 24, { size: 9, bold: true, color: P.accent })
    d.text(places.join('   ·   '), margin, footY + 32, { size: 11, color: P.ink, maxW: colW, maxLines: 2 })
  }
  if (quotes.length) {
    const qx = margin + usable - colW
    let qy = footY
    for (const q of quotes) {
      qy += d.text(`„${q}"`, qx, qy + 6, { size: 11, italic: true, color: P.ink, maxW: colW, maxLines: 2 }) + 4
    }
  }

  // Fußnote
  d.line(margin, H - 14, W - margin, H - 14, P.rule)
  d.text('Lebenswerk · Lebensgeschichten.ai', margin, H - 7, { size: 8, color: P.soft })
}

// Bild als DataURL + natürliche Maße laden (für das Poster-Motiv).
async function loadImage(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`Bild konnte nicht geladen werden (HTTP ${r.status}).`)
  const blob = await r.blob()
  const data = await new Promise((res, rej) => {
    const fr = new FileReader()
    fr.onload = () => res(fr.result); fr.onerror = () => rej(new Error('Bild konnte nicht gelesen werden.'))
    fr.readAsDataURL(blob)
  })
  const dims = await new Promise((res) => {
    const im = new Image()
    im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight })
    im.onerror = () => res({ w: 1536, h: 1024 })
    im.src = data
  })
  return { data, ...dims }
}

// `bgUrl` ist optional: Ohne Motiv bekommt das Poster einen dunklen Kopf statt
// eines Bildes — es bleibt vollständig, nur weniger prächtig.
export async function downloadPosterPdf(filename, data, bgUrl) {
  let bg = null
  if (bgUrl) { try { bg = await loadImage(bgUrl) } catch { /* ohne Motiv weiter */ } }
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [P.W, P.H] })
  paintPoster(pdfDraw(doc), data || {}, { bg })
  doc.save(filename)
}
