// src/enduserProof.js
// Client-seitige, BILD-LOSE Buch-Generierung für die Endnutzer-„Probedruck"-Vorschau.
// Nutzt dieselben Prompt-Bausteine wie der Admin (categories.js, Variante book_v2),
// aber ohne den serverseitigen Bild-/Job-Weg: Gerüst + je Kapitel ein askLLM-Aufruf
// über den öffentlichen /api/ask (kein Login nötig). Ergebnis = { title, subtitle,
// chapters:[{number,heading,body}], proof:true } — reiner Text.

import { getCategory } from './categories.js'
import { langDirective } from './i18n.js'
import { askLLM } from './api.js'

// Robustes JSON-Parsen der KI-Antwort (identisch zur Admin-Logik in App.jsx).
function tryParseJSON(raw) {
  if (!raw) return null
  let s = String(raw).trim()
  if (s.startsWith('```')) s = s.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '').trim()
  const first = s.indexOf('{')
  const last = s.lastIndexOf('}')
  if (first > 0 || (first === 0 && last > 0 && last < s.length - 1)) s = s.slice(first, last + 1)
  try { return JSON.parse(s) } catch {}
  try { return JSON.parse(s.replace(/,(\s*[}\]])/g, '$1')) } catch { return null }
}

// memorial + contributions (i. d. R. genau der eine Beitrag des Endnutzers) → Buch.
// onProgress({ pct, text }) für die Fortschrittsanzeige. cancelRef?.current === true
// bricht sauber ab.
export async function generateProofBook({ memorial, contributions, lang, onProgress, cancelRef }) {
  const cat = getCategory(memorial.product_category)
  const gen = cat?.generators?.book_v2
  if (!gen) throw new Error('Für dieses Produkt ist keine Buchvorschau verfügbar.')
  const dir = langDirective(lang || memorial.languages?.[0] || 'de')
  const checkCancel = () => { if (cancelRef?.current) throw new Error('__CANCELLED__') }

  onProgress?.({ pct: 5, text: 'Buch-Gerüst wird geplant …' })
  const outlineSys = gen.outlineSystem(memorial, contributions) + dir
  let outline = null, lastRaw = ''
  for (let a = 1; a <= 3; a++) {
    checkCancel()
    lastRaw = await askLLM(outlineSys, [{ role: 'user', content: 'Erzeuge jetzt das Gerüst als JSON.' }], { memorialCode: memorial.id, kind: 'proof_outline' })
    const p = tryParseJSON(lastRaw)
    if (p && p.title) { outline = p; break }
    if (a < 3) await new Promise(r => setTimeout(r, 1500 * a))
  }
  if (!outline) throw new Error('Das Buch-Gerüst konnte nicht erstellt werden. Bitte erneut versuchen.')

  const plans = Array.isArray(outline.chapters) ? outline.chapters : []
  if (!plans.length) throw new Error('Es konnten keine Kapitel geplant werden — bitte zuerst mehr Fragen im Interview beantworten.')

  const chapters = []
  for (let i = 0; i < plans.length; i++) {
    checkCancel()
    const plan = plans[i]
    onProgress?.({ pct: 10 + Math.round((85 * i) / plans.length), text: `Kapitel ${i + 1} von ${plans.length} wird geschrieben …` })
    const sys = gen.chapterSystem(memorial, contributions, plan, plans) + dir
    let ch = null
    for (let a = 1; a <= 2; a++) {
      const raw = await askLLM(sys, [{ role: 'user', content: 'Erzeuge jetzt dieses eine Kapitel als JSON.' }], { memorialCode: memorial.id, kind: 'proof_chapter' })
      const p = tryParseJSON(raw)
      if (p && (p.body || p.heading)) { ch = p; break }
    }
    chapters.push({
      number: Number.isFinite(plan.number) ? plan.number : (i + 1),
      heading: String(ch?.heading || plan.heading || '').trim(),
      body: String(ch?.body || '').trim(),
      // Bild-Motiv (für die vorläufige Druckversion; beim Zwischenstand ungenutzt).
      image_prompt: String(ch?.image_prompt || plan.image_prompt || '').trim(),
    })
  }

  onProgress?.({ pct: 100, text: 'Fertig.' })
  // language mitgeben: die Leseansicht (auch im Admin-Dashboard) liest daraus die
  // UI-/Bezeichner-Sprache; fehlt sie, fällt sie auf Deutsch zurück.
  return { title: String(outline.title || memorial.name || 'Mein Leben').trim(), subtitle: String(outline.subtitle || '').trim(), language: lang || memorial.languages?.[0] || 'de', chapters, proof: true }
}
