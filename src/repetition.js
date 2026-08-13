// src/repetition.js
// Deterministische Wiederholungsprüfung über die FERTIGEN Kapitel eines Buches.
// Ohne KI, ohne Kosten, immer reproduzierbar.
//
// ── Warum es das braucht ──────────────────────────────────────────
// Jedes Kapitel entsteht in einem eigenen KI-Aufruf, und jeder dieser Aufrufe
// sieht ALLE Beiträge. Die Gliederung verteilt den Stoff zwar (owns-Listen,
// categories.js), aber am Ende prüfte niemand nach, ob sich ein Motiv doch in
// mehrere Kapitel geschlichen hat. Im Lutherhof-Jubiläumsbuch hat GENAU EINE
// Person die gehäkelten Topflappen erzählt — im Buch standen sie in 12 von 22
// Kapiteln, und die Begrüßungsformel „Schön, dass Sie wieder da sind" 13-mal.
// Aufgefallen ist das erst dem Kunden.
//
// Die KI-Inhaltsprüfung (review.js) kennt die Kategorie „Wiederholung" bereits,
// hat aber keine dieser Stellen gemeldet: Ein Modell, das 17.700 Wörter am Stück
// liest, zählt Motive über 22 Kapitel hinweg nicht zuverlässig. Zählen ist
// Maschinenarbeit.
//
// ── Was geprüft wird ──────────────────────────────────────────────
// 1. WIEDERHOLTE WORTFOLGEN. Dieselbe Wortfolge (ab 6 Wörtern) in mehreren
//    Kapiteln. Am fertigen Lutherhof-Buch gemessen: 15 solche Stellen im
//    Original, 2 in der entdoppelten Fassung — das Merkmal trennt also wirklich.
//    Reine Wortstatistik trennt NICHT: „topflappen" (9 Kapitel) und „wärme"
//    (9 Kapitel) sehen für sie gleich aus; deshalb wird hier auf Wortfolgen
//    geprüft, nicht auf Einzelwörter.
// 2. VERLETZTE EIGENTUMSZUWEISUNG. Die Gliederung sagt, welche Anekdote welchem
//    Kapitel exklusiv gehört (owns). Steht sie zusätzlich woanders, ist das ein
//    Befund. Setzt voraus, dass die Gliederung am Buch gespeichert ist
//    (book.outline, seit 13.08.2026) — ältere Bücher überspringen diesen Teil.
//    Gegenprobe mit einer nachgebauten Gliederung am Lutherhof-Buch: findet die
//    6 fremden Topflappen-Kapitel, Kopenhagen und das Sockenwerfen.
//
// Die Befunde haben dasselbe Format wie die der KI-Prüfung und landen im selben
// Bericht. „quote" ist WÖRTLICH aus dem Kapitel — nur so greifen die Knöpfe
// „Umformulieren"/„Löschen" im Prüfbericht unmittelbar.

const MIN_PHRASE = 6        // ab so vielen gleichen Wörtern in Folge = Wiederholung
const SEED = 5              // Länge des Suchfensters (Wortfolgen werden danach verschmolzen)
const MIN_STEM = 4
const STEM_LEN = 7
const SPREAD = 0.45         // Stamm in mehr als 45 % der Kapitel = Grundwortschatz
const MAX_PER_GROUP = 8
const MAX_FINDINGS = 40

const WORD_RE = /[\p{L}\p{N}]+/gu

function stem(w) { return w.length > STEM_LEN ? w.slice(0, STEM_LEN) : w }

// Wörter mit Position im Originaltext — die Position wird für das wörtliche
// Zitat gebraucht.
function tokenize(text) {
  const out = []
  const re = new RegExp(WORD_RE.source, 'gu')
  let m
  while ((m = re.exec(text))) out.push({ w: m[0].toLowerCase(), at: m.index, end: m.index + m[0].length })
  return out
}

// Der Satz, in dem eine Stelle liegt — als exakter Teilstring.
function sentenceAround(text, from, to) {
  const before = text.slice(0, from)
  let start = 0
  for (const mark of ['. ', '! ', '? ', '… ', '\n']) {
    const i = before.lastIndexOf(mark)
    if (i >= 0 && i + mark.length > start) start = i + mark.length
  }
  let end = text.length
  for (const mark of ['.', '!', '?', '…', '\n']) {
    const i = text.indexOf(mark, to)
    if (i >= 0 && i + 1 < end) end = i + 1
  }
  return text.slice(start, end).trim()
}

function chapterLabel(ch) {
  return `Kapitel ${ch.number}${ch.heading ? `: ${ch.heading}` : ''}`
}

function prepare(book) {
  const raw = Array.isArray(book?.chapters) ? book.chapters : []
  return raw.map((ch, i) => ({
    i,
    number: Number(ch?.number) || i + 1,
    heading: String(ch?.heading || ''),
    body: String(ch?.body || ''),
  })).filter(c => c.body.trim())
}

// Stämme je Kapitel + Verbreitung über die Kapitel.
function stemStats(chapters) {
  const perChapter = chapters.map(c => {
    const s = new Set()
    for (const t of tokenize(c.body)) { const st = stem(t.w); if (st.length >= MIN_STEM) s.add(st) }
    return s
  })
  const df = new Map()
  for (const set of perChapter) for (const st of set) df.set(st, (df.get(st) || 0) + 1)
  return { perChapter, df }
}

// ── 1. Wiederholte Wortfolgen ─────────────────────────────────────
// Gesucht wird über ein Fenster von SEED Wörtern; die tatsächlich wiederholte
// Stelle wird danach nach beiden Seiten so weit ausgedehnt, wie die Wörter
// übereinstimmen. Gemeldet wird immer die Stelle SELBST — deshalb wird bewusst
// NICHT transitiv gruppiert („ein ehrliches …" verbindet sonst zwei völlig
// verschiedene Passagen zu einer Gruppe, und das Zitat passt nicht zum Befund).
function repeatedPhrases(chapters) {
  const toks = chapters.map(c => tokenize(c.body))
  const seeds = new Map()
  toks.forEach((t, ci) => {
    for (let i = 0; i + SEED <= t.length; i++) {
      const key = t.slice(i, i + SEED).map(x => x.w).join(' ')
      if (!seeds.has(key)) seeds.set(key, [])
      seeds.get(key).push({ ci, idx: i })
    }
  })

  const groups = []
  for (const [key, occ] of seeds) {
    const chapterSet = [...new Set(occ.map(o => o.ci))]
    if (chapterSet.length < 2) continue
    // Fundstelle beidseitig ausdehnen, solange ALLE Vorkommen übereinstimmen.
    let left = 0, right = 0
    for (;;) {
      const w = occ.map(o => toks[o.ci][o.idx - left - 1]?.w)
      if (w[0] === undefined || w.some(x => x !== w[0])) break
      left++
    }
    for (;;) {
      const w = occ.map(o => toks[o.ci][o.idx + SEED + right]?.w)
      if (w[0] === undefined || w.some(x => x !== w[0])) break
      right++
    }
    const len = SEED + left + right
    if (len < MIN_PHRASE) continue
    // Zwei Kapitel reichen nur bei einer wirklich langen Passage — kurze
    // Wendungen („für neue Kolleginnen und Kollegen ist") wiederholen sich in
    // jeder Sprache zufällig.
    if (chapterSet.length < 3 && len < 8) continue
    // Ohne Gliederung lässt sich nicht bestimmen, WELCHE Fundstelle die richtige
    // ist; die erste bleibt stehen, alle weiteren werden gemeldet.
    const phrase = toks[occ[0].ci].slice(occ[0].idx - left, occ[0].idx + SEED + right).map(t => t.w).join(' ')
    const home = Math.min(...chapterSet)
    groups.push({ occ: occ.map(o => ({ ci: o.ci, from: o.idx - left, to: o.idx + SEED + right - 1 })), chapters: chapterSet, phrase, home })
  }
  return groups.map(g => ({ ...g, toks }))
}

// ── 2. Verletzte Eigentumszuweisung (owns aus der Gliederung) ─────
function ownershipBreaches(chapters, outline, df, n) {
  const list = Array.isArray(outline) ? outline : []
  if (!list.length) return []
  const limit = Math.max(2, Math.floor(n * SPREAD))
  const out = []
  for (const entry of list) {
    const owner = chapters.findIndex(c => c.number === Number(entry?.number))
    if (owner < 0) continue
    const owns = Array.isArray(entry?.owns) ? entry.owns : []
    for (const motif of owns) {
      // Nur kennzeichnende Wörter des Motivs: Wörter, die ohnehin über das halbe
      // Buch verteilt sind, taugen nicht als Erkennungsmerkmal.
      const keys = [...new Set(tokenize(String(motif)).map(t => stem(t.w)))]
        .filter(s => s.length >= MIN_STEM && (df.get(s) || 0) >= 1 && (df.get(s) || 0) <= limit)
      if (keys.length < 2) continue
      chapters.forEach((c, ci) => {
        if (ci === owner) return
        for (const sent of c.body.split(/(?<=[.!?…])\s+/)) {
          const st = new Set(tokenize(sent).map(t => stem(t.w)))
          const hit = keys.filter(k => st.has(k))
          if (hit.length < 2) continue
          out.push({ ci, owner, motif: String(motif), quote: sent.trim() })
          break
        }
      })
    }
  }
  return out
}

// ── Was hier bewusst NICHT geprüft wird ───────────────────────────
// „Austauschbare Schlussabsätze" (im Lutherhof-Buch 24 Stellen) wären der
// dritte naheliegende Test. Drei Kriterien wurden am Original UND an der
// entdoppelten Fassung durchgerechnet, keines trennt:
//   • Anteil Allerwelts-Wörter im letzten Absatz: 41–57 % (Original) gegen
//     16–41 % (entdoppelt) — die Bücher unterscheiden sich im MITTEL, aber es
//     gibt keinen Absatz-Schwellwert, der nicht bloß auf dieses Buch geeicht wäre.
//   • Wörter, die nur in diesem Kapitel vorkommen: in beiden Fassungen gleich
//     verteilt (0–19 %).
//   • Ähnlichkeit der Schlussabsätze untereinander: Faktor 1,10 gegenüber
//     beliebigen Absatzpaaren des Buches — also praktisch keine.
// Solche Absätze teilen einen TONFALL, keinen Wortschatz. Ein geratener
// Schwellwert würde bei anderen Büchern Fehlalarme produzieren; gegen dieses
// Muster hilft die Prompt-Regel (categories.js, „ZUSAMMENFASSENDE
// SCHLUSSABSÄTZE") und die inhaltliche KI-Prüfung, nicht das Zählen.

// ── Befunde bauen ─────────────────────────────────────────────────
export function repetitionFindings(book, { maxFindings = MAX_FINDINGS } = {}) {
  const chapters = prepare(book)
  const n = chapters.length
  if (n < 2) return []
  const { df } = stemStats(chapters)
  const findings = []

  for (const g of repeatedPhrases(chapters)) {
    const others = g.occ.filter(s => s.ci !== g.home)
    const nums = g.chapters.map(ci => chapters[ci].number)
    const severity = g.chapters.length >= 5 ? 'hoch' : g.chapters.length >= 3 ? 'mittel' : 'niedrig'
    for (const s of others.slice(0, MAX_PER_GROUP)) {
      const t = g.toks[s.ci]
      const quote = sentenceAround(chapters[s.ci].body, t[s.from].at, t[s.to].end)
      if (!quote) continue
      findings.push({
        category: 'Wiederholung',
        severity,
        location: chapterLabel(chapters[s.ci]),
        quote: quote.slice(0, 400),
        note: `Automatisch gefunden (Textvergleich, keine KI): Die Formulierung „${g.phrase}" steht wortgleich in ${g.chapters.length} Kapiteln (${nums.join(', ')}). Sie gehört an EINE Stelle — hier sollte sie entfallen; stehen bleiben kann sie in ${chapterLabel(chapters[g.home])}.`,
        source_contributor: '', source_quote: '',
        auto: 'repetition', spread: g.chapters.length,
      })
    }
  }

  for (const b of ownershipBreaches(chapters, book?.outline, df, n)) {
    findings.push({
      category: 'Wiederholung',
      severity: 'mittel',
      location: chapterLabel(chapters[b.ci]),
      quote: b.quote.slice(0, 400),
      note: `Automatisch gefunden (Abgleich mit der Gliederung): „${b.motif}" gehört laut Gliederung ausschließlich in ${chapterLabel(chapters[b.owner])} und wird dort erzählt. Hier sollte es entfallen.`,
      source_contributor: '', source_quote: '',
      auto: 'repetition', spread: 2,
    })
  }

  // Dieselbe Stelle nicht doppelt melden (ein Absatz kann mehrere Prüfungen auslösen).
  const seen = new Set()
  const unique = findings.filter(f => {
    const key = `${f.location}|${f.quote.slice(0, 80)}`
    if (seen.has(key)) return false
    seen.add(key); return true
  })
  const order = { hoch: 0, mittel: 1, niedrig: 2 }
  unique.sort((a, b) => (order[a.severity] ?? 3) - (order[b.severity] ?? 3) || (b.spread || 0) - (a.spread || 0))
  return unique.slice(0, maxFindings)
}

// ── Einbau in den Prüfbericht ─────────────────────────────────────
// Die KI-Prüfung meldet dieselbe Stelle manchmal auch; dann gewinnt ihr Befund
// (bessere Begründung) und der automatische entfällt.
export function withRepetitionCheck(report, value) {
  let auto = []
  try { auto = repetitionFindings(value) } catch { auto = [] }
  const llm = Array.isArray(report?.findings) ? report.findings : []
  if (!auto.length) return report
  const known = llm.map(f => String(f?.quote || '')).filter(Boolean)
  const fresh = auto.filter(a => !known.some(q => q.includes(a.quote) || a.quote.includes(q)))
  if (!fresh.length) return report
  const chapters = new Set(fresh.map(f => f.location)).size
  const note = `Automatische Wiederholungsprüfung: ${fresh.length} ${fresh.length === 1 ? 'Stelle' : 'Stellen'} in ${chapters} ${chapters === 1 ? 'Kapitel' : 'Kapiteln'}, die inhaltlich schon anderswo im Buch stehen.`
  return {
    ...report,
    summary: [report?.summary, note].filter(Boolean).join(' '),
    findings: [...llm, ...fresh],
  }
}
