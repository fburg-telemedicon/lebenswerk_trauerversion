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
- Erfinde NICHTS. Kein Name, kein Jahr, keine Angabe, die nicht im Interview steht.
- "name": Nennt das Interview keinen Namen, gib einen LEEREN String zurück (das Blatt schreibt dann „Name nicht genannt"). Erfinde NIEMALS einen Namen. Kosenamen/Teilnamen („Opa Karl") sind erlaubt, wenn sie so vorkommen.
- "role": kurz und eindeutig, z. B. "Hauptperson", "Mutter", "Vater", "Ehefrau", "Ehemann", "Tochter", "Sohn", "Schwester", "Bruder", "Großmutter", "Enkelin".
- "born"/"died": nur belegte Jahreszahlen, sonst leerer String. Niemals schätzen.
- "note": höchstens 8 Wörter — Beruf, Wesenszug oder ein Detail, das das Interview hergibt (z. B. „Schreiner, ruhig und humorvoll"); sonst leerer String.
- "couples": Paare (Ehe/Partnerschaft), je Paar EIN Eintrag.
- "parents": jede Eltern-Kind-Beziehung EINZELN (ein Elternteil + ein Kind pro Eintrag).
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
  return { rows: [...rows.entries()].sort((a, b) => a[0] - b[0]), couples, parents, byId, root, gen }
}

// Gestaltung: eine gerahmte Urkunde im Hochformat statt eines nüchternen
// Organigramms — cremefarbenes Papier, Doppelrahmen mit Eckvignetten, farbig
// hinterlegte Karten (Hauptperson in Gold, Vorfahren/Partner in Blau, Geschwister
// und Kinder in Salbeigrün), Herz-Symbol auf der Paarlinie, Kreuz bei
// Verstorbenen, Legende am Fuß.
const TREE = {
  W: 297, H: 420,             // DIN A3 HOCHformat
  margin: 14, frame: 8,       // Papierrand + Rahmenabstand
  boxW: 52, boxH: 26, gapX: 7, gapY: 30,
  paper: [252, 249, 241],
  ink: [30, 41, 59], soft: [110, 116, 128],
  gold: [176, 141, 62], goldSoft: [222, 199, 138],
  line: [96, 116, 140],
  rootFill: [253, 246, 228], rootEdge: [176, 141, 62],
  blueFill: [231, 238, 247], blueEdge: [122, 151, 185],
  sageFill: [235, 240, 229], sageEdge: [150, 172, 132],
}

// Blau = Vorfahren und Partner (die Linie, aus der man kommt bzw. mit der man
// geht), Salbei = Geschwister und Nachkommen. Rein optische Gliederung.
function cardColors(p, layout) {
  if (p.id === layout.root) return { fill: TREE.rootFill, edge: TREE.rootEdge, lw: 0.9 }
  const partnerOfRoot = layout.couples.some(c => (c.a === layout.root && c.b === p.id) || (c.b === layout.root && c.a === p.id))
  const isAncestor = layout.gen.get(p.id) < 0
  if (isAncestor || partnerOfRoot) return { fill: TREE.blueFill, edge: TREE.blueEdge, lw: 0.5 }
  return { fill: TREE.sageFill, edge: TREE.sageEdge, lw: 0.5 }
}

function paintTree(d, layout, memorial) {
  const { W, H, margin, frame, boxW, boxH, gapX, gapY } = TREE
  const rows = layout.rows

  // Papier + doppelter Zierrahmen mit Eckvignetten
  d.rect(0, 0, W, H, TREE.paper)
  d.frameRect(margin, margin, W - 2 * margin, H - 2 * margin, TREE.gold, 0.7)
  d.frameRect(margin + 2.2, margin + 2.2, W - 2 * margin - 4.4, H - 2 * margin - 4.4, TREE.goldSoft, 0.3)
  d.corners(margin + 2.2, margin + 2.2, W - 2 * margin - 4.4, H - 2 * margin - 4.4, 7, TREE.gold)

  // Kopf
  const top = margin + frame + 6
  d.text('Stammbaum', W / 2, top + 4, { size: 9, align: 'center', color: TREE.gold, font: 'times', bold: true })
  d.text(memorial.name || '', W / 2, top + 14, { size: 19, bold: true, align: 'center', color: TREE.ink, font: 'times', maxW: W - 2 * (margin + frame), maxLines: 1 })
  d.text('Auf Grundlage der im Interview erwähnten Beziehungen.', W / 2, top + 21, { size: 7, italic: true, align: 'center', color: TREE.soft, font: 'times' })
  d.text('Fehlende Namen sind als „Name nicht genannt" markiert.', W / 2, top + 25, { size: 7, italic: true, align: 'center', color: TREE.soft, font: 'times' })
  d.line(W / 2 - 26, top + 30, W / 2 + 26, top + 30, TREE.goldSoft)

  // Zeilen (Generationen) vertikal verteilen
  const bodyTop = top + 38
  const bodyBottom = H - margin - frame - 22       // Platz für die Legende
  const usableH = bodyBottom - bodyTop
  const rowH = Math.min(boxH + gapY, usableH / Math.max(1, rows.length))
  const usableW = W - 2 * (margin + frame)
  // Der Baum sitzt VERTIKAL ZENTRIERT in der Fläche: Bei wenigen Generationen
  // klebte er sonst oben und die untere Blatthälfte blieb leer.
  const contentH = rows.length * rowH - (rowH - boxH)
  const yOffset = Math.max(0, (usableH - contentH) / 2)
  const pos = new Map()

  rows.forEach(([, list], ri) => {
    // Karten schrumpfen, wenn eine Generation sehr breit ist (viele Geschwister).
    const bw = Math.min(boxW, (usableW - (list.length - 1) * gapX) / Math.max(1, list.length))
    const totalW = list.length * bw + (list.length - 1) * gapX
    const x0 = (W - totalW) / 2
    const y = bodyTop + yOffset + ri * rowH
    list.forEach((p, i) => {
      const x = x0 + i * (bw + gapX)
      pos.set(p.id, { x, y, w: bw, cx: x + bw / 2, cy: y + boxH / 2 })
    })
  })

  // Verbindungen (hinter den Karten)
  for (const rel of layout.parents) {
    const p = pos.get(rel.parent), c = pos.get(rel.child)
    if (!p || !c) continue
    const midY = (p.y + boxH + c.y) / 2
    d.line(p.cx, p.y + boxH, p.cx, midY, TREE.line)
    d.line(p.cx, midY, c.cx, midY, TREE.line)
    d.line(c.cx, midY, c.cx, c.y, TREE.line)
  }
  // Paarlinie mit Herz in der Mitte
  for (const c of layout.couples) {
    const a = pos.get(c.a), b = pos.get(c.b)
    if (!a || !b) continue
    const left = a.x < b.x ? a : b
    const right = a.x < b.x ? b : a
    const x1 = left.x + left.w, x2 = right.x
    const y = left.cy
    if (x2 > x1) {
      d.line(x1, y, x2, y, TREE.line)
      d.heart((x1 + x2) / 2, y, 2.4, TREE.gold)
    }
  }

  // Karten
  for (const [, list] of rows) {
    for (const p of list) {
      const at = pos.get(p.id)
      const col = cardColors(p, layout)
      d.card(at.x, at.y, at.w, boxH, col.fill, col.edge, col.lw)

      const name = String(p.name || '').trim() || 'Name nicht genannt'
      const unnamed = !String(p.name || '').trim()
      const years = [p.born ? `* ${p.born}` : '', p.died ? `† ${p.died}` : ''].filter(Boolean).join('   ')

      let ty = at.y + 6.5
      d.text(String(p.role || ''), at.cx, ty, { size: 6, bold: true, align: 'center', color: TREE.gold, font: 'times', maxW: at.w - 4, maxLines: 1 })
      ty += 4.6
      ty += d.text(name, at.cx, ty, {
        size: unnamed ? 7 : 8.6, bold: !unnamed, italic: unnamed, align: 'center',
        color: unnamed ? TREE.soft : TREE.ink, font: 'times', maxW: at.w - 4, maxLines: 2,
      })
      if (years) { d.text(years, at.cx, ty + 0.4, { size: 6.4, align: 'center', color: TREE.soft, font: 'times', maxW: at.w - 4, maxLines: 1 }); ty += 4 }
      if (p.note) d.text(String(p.note), at.cx, ty + 0.8, { size: 5.8, italic: true, align: 'center', color: TREE.soft, font: 'times', maxW: at.w - 5, maxLines: 2 })
    }
  }

  // Legende. Das Herz wird als Vektor GEZEICHNET, nicht gesetzt: Die
  // jsPDF-Standardschriften (WinAnsi) kennen kein ♥ und drucken statt dessen Müll.
  const ly = H - margin - frame - 8
  d.line(margin + frame + 20, ly - 7, W - margin - frame - 20, ly - 7, TREE.goldSoft)
  // Die Legende wird stückweise gesetzt, damit das Herz VOR seinem Text steht und
  // ihn nicht überdeckt (ein zentrierter Gesamttext ließ die Position raten).
  const parts = [
    { t: '*  geboren', w: 22 },
    { t: '†  verstorben', w: 27 },
    { t: 'Ehe/Partnerschaft', w: 34, heart: true },
    { t: '„Name nicht genannt" = im Interview kein Name gefallen', w: 78 },
  ]
  const gapL = 8
  const totalL = parts.reduce((n, p) => n + p.w, 0) + gapL * (parts.length - 1)
  let lx = (W - totalL) / 2
  for (const part of parts) {
    if (part.heart) { d.heart(lx + 1.6, ly - 1.3, 1.7, TREE.gold); d.text(part.t, lx + 5, ly, { size: 6.2, color: TREE.soft, font: 'times' }) }
    else d.text(part.t, lx, ly, { size: 6.2, color: TREE.soft, font: 'times' })
    lx += part.w + gapL
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
    // Szenenkachel des Posters: kommt bereits zugeschnitten als JPEG (13 Szenen als
    // PNG blähten die Datei auf ein Vielfaches auf) und füllt ihre Zelle exakt.
    tile(img, x, y, w, h) { doc.addImage(img.data, 'JPEG', x, y, w, h, undefined, 'FAST') },

    // ── Primitive für den Stammbaum ──
    // Karte mit Füllung und farbigem Rand.
    card(x, y, w, h, fill, edge, lw) {
      doc.setFillColor(fill[0], fill[1], fill[2])
      doc.setDrawColor(edge[0], edge[1], edge[2])
      doc.setLineWidth(lw)
      doc.roundedRect(x, y, w, h, 2.6, 2.6, 'FD')
      doc.setLineWidth(0.3)
    },
    // Rahmenlinie ohne Füllung.
    frameRect(x, y, w, h, color, lw) {
      doc.setDrawColor(color[0], color[1], color[2])
      doc.setLineWidth(lw)
      doc.rect(x, y, w, h, 'S')
      doc.setLineWidth(0.3)
    },
    // Eckvignetten: kurze Doppelstriche, die sich in den Ecken kreuzen — eine
    // dezente Urkunden-Anmutung ohne Ornament-Grafik.
    corners(x, y, w, h, len, color) {
      doc.setDrawColor(color[0], color[1], color[2])
      doc.setLineWidth(0.6)
      const pts = [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]]
      for (const [px, py, sx, sy] of pts) {
        doc.line(px + sx * 2, py + sy * 2, px + sx * (2 + len), py + sy * 2)
        doc.line(px + sx * 2, py + sy * 2, px + sx * 2, py + sy * (2 + len))
        doc.circle(px + sx * 2, py + sy * 2, 0.7, 'S')
      }
      doc.setLineWidth(0.3)
    },
    // Herz auf der Paarlinie: zwei Kreise + Dreieck.
    heart(cx, cy, r, color) {
      doc.setFillColor(color[0], color[1], color[2])
      doc.circle(cx - r * 0.5, cy - r * 0.25, r * 0.55, 'F')
      doc.circle(cx + r * 0.5, cy - r * 0.25, r * 0.55, 'F')
      doc.triangle(cx - r, cy - r * 0.05, cx + r, cy - r * 0.05, cx, cy + r, 'F')
    },

    // ── Primitive fürs Poster ──
    // Dicke Linie mit runden Enden: der Lebenspfad.
    thickLine(x1, y1, x2, y2, color, w) {
      doc.setDrawColor(color[0], color[1], color[2])
      doc.setLineWidth(w)
      doc.setLineCap('round')
      doc.line(x1, y1, x2, y2)
      doc.setLineCap('butt')
      doc.setLineWidth(0.3)
    },
    // Weicher Weg durch eine Punktfolge (Catmull-Rom, in kurze Segmente zerlegt).
    // jsPDF kann Kurven nur relativ zeichnen; die Abtastung ist einfacher und
    // erlaubt es, die Farbe unterwegs zu wechseln (je Lebensabschnitt).
    curveThrough(points, colorAt, width) {
      if (points.length < 2) return
      const P0 = [points[0], ...points, points[points.length - 1]]
      doc.setLineCap('round')
      doc.setLineWidth(width)
      for (let i = 1; i < P0.length - 2; i++) {
        const p0 = P0[i - 1], p1 = P0[i], p2 = P0[i + 1], p3 = P0[i + 2]
        const c = colorAt(i - 1)
        doc.setDrawColor(c[0], c[1], c[2])
        let px = p1.x, py = p1.y
        for (let s = 1; s <= 12; s++) {
          const t = s / 12, t2 = t * t, t3 = t2 * t
          const x = 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3)
          const y = 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3)
          doc.line(px, py, x, y)
          px = x; py = y
        }
      }
      doc.setLineCap('butt')
      doc.setLineWidth(0.3)
    },
    // Bild rechteckig (3:2) mit dünnem Rahmen.
    photo(data, x, y, w, h, edge) {
      doc.addImage(data, 'PNG', x, y, w, h, undefined, 'FAST')
      if (edge) { doc.setDrawColor(edge[0], edge[1], edge[2]); doc.setLineWidth(0.4); doc.rect(x, y, w, h, 'S'); doc.setLineWidth(0.3) }
    },
    // Kartusche: halbtransparentes Papierfeld mit feinem Rand — trägt die Schrift
    // auch über einem vollflächig illustrierten Blatt.
    bubble(x, y, w, h, fill, edge, alpha = 0.88) {
      const gs = typeof doc.GState === 'function'
      if (gs) doc.setGState(new doc.GState({ opacity: alpha }))
      doc.setFillColor(fill[0], fill[1], fill[2])
      doc.setDrawColor(edge[0], edge[1], edge[2])
      doc.setLineWidth(0.4)
      doc.roundedRect(x, y, w, h, 2.4, 2.4, 'FD')
      if (gs) doc.setGState(new doc.GState({ opacity: 1 }))
      doc.setLineWidth(0.3)
    },
    // Abgerundete Farbfläche: die Abschnitts-Pille.
    pill(x, y, w, h, color) {
      doc.setFillColor(color[0], color[1], color[2])
      doc.roundedRect(x, y, w, h, h / 2, h / 2, 'F')
    },
    // Farbiger Ring um eine Vignette.
    ring(cx, cy, r, color, lw) {
      doc.setDrawColor(color[0], color[1], color[2])
      doc.setLineWidth(lw)
      doc.circle(cx, cy, r, 'S')
      doc.setLineWidth(0.3)
    },
    // Bild kreisförmig beschnitten einsetzen. jsPDF kann Bilder nicht maskieren,
    // deshalb: Clipping-Pfad (Kreis) setzen, Bild formatfüllend hineinzeichnen,
    // Zustand zurücknehmen. Ohne Clipping würde das quadratische Bild über den
    // Ring hinausstehen und das Poster unruhig machen.
    circleImage(data, iw, ih, cx, cy, r) {
      const s = Math.max((2 * r) / iw, (2 * r) / ih)
      const w = iw * s, h = ih * s
      doc.saveGraphicsState()
      doc.circle(cx, cy, r, null)   // Pfad ohne Malen …
      doc.clip(); doc.discardPath()  // … als Maske verwenden
      doc.addImage(data, 'PNG', cx - w / 2, cy - h / 2, w, h, undefined, 'FAST')
      doc.restoreGraphicsState()
    },

    text(str, x, y, o = {}) {
      const c = o.color || [0, 0, 0]
      doc.setTextColor(c[0], c[1], c[2])
      doc.setFont(o.font || 'helvetica', o.bold ? 'bold' : (o.italic ? 'italic' : 'normal'))
      doc.setFontSize(o.size || 10)
      const lines = o.maxW ? doc.splitTextToSize(String(str), o.maxW) : [String(str)]
      const lh = (o.size || 10) * 0.3528 * 1.25
      lines.slice(0, o.maxLines || 99).forEach((ln, i) => {
        // `angle` erlaubt leicht schräg gesetzte Beschriftungen — auf dem Poster
        // nimmt das der Typografie das Amtliche und passt zum gezeichneten Blatt.
        doc.text(ln, x, y + i * lh, { align: o.align || 'left', ...(o.angle ? { angle: o.angle } : {}) })
      })
      return lines.length * lh
    },
  }
}

export function downloadTreePdf(filename, data, memorial) {
  const layout = layoutTree(data)
  if (!layout) throw new Error('Der Stammbaum enthält keine Personen — das Interview gibt (noch) keine Familie her.')
  // Hochformat (A3): Ein Stammbaum wächst nach unten, nicht in die Breite.
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [TREE.W, TREE.H] })
  paintTree(pdfDraw(doc), layout, memorial)
  doc.save(filename)
}

// ════════════════════════════════════════════════════════════════
// 2) LEBENSPOSTER (DIN A2 quer, 594 × 420 mm)
// ════════════════════════════════════════════════════════════════
//
// Das Poster ist eine ILLUSTRIERTE LEBENSKARTE: Ein Pfad mäandert in Serpentinen
// über das Blatt, unterwegs liegen die Lebensabschnitte (farbige Pillen), an ihm
// hängen die Stationen — jede mit einer freigestellten Vignette (FLUX, Bildmodus
// 'vignette') und wenigen Worten.
//
// WARUM VEKTOR + VIGNETTEN statt EINES großen KI-Bildes: Ein Bildmodell kann
// Schrift nicht zuverlässig setzen (in den Vorlagen steht „Goburt in Segen" und
// „Röckkohr zur Musik"). Jahreszahlen und Namen eines echten Lebens dürfen aber
// nicht falsch sein. Also: die GRAFIK von der KI, die SCHRIFT vom Layout.

// ── Die fünf Poster-Stile ─────────────────────────────────────────
// Jeder Stil bestimmt Papier, Palette und Typografie — UND den Illustrationsstil
// der Vignetten (`key` geht als `posterStyle` an api/admin/generate-image.js, wo
// die passende Bild-Direktive liegt). So passen Grafik und Layout zusammen.
export const POSTER_STYLES = [
  {
    key: 'storybook',
    label: 'Erzählt & handgezeichnet',
    description: 'Warmes Cremepapier, weiche Erdtöne, gezeichnete Szenen – wie ein illustriertes Bilderbuch.',
    paper: [246, 239, 225], ink: [43, 38, 33], soft: [124, 112, 99],
    accents: [[176, 92, 60], [92, 122, 84], [70, 106, 128], [186, 146, 62], [128, 88, 120], [96, 108, 116]],
    heading: 'times', body: 'helvetica', titleUpper: false,
  },
  {
    key: 'journal',
    label: 'Reisetagebuch & Skizze',
    description: 'Notizbuchpapier, Tintenlinien mit laviertem Aquarell – wie ein über Jahrzehnte geführtes Skizzenbuch.',
    paper: [247, 242, 229], ink: [38, 44, 58], soft: [122, 126, 138],
    accents: [[58, 78, 128], [172, 96, 62], [104, 122, 78], [186, 148, 66], [80, 116, 118], [126, 84, 104]],
    heading: 'times', body: 'helvetica', titleUpper: false,
  },
  {
    key: 'atlas',
    label: 'Alter Atlas',
    description: 'Gealtertes Kartenpapier, Sepia und Tinte – die Lebensreise als antike Landkarte.',
    paper: [240, 229, 205], ink: [58, 44, 30], soft: [130, 108, 82],
    accents: [[140, 82, 45], [100, 92, 60], [72, 92, 96], [160, 118, 60], [110, 70, 60], [92, 104, 78]],
    heading: 'times', body: 'times', titleUpper: false,
  },
  {
    key: 'watercolor',
    label: 'Aquarell & luftig',
    description: 'Viel Weißraum, zarte Wasserfarben, leichte Anmutung – poetisch und zurückhaltend.',
    paper: [252, 250, 247], ink: [50, 52, 58], soft: [140, 142, 150],
    accents: [[168, 122, 132], [122, 152, 158], [150, 166, 130], [198, 168, 116], [136, 132, 168], [176, 146, 128]],
    heading: 'times', body: 'helvetica', titleUpper: false,
  },
  {
    key: 'nouveau',
    label: 'Jugendstil & Ornament',
    description: 'Elfenbein und tiefe Buntglasfarben, geschwungene Konturen, goldene Linien – festlich und dekorativ.',
    paper: [243, 236, 220], ink: [40, 34, 28], soft: [132, 116, 92],
    accents: [[46, 106, 92], [40, 84, 118], [150, 66, 78], [176, 138, 60], [96, 68, 108], [136, 96, 56]],
    heading: 'times', body: 'times', titleUpper: false,
  },
]
export const DEFAULT_POSTER_STYLE = 'storybook'
export const getPosterStyle = k => POSTER_STYLES.find(s => s.key === k) || POSTER_STYLES[0]

export function posterSystem(memorial, contributions) {
  const lines = contributions.flatMap(c => (c.messages || []).map(m => m.role === 'assistant' ? `F: ${m.content}` : `A: ${m.content}`))
  return `Du bist Kurator und Informationsdesigner. Aus dem folgenden autobiographischen Interview mit ${memorial.name} entwickelst du ein LEBENSPOSTER (DIN A2 quer): eine illustrierte Landkarte dieses Lebens. Ein Pfad führt durch die Lebensabschnitte; an ihm liegen einzelne Stationen, jede mit einer kleinen Illustration und wenigen Worten.

Gib REINES, GÜLTIGES JSON aus (kein Markdown, keine Erklärungen):
{
  "title": "Titel des Posters, kurz und stark (max. 6 Wörter)",
  "subtitle": "Untertitel, max. 14 Wörter",
  "person": { "name": "${memorial.name}", "years": "z. B. 1948 – heute; leer, wenn unbekannt" },
  "sections": [
    {
      "heading": "Name des Lebensabschnitts (max. 4 Wörter)",
      "period": "Zeitraum, z. B. 1948–1964 oder 'ab 1985'",
      "stations": [
        {
          "year": "Jahr oder Zeitraum, z. B. 1965; leer, wenn unbekannt",
          "title": "Überschrift der Station, max. 5 Wörter",
          "text": "1 Satz, konkret, max. 22 Wörter",
          "image_prompt": "English, 10-20 words: a small SCENE that captures this station — a place with a few objects and atmosphere (e.g. 'a warm bakery back room at dawn, trays of bread, flour dust in the light'). Objects and places, no faces, no portraits, no text.",
          "weight": "Bedeutung dieser Station: 3 = Wendepunkt (groß), 2 = wichtig, 1 = Nebenstation"
        }
      ]
    }
  ],
  "values": ["Wert, max. 2 Wörter"],
  "places": ["Ort"],
  "quote": "EIN Satz der Person, wörtlich oder sehr nah am Wortlaut, max. 18 Wörter"
}

Regeln zum AUFBAU:
- "sections": 4–5 Lebensabschnitte, CHRONOLOGISCH (z. B. Wurzeln & Kindheit, Jugend & Ausbildung, Beruf, Familie & Liebe, Späte Jahre & Vermächtnis).
- Insgesamt 10–12 "stations" (also 2–3 je Abschnitt) — WENIGE, dafür STARKE Stationen. Wähle die Wendepunkte, nicht jede Episode.
- "weight": Pro Poster höchstens 3 Stationen mit weight 3 und höchstens 4 mit weight 2. Der Rest ist 1.
- "image_prompt" ist das Herz der Grafik: eine kleine SZENE mit Atmosphäre (Ort + wenige Gegenstände + Licht), KEINE Gesichter, KEINE Porträts, kein Text im Bild.
- "values": 5–8 Stück. "places": 3–6 Stück. "quote": genau EIN Satz.

Regeln zur WAHRHEIT (die wichtigsten):
- Erfinde NICHTS. Keine Jahreszahl, kein Ort, kein Ereignis, kein Zitat, das nicht im Interview steht. Lieber eine Station weniger.
- Ist ein Jahr unklar, lass "year" leer, statt zu raten.
- Der "quote" muss so oder fast so im Interview gefallen sein. Gibt das Interview keinen Satz her, gib "" zurück.

Sonstiges:
- Kurz, konkret, bildhaft — dies ist ein Poster, kein Fließtext.
- Alles auf Deutsch, NUR "image_prompt" auf Englisch.
- Gültiges JSON, keine trailing commas.

Interview:\n\n${lines.join('\n')}`
}

// Alle Bild-Aufträge des Posters, in Reihenfolge. Schlüssel "si:ti" = Abschnitt/Station.
export function posterImageJobs(data) {
  const jobs = []
  ;(Array.isArray(data?.sections) ? data.sections : []).slice(0, 6).forEach((sec, si) => {
    ;(Array.isArray(sec.stations) ? sec.stations : []).slice(0, 4).forEach((st, ti) => {
      if (st?.image_prompt) jobs.push({ key: `${si}:${ti}`, si, ti, prompt: st.image_prompt })
    })
  })
  return jobs
}

const P = { W: 594, H: 420, margin: 22 }

// ── Layout ────────────────────────────────────────────────────────
// Serpentine: Die Stationen laufen Bahn für Bahn abwechselnd nach rechts und
// nach links. Jede Station bekommt eine Zelle: oben die runde Vignette, darunter
// Jahr, Titel und ein Satz. Die Abschnitts-Pille sitzt über der ersten Station
// ihrer Gruppe.
function layoutPoster(data, st) {
  const sections = (Array.isArray(data?.sections) ? data.sections : []).slice(0, 6)
  const stations = []
  sections.forEach((sec, si) => {
    ;(Array.isArray(sec.stations) ? sec.stations : []).slice(0, 4).forEach((s, ti) => {
      stations.push({ ...s, si, ti, first: ti === 0, section: sec })
    })
  })
  if (stations.length === 0) return null

  const headH = 72
  const footH = 40
  const bodyH = P.H - headH - footH
  const lanes = stations.length > 12 ? 4 : 3
  const laneH = bodyH / lanes
  const perLane = Math.ceil(stations.length / lanes)
  const usableW = P.W - 2 * P.margin
  const cellW = usableW / perLane

  // LESERICHTUNG, nicht Serpentine: Jede Bahn läuft links → rechts, wie Text.
  // Eine echte Serpentine (Bahn 2 rückwärts) sah zwar nach „Weg" aus, ließ die
  // Jahreszahlen dort aber rückwärts lesen — der häufigste Fehler bei solchen
  // Postern. Der Pfad springt stattdessen am Zeilenende sichtbar zurück.
  stations.forEach((s, i) => {
    const lane = Math.floor(i / perLane)
    const idxInLane = i % perLane
    s.lane = lane
    s.cx = P.margin + idxInLane * cellW + cellW / 2
    s.cy = headH + lane * laneH + laneH / 2
    s.cellW = cellW
    s.laneH = laneH
    s.color = st.accents[s.si % st.accents.length]
  })
  return { sections, stations, lanes, perLane, cellW, laneH, headH, footH }
}

// `images` = { "si:ti": { data, w, h } }
function paintPoster(d, data, images, st) {
  const L = layoutPoster(data, st)
  if (!L) throw new Error('Das Poster enthält keine Stationen — das Interview gibt (noch) zu wenig her.')
  const { W, H, margin } = P

  d.rect(0, 0, W, H, st.paper)

  // ── Kopf ──
  const title = String(data.title || 'Ein Leben')
  d.text(st.titleUpper ? title.toUpperCase() : title, W / 2, 30, {
    size: 34, bold: true, align: 'center', color: st.ink, font: st.heading, maxW: W - 2 * margin, maxLines: 1,
  })
  if (data.subtitle) {
    d.text(String(data.subtitle), W / 2, 42, { size: 13, italic: true, align: 'center', color: st.soft, font: st.body, maxW: W - 140, maxLines: 1 })
  }
  const who = [data.person?.name, data.person?.years].filter(Boolean).join('   ·   ')
  if (who) d.text(who, W / 2, 52, { size: 10, align: 'center', color: st.soft, font: st.body, maxW: W - 140, maxLines: 1 })
  d.line(W / 2 - 36, 57, W / 2 + 36, 57, st.soft)

  // ── Pfad (liegt hinter allem anderen) ──
  // Innerhalb einer Bahn eine kräftige Linie; am Bahnende ein Rücksprung, der
  // rechts aus dem Blatt läuft und links wieder hereinkommt — er ist bewusst
  // dünner und heller, damit er als Übergang gelesen wird und nicht als Station.
  const py = s => s.cy - 8
  for (let i = 0; i < L.stations.length - 1; i++) {
    const a = L.stations[i], b = L.stations[i + 1]
    if (a.lane === b.lane) {
      d.thickLine(a.cx, py(a), b.cx, py(b), a.color, 2.4)
    } else {
      // Der Rücksprung muss UNTER den Textblöcken der Bahn durchlaufen, sonst
      // streicht er quer durch die Sätze. Die Bahn-Unterkante liegt darunter.
      const yMid = a.cy + a.laneH / 2 - 2
      d.thickLine(a.cx, py(a), W - margin + 4, py(a), a.color, 1.2)
      d.thickLine(W - margin + 4, py(a), W - margin + 4, yMid, a.color, 1.2)
      d.thickLine(margin - 4, yMid, W - margin + 4, yMid, b.color, 1.2)
      d.thickLine(margin - 4, yMid, margin - 4, py(b), b.color, 1.2)
      d.thickLine(margin - 4, py(b), b.cx, py(b), b.color, 1.2)
    }
  }

  // ── Stationen ──
  for (const s of L.stations) {
    const img = images[`${s.si}:${s.ti}`]
    const vign = Math.min(46, s.cellW * 0.78)
    const cy = s.cy - 8

    // Abschnitts-Pille über der ersten Station der Gruppe
    if (s.first) {
      const head = String(s.section.heading || '').trim()
      const per = String(s.section.period || '').trim()
      const label = per ? `${head}  ·  ${per}` : head
      if (label) {
        const pillW = Math.min(s.cellW + 30, 10 + label.length * 1.95)
        const px = Math.max(margin, Math.min(W - margin - pillW, s.cx - pillW / 2))
        const pyy = s.cy - s.laneH / 2 + 1
        d.pill(px, pyy, pillW, 8.6, s.color)
        d.text(label, px + pillW / 2, pyy + 5.9, { size: 7.4, bold: true, align: 'center', color: [255, 255, 255], font: st.heading, maxW: pillW - 5, maxLines: 1 })
      }
    }

    // Vignette (Bild im Kreis + Ring in der Abschnittsfarbe)
    if (img) d.circleImage(img.data, img.w, img.h, s.cx, cy, vign / 2)
    else     d.circle(s.cx, cy, vign / 2, st.paper)
    d.ring(s.cx, cy, vign / 2, s.color, 0.9)

    // Text
    let ty = cy + vign / 2 + 6
    if (s.year) {
      d.text(String(s.year), s.cx, ty, { size: 9, bold: true, align: 'center', color: s.color, font: st.heading, maxW: s.cellW - 6, maxLines: 1 })
      ty += 4.6
    }
    ty += d.text(String(s.title || ''), s.cx, ty, { size: 8.6, bold: true, align: 'center', color: st.ink, font: st.heading, maxW: s.cellW - 8, maxLines: 2 })
    d.text(String(s.text || ''), s.cx, ty + 1.2, { size: 6.9, align: 'center', color: st.soft, font: st.body, maxW: s.cellW - 8, maxLines: 4 })
  }

  // ── Fuß: Werte · Orte · Zitat ──
  const fy = H - L.footH + 10
  d.line(margin, fy - 8, W - margin, fy - 8, st.soft)
  const values = (Array.isArray(data.values) ? data.values : []).slice(0, 8)
  const places = (Array.isArray(data.places) ? data.places : []).slice(0, 6)
  const colW = (W - 2 * margin) / 3 - 8

  if (values.length) {
    d.text('WERTE', margin, fy, { size: 7, bold: true, color: st.accents[0], font: st.heading })
    d.text(values.join('  ·  '), margin, fy + 6, { size: 9, color: st.ink, font: st.body, maxW: colW, maxLines: 2 })
  }
  if (places.length) {
    const x = margin + colW + 12
    d.text('ORTE', x, fy, { size: 7, bold: true, color: st.accents[1 % st.accents.length], font: st.heading })
    d.text(places.join('  ·  '), x, fy + 6, { size: 9, color: st.ink, font: st.body, maxW: colW, maxLines: 2 })
  }
  if (data.quote) {
    const x = margin + 2 * (colW + 12)
    d.text(`„${data.quote}"`, x, fy + 2, { size: 10.5, italic: true, color: st.ink, font: st.heading, maxW: colW + 8, maxLines: 3 })
  }
  d.text('Lebenswerk · Lebensgeschichten.ai', W - margin, H - 5, { size: 6.5, align: 'right', color: st.soft, font: st.body })
}

// Bild als DataURL + natürliche Maße laden.
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

// ── Organisches Layout (Hybrid) ───────────────────────────────────
// Die KI entscheidet die GESTALTUNG (welche Station ist ein Wendepunkt, welcher
// Abschnitt gehört zusammen, was steht drin); die GEOMETRIE rechnet der Code —
// denn ein Sprachmodell sieht seine eigene Zeichnung nicht und legt Texte über
// Bilder. Hier gilt: Jede Station bekommt eine ZELLE, Zellen überlappen sich nie,
// und alles einer Station bleibt in ihrer Zelle. Innerhalb dieser Garantie ist
// das Blatt frei: Zellen sind unterschiedlich breit (nach Bedeutung), die Bilder
// sitzen in drei Größen, die Höhe schwankt, der Text steht mal über, mal unter
// dem Bild — und der Weg läuft als weiche Kurve durch die Bildmitten.
const ORG = {
  headH: 66,          // Titelzone
  footH: 26,          // Werte/Orte/Zitat
  lanes: 3,
  imgW: { 3: 92, 2: 66, 1: 46 },   // Bildbreite nach Bedeutung (3:2)
  gap: 5,
}

function layoutOrganic(data, st) {
  const stations = []
  ;(data.sections || []).slice(0, 6).forEach((sec, si) => {
    ;(sec.stations || []).forEach((s, ti) => {
      const w = Math.min(3, Math.max(1, parseInt(s.weight, 10) || 1))
      stations.push({ ...s, si, ti, weight: w, first: ti === 0, section: sec, color: st.accents[si % st.accents.length] })
    })
  })
  if (!stations.length) return null

  const usableW = P.W - 2 * P.margin
  const bodyTop = ORG.headH
  const bodyH = P.H - ORG.headH - ORG.footH

  // Stationen auf Bahnen verteilen: Wir füllen eine Bahn, bis ihre Breite voll
  // ist — dadurch stehen mal vier kleine, mal zwei große Stationen in einer Zeile.
  // Bahnen AUSGEWOGEN füllen: Jede Bahn bekommt etwa denselben Breiten-Anteil.
  // (Greedy „füllen bis voll" ließ in der letzten Bahn eine einzelne Station
  // stehen — halbes Blatt leer.)
  const cellOf = s => ORG.imgW[s.weight] + ORG.gap * 2
  const total = stations.reduce((n, s) => n + cellOf(s), 0)
  const laneCount = Math.min(ORG.lanes, Math.max(1, Math.ceil(total / usableW)))
  const target = total / laneCount
  const lanes = [[]]
  let acc = 0
  for (const s of stations) {
    const c = cellOf(s)
    if (lanes.length < laneCount && acc > 0 && acc + c / 2 > target) {
      lanes.push([]); acc = 0
    }
    lanes[lanes.length - 1].push(s)
    acc += c
  }

  // Höhe erst JETZT verteilen: nach der Zahl der tatsächlich gefüllten Bahnen.
  // (Rechnete man mit der Obergrenze, bliebe bei zwei Bahnen unten eine leer.)
  const laneH = bodyH / lanes.length

  // Zellen einer Bahn proportional auf die volle Breite dehnen → kein Flattern am
  // Zeilenende, aber die Breitenverhältnisse (und damit die Bildgrößen) bleiben.
  lanes.forEach((lane, li) => {
    const total = lane.reduce((n, s) => n + cellOf(s), 0)
    const stretch = usableW / total
    let x = P.margin
    lane.forEach((s, i) => {
      const cw = cellOf(s) * stretch
      s.cellX = x
      s.cellW = cw
      s.lane = li
      // Höhenversatz: gerade/ungerade Stationen wandern leicht nach oben bzw.
      // unten — das nimmt dem Blatt die Reihenoptik, ohne Zellen zu verlassen.
      const swing = (i % 2 === 0 ? -1 : 1) * (li % 2 === 0 ? 1 : -1)
      s.imgW = Math.min(ORG.imgW[s.weight], cw - 2 * ORG.gap)
      s.imgH = s.imgW / 1.5
      s.laneTop = bodyTop + li * laneH
      s.laneH = laneH
      // Text mal unter, mal über dem Bild (abwechselnd, nie beides am selben Ort).
      // Über der ERSTEN Station eines Abschnitts sitzt die Abschnitts-Pille —
      // dort darf der Text nicht auch nach oben, sonst kollidiert beides.
      s.textAbove = !s.first && (i + li) % 3 === 1
      const slack = laneH - s.imgH - 22
      const off = Math.max(-6, Math.min(6, swing * slack * 0.18))
      s.imgY = s.laneTop + (s.textAbove ? 22 : 6) + off
      s.imgX = x + (cw - s.imgW) / 2
      s.cx = s.imgX + s.imgW / 2
      s.cy = s.imgY + s.imgH / 2
      x += cw
    })
  })
  return { stations, lanes }
}

function paintPosterOrganic(d, data, images, st) {
  const L = layoutOrganic(data, st)
  if (!L) throw new Error('Das Poster enthält keine Stationen — das Interview gibt (noch) zu wenig her.')
  const { W, H, margin } = P

  d.rect(0, 0, W, H, st.paper)

  // Kopf
  const title = String(data.title || 'Ein Leben')
  d.text(st.titleUpper ? title.toUpperCase() : title, W / 2, 28, { size: 32, bold: true, align: 'center', color: st.ink, font: st.heading, maxW: W - 60, maxLines: 1 })
  if (data.subtitle) d.text(String(data.subtitle), W / 2, 40, { size: 12, italic: true, align: 'center', color: st.soft, font: st.body, maxW: W - 90, maxLines: 1 })
  const who = [data.person?.name, data.person?.years].filter(Boolean).join('   ·   ')
  if (who) d.text(who, W / 2, 49, { size: 9.5, align: 'center', color: st.soft, font: st.body, maxW: W - 90, maxLines: 1 })

  // Der Weg: eine weiche Kurve durch alle Bildmitten, Farbe je Abschnitt.
  const pts = L.stations.map(s => ({ x: s.cx, y: s.cy }))
  d.curveThrough(pts, i => (L.stations[Math.min(i, L.stations.length - 1)].color), 2.2)

  // Stationen
  for (const s of L.stations) {
    const img = images[`${s.si}:${s.ti}`]
    if (img) d.photo(img.data, s.imgX, s.imgY, s.imgW, s.imgH, s.color)
    else { d.card(s.imgX, s.imgY, s.imgW, s.imgH, st.paper, s.color, 0.4) }

    // Textblock (über oder unter dem Bild) — bleibt immer in der Zelle.
    const tw = s.cellW - 2 * ORG.gap
    const tx = s.cellX + s.cellW / 2
    let ty = s.textAbove ? s.imgY - 13 : s.imgY + s.imgH + 6
    if (s.year) {
      d.text(String(s.year), tx, ty, { size: 8.5, bold: true, align: 'center', color: s.color, font: st.heading, maxW: tw, maxLines: 1 })
      ty += 4.4
    }
    ty += d.text(String(s.title || ''), tx, ty, { size: 8.2, bold: true, align: 'center', color: st.ink, font: st.heading, maxW: tw, maxLines: 2 })
    // Die Beschreibung steht immer unter dem Bild — steht die Überschrift oben,
    // ist der Platz darunter frei; sonst schließt sie an die Überschrift an.
    const dy = s.textAbove ? s.imgY + s.imgH + 6 : ty + 1
    d.text(String(s.text || ''), tx, dy, { size: 6.4, align: 'center', color: st.soft, font: st.body, maxW: tw, maxLines: 4 })
  }

  // Abschnitts-Pillen: über der ERSTEN Station jedes Abschnitts, am oberen
  // Zellenrand — sie kollidieren nie mit Bild oder Text, weil dort Luft bleibt.
  for (const s of L.stations) {
    if (!s.first) continue
    const head = String(s.section.heading || '').trim()
    const per = String(s.section.period || '').trim()
    const label = per ? `${head} · ${per}` : head
    if (!label) continue
    const pw = Math.min(s.cellW + 24, 8 + label.length * 1.9)
    const px = Math.max(margin, Math.min(W - margin - pw, s.cx - pw / 2))
    const py = s.laneTop - 1
    d.pill(px, py, pw, 7.6, s.color)
    d.text(label, px + pw / 2, py + 5.2, { size: 6.6, bold: true, align: 'center', color: [255, 255, 255], font: st.heading, maxW: pw - 4, maxLines: 1 })
  }

  // Fuß
  const fy = H - ORG.footH + 8
  d.line(margin, fy - 7, W - margin, fy - 7, st.soft)
  const values = (Array.isArray(data.values) ? data.values : []).slice(0, 8)
  const places = (Array.isArray(data.places) ? data.places : []).slice(0, 6)
  const colW = (W - 2 * margin) / 3 - 8
  if (values.length) {
    d.text('WERTE', margin, fy, { size: 6.5, bold: true, color: st.accents[0], font: st.heading })
    d.text(values.join('  ·  '), margin, fy + 5.5, { size: 8.5, color: st.ink, font: st.body, maxW: colW, maxLines: 2 })
  }
  if (places.length) {
    const x = margin + colW + 12
    d.text('ORTE', x, fy, { size: 6.5, bold: true, color: st.accents[1 % st.accents.length], font: st.heading })
    d.text(places.join('  ·  '), x, fy + 5.5, { size: 8.5, color: st.ink, font: st.body, maxW: colW, maxLines: 2 })
  }
  if (data.quote) {
    const x = margin + 2 * (colW + 12)
    d.text(`„${data.quote}"`, x, fy + 2, { size: 10, italic: true, color: st.ink, font: st.heading, maxW: colW + 8, maxLines: 3 })
  }
  d.text('Lebenswerk · Lebensgeschichten.ai', W - margin, H - 4, { size: 6, align: 'right', color: st.soft, font: st.body })
}

// `urls` = { "si:ti": signierte URL }. Ein fehlendes Bild ist nicht fatal — die
// Station bekommt dann einen leeren Kreis in ihrer Abschnittsfarbe.
export async function downloadPosterPdf(filename, data, urls = {}, styleKey) {
  const st = getPosterStyle(styleKey || data?.style)
  const images = {}
  await Promise.all(Object.entries(urls).map(async ([k, url]) => {
    if (!url) return
    try { images[k] = await loadImage(url) } catch { /* Station bleibt ohne Bild */ }
  }))
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [P.W, P.H] })
  paintPosterOrganic(pdfDraw(doc), data || {}, images, st)
  doc.save(filename)
}

// ════════════════════════════════════════════════════════════════
// 3) POSTER-KOMPOSITION DURCH DIE KI (SVG)
// ════════════════════════════════════════════════════════════════
//
// Das feste Raster oben (paintPoster) ist zuverlässig, sieht aber gebaut aus:
// gleich große Kreise in Bahnen. Die Vorbilder leben von freier Komposition —
// unterschiedlich große Szenen, ein geschwungener Weg, Text mal links, mal
// rechts. Genau das kann eine KI: Sie bekommt die Inhalte und die Bildmaße und
// ENTWIRFT DAS BLATT als SVG.
//
// Warum das die Rechtschreibung rettet: Im SVG ist jeder Text ECHTER TEXT (vom
// Sprachmodell geschrieben, nicht vom Bildmodell gemalt) und wird als Vektor ins
// PDF gesetzt — beliebig scharf, korrekt geschrieben. Die Bild-KI liefert nur
// noch die Illustrationen.
//
// Sicherheitsnetz: Kommt kein brauchbares SVG zurück, greift das feste Layout
// (downloadPosterPdf) — das Poster entsteht also immer.

// Zeilenumbruch gibt es in SVG nicht. Die KI markiert Textblöcke deshalb mit
// data-w (verfügbare Breite in mm); wir brechen den Text hier selbst um und
// messen dabei mit derselben Schrift, mit der das PDF gesetzt wird.
const SVG_NS = 'http://www.w3.org/2000/svg'

// Grob, aber ausreichend: die äußersten Koordinaten des SVG-Inhalts. Wir lesen die
// Positions-Attribute aller Elemente und zusätzlich die Zahlen aus Pfaddaten. Das
// reicht, um zu erkennen, dass das Modell z. B. in Pixeln gerechnet hat (Werte weit
// jenseits von 594/420) und um den Inhalt aufs Blatt zurückzuholen.
function svgExtent(svg) {
  let maxX = 0, maxY = 0
  const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0 }
  for (const el of svg.querySelectorAll('*')) {
    const t = el.tagName.toLowerCase()
    if (t === 'rect' || t === 'image') {
      maxX = Math.max(maxX, num(el.getAttribute('x')) + num(el.getAttribute('width')))
      maxY = Math.max(maxY, num(el.getAttribute('y')) + num(el.getAttribute('height')))
    } else if (t === 'circle' || t === 'ellipse') {
      maxX = Math.max(maxX, num(el.getAttribute('cx')) + num(el.getAttribute('r') || el.getAttribute('rx')))
      maxY = Math.max(maxY, num(el.getAttribute('cy')) + num(el.getAttribute('r') || el.getAttribute('ry')))
    } else if (t === 'text' || t === 'tspan') {
      maxX = Math.max(maxX, num(el.getAttribute('x')))
      maxY = Math.max(maxY, num(el.getAttribute('y')))
    } else if (t === 'line') {
      maxX = Math.max(maxX, num(el.getAttribute('x1')), num(el.getAttribute('x2')))
      maxY = Math.max(maxY, num(el.getAttribute('y1')), num(el.getAttribute('y2')))
    } else if (t === 'path' || t === 'polyline' || t === 'polygon') {
      const d = el.getAttribute('d') || el.getAttribute('points') || ''
      const nums = (d.match(/-?\d+(?:\.\d+)?/g) || []).map(Number)
      for (let i = 0; i + 1 < nums.length; i += 2) {
        maxX = Math.max(maxX, nums[i])
        maxY = Math.max(maxY, nums[i + 1])
      }
    }
  }
  return { maxX, maxY }
}

export function posterLayoutSystem(data, styleKey) {
  const st = getPosterStyle(styleKey)
  const hex = c => '#' + c.map(v => v.toString(16).padStart(2, '0')).join('')
  const palette = st.accents.map(hex).join(', ')
  const stations = []
  ;(data.sections || []).forEach((sec, si) => {
    ;(sec.stations || []).forEach((s, ti) => {
      stations.push(`  IMG:${si}:${ti} | Abschnitt „${sec.heading}" (${sec.period || ''}) | Jahr: ${s.year || '—'} | Titel: ${s.title} | Bedeutung: ${s.weight || 1}\n     Text: ${s.text}`)
    })
  })

  return `Du bist Infografik-Designerin. Du gestaltest ein LEBENSPOSTER im Format DIN A2 quer als SVG.

BLATTMASSE — HALTE DICH EXAKT DARAN:
- Das Wurzelelement lautet GENAU: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 594 420">
- KEIN width-Attribut, KEIN height-Attribut am <svg>. Keine Pixel, keine "px"-Einheiten irgendwo.
- ALLE Koordinaten liegen zwischen 0 und 594 (x) bzw. 0 und 420 (y) — die Einheit ist Millimeter. Eine Schriftgröße von 4 bedeutet 4 mm, nicht 4 px.
- Sicherheitsrand 14 mm rundum: dort darf NICHTS Wichtiges liegen. Nichts darf über den Blattrand hinausragen.

STIL „${st.label}":
- Papierfarbe (Hintergrund-Rechteck über das ganze Blatt): ${hex(st.paper)}
- Schriftfarbe: ${hex(st.ink)}, gedämpft: ${hex(st.soft)}
- Akzentfarben (für Wege, Bänder, Jahreszahlen): ${palette}
- Schriften: NUR font-family="times" (Serifen) oder font-family="helvetica" (serifenlos). Überschriften bevorzugt ${st.heading}, Fließtext ${st.body}.

INHALTE (alles davon MUSS aufs Poster, wörtlich, ohne Änderung):
Titel: ${data.title}
Untertitel: ${data.subtitle || ''}
Person: ${[data.person?.name, data.person?.years].filter(Boolean).join(' · ')}
Stationen (chronologisch — jede hat ein Bild, das du über den Platzhalter einsetzt):
${stations.join('\n')}
Werte: ${(data.values || []).join(' · ')}
Orte: ${(data.places || []).join(' · ')}
Zitat: ${data.quote || ''}

SO BAUST DU DAS BLATT:
- Ein geschwungener Weg (ein oder mehrere <path> mit Bézier-Kurven, stroke-width 2–3, stroke-linecap="round") führt CHRONOLOGISCH durch das Blatt und verbindet die Stationen. Er darf sich krümmen, aufsteigen, abfallen — er ist die Lebenslinie, kein Lineal. Die Farbe wechselt je Lebensabschnitt (nutze die Akzentfarben in der Reihenfolge der Abschnitte).
- Die Stationen liegen ENTLANG dieses Weges, NICHT auf einem Raster: unterschiedliche Höhen, mal über, mal unter dem Weg, unregelmäßige Abstände.
- Bilder als <image href="IMG:si:ti" x="…" y="…" width="…" height="…" preserveAspectRatio="xMidYMid slice"/>. Die Platzhalter-href MUSS exakt so bleiben (IMG:Abschnitt:Station), sie wird beim Rendern durch das echte Bild ersetzt.
  • Bedeutung 3 → großes Bild, etwa 90–110 mm breit
  • Bedeutung 2 → mittleres Bild, etwa 60–75 mm breit
  • Bedeutung 1 → kleines Bild, etwa 40–50 mm breit
  • Seitenverhältnis IMMER 3:2 (Breite:Höhe = 1.5), sonst wird das Bild beschnitten.
  • Bilder dürfen sich NICHT überlappen und keinen Text überdecken.
- Je Abschnitt EIN Band/eine Pille (<rect rx="4"> in der Akzentfarbe, weiße Schrift darauf) mit dem Namen des Abschnitts und dem Zeitraum, am Beginn der Gruppe.
- Zu jeder Station: Jahreszahl (fett, in der Akzentfarbe), Titel (fett, Schriftfarbe) und der Text. Setze sie WECHSELND neben, über oder unter das Bild — nicht immer gleich.
- Titel des Posters groß (font-size 26–34) im Kopfbereich, Untertitel darunter, Person klein darunter.
- Werte, Orte und das Zitat in einer ruhigen Fußzone.

TEXT — WICHTIG (SVG kann nicht umbrechen, das erledigt der Renderer):
- Jeder mehrzeilige Text ist EIN <text>-Element mit dem Attribut data-w="Breite in mm". Der Renderer bricht ihn innerhalb dieser Breite um. Schreibe den Text als reinen Inhalt, OHNE <tspan>.
- Beispiel: <text x="120" y="180" data-w="52" font-family="helvetica" font-size="3.4" fill="${hex(st.soft)}">Der Satz zur Station.</text>
- text-anchor="start" (Standard), "middle" oder "end" — der Umbruch respektiert das.
- Schriftgrößen: Stationstext 3.2–3.8, Stationstitel 4.5–5.5, Jahreszahl 5–6, Abschnittsband 4, Poster-Titel 26–34.
- Ändere KEINEN der oben gelieferten Texte: kein Umformulieren, keine Kürzung, keine neuen Sätze. Du gestaltest nur.

ERLAUBTE ELEMENTE: svg, g, rect, circle, ellipse, line, path, polyline, polygon, text, image. KEINE style-Blöcke, KEIN <foreignObject>, KEIN Filter, KEIN Skript, KEINE externen Verweise (außer den IMG:-Platzhaltern).

Gib AUSSCHLIESSLICH das SVG aus — beginnend mit <svg und endend mit </svg>. Kein Markdown, keine Erklärung.`
}

// SVG der KI → echtes DOM-SVG, Bilder eingesetzt, Text umbrochen.
// `images` = { "si:ti": dataURL }
function prepareSvg(svgText, images, doc) {
  const clean = String(svgText || '').trim().replace(/^```(?:svg|xml)?/i, '').replace(/```$/, '').trim()
  const start = clean.indexOf('<svg')
  const end = clean.lastIndexOf('</svg>')
  if (start < 0 || end < 0) throw new Error('Die KI hat kein SVG geliefert.')
  const src = clean.slice(start, end + 6)

  const parsed = new DOMParser().parseFromString(src, 'image/svg+xml')
  if (parsed.querySelector('parsererror')) throw new Error('Das SVG der KI ist fehlerhaft.')
  const svg = parsed.documentElement

  // ── Bilder bändigen ──
  // Zwei Dinge zwingend geradeziehen:
  //  1. Breite deckeln (das Modell setzt gelegentlich ein Bild über das halbe Blatt).
  //  2. preserveAspectRatio auf "none": svg2pdf setzt ein Bild mit "…slice" in
  //     seiner NATÜRLICHEN Pixelgröße ins PDF — ein 1536-px-Bild deckte damit das
  //     halbe Poster zu. Die Illustrationen sind exakt 3:2, die Rahmen ebenfalls,
  //     also verzerrt "none" nichts.
  for (const img of [...svg.querySelectorAll('image')]) {
    let w = parseFloat(img.getAttribute('width') || '0')
    if (!(w > 0)) w = 60
    if (w > 130) w = 130
    img.setAttribute('width', String(w))
    img.setAttribute('height', String(Math.round((w / 1.5) * 100) / 100))
    img.setAttribute('preserveAspectRatio', 'none')
  }

  // ── Auf Millimeter normalisieren ──
  // Trotz klarer Vorgabe arbeitet die KI gern in Pixeln (viewBox z. B.
  // "0 0 1600 1131"). Würden wir die viewBox einfach auf 594×420 setzen, läge der
  // Inhalt weit außerhalb — man sähe nur die linke obere Ecke. Also: vorhandene
  // viewBox lesen, den Inhalt in eine skalierte Gruppe hängen und DANN das Blatt
  // auf A2 in mm festlegen. Der Skalierungsfaktor gilt auch für den Textumbruch.
  const vb = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number)
  let vbW = vb.length === 4 && vb[2] > 0 ? vb[2] : parseFloat(svg.getAttribute('width')) || P.W
  let vbH = vb.length === 4 && vb[3] > 0 ? vb[3] : parseFloat(svg.getAttribute('height')) || P.H

  // Selbst mit korrekter viewBox schreibt das Modell Elemente über den Blattrand
  // hinaus. Deshalb messen wir die TATSÄCHLICHE Ausdehnung des Inhalts (Attribute
  // + Pfadkoordinaten) und rechnen damit — so passt das Blatt am Ende immer.
  const extent = svgExtent(svg)
  if (extent.maxX > vbW * 1.02) vbW = extent.maxX
  if (extent.maxY > vbH * 1.02) vbH = extent.maxY

  const scale = Math.min(P.W / vbW, P.H / vbH)
  if (Math.abs(scale - 1) > 0.001) {
    const g = parsed.createElementNS(SVG_NS, 'g')
    g.setAttribute('transform', `scale(${scale})`)
    while (svg.firstChild) g.appendChild(svg.firstChild)
    svg.appendChild(g)
  }
  svg.setAttribute('viewBox', `0 0 ${P.W} ${P.H}`)
  svg.setAttribute('width', String(P.W))
  svg.setAttribute('height', String(P.H))
  svg.removeAttribute('preserveAspectRatio')

  // Sicherheit: nur erlaubte Elemente behalten (kein Skript, kein externer Verweis).
  const ALLOWED = new Set(['svg', 'g', 'rect', 'circle', 'ellipse', 'line', 'path', 'polyline', 'polygon', 'text', 'tspan', 'image', 'defs', 'title', 'desc'])
  for (const el of [...svg.querySelectorAll('*')]) {
    if (!ALLOWED.has(el.tagName.toLowerCase())) el.remove()
  }

  // Bilder NICHT von svg2pdf zeichnen lassen: Es ignoriert width/height eines
  // <image> und setzt die Datei in ihrer natürlichen Pixelgröße ins PDF — ein
  // 1536-px-Bild deckte damit das halbe Poster zu. Wir sammeln die Bilder mit
  // ihren SVG-Maßen ein, entfernen die Elemente und zeichnen sie anschließend
  // selbst mit jsPDF (unter die Vektorebene).
  const placed = []
  for (const img of [...svg.querySelectorAll('image')]) {
    const href = img.getAttribute('href') || img.getAttribute('xlink:href') || ''
    const m = /^IMG:(\d+):(\d+)$/.exec(href.trim())
    const data = m ? images[`${m[1]}:${m[2]}`] : null
    const x = parseFloat(img.getAttribute('x') || '0')
    const y = parseFloat(img.getAttribute('y') || '0')
    const w = parseFloat(img.getAttribute('width') || '0')
    const h = parseFloat(img.getAttribute('height') || '0')
    if (data && w > 0 && h > 0) placed.push({ data, x: x * scale, y: y * scale, w: w * scale, h: h * scale })
    img.remove()
  }

  // Zeilenumbruch: <text data-w="…"> → tspans, gemessen mit der PDF-Schrift.
  for (const t of [...svg.querySelectorAll('text[data-w]')]) {
    const w = parseFloat(t.getAttribute('data-w'))
    const size = parseFloat(t.getAttribute('font-size') || '4')
    const fam = (t.getAttribute('font-family') || 'helvetica').includes('times') ? 'times' : 'helvetica'
    const bold = (t.getAttribute('font-weight') || '').toString() === 'bold' || Number(t.getAttribute('font-weight')) >= 600
    const italic = (t.getAttribute('font-style') || '') === 'italic'
    const content = (t.textContent || '').replace(/\s+/g, ' ').trim()
    if (!content || !(w > 0)) continue

    // Gemessen wird im PDF (Millimeter). Arbeitet das SVG in anderen Einheiten,
    // müssen Schriftgröße und Breite erst mit demselben Faktor umgerechnet werden,
    // mit dem der Inhalt später skaliert wird — sonst bricht der Text falsch um.
    doc.setFont(fam, bold ? 'bold' : (italic ? 'italic' : 'normal'))
    doc.setFontSize(size * scale)
    const lines = doc.splitTextToSize(content, w * scale).map(l => l)
    const x = t.getAttribute('x') || '0'
    while (t.firstChild) t.removeChild(t.firstChild)
    lines.forEach((line, i) => {
      const ts = parsed.createElementNS(SVG_NS, 'tspan')
      ts.setAttribute('x', x)
      if (i > 0) ts.setAttribute('dy', String(size * 1.25))
      ts.textContent = line
      t.appendChild(ts)
    })
  }
  // Das vollflächige Papier-Rechteck muss VOR den Bildern liegen — svg2pdf malt
  // die Vektorebene aber ZULETZT und würde die Illustrationen sonst zudecken.
  // Also: Papierfarbe herausziehen, Rechteck entfernen, Papier selbst zeichnen.
  let paper = null
  for (const r of [...svg.querySelectorAll('rect')]) {
    const w = parseFloat(r.getAttribute('width') || '0')
    const h = parseFloat(r.getAttribute('height') || '0')
    if (w >= vbW * 0.97 && h >= vbH * 0.97) {
      paper = r.getAttribute('fill') || null
      r.remove()
      break
    }
  }
  return { svg, placed, paper }
}

// Rendert das KI-SVG als Vektor-PDF (A2 quer). `urls` = { "si:ti": signierte URL }
export async function downloadPosterSvgPdf(filename, svgText, urls = {}) {
  const images = {}
  await Promise.all(Object.entries(urls).map(async ([k, url]) => {
    if (!url) return
    try { const im = await loadImage(url); images[k] = im.data } catch { /* Bild fällt weg */ }
  }))

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [P.W, P.H] })
  const { svg, placed, paper } = prepareSvg(svgText, images, doc)

  // Reihenfolge: Papier, dann die Illustrationen (Pixel), dann die Vektorebene
  // (Wege, Bänder, Schrift) darüber.
  if (paper) { doc.setFillColor(paper); doc.rect(0, 0, P.W, P.H, 'F') }
  for (const im of placed) {
    try { doc.addImage(im.data, 'PNG', im.x, im.y, im.w, im.h, undefined, 'FAST') } catch { /* Bild überspringen */ }
  }

  // svg2pdf braucht das Element im Dokument (Layout-Messung).
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:594mm;height:420mm;'
  host.appendChild(svg)
  document.body.appendChild(host)
  try {
    // Gezielt den ESM-Build laden: Die Paket-Auflösung liefert sonst je nach
    // Umgebung das UMD-Bündel, dessen Default-Export kein Aufruf-Ziel ist.
    const { svg2pdf } = await import('svg2pdf.js/dist/svg2pdf.es.js')
    await svg2pdf(svg, doc, { x: 0, y: 0, width: P.W, height: P.H })
    doc.save(filename)
  } finally {
    host.remove()
  }
}

// ════════════════════════════════════════════════════════════════
// 4) POSTER ALS ILLUSTRIERTES BLATT (Szene + Vektortext)
// ════════════════════════════════════════════════════════════════
//
// Die Vorbilder (NotebookLM-Infografiken) sind EIN großes KI-Bild — deshalb sehen
// sie so üppig aus, und deshalb steht darin „Goburt in Segen". Wir nehmen die
// Optik, nicht den Fehler: Die Bild-KI malt das ganze Blatt (mäandernder Weg,
// Szenen, warmes Papier) und lässt dabei bewusst RUHIGE FLÄCHEN frei; der Text
// kommt als Vektor darüber. Wo genau, entscheidet keine Vermutung, sondern eine
// Analyse des fertigen Bildes: Wir messen die Detaildichte je Rasterzelle und
// setzen jede Beschriftung in die ruhigste Zelle in ihrer Nähe.

// Motiv-Prompt fürs Gesamtblatt: aus den Stationen destilliert.
export function posterSceneSystem(data) {
  const st = []
  ;(data.sections || []).forEach(sec => (sec.stations || []).forEach(s => {
    if (s.image_prompt) st.push(String(s.image_prompt))
  }))
  const scenes = st.slice(0, 12).map((s, i) => `${i + 1}. ${s}`).join('\n')
  return `Du bist Illustrator. Beschreibe EIN einziges, weites Illustrationsblatt (Lebenskarte) in ENGLISCH — es zeigt den Lebensweg als mäandernden Pfad, an dem die folgenden Szenen liegen (in dieser Reihenfolge, von links unten nach rechts oben):

${scenes}

Gib NUR die englische Bildbeschreibung aus (60–110 Wörter), keine Erklärung, kein Markdown, KEINE Anführungszeichen.

Regeln:
- Beschreibe den Weg und die Szenen entlang des Weges, ihre Anordnung und die Atmosphäre.
- Verlange ausdrücklich große, ruhige, leere Papierflächen zwischen und um die Szenen (dort wird später Text gedruckt).
- KEIN Text im Bild, keine Schrift, keine Zahlen, keine Schilder.
- Keine Gesichter, keine Porträts.
- Nenne kein Medium und keinen Kunststil (der kommt separat).`
}

// Detaildichte je Rasterzelle: viel Kontrast = Bild, wenig = ruhige Fläche.
function densityGrid(imgEl, cols, rows) {
  const W = 240, H = Math.round(W * (imgEl.naturalHeight / imgEl.naturalWidth))
  const cv = document.createElement('canvas')
  cv.width = W; cv.height = H
  const ctx = cv.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(imgEl, 0, 0, W, H)
  const { data } = ctx.getImageData(0, 0, W, H)
  const grid = []
  for (let r = 0; r < rows; r++) {
    grid.push([])
    for (let c = 0; c < cols; c++) {
      const x0 = Math.floor(c * W / cols), x1 = Math.floor((c + 1) * W / cols)
      const y0 = Math.floor(r * H / rows), y1 = Math.floor((r + 1) * H / rows)
      let sum = 0, n = 0
      for (let y = y0; y < y1; y++) {
        for (let x = x0 + 1; x < x1; x++) {
          const i = (y * W + x) * 4, j = (y * W + x - 1) * 4
          const l1 = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
          const l0 = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2]
          sum += Math.abs(l1 - l0); n++
        }
      }
      grid[r].push(n ? sum / n : 0)
    }
  }
  return grid
}

const SCENE = { cols: 6, rows: 5, margin: 16, headH: 44, footH: 22 }

// Zellen belegen: Jede Station bekommt die ruhigste noch freie Zelle möglichst
// nahe ihrer chronologischen Spalte — so bleibt die Leserichtung erhalten, ohne
// dass Text auf einer Illustration landet.
function placeLabels(grid, count, cols, rows, used) {
  const out = []
  for (let i = 0; i < count; i++) {
    const wantCol = Math.min(cols - 1, Math.floor(i * cols / count))
    let best = null
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (used.has(`${r}:${c}`)) continue
        // Ruhe + Nähe zur Wunschspalte (Detaildichte zählt stärker)
        const score = grid[r][c] + Math.abs(c - wantCol) * 3.5
        if (!best || score < best.score) best = { r, c, score }
      }
    }
    if (!best) break
    used.add(`${best.r}:${best.c}`)
    out.push(best)
  }
  return out
}


// ── Szenen im Bild FINDEN statt raten ─────────────────────────────
// Die KI-Verortung („in welcher Zelle liegt Szene 3?") war unzuverlässig, und
// eine „ruhigste Zelle" gibt es nicht mehr, seit das Blatt voll bespielt ist.
// Also messen wir selbst: Das Bild wird in ein feines Raster zerlegt, jede Zelle
// bekommt ihre Detaildichte. Zusammenhängende dichte Zellen = eine Szene, ruhige
// Zellen = die Papiergassen. Weil der Bild-Prompt die Szenen in LESERICHTUNG
// anordnen lässt, ist die i-te gefundene Szene die i-te Station — ohne Raten.
const GRID_COLS = 48, GRID_ROWS = 34

function densityMap(imgEl) {
  const W = GRID_COLS * 8, H = Math.round(W * (imgEl.naturalHeight / imgEl.naturalWidth))
  const cv = document.createElement('canvas')
  cv.width = W; cv.height = H
  const ctx = cv.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(imgEl, 0, 0, W, H)
  const { data } = ctx.getImageData(0, 0, W, H)
  const g = []
  for (let r = 0; r < GRID_ROWS; r++) {
    g.push([])
    for (let c = 0; c < GRID_COLS; c++) {
      const x0 = Math.floor(c * W / GRID_COLS), x1 = Math.floor((c + 1) * W / GRID_COLS)
      const y0 = Math.floor(r * H / GRID_ROWS), y1 = Math.floor((r + 1) * H / GRID_ROWS)
      let sum = 0, n = 0
      for (let y = y0; y < y1; y++) {
        for (let x = x0 + 1; x < x1; x++) {
          const i = (y * W + x) * 4, j = (y * W + x - 1) * 4
          const l1 = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
          const l0 = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2]
          sum += Math.abs(l1 - l0); n++
        }
      }
      g[r].push(n ? sum / n : 0)
    }
  }
  return g
}

// Zusammenhängende dichte Bereiche = Szenen. Sortiert in Leserichtung (zeilenweise).
function findScenes(grid) {
  const vals = grid.flat().slice().sort((a, b) => a - b)
  const thr = vals[Math.floor(vals.length * 0.45)] * 1.6 + 1.5   // „deutlich mehr als ruhig"
  const seen = Array.from({ length: GRID_ROWS }, () => new Array(GRID_COLS).fill(false))
  const blobs = []
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      if (seen[r][c] || grid[r][c] < thr) continue
      const stack = [[r, c]]; seen[r][c] = true
      let minR = r, maxR = r, minC = c, maxC = c, n = 0
      while (stack.length) {
        const [y, x] = stack.pop(); n++
        minR = Math.min(minR, y); maxR = Math.max(maxR, y)
        minC = Math.min(minC, x); maxC = Math.max(maxC, x)
        for (const [dy, dx] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ny = y + dy, nx = x + dx
          if (ny < 0 || nx < 0 || ny >= GRID_ROWS || nx >= GRID_COLS) continue
          if (seen[ny][nx] || grid[ny][nx] < thr) continue
          seen[ny][nx] = true; stack.push([ny, nx])
        }
      }
      if (n >= 6) blobs.push({ minR, maxR, minC, maxC, n })   // Rauschen verwerfen
    }
  }
  // Leserichtung: nach Zeilenband, darin nach x
  const bandH = 6
  blobs.sort((a, b) => {
    const ba = Math.floor(((a.minR + a.maxR) / 2) / bandH)
    const bb = Math.floor(((b.minR + b.maxR) / 2) / bandH)
    return ba !== bb ? ba - bb : ((a.minC + a.maxC) / 2) - ((b.minC + b.maxC) / 2)
  })
  return blobs
}

// Freier Platz für eine Beschriftung: unter, über, links oder rechts der Szene —
// derjenige Kandidat mit der geringsten Detaildichte gewinnt, belegte Plätze sind
// gesperrt. So steht der Text IMMER in einer Papiergasse an seiner Szene.
function captionSpot(grid, blob, taken, W, H) {
  const cw = W / GRID_COLS, ch = H / GRID_ROWS
  const cx = ((blob.minC + blob.maxC) / 2 + 0.5) * cw
  const cands = [
    { x: cx, y: (blob.maxR + 2.2) * ch, cells: [[blob.maxR + 1, blob.minC, blob.maxC], [blob.maxR + 2, blob.minC, blob.maxC]] },
    { x: cx, y: (blob.minR - 1.6) * ch, cells: [[blob.minR - 1, blob.minC, blob.maxC], [blob.minR - 2, blob.minC, blob.maxC]] },
    { x: (blob.minC - 2.5) * cw, y: ((blob.minR + blob.maxR) / 2 + 0.5) * ch, cells: [[Math.round((blob.minR + blob.maxR) / 2), blob.minC - 3, blob.minC - 1]] },
    { x: (blob.maxC + 3.5) * cw, y: ((blob.minR + blob.maxR) / 2 + 0.5) * ch, cells: [[Math.round((blob.minR + blob.maxR) / 2), blob.maxC + 1, blob.maxC + 3]] },
  ]
  let best = null
  for (const c of cands) {
    if (c.y < 34 || c.y > H - 8 || c.x < 25 || c.x > W - 25) continue
    let dens = 0, n = 0, blocked = false
    for (const [r, c0, c1] of c.cells) {
      if (r < 0 || r >= GRID_ROWS) { blocked = true; break }
      for (let cc = Math.max(0, c0); cc <= Math.min(GRID_COLS - 1, c1); cc++) {
        if (taken.has(`${r}:${cc}`)) { blocked = true; break }
        dens += grid[r][cc]; n++
      }
      if (blocked) break
    }
    if (blocked || !n) continue
    const score = dens / n
    if (!best || score < best.score) best = { ...c, score }
  }
  if (!best) return null
  for (const [r, c0, c1] of best.cells) {
    for (let cc = Math.max(0, c0); cc <= Math.min(GRID_COLS - 1, c1); cc++) taken.add(`${r}:${cc}`)
  }
  return best
}

// Das gemalte Schild einer Station als Rechteck in mm — oder null, wenn die
// Angabe unbrauchbar ist. Geprüft wird beides: die Maße (ein Schild ist ein
// liegender Streifen, kein halbes Blatt) und der BILDINHALT an dieser Stelle. Das
// feine Detaildichte-Raster (`bg.grid`) verrät, ob dort wirklich eine ruhige Fläche
// liegt; ein Schild ist per Definition leer. Greift das Modell daneben, fällt die
// Beschriftung auf die bisherige Kartuschen-Logik zurück, statt im Motiv zu landen.
function plaqueRect(loc, bg) {
  const { W, H } = P
  const num = v => (Number.isFinite(v) ? v : NaN)
  let x = num(loc.x), y = num(loc.y), w = num(loc.w), h = num(loc.h)
  if ([x, y, w, h].some(Number.isNaN)) return null
  if (w <= 0.02 || h <= 0.012 || w > 0.42 || h > 0.16) return null      // kein Schild
  if (x < 0 || y < 0 || x + w > 1 || y + h > 1) return null

  // 1) Ist an der gemeldeten Stelle wirklich ein Schild? Geprüft wird das GEMALTE
  //    Rechteck (nicht das später vergrößerte): Ein Schild ist eine ruhige, leere
  //    Fläche. Liegt dort Motiv, hat das Modell danebengegriffen.
  const px = x * W, py = y * H, pw = w * W, ph = h * H
  const rows = bg.grid.length, cols = bg.grid[0].length
  let sum = 0, n = 0
  for (let r = Math.floor(py / H * rows); r <= Math.min(rows - 1, Math.floor((py + ph) / H * rows)); r++) {
    for (let c = Math.floor(px / W * cols); c <= Math.min(cols - 1, Math.floor((px + pw) / W * cols)); c++) {
      if (r < 0 || c < 0) continue
      sum += bg.grid[r][c]; n++
    }
  }
  if (!n) return null
  const all = bg.grid.flat().slice().sort((a, b) => a - b)
  const calm = all[Math.floor(all.length * 0.5)] * 2.2 + 3   // „ruhiger als der Rest"
  if (sum / n > calm) return null                            // dort ist Motiv, kein Schild

  // 2) LESBARKEIT GEHT VOR TREUE ZUM SCHILD: Der Text wird nicht in das gemalte
  //    Schild gezwängt — das Schild sagt nur, WO er hingehört. Darüber liegt eine
  //    eigene Kartusche in fester Mindestgröße, mittig auf dem Schild.
  const MIN_W = 54, MIN_H = 17
  const rw = Math.max(MIN_W, pw), rh = Math.max(MIN_H, ph)
  const rx = Math.max(4, Math.min(W - rw - 4, px + pw / 2 - rw / 2))
  const ry = Math.max(P.margin, Math.min(H - rh - 4, py + ph / 2 - rh / 2))
  return { x: rx, y: ry, w: rw, h: rh }
}

function paintPosterScene(d, data, bg, st) {
  const { W, H } = P
  const stations = []
  ;(data.sections || []).forEach((sec, si) => (sec.stations || []).forEach((s, ti) =>
    stations.push({ ...s, si, ti, color: st.accents[si % st.accents.length], first: ti === 0, section: sec })))

  // Bild full-bleed (cover-fit, nie verzerrt)
  const sc = Math.max(W / bg.w, H / bg.h)
  d.image(bg.data, (W - bg.w * sc) / 2, (H - bg.h * sc) / 2, bg.w * sc, bg.h * sc)

  // Kopf: NUR Name und Lebensspanne, groß, OHNE Kasten. Ein Poster braucht keine
  // Buchtitelei — der Name trägt es.
  // Titel-Kartusche: Der Name lag bisher direkt auf dem Motiv (und damit auf dem
  // gezeichneten Kartenrahmen). Jetzt trägt ihn ein eigenes Papierfeld.
  const who = String(data.person?.name || '').trim()
  if (who) {
    const tw = Math.min(W - 80, 18 + who.length * 7.2)
    d.bubble((W - tw) / 2, 9, tw, 22, st.paper, st.accents[0], 0.92)
    d.text(who, W / 2, 24, { size: 26, bold: true, align: 'center', color: st.ink, font: st.heading, maxW: tw - 10, maxLines: 1 })
  }

  // Beschriftungen als KARTUSCHEN: Das Blatt ist vollflächig illustriert — es gibt
  // keine freien Papiergassen mehr. Statt Schrift ins Motiv zu legen (unlesbar),
  // bekommt jede Station ein kleines Papierfeld, gesetzt an die RUHIGSTE Stelle in
  // ihrer Umgebung. Die Chronologie steuert grob die Spalte, damit die Reihenfolge
  // von links nach rechts lesbar bleibt.
  const cellW = (W - 2 * SCENE.margin) / SCENE.cols
  const cellH = (H - SCENE.headH - SCENE.footH) / SCENE.rows
  const used = new Set()
  const spots = placeLabels(bg.grid2, stations.length, SCENE.cols, SCENE.rows, used)

  // Wo liegt die Szene? `scene_spots` kommt aus der Bildanalyse beim Erzeugen
  // (8×6-Raster). Die Kartusche wird dann DIREKT AN dieser Szene abgesetzt —
  // in die ruhigste der vier Positionen darum. Ohne Verortung bleibt es bei der
  // ruhigsten freien Zelle (Rückfall).
  const spotMap = new Map((data.scene_spots || []).map(x => [Number(x.i), x]))
  const gCols = bg.grid2[0].length, gRows = bg.grid2.length

  stations.forEach((s2, i) => {
    const bw = Math.min(cellW - 4, 62)
    const bh = s2.year ? 17 : 12
    let bx, by
    const loc = spotMap.get(i)

    // BESTER FALL: Die Bild-KI hat an der Szene ein LEERES SCHILD mitgemalt, und die
    // Bildanalyse hat es vermessen (relative Koordinaten). Dann steht der Text nicht
    // irgendwo auf dem Motiv, sondern in einer Fläche, die eigens dafür da ist — und
    // gehört sichtbar zu SEINER Szene. Vertraut wird der Angabe nur, wenn dort auch
    // wirklich eine ruhige Fläche liegt (sonst hat das Modell danebengegriffen).
    if (loc && plaqueRect(loc, bg)) {
      const r = plaqueRect(loc, bg)
      // Der Text steht NICHT im gemalten Schild — das Schild sagt nur, WO er
      // hingehört. Darüber liegt eine eigene Kartusche in fester, lesbarer Größe.
      // (Vorher habe ich die Schrift auf die Schildhöhe skaliert; malte die KI ein
      // Mini-Schild, wurde die Beschriftung mikroskopisch und klebte im Motiv.)
      d.bubble(r.x, r.y, r.w, r.h, st.paper, s2.color, 0.93)
      let ty = r.y + 6.5
      if (s2.year) {
        d.text(String(s2.year), r.x + r.w / 2, ty, { size: 10, bold: true, align: 'center', color: s2.color, font: st.heading, maxW: r.w - 4, maxLines: 1 })
        ty += 5.5
      }
      d.text(String(s2.title || ''), r.x + r.w / 2, ty, { size: 8.5, bold: true, align: 'center', color: st.ink, font: st.heading, maxW: r.w - 4, maxLines: 2 })
      return
    }

    if (loc && Number.isFinite(loc.col) && Number.isFinite(loc.row)) {
      const sx = (Math.min(7, Math.max(0, loc.col)) + 0.5) / 8 * W
      const sy = (Math.min(5, Math.max(0, loc.row)) + 0.5) / 6 * H
      const cands = [
        { x: sx - bw / 2, y: sy + 20 }, { x: sx - bw / 2, y: sy - 20 - bh },
        { x: sx - bw - 12, y: sy - bh / 2 }, { x: sx + 12, y: sy - bh / 2 },
      ]
      let best = null
      for (const c of cands) {
        const x = Math.max(6, Math.min(W - bw - 6, c.x))
        const y = Math.max(SCENE.headH + 4, Math.min(H - bh - 6, c.y))
        const gc = Math.min(gCols - 1, Math.max(0, Math.floor((x + bw / 2) / W * gCols)))
        const gr = Math.min(gRows - 1, Math.max(0, Math.floor((y + bh / 2) / H * gRows)))
        const key = `${gr}:${gc}`
        const score = bg.grid2[gr][gc] + (used.has(key) ? 60 : 0)
        if (!best || score < best.score) best = { x, y, score, key }
      }
      used.add(best.key)
      bx = best.x; by = best.y
    } else {
      const spot = spots[i]
      if (!spot) return
      bx = Math.max(6, Math.min(W - bw - 6, SCENE.margin + spot.c * cellW + (cellW - bw) / 2))
      by = Math.max(SCENE.headH + 4, Math.min(H - bh - 6, SCENE.headH + spot.r * cellH + (cellH - bh) / 2))
    }

    d.bubble(bx, by, bw, bh, st.paper, s2.color)
    let ty = by + 6.5
    if (s2.year) {
      d.text(String(s2.year), bx + bw / 2, ty, { size: 10, bold: true, align: 'center', color: s2.color, font: st.heading, maxW: bw - 4, maxLines: 1 })
      ty += 5.5
    }
    d.text(String(s2.title || ''), bx + bw / 2, ty, { size: 8.5, bold: true, align: 'center', color: st.ink, font: st.heading, maxW: bw - 4, maxLines: 2 })
  })
}

// `sceneUrl` = signierte URL des Gesamtbildes.
export async function downloadPosterScenePdf(filename, data, sceneUrl, styleKey) {
  const st = getPosterStyle(styleKey || data?.style)
  const img = await loadImage(sceneUrl)
  const el = await new Promise((res, rej) => {
    const im = new Image()
    im.onload = () => res(im); im.onerror = () => rej(new Error('Motiv konnte nicht gelesen werden.'))
    im.src = img.data
  })
  // grid  = feines Raster (Szenen-Erkennung), grid2 = grobes Raster (Kartuschen-Plätze)
  const grid = densityMap(el)
  const grid2 = densityGrid(el, SCENE.cols, SCENE.rows)
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [P.W, P.H] })
  paintPosterScene(pdfDraw(doc), data || {}, { data: img.data, w: img.w, h: img.h, grid, grid2 }, st)
  doc.save(filename)
}

// ════════════════════════════════════════════════════════════════
// 6) VORSCHAU + DOWNLOAD je Stil (ein gemaltes Blatt, Text als Vektor)
// ════════════════════════════════════════════════════════════════
//
// Zwischendurch hat das Layout das Blatt aus EINZELN gezeichneten Szenen selbst
// zusammengesetzt. Der Text saß damit garantiert richtig — aber das Blatt sah aus
// wie ein Kontaktbogen: Der geschwungene Weg und die freie, wilde Anordnung
// entstehen nur, wenn die Bild-KI das ganze Blatt in einem Zug malt. Also wieder
// EIN Motiv je Stil (`variants[].scene_path`), Beschriftung als Vektor darüber
// (Bildmodelle verschreiben sich). Wo die Szenen liegen, hat der Worker beim
// Erzeugen ausgemessen (`scene_spots`) — daran hängen die Kartuschen.

// Bild als Element (für die Bildanalyse und die Leinwand-Vorschau).
async function toImageEl(dataUrl) {
  return await new Promise((res, rej) => {
    const im = new Image()
    im.onload = () => res(im)
    im.onerror = () => rej(new Error('Motiv konnte nicht gelesen werden.'))
    im.src = dataUrl
  })
}

// Zeichenbackend für die Bildschirm-Vorschau: dieselbe Malfunktion wie fürs PDF,
// anderes Ziel. So zeigt die Detailansicht exakt das, was heruntergeladen wird.
function canvasDraw(ctx, s, imgEl) {
  const col = c => `rgb(${c[0]},${c[1]},${c[2]})`
  const setFont = o => {
    const px = (o.size || 10) * 0.3528 * s
    const fam = o.font === 'times' ? 'Georgia, "Times New Roman", serif' : 'Helvetica, Arial, sans-serif'
    ctx.font = `${o.bold ? '700 ' : o.italic ? 'italic ' : ''}${px}px ${fam}`
  }
  const wrap = (str, o) => {
    if (!o.maxW) return [String(str)]
    const words = String(str).split(/\s+/)
    const lines = []; let cur = ''
    for (const w of words) {
      const t = cur ? `${cur} ${w}` : w
      if (!cur || ctx.measureText(t).width <= o.maxW * s) cur = t
      else { lines.push(cur); cur = w }
    }
    if (cur) lines.push(cur)
    return lines
  }
  const roundRect = (x, y, w, h, r) => {
    ctx.beginPath()
    ctx.moveTo((x + r) * s, y * s)
    ctx.arcTo((x + w) * s, y * s, (x + w) * s, (y + h) * s, r * s)
    ctx.arcTo((x + w) * s, (y + h) * s, x * s, (y + h) * s, r * s)
    ctx.arcTo(x * s, (y + h) * s, x * s, y * s, r * s)
    ctx.arcTo(x * s, y * s, (x + w) * s, y * s, r * s)
    ctx.closePath()
  }
  return {
    rect(x, y, w, h, c, alpha) {
      ctx.save()
      if (alpha != null) ctx.globalAlpha = alpha
      ctx.fillStyle = col(c)
      ctx.fillRect(x * s, y * s, w * s, h * s)
      ctx.restore()
    },
    image(_data, x, y, w, h) { ctx.drawImage(imgEl, x * s, y * s, w * s, h * s) },
    bubble(x, y, w, h, fill, edge, alpha = 0.88) {
      ctx.save()
      ctx.globalAlpha = alpha
      ctx.fillStyle = col(fill)
      ctx.strokeStyle = col(edge)
      ctx.lineWidth = 0.4 * s
      roundRect(x, y, w, h, 2.4)
      ctx.fill(); ctx.stroke()
      ctx.restore()
    },
    text(str, x, y, o = {}) {
      setFont(o)
      ctx.fillStyle = col(o.color || [0, 0, 0])
      ctx.textAlign = o.align || 'left'
      ctx.textBaseline = 'alphabetic'
      const lines = wrap(str, o).slice(0, o.maxLines || 99)
      const lh = (o.size || 10) * 0.3528 * 1.25
      lines.forEach((ln, i) => ctx.fillText(ln, x * s, (y + i * lh) * s))
      return lines.length * lh
    },
  }
}

// Motiv + Bildanalyse einer Variante laden (beides brauchen Vorschau und PDF).
async function loadSheet(data, variant) {
  const url = variant?.scene_url || data?.scene_url
  if (!url) throw new Error('Das Poster-Motiv konnte nicht geladen werden — bitte die Seite neu laden.')
  const img = await loadImage(url)
  const el = await toImageEl(img.data)
  return {
    bg: { data: img.data, w: img.w, h: img.h, grid: densityMap(el), grid2: densityGrid(el, SCENE.cols, SCENE.rows) },
    el,
    data: { ...data, scene_spots: variant?.scene_spots || data?.scene_spots },
  }
}

export async function renderPosterPreview(data, variant, styleKey, pxPerMm = 2.6) {
  const st = getPosterStyle(styleKey || variant?.style || data?.style)
  const sheet = await loadSheet(data, variant)
  const cv = document.createElement('canvas')
  cv.width = Math.round(P.W * pxPerMm)
  cv.height = Math.round(P.H * pxPerMm)
  paintPosterScene(canvasDraw(cv.getContext('2d'), pxPerMm, sheet.el), sheet.data, sheet.bg, st)
  return cv.toDataURL('image/jpeg', 0.88)
}

export async function downloadPosterVariantPdf(filename, data, variant, styleKey) {
  const st = getPosterStyle(styleKey || variant?.style || data?.style)
  const sheet = await loadSheet(data, variant)
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [P.W, P.H] })
  paintPosterScene(pdfDraw(doc), sheet.data, sheet.bg, st)
  doc.save(filename)
}
