// api/_lib/genprompts.js
// Serverseitige Prompt-Helfer für die Buch-Generierung im Worker (api/cron/generate.js).
// Bewusst NUR die von Zwischenergebnissen abhängigen Bausteine – Outline- und
// Kapitel-Prompts baut weiterhin der Browser mit src/categories.js und übergibt sie
// als Job-Plan (port-frei). Diese hier hängen von den erzeugten Kapiteln ab, müssen
// also im Worker gebaut werden.
//
// WICHTIG: `tryParseJSON`, `imageAssignSystem`, `faceRefSystem` sind wörtliche
// Kopien der gleichnamigen Funktionen in src/App.jsx – bei Änderungen dort HIER
// mitziehen (und umgekehrt).

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

// Prompt für die KI-Bildzuordnung: welche hochgeladenen Fotos passen in welches
// Kapitel? Liefert JSON { assignments: [{ chapter, image_ids:[…] }] }.
function imageAssignSystem(chapters, uploads) {
  const chapLines = chapters.map(c => `${c.number}. ${c.heading || ''}`).join('\n')
  const upLines = uploads.map(u => {
    const res = (u.width && u.height) ? `${u.width}×${u.height}px` : 'Auflösung unbekannt'
    const solo = (u.orientation === 'landscape' && u.quality_flag !== 'low' && (u.width || 0) >= 1819 && (u.height || 0) >= 1276)
    const fit = solo ? 'füllt allein eine Doppelseite' : 'besser mit weiteren Fotos gruppieren'
    return `- id ${u.id}: ${u.caption ? '„' + u.caption + '" – ' : ''}${u.description || '(keine Beschreibung)'} [${u.orientation}, ${res}${u.quality_flag === 'low' ? ', geringe Qualität' : ''} → ${fit}]`
  }).join('\n')
  return `Du ordnest hochgeladene Fotos den Kapiteln eines Buches zu. Jedes Kapitel füllt im Druck EINE Doppelseite.

Kapitel:
${chapLines}

Fotos:
${upLines}

Ordne jedes Foto dem inhaltlich und zeitlich am besten passenden Kapitel zu (nutze Bildunterschrift und Beschreibung). Ein Kapitel darf mehrere Fotos bekommen (max. 4 – sie werden dann gemeinsam auf der Doppelseite angeordnet); nicht jedes Kapitel braucht eines. Lässt sich ein Foto nicht sinnvoll zuordnen, lass es weg.

Berücksichtige dabei die Auflösung: Ein hochauflösendes Querformat-Foto („füllt allein eine Doppelseite") darf ruhig als einziges Foto ein Kapitel bekommen. Mehrere kleine oder gering aufgelöste Fotos, die inhaltlich zusammenpassen, ordne bevorzugt GEMEINSAM einem Kapitel zu, damit sie zusammen eine volle, ansehnliche Seite ergeben, statt einzeln aufgeblasen zu werden.

Gib REINES, GÜLTIGES JSON aus (kein Markdown-Codeblock, keine Erklärungen):
{
  "assignments": [
    { "chapter": <Kapitelnummer als Zahl>, "image_ids": ["id1", "id2"] }
  ]
}`
}

// Prompt: pro Kapitel das am besten passende REFERENZFOTO einer Person wählen
// (image-to-image Personen-Ähnlichkeit). Liefert JSON { refs: [{ chapter, image_id }] }.
function faceRefSystem(chapters, uploads) {
  const chapLines = chapters.map(c => `${c.number}. ${c.heading || ''}`).join('\n')
  const upLines = uploads.map(u =>
    `- id ${u.id}: ${u.caption ? '„' + u.caption + '" – ' : ''}${u.description || '(keine Beschreibung)'} [${u.orientation}]`
  ).join('\n')
  return `Du wählst für die Kapitel eines Erinnerungsbuchs jeweils das am besten geeignete REFERENZFOTO einer Person. Dieses Foto dient später als Vorlage, damit ein KI-generiertes Bild die abgebildete Person ähnlich darstellt.

Kapitel:
${chapLines}

Hochgeladene Fotos:
${upLines}

Wähle je Kapitel EIN Foto, das die im Kapitel behandelte Person am klarsten zeigt. Nutze Bildtitel und Beschreibung, um Namen/Beziehung dem Kapitel zuzuordnen; Porträts/Hochkant-Fotos eignen sich meist besser. Ein Foto darf für mehrere Kapitel gewählt werden. Gibt es für ein Kapitel kein klar passendes Personenfoto (z. B. reines Landschafts-/Sachfoto oder unpassende Person), lass das Kapitel weg.

Gib REINES, GÜLTIGES JSON aus (kein Markdown, keine Erklärung):
{
  "refs": [
    { "chapter": <Kapitelnummer als Zahl>, "image_id": "<id>" }
  ]
}`
}

// Baut aus einem generierten Wert (Buch-Objekt oder String) den zu prüfenden
// Fließtext mit Abschnitts-Markern. Wörtliche Kopie aus src/review.js – bei
// Änderungen dort HIER mitziehen.
function extractReviewText(value) {
  if (!value) return ''
  if (typeof value === 'string') return value
  const parts = []
  if (value.title) parts.push(`[Titel] ${value.title}`)
  if (value.subtitle) parts.push(`[Untertitel] ${value.subtitle}`)
  ;(value.chapters || []).forEach((ch, i) => {
    const num = ch?.number || i + 1
    const head = ch?.heading ? `: ${ch.heading}` : ''
    parts.push(`[Kapitel ${num}${head}]`)
    if (ch?.body) parts.push(ch.body)
  })
  return parts.join('\n\n')
}

module.exports = { tryParseJSON, imageAssignSystem, faceRefSystem, extractReviewText }
