// api/_lib/avocaconsensus.js
// MEHRFACH-EINSTUFUNG: Dieselbe Erzählung wird mehrfach unabhängig eingestuft,
// und die Durchgänge werden hier zusammengeführt.
//
// WARUM ÜBERHAUPT: Ein einzelner Durchgang schwankt. In den Testläufen kam
// dieselbe Erzählung bei „Offenheit" einmal auf Stufe 3 und einmal auf Stufe 4 —
// bei identischem Material. Wer nur EIN Ergebnis sieht, hält die Stufe für eine
// Messung; sie ist aber eine Einschätzung mit Streuung. Drei Durchgänge machen
// die Streuung sichtbar, statt sie zu verstecken.
//
// DIE ENTSCHEIDENDE REGEL: Weichen die Durchgänge um MEHR ALS EINE STUFE
// voneinander ab, wird die Dimension als „uneindeutig" ausgewiesen — nicht
// gemittelt. Ein Mittelwert aus 2 und 5 wäre 3,5 und sähe aus wie ein Ergebnis,
// obwohl er in Wahrheit bedeutet: Das Material trägt die Einstufung nicht.
//
// WAS NICHT GEMISCHT WIRD: Die Texte (Absatz, Belege, Gegenprobe) werden NICHT
// aus mehreren Durchgängen zusammengesetzt, sondern es wird der Durchgang
// übernommen, der die gewählte Stufe vergeben hat. Eine Collage aus drei
// Begründungen läse sich zwar reichhaltiger, würde aber Sätze nebeneinander
// stellen, die nie zusammen gedacht wurden — und die Belege stammten dann aus
// verschiedenen Einstufungen.

const STRENGTH_ORDER = ['niedrig', 'mittel', 'hoch']

const isLevel = v => Number.isInteger(v) && v >= 1 && v <= 5

// Schwächste Belegstärke gewinnt: Wenn ein Durchgang nur „mittel" sah, ist die
// Grundlage nicht plötzlich „hoch", weil zwei andere großzügiger waren.
function weakestStrength(values) {
  const idx = values
    .map(v => STRENGTH_ORDER.indexOf(String(v || '').toLowerCase()))
    .filter(i => i >= 0)
  if (!idx.length) return 'niedrig'
  return STRENGTH_ORDER[Math.min(...idx)]
}

function median(nums) {
  const s = [...nums].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

// `runs`: Array der geparsten JSON-Ergebnisse (mindestens eines).
// `codes`: die erwartete Reihenfolge der Dimensionen.
function mergeAvocaRuns(runs, codes) {
  const valid = (Array.isArray(runs) ? runs : []).filter(r => r && Array.isArray(r.dimensions))
  if (!valid.length) return null
  const base = valid[0]
  const order = Array.isArray(codes) && codes.length
    ? codes
    : base.dimensions.map(d => String(d.code))

  const dimensions = order.map(code => {
    // Die Sicht jedes Durchgangs auf diese Dimension.
    const views = valid
      .map(r => r.dimensions.find(d => String(d.code) === code))
      .filter(Boolean)
    if (!views.length) {
      return { code, level: null, unclear: true, evidence_strength: 'niedrig',
               unclear_reason: 'Zu dieser Dimension liegt kein Ergebnis vor.',
               consistency: { runs: valid.length, levels: [], spread: null } }
    }

    const levels = views.map(v => (v.unclear === true ? null : v.level)).map(v => (isLevel(v) ? v : null))
    const got = levels.filter(isLevel)
    const consistency = { runs: views.length, levels, spread: got.length ? Math.max(...got) - Math.min(...got) : null }

    // Weniger als die Hälfte der Durchgänge konnte einstufen → uneindeutig.
    if (got.length < Math.ceil(views.length / 2)) {
      const reason = views.find(v => v.unclear === true && String(v.unclear_reason || '').trim())?.unclear_reason
      return {
        ...views[0], code, level: null, unclear: true, evidence_strength: 'niedrig',
        unclear_reason: reason || 'Das Gespräch gibt zu dieser Dimension zu wenig her.',
        consistency,
      }
    }

    // Streuung über eine Stufe hinaus → NICHT mitteln, sondern ausweisen.
    if (consistency.spread > 1) {
      const chosen = views.find(v => v.level === median(got)) || views[0]
      return {
        ...chosen, code, level: null, unclear: true,
        evidence_strength: weakestStrength(views.map(v => v.evidence_strength)),
        unclear_reason: `Uneindeutig: Die ${views.length} unabhängigen Durchgänge kamen auf Stufe ${got.join(', ')}. `
          + 'Eine Abweichung von mehr als einer Stufe heißt, dass das Gespräch die Einstufung nicht eindeutig trägt — '
          + 'hier wird deshalb keine Stufe vergeben.',
        consistency,
      }
    }

    const level = median(got)
    // Texte, Belege und Gegenprobe kommen aus GENAU EINEM Durchgang — dem, der
    // die gewählte Stufe vergeben hat.
    const chosen = views.find(v => v.level === level) || views[0]
    return {
      ...chosen,
      code,
      level,
      unclear: false,
      unclear_reason: '',
      evidence_strength: weakestStrength(views.map(v => v.evidence_strength)),
      consistency,
    }
  })

  // Das Gesamtbild stammt aus dem Durchgang, der bei den meisten Dimensionen
  // die gewählte Stufe getroffen hat — sonst widerspräche es den Stufen darüber.
  const scores = valid.map(r => dimensions.reduce((n, d) => {
    const v = r.dimensions.find(x => String(x.code) === d.code)
    return n + (v && v.level === d.level ? 1 : 0)
  }, 0))
  const best = valid[scores.indexOf(Math.max(...scores))] || base

  const unclear = dimensions.filter(d => d.unclear).length
  return {
    ...base,
    dimensions,
    overall: best.overall || base.overall || '',
    not_stated: best.not_stated || base.not_stated || [],
    consistency: {
      runs: valid.length,
      unclear_dimensions: unclear,
      note: `Die Einstufung wurde ${valid.length}-mal unabhängig vorgenommen. Abweichungen von höchstens einer Stufe `
        + 'gelten als bestätigt (angegeben ist die mittlere Stufe, die Belegstärke die vorsichtigste der Durchgänge). '
        + 'Bei größerer Abweichung wird keine Stufe vergeben.',
    },
  }
}

module.exports = { mergeAvocaRuns, weakestStrength, STRENGTH_ORDER }
