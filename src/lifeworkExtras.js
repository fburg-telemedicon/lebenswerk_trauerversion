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
    key: 'editorial',
    label: 'Editorial & klar',
    description: 'Helles Papier, kräftige Farbflächen, serifenlose Typografie – ruhig, modern, aufgeräumt.',
    paper: [250, 249, 246], ink: [24, 24, 27], soft: [113, 113, 122],
    accents: [[220, 90, 60], [34, 110, 120], [45, 90, 160], [230, 160, 40], [120, 80, 160], [60, 130, 90]],
    heading: 'helvetica', body: 'helvetica', titleUpper: true,
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
    key: 'bauhaus',
    label: 'Geometrisch & grafisch',
    description: 'Reduzierte Formen, kräftige Grundfarben, strenge Typografie – ein Plakat, kein Album.',
    paper: [244, 241, 234], ink: [20, 20, 20], soft: [110, 110, 110],
    accents: [[214, 69, 47], [37, 84, 150], [240, 178, 30], [40, 40, 40], [46, 128, 108], [150, 62, 120]],
    heading: 'helvetica', body: 'helvetica', titleUpper: true,
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
          "image_prompt": "English, 8-16 words: ONE single concrete object or small scene symbolising this station (e.g. a red brick bakery shop front; an old steam locomotive; a nurse cap with a stethoscope). No faces, no portraits, no text."
        }
      ]
    }
  ],
  "values": ["Wert, max. 2 Wörter"],
  "places": ["Ort"],
  "quote": "EIN Satz der Person, wörtlich oder sehr nah am Wortlaut, max. 18 Wörter"
}

Regeln zum AUFBAU:
- "sections": 4–6 Lebensabschnitte, CHRONOLOGISCH (z. B. Wurzeln & Kindheit, Jugend & Ausbildung, Beruf, Familie & Liebe, Späte Jahre, Werte & Vermächtnis).
- Jeder Abschnitt hat 3–4 "stations" — insgesamt 14–20 Stationen. Nicht mehr, sonst wird das Poster unlesbar.
- "image_prompt" ist das Herz der Grafik: EIN klar erkennbares Symbol, kein Wimmelbild, KEINE Gesichter/Porträts (die Illustration steht frei auf dem Papier). Denke in Gegenständen und Orten: Werkstatt, Akkordeon, Fahrrad, Klinikflur, Kirchturm, Küchentisch, Koffer, Garten.
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

  stations.forEach((s, i) => {
    const lane = Math.floor(i / perLane)
    const idxInLane = i % perLane
    const pos = lane % 2 === 0 ? idxInLane : (perLane - 1 - idxInLane)  // Serpentine
    s.lane = lane
    s.cx = P.margin + pos * cellW + cellW / 2
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
  const py = s => s.cy - 8
  for (let i = 0; i < L.stations.length - 1; i++) {
    const a = L.stations[i], b = L.stations[i + 1]
    if (a.lane === b.lane) {
      d.thickLine(a.cx, py(a), b.cx, py(b), a.color, 2.4)
    } else {
      // Bahnwechsel: am Blattrand herumschwingen
      const edge = (a.lane % 2 === 0) ? W - margin + 6 : margin - 6
      d.thickLine(a.cx, py(a), edge, py(a), a.color, 2.4)
      d.thickLine(edge, py(a), edge, py(b), a.color, 2.4)
      d.thickLine(edge, py(b), b.cx, py(b), b.color, 2.4)
    }
  }

  // ── Stationen ──
  for (const s of L.stations) {
    const img = images[`${s.si}:${s.ti}`]
    const vign = Math.min(36, s.cellW * 0.66)
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
  paintPoster(pdfDraw(doc), data || {}, images, st)
  doc.save(filename)
}
