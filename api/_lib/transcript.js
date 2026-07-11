// api/_lib/transcript.js  (CommonJS – Serverseite, genutzt vom Cron)
// Prompt-Bau + Node-spezifische Helfer. Die reinen Text-Operationen (apply,
// revert, findNeedle, fixMojibake, anchorInText) leben laufzeit-neutral in
// ./transcript-core.js und werden von HIER (Backend) und von src/transcript.js
// (Frontend) aus DERSELBEN Quelle bezogen – so laufen sie nicht auseinander.

const crypto = require('crypto')
const { applyCorrectionToMessages, fixMojibake, anchorInText } = require('./transcript-core')

function transcriptCheckSystem(memorial, contribution, userAnswers) {
  const names = []
  if (memorial?.name) names.push(memorial.name)
  if (contribution?.contributor_name) names.push(contribution.contributor_name)
  const nameHint = names.length
    ? `\nBekannte Eigennamen (korrekte Schreibweise bevorzugen): ${[...new Set(names)].join(', ')}.`
    : ''
  const answersBlock = userAnswers.map(a => `#${a.index}: ${a.content}`).join('\n\n')
  return `Du bereinigst maschinelle Sprachtranskripte (Speech-to-Text) deutscher Interview-Antworten. Sie stammen aus gesprochenen Beiträgen und enthalten typische Transkriptionsfehler.

Es gibt ZWEI Arten von Befunden:

A) "correction" – wird AUTOMATISCH übernommen. Nur klar eindeutige Fehler:
   - offensichtliche STT-Verhörer / falsch erkannte Wörter,
   - falsch geschriebene Eigennamen (nutze Kontext und bekannte Namen),
   - offensichtliche Zahl-/Datums-Verhörer.

B) "suggestion" – wird NUR VORGESCHLAGEN (nicht automatisch angewandt). Das ist alles, was TEXT ENTFERNT:
   - eingestreute Fremdgeräusch-Artefakte oder gesprochene Störeinschübe/Unterbrechungen, die inhaltlich nicht dazugehören (z. B. „ähm Moment das Telefon klingelt", Nebenbemerkungen an Dritte, abgebrochene Halbsätze ohne Bedeutung).
   Für "suggestion" nimm in "before" den zu entfernenden Teil MIT je einem angrenzenden Wort (bzw. Satzzeichen) DAVOR UND DANACH; "after" = genau diese angrenzenden Wörter OHNE den störenden Teil. So bleibt der Text zusammenhängend und die Änderung ist umkehrbar. Entferne NIEMALS sinntragende Aussagen.

NICHT ändern: Stil, Wortwahl, Grammatikfeinheiten, Inhalt oder Bedeutung; keine Ergänzungen, kein Umschreiben. Im Zweifel NICHT aufnehmen.${nameHint}

Antworten (mit Index):
${answersBlock}

Antworte AUSSCHLIESSLICH mit rohem JSON (kein Markdown, keine Erklärung):
{
  "corrections": [
    { "kind": "correction" | "suggestion", "message_index": <Index der Antwort als Zahl>, "before": "exakter Originalausschnitt", "after": "korrigierter Ausschnitt", "reason": "kurze Begründung auf Deutsch" }
  ]
}
"before" MUSS wörtlich und eindeutig im jeweiligen Antworttext vorkommen. Gibt es nichts zu tun: { "corrections": [] }.`
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

module.exports = { transcriptCheckSystem, applyCorrectionToMessages, newCorrectionId, parseCorrectionsJSON, fixMojibake, anchorInText }
