// src/careerDocs.js
// ZEUGNISSE UND NACHWEISE der Kategorie „Lebenslauf": Prompt für die Auslesung
// und die Aufbereitung der bestätigten Dokumente als Quelle für Lebenslauf und
// Kompetenzprofil.
//
// WIE ES LÄUFT: Die Person lädt im Interview Fotos ihrer Unterlagen hoch
// (derselbe Upload-Pfad wie die Fotos, nur anders beschriftet — siehe
// CAREER_DOC_L10N in contributor.jsx). Ein Job liest jedes Bild mit dem
// multimodalen Modell aus (`resultType: 'documents'` in api/cron/generate.js)
// und legt die Auslesung in `memorials.documents` ab. Der Manager bestätigt
// oder verwirft jede Auslesung; erst BESTÄTIGTE Dokumente werden zur Quelle.
//
// WARUM DIE BESTÄTIGUNG NICHT WEGGELASSEN WURDE: Ein Foto eines Arbeitszeugnisses
// ist schief, geknickt, manchmal halb abgeschnitten. Eine falsch gelesene
// Jahreszahl aus so einem Bild wäre im Lebenslauf nicht von einer erzählten zu
// unterscheiden — und niemand könnte sie mehr nachprüfen. Deshalb ist jede
// Auslesung erst einmal ein Vorschlag.
//
// GRENZE, die man kennen muss: Ausgelesen werden BILDER (Foto, Scan als JPG/PNG).
// PDFs kann der Upload-Pfad nicht annehmen — er rechnet jede Datei über sharp in
// ein JPEG um. Wer ein PDF hat, fotografiert die Seite oder exportiert sie als
// Bild. Das ist bewusst so gelassen: ein PDF-Rasterer im Container wäre eine
// eigene Abhängigkeit für einen Fall, den ein Foto genauso löst.

// Dokumentarten, die der Auslesung bekannt sind. `key` steht in den Daten,
// `label` erscheint im Dashboard und im Lebenslauf-Beleg.
export const DOC_KINDS = [
  { key: 'arbeitszeugnis',  label: 'Arbeitszeugnis' },
  { key: 'zwischenzeugnis', label: 'Zwischenzeugnis' },
  { key: 'abschluss',       label: 'Abschlusszeugnis / Urkunde' },
  { key: 'zertifikat',      label: 'Zertifikat / Weiterbildung' },
  { key: 'referenz',        label: 'Referenz / Empfehlung' },
  { key: 'lebenslauf',      label: 'Früherer Lebenslauf' },
  { key: 'sonstiges',       label: 'Sonstiges' },
]
export const docKindLabel = k => DOC_KINDS.find(d => d.key === k)?.label || 'Sonstiges'

// Auslesung EINES Dokuments. Der Prompt bekommt das Bild dazu (multimodal).
export function docExtractSystem(memorial, upload) {
  const name = String(memorial?.name || '').trim()
  const caption = String(upload?.caption || '').trim()
  const desc = String(upload?.description || '').trim()
  const hint = [caption && `Titel laut Person: „${caption}"`, desc && `Notiz: „${desc}"`].filter(Boolean).join('\n')
  const kinds = DOC_KINDS.map(k => `"${k.key}" (${k.label})`).join(', ')

  return `Du liest ein fotografiertes berufliches Dokument aus${name ? ` — es gehört zu ${name}` : ''}. Gib die enthaltenen Angaben strukturiert wieder. Du bewertest nichts und ergänzt nichts.
${hint ? `\n${hint}\n` : ''}
Gib REINES, GÜLTIGES JSON aus (kein Markdown, keine Erklärung):
{
  "readable": true,
  "kind": "arbeitszeugnis",
  "organization": "",
  "role": "",
  "from": "",
  "to": "",
  "qualification": "",
  "grade": "",
  "issued": "",
  "duties": ["..."],
  "summary": "",
  "unreadable_reason": ""
}

REGELN:
- "readable": false nur, wenn das Bild kein lesbares berufliches Dokument zeigt (unscharf, kein Dokument, zu wenig sichtbar). Dann "unreadable_reason" in einem Satz ausfüllen und alle übrigen Felder leer lassen.
- "kind": eine der folgenden Arten: ${kinds}.
- Gib NUR wieder, was im Bild WIRKLICH STEHT. Erfinde keine Organisation, kein Datum, keine Note. Was nicht lesbar ist, bleibt ein LEERER STRING — schätze nichts und ergänze nichts aus Allgemeinwissen.
- "from"/"to": Beschäftigungs- bzw. Ausbildungszeitraum, wie er im Dokument steht (Jahr oder MM/JJJJ). "issued": Ausstellungsdatum, falls angegeben.
- "grade": Note oder Gesamtbeurteilung NUR, wenn sie ausdrücklich dasteht (z. B. „1,7", „stets zur vollsten Zufriedenheit"). Deute die Zeugnissprache NICHT in eine Note um.
- "duties": bis zu sechs kurze Punkte aus der Tätigkeitsbeschreibung, in den Worten des Dokuments verdichtet.
- "summary": zwei bis drei Sätze, was das Dokument belegt. Sachlich, ohne Bewertung der Person.
- KEINE personenbezogenen Angaben Dritter (Namen von Vorgesetzten, Unterzeichnenden, Kolleginnen) — die brauchen wir nicht und sie gehören nicht in den Lebenslauf.
- KEINE geschützten Merkmale: Geburtsdatum, Geburtsort, Alter, Staatsangehörigkeit, Familienstand, Konfession, Gesundheitsangaben werden NICHT übernommen, auch wenn sie im Dokument stehen.
- Schreibe auf Deutsch.
- Gültiges JSON, keine trailing commas.`
}

// ── Bestätigte Dokumente als Quelle ───────────────────────────────
// Beleg-Kennungen sind "D1", "D2" … — bewusst anders als die "A17" der
// Gesprächsantworten, damit im fertigen Dokument erkennbar bleibt, ob eine
// Angabe erzählt oder belegt ist.
export const confirmedDocs = docs =>
  (Array.isArray(docs) ? docs : []).filter(d => d && d.confirmed === true && d.data && d.data.readable !== false)

export function docsBlock(docs) {
  const list = confirmedDocs(docs)
  if (!list.length) return ''
  const lines = list.map((d, i) => {
    const x = d.data || {}
    const parts = [
      `[D${i + 1}] ${docKindLabel(x.kind)}`,
      x.organization && `Organisation: ${x.organization}`,
      x.role && `Funktion: ${x.role}`,
      (x.from || x.to) && `Zeitraum: ${[x.from, x.to].filter(Boolean).join(' – ')}`,
      x.qualification && `Abschluss: ${x.qualification}`,
      x.grade && `Beurteilung: ${x.grade}`,
      x.issued && `Ausgestellt: ${x.issued}`,
      Array.isArray(x.duties) && x.duties.length && `Tätigkeiten: ${x.duties.join('; ')}`,
      x.summary && `Inhalt: ${x.summary}`,
    ].filter(Boolean)
    return parts.join('\n      ')
  })
  return `\n\nBESTÄTIGTE DOKUMENTE (von der Person hochgeladen, ausgelesen und geprüft — sie sind BELEGE und dürfen wie Aussagen aus dem Gespräch verwendet werden; ihre Belegnummern beginnen mit D):\n\n${lines.join('\n\n')}`
}

// Zusatzregeln für die Prompts, sobald bestätigte Dokumente vorliegen.
export function docsRule(docs) {
  if (!confirmedDocs(docs).length) return ''
  return `
- BESTÄTIGTE DOKUMENTE sind eine zweite Quelle neben dem Gespräch. Ihre Angaben (Zeiträume, Organisationen, Abschlüsse) sind belegt und dürfen verwendet werden, auch wenn sie im Gespräch nicht fielen. Belege sie mit ihrer Nummer ("D2").
- Widersprechen sich Gespräch und Dokument (z. B. verschiedene Jahreszahlen), hat das DOKUMENT Vorrang; erwähne den Unterschied in "not_stated" („Zeitraum laut Zeugnis 2004–2011, im Gespräch anders erinnert").
- Ein Dokument allein macht aus einer Tätigkeit keine erzählte Geschichte: Übernimm daraus Eckdaten und Aufgaben, aber keine Wertungen aus der Zeugnissprache.`
}
