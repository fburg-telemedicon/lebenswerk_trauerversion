// src/enduserAnamnesis.js
// Client-seitige Erstellung + Bearbeitung des Anamnesebogens für den PATIENTEN-
// Review (Step 2). Der Patient prüft/bearbeitet/bestätigt den Bogen NACH dem
// Interview direkt im Beitragenden-Flow — per Tippen UND per KI-Sprachanweisung —
// und bestätigt zum Schluss mit „ok" (Vorbild: Probedruck-/Finalize-Flow).
//
// Der Bogen ist KANONISCH auf Deutsch (für die aufnehmende Ärztin/den Arzt). Ist
// die Interviewsprache eine andere, wird zusätzlich eine Übersetzung angezeigt, in
// der der Patient prüft/bearbeitet. Änderungen (Text ODER KI-Anweisung) fließen in
// BEIDE Fassungen zurück: bearbeitet wird in der Anzeigesprache (`loc`), das
// kanonische Deutsch (`de`) wird beim Bestätigen aus den geänderten Abschnitten neu
// abgeleitet (unveränderte Abschnitte behalten ihr direkt aus dem Gespräch erzeugtes
// Deutsch — keine Round-Trip-Verluste). KEIN Medizinprodukt: nichts erfinden, keine
// Diagnosen, keine Bewertung — nur wiedergeben/übersetzen, was gesagt wurde.

import { getCategory } from './categories.js'
import { langDirective } from './i18n.js'
import { askLLM } from './api.js'

// Deutsch (inkl. Schweizer Hochdeutsch) braucht KEINE Übersetzung: der kanonische
// Bogen ist ohnehin Deutsch; `loc` == `de`.
export function isGermanReview(lang) {
  return !lang || lang === 'de' || lang === 'de-CH'
}

// Fester Kopf des Anamnesebogens. Muss mit der Admin-Generierung in App.jsx
// übereinstimmen, damit der im Dashboard heruntergeladene Bogen einheitlich aussieht.
export function buildAnamnesisHeader(memorial) {
  const cat = getCategory('anamnesis')
  const extra = (cat.intake.extra || [])
    .map(f => {
      const v = memorial?.intake?.[f.key]
      if (!v) return null
      const opt = f.options?.find(o => o.value === v)
      return `${f.label.replace(/\s*\*$/, '')}: ${opt?.label || v}`
    })
    .filter(Boolean).join(' · ')
  const lines = [memorial?.name && `Name: ${memorial.name}`, extra].filter(Boolean).join('\n')
  return `# Anamnesebogen (Selbstauskunft)\n\n_Hinweis: Dieser Bogen wurde aus der Patientenselbstauskunft KI-generiert. Er ist nicht ärztlich validiert und ersetzt keine ärztliche Anamnese oder Untersuchung._${lines ? `\n\n${lines}` : ''}`
}

// Kanonischer deutscher Bogen aus Kopf + Abschnitten. Format identisch zur
// Admin-Generierung: Kopf, dann je Abschnitt „## Label\n\n<Text>", verbunden mit \n\n.
export function buildCanonical(memorial, sections) {
  const header = buildAnamnesisHeader(memorial)
  return sections
    .map((s, i) => `${i === 0 ? header + '\n\n' : ''}## ${s.label}\n\n${String(s.de || '').trim()}`)
    .join('\n\n')
}

// Robuste Zerlegung „<Überschrift>\n---\n<Text>" aus der Übersetzung.
function splitLabelText(raw, fallbackLabel, fallbackText) {
  const s = String(raw || '').trim()
  const idx = s.indexOf('\n---')
  if (idx > 0) {
    const label = s.slice(0, idx).trim()
    const text = s.slice(idx).replace(/^\n---\s*\n?/, '').trim()
    if (label) return { label, text }
  }
  return { label: fallbackLabel, text: s || fallbackText }
}

// Einen deutschen Abschnitt (+ Überschrift) originalgetreu in die Anzeigesprache
// übersetzen — nur fürs Patienten-Review. Nichts ändern/ergänzen/weglassen.
async function translateForReview(deText, deLabel, lang, memorialCode) {
  const sys = `Du bist ein medizinischer Fachübersetzer. Übersetze einen Abschnitt eines Anamnesebogens originalgetreu.${langDirective(lang)}
Regeln:
- Übersetze AUSSCHLIESSLICH; ändere NICHTS inhaltlich, füge nichts hinzu, lass nichts weg.
- Behalte Markierungen wie „⚠ ROTE FLAGGE:" und „Fremdanamnese (Begleitperson):" sinngemäß bei.
- Behalte Absätze und Stichpunkte („• ") bei.
- Gib GENAU dieses Format zurück: zuerst die übersetzte Überschrift, dann eine Zeile mit nur „---", danach der übersetzte Text. Sonst nichts.`
  const raw = await askLLM(
    sys,
    [{ role: 'user', content: `ÜBERSCHRIFT:\n${deLabel}\n\nTEXT:\n${deText}` }],
    { memorialCode, kind: 'anamnese_translate' }
  )
  return splitLabelText(raw, deLabel, deText)
}

// Einen (in der Anzeigesprache bearbeiteten) Abschnitt originalgetreu ins Deutsche
// zurückübersetzen — beim Bestätigen für die geänderten Abschnitte.
export async function translateToGerman(locText, lang, memorialCode) {
  if (isGermanReview(lang)) return String(locText || '').trim()
  const sys = `Du bist ein medizinischer Fachübersetzer. Übersetze den folgenden Abschnitt eines Anamnesebogens originalgetreu INS DEUTSCHE.
Regeln:
- Übersetze AUSSCHLIESSLICH; ändere nichts inhaltlich, ergänze nichts, lass nichts weg.
- Behalte Markierungen („⚠ ROTE FLAGGE:", „Fremdanamnese (Begleitperson):") und Stichpunkte („• ") bei.
- Nüchterne, knappe Dokumentationssprache.
- Gib NUR den deutschen Text zurück — ohne Vorbemerkung, ohne Anführungszeichen.`
  const raw = await askLLM(sys, [{ role: 'user', content: String(locText || '') }], { memorialCode, kind: 'anamnese_translate' })
  return String(raw || '').trim()
}

// KI-Überarbeitung eines Abschnitts (bzw. seiner Überschrift) per Anweisung —
// arbeitet in der Anzeigesprache. Anweisung steht im SYSTEM-Prompt (Azure-Prompt-
// Shield lehnt Imperative im User-Turn ab), wie im Probedruck-Flow.
export async function reviseAnamnesisSection({ segment, instruction, lang, memorialCode, isHeading = false }) {
  const sys = `${langDirective(lang)} Du bearbeitest einen Abschnitt eines medizinischen Anamnesebogens (Patientenselbstauskunft) im Auftrag der Patientin/des Patienten.
- Überarbeite ${isHeading ? 'die bereitgestellte ÜBERSCHRIFT — kurz und prägnant, ohne abschließenden Punkt' : 'AUSSCHLIESSLICH den bereitgestellten Abschnitt'} gemäß der Anweisung.
- Bleib sachlich und knapp (nüchterne Dokumentationssprache). Behalte die Sprache bei.
- Erfinde KEINE medizinischen Fakten, ergänze nichts aus Allgemeinwissen, stelle KEINE Diagnosen und bewerte nichts.
- Behalte vorhandene Markierungen („⚠"/Rote Flagge, „Fremdanamnese") bei, sofern zutreffend.
- Gib NUR den überarbeiteten Text zurück – ohne Anführungszeichen, ohne Vorbemerkung, ohne Kommentar.
- Soll der Text laut Anweisung entfernt werden oder leer bleiben, antworte AUSSCHLIESSLICH mit dem Wort LEER (nichts sonst).`
  let revised = String(await askLLM(
    sys,
    [{ role: 'user', content: `${isHeading ? 'ÜBERSCHRIFT' : 'ABSCHNITT'}:\n${segment}\n\nANWEISUNG:\n${instruction}` }],
    { memorialCode, kind: 'anamnese_edit' }
  ) || '').trim()
  if (!revised) return null   // KI-Aussetzer → Text unverändert lassen
  if (/^\[?\s*leer\s*\]?$/i.test(revised) ||
      /^\[[^\]]*(rausgelassen|weggelassen|ausgelassen|entfernt|kein text|leer)[^\]]*\]$/i.test(revised)) revised = ''
  return revised
}

// memorial + Beitrag (der eine Interview-Beitrag des Patienten) → Bogen-Abschnitte.
// Ergebnis: [{ key, label, labelLoc, de, loc, dirty:false }]. `de` ist der kanonische
// deutsche Text (direkt aus dem Gespräch); `loc`/`labelLoc` die Anzeigefassung in der
// Interviewsprache (bei Deutsch identisch). onProgress({ pct, text }); cancelRef bricht ab.
export async function generateAnamnesisBogen({ memorial, contributions, lang, onProgress, cancelRef }) {
  const ft = getCategory('anamnesis').finalText
  const sectionsDef = Array.isArray(ft?.sections) ? ft.sections : []
  if (!sectionsDef.length) throw new Error('Für diese Kategorie ist kein Bogen konfiguriert.')
  const styleInstruction = ft.styles?.[0]?.instruction || ''
  const checkCancel = () => { if (cancelRef?.current) throw new Error('__CANCELLED__') }
  const german = isGermanReview(lang)
  const hasAnswers = (contributions || []).some(c => Array.isArray(c?.messages) && c.messages.some(m => m.role === 'user'))
  if (!hasAnswers) throw new Error('Es liegen noch keine Antworten vor — bitte zuerst das Anamnesegespräch führen.')

  const out = []
  for (let i = 0; i < sectionsDef.length; i++) {
    checkCancel()
    const section = sectionsDef[i]
    onProgress?.({ pct: Math.round((92 * i) / sectionsDef.length), text: `Abschnitt ${i + 1} von ${sectionsDef.length} …` })
    // Der Abschnitts-Prompt erzeugt IMMER Deutsch (siehe anamnesisSection).
    const sys = ft.sectionSystem(memorial, contributions, section, styleInstruction)
    let de = ''
    for (let a = 1; a <= 2; a++) {
      checkCancel()
      const raw = await askLLM(
        sys,
        [{ role: 'user', content: `Schreibe jetzt den Abschnitt „${section.label}" des Anamnesebogens.` }],
        { memorialCode: memorial.id, kind: 'anamnese_section' }
      )
      de = String(raw || '').trim()
      if (de) break
    }
    let loc = de, labelLoc = section.label
    if (!german && de) {
      checkCancel()
      const tr = await translateForReview(de, section.label, lang, memorial.id)
      loc = tr.text; labelLoc = tr.label
    }
    out.push({ key: section.key, label: section.label, labelLoc, de, loc, dirty: false })
  }
  onProgress?.({ pct: 100, text: 'Fertig.' })
  return out
}
