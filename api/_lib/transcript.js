// api/_lib/transcript.js  (CommonJS – Serverseite, genutzt vom Cron)
// Prompt + Anwenden von Transkriptions-Korrekturen. Das Frontend-Pendant
// (src/transcript.js) enthält nur die Undo/Redo-Helfer für den Bericht.

const crypto = require('crypto')

function transcriptCheckSystem(memorial, contribution, userAnswers) {
  const names = []
  if (memorial?.name) names.push(memorial.name)
  if (contribution?.contributor_name) names.push(contribution.contributor_name)
  const nameHint = names.length
    ? `\nBekannte Eigennamen (korrekte Schreibweise bevorzugen): ${[...new Set(names)].join(', ')}.`
    : ''
  const answersBlock = userAnswers.map(a => `#${a.index}: ${a.content}`).join('\n\n')
  return `Du bereinigst maschinelle Sprachtranskripte (Speech-to-Text) deutscher Interview-Antworten. Sie stammen aus gesprochenen Beiträgen und enthalten typische Transkriptionsfehler.

Korrigiere NUR echtes Transkriptions-Rauschen:
- offensichtliche STT-Verhörer / falsch erkannte Wörter,
- eingestreute Fremdgeräusch-Artefakte oder sinnlose Störeinschübe, die nicht zum Satz gehören,
- falsch geschriebene Eigennamen (nutze Kontext und bekannte Namen),
- offensichtliche Zahl-/Datums-Verhörer.

NICHT ändern: Stil, Wortwahl, Grammatikfeinheiten, Inhalt oder Bedeutung; keine Kürzungen, keine Ergänzungen, kein Umschreiben. Im Zweifel NICHT korrigieren.${nameHint}

Antworten (mit Index):
${answersBlock}

Antworte AUSSCHLIESSLICH mit rohem JSON (kein Markdown, keine Erklärung):
{
  "corrections": [
    { "message_index": <Index der Antwort als Zahl>, "before": "exakter Originalausschnitt", "after": "korrigierter Ausschnitt", "reason": "kurze Begründung auf Deutsch" }
  ]
}
"before" MUSS wörtlich und eindeutig im jeweiligen Antworttext vorkommen – so kurz wie möglich, aber eindeutig. Nur echte Fehler aufnehmen. Gibt es nichts zu korrigieren: { "corrections": [] }.`
}

// Wendet eine Korrektur auf messages an (erste Fundstelle im Ziel-Text).
function applyCorrectionToMessages(messages, corr) {
  const arr = Array.isArray(messages) ? messages.map(m => ({ ...m })) : []
  const m = arr[corr.message_index]
  if (!m || typeof m.content !== 'string' || !corr.before) return { messages: arr, ok: false }
  const pos = m.content.indexOf(corr.before)
  if (pos < 0) return { messages: arr, ok: false }
  m.content = m.content.slice(0, pos) + corr.after + m.content.slice(pos + corr.before.length)
  return { messages: arr, ok: true }
}

function newCorrectionId() {
  try { return crypto.randomUUID() } catch { return 'c' + Math.random().toString(36).slice(2, 10) }
}

// Robustes JSON-Parsen der Modellantwort: Codefences strippen, äußerstes {…}
// isolieren. Gibt das corrections-Array zurück (leer bei Fehlern).
function parseCorrectionsJSON(raw) {
  const text = String(raw || '').trim()
  const cleaned = text.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  let obj = null
  try { obj = JSON.parse(cleaned) } catch {
    const a = cleaned.indexOf('{'), b = cleaned.lastIndexOf('}')
    if (a >= 0 && b > a) { try { obj = JSON.parse(cleaned.slice(a, b + 1)) } catch {} }
  }
  return Array.isArray(obj?.corrections) ? obj.corrections : []
}

module.exports = { transcriptCheckSystem, applyCorrectionToMessages, newCorrectionId, parseCorrectionsJSON }
