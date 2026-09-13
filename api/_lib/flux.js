// api/_lib/flux.js
// Gemeinsame FLUX-Bilderzeugung fuer api/admin/generate-image.js (Buchbilder,
// inkl. image-to-image) und api/enduser-image.js (Endnutzer erzeugt ein Bild
// neu). Bis 2026-09-13 lag dieser Block in BEIDEN Dateien als Kopie; die
// Endnutzer-Fassung war die aeltere, kommentarlose Variante ohne img2img.
//
// Die Bildgroesse ist zugleich der Preis-Schluessel in api/_lib/cost.js
// (FLUX_MODEL = 'flux-2-pro-1536x1024') — beim Aendern dort mitziehen.

const IMAGE_W = 1536, IMAGE_H = 1024
const FLUX_MODEL = `flux-2-pro-${IMAGE_W}x${IMAGE_H}`

// Das LLM schreibt in image_prompt gern selbst ein Medium hinein ("vintage
// photograph", "oil painting", "cinematic still"). Steht so ein Wort im Motiv,
// kaempft es gegen die Stil-Direktive – und jedes Kapitel gewinnt anders. Wir
// schneiden diese Wortgruppen deshalb aus dem Motiv heraus; das Medium kommt
// AUSSCHLIESSLICH aus image-styles.js. Wirkt auch fuer bereits gespeicherte
// Buecher, weil beim Neu-Erzeugen der alte image_prompt gefiltert wird.
const MEDIUM_SRC =
  '\\b(?:hyper-?realistic|photo-?realistic|photorealism|cinematic|filmic|movie still|film still|' +
  '(?:vintage|sepia|black[- ]and[- ]white|b&w|analog|polaroid|old|archival|documentary|candid|studio|dslr|35mm|film)?\\s*' +
  '(?:photograph|photography|photo|snapshot)|' +
  'oil painting|watercolou?r(?:\\s+painting)?|gouache|acrylic|pastel|charcoal|ink drawing|pencil (?:drawing|sketch)|sketch|' +
  'etching|engraving|woodcut|lithograph|painting|painterly|illustration|illustrated|drawing|artwork|' +
  'digital art|concept art|matte painting|3-?d render|3-?d|render(?:ed|ing)?|cgi|unreal engine|octane|' +
  'anime|manga|comic|cartoon|storybook|pixar|disney|impressionist|expressionist|art nouveau|art deco)\\b'

const MEDIUM_WORDS = new RegExp(MEDIUM_SRC, 'gi')
// Typischer Satzanfang "A nostalgic vintage photograph of …" / "Oil painting of …":
// hier muss die ganze Einleitung inkl. "of" weg, sonst bleibt ein Fragment stehen.
const MEDIUM_LEAD = new RegExp(
  '^[^,.]{0,40}?(?:(?:' + MEDIUM_SRC + ')[\\s,:;-]*){1,3}(?:of|showing|depicting|featuring|capturing)?[\\s,:;-]*', 'i')

function stripMedium(text) {
  const cleaned = String(text || '')
    .replace(MEDIUM_LEAD, '')
    .replace(MEDIUM_WORDS, ' ')
    // durch das Ausschneiden entstandene Fuellwoerter/Satzzeichen aufraeumen
    .replace(/\b(?:in|as|a|an|the|of|with|style|styled|look|aesthetic|vibe|quality)\b(?=[\s,;.]*(?:$|[,;.]))/gi, ' ')
    .replace(/,\s*(?=,)/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,;.])/g, '$1')
    .replace(/^[\s,;.\-]+|[\s,;.\-]+$/g, '')
    .trim()
  // Falls der Prompt fast nur aus Medien-Woertern bestand, lieber das Original
  // lassen als ein leeres Motiv an FLUX zu schicken.
  return cleaned.length >= 15 ? cleaned : String(text || '').trim()
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Azure lehnt einzelne (vom LLM erzeugte) Bild-Prompts ueber den Inhaltsfilter
// dauerhaft ab (Responsible AI / Bing-Sperrliste). Solche Fehler sind NICHT
// transient – ein Wiederholen mit demselben Prompt hilft nicht.
function isContentPolicyError(msg) {
  return /RAI policy|BingBlockList|responsible ai|content (policy|filter|management)|blocklist|block list|moderat|flagged/i.test(String(msg || ''))
}

// Neutrales, garantiert zulaessiges Ersatzmotiv: wird verwendet, wenn der
// eigentliche Kapitel-Prompt vom Inhaltsfilter blockiert wird, damit das
// Kapitel nicht ganz ohne Bild bleibt. Bewusst ohne Personen, Namen, Text und
// religioese/sensible Symbole.
const SAFE_FALLBACK_PROMPT =
  'A serene, atmospheric memorial scene: a peaceful natural landscape at soft golden-hour light, a gentle meadow with wildflowers, distant calm hills and a tender sky. ' +
  'Quiet, comforting and dignified mood, evoking remembrance, love and gratitude. No people, no faces, no text, no lettering, no logos, no symbols, no religious icons.'

// Bytes aus der FLUX-Antwort holen: entweder direkt base64 oder eine URL,
// die wir nachladen.
async function bytesFromResult(out) {
  if (out?.b64) return Buffer.from(out.b64, 'base64')
  if (out?.url) {
    const r = await fetch(out.url)
    if (!r.ok) throw new Error(`Bild-Download fehlgeschlagen: HTTP ${r.status}`)
    return Buffer.from(await r.arrayBuffer())
  }
  throw new Error('Keine Bilddaten erhalten.')
}

// ── Azure Foundry: FLUX.2 [pro] (Black Forest Labs) ───────────────
// BFL-Provider-API. Antwort kann synchron (b64/url) oder asynchron mit
// polling_url kommen – beides wird abgedeckt.
async function generateAzureFlux(fullPrompt, referenceB64) {
  const endpoint   = (process.env.AZURE_FLUX_ENDPOINT || '').replace(/\/+$/, '')
  const key        = process.env.AZURE_FLUX_KEY
  const model      = process.env.AZURE_FLUX_MODEL || 'FLUX.2-pro'
  const modelPath  = process.env.AZURE_FLUX_MODEL_PATH || 'flux-2-pro'
  const apiVersion = process.env.AZURE_FLUX_API_VERSION || 'preview'
  // Body-Feldname für das Referenzbild (image-to-image). Je nach Foundry-/BFL-
  // Variante 'input_image' oder 'image_prompt'. Vor dem Scharfschalten gegen den
  // echten Endpunkt verifizieren; Default 'input_image'.
  const refField   = process.env.AZURE_FLUX_IMG2IMG_FIELD || 'input_image'
  if (!endpoint || !key) throw new Error('Azure FLUX ist nicht konfiguriert (AZURE_FLUX_ENDPOINT/KEY).')

  const startedAt = Date.now()   // Basis für das Poll-Zeitbudget (s. unten)
  const url = `${endpoint}/providers/blackforestlabs/v1/${modelPath}?api-version=${apiVersion}`
  const body = {
    model,
    prompt: fullPrompt,
    width: IMAGE_W,
    height: IMAGE_H,
    output_format: 'png',
    num_images: 1,
  }
  // Referenzbild (Person soll wie auf dem echten Foto aussehen, in die
  // Kapitelzeit versetzt). Nur gesetzt, wenn ein Referenzbild übergeben wurde.
  if (referenceB64) body[refField] = referenceB64
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  })
  if (!resp.ok) {
    const errBody = await resp.text()
    console.error('FLUX error:', resp.status, errBody)
    let msg = `HTTP ${resp.status}`
    try { const j = JSON.parse(errBody); msg = j?.error?.message || j?.error?.code || j?.detail || msg } catch {}
    throw new Error(msg)
  }
  let data = await resp.json()

  const hasImageData = (d) => Boolean(
    d?.b64_json || d?.image || d?.data?.[0]?.b64_json ||
    d?.result?.sample || d?.sample || d?.url || d?.data?.[0]?.url
  )

  // Async-Variante: pollen, bis das Sample tatsächlich bereitsteht. Wir pollen
  // bis kurz vor dem 60-s-Function-Budget (statt fixer 45 s) – einzelne Kapitel-
  // bilder brauchen unter Last gelegentlich länger, und ein zu kurzes Fenster
  // war die häufigste Ursache für "Keine Bilddaten". Abbruchgrund (Timeout vs.
  // echter Fehler) wird unten unterschieden.
  const POLL_DEADLINE_MS = 50000  // lässt ~10 s für Upload + Kostenerfassung
  let polled = false
  const pollUrl = data?.polling_url || data?.poll_url
  if (pollUrl && !hasImageData(data)) {
    polled = true
    while (Date.now() - startedAt < POLL_DEADLINE_MS) {
      await sleep(1500)
      const pr = await fetch(pollUrl, { headers: { Authorization: `Bearer ${key}` } })
      data = await pr.json().catch(() => ({}))
      const st = String(data?.status || data?.state || '')
      if (hasImageData(data)) break       // erst abbrechen, wenn die Daten WIRKLICH da sind
      if (/error|fail|moderat/i.test(st)) throw new Error(`FLUX: ${st || 'Fehler'}`)
    }
  }

  const b64 = data?.b64_json || data?.image || data?.data?.[0]?.b64_json
  const out = b64 ? { b64 } : { url: data?.result?.sample || data?.sample || data?.url || data?.data?.[0]?.url }
  if (!b64 && !out.url) {
    console.error('FLUX: unerwartete Antwort:', JSON.stringify(data).slice(0, 500))
    // Polling-Timeout enthält bewusst "timeout" → der Client wertet das als
    // transient und versucht es (mit frischem 60-s-Budget) automatisch erneut.
    const st = String(data?.status || data?.state || '')
    throw new Error(polled
      ? `FLUX-Bild nicht rechtzeitig fertig (timeout, Status: ${st || 'pending'}).`
      : 'Keine Bilddaten von FLUX erhalten.')
  }
  const buffer = await bytesFromResult(out)
  return { buffer, model: FLUX_MODEL, provider: 'azure-flux' }
}

// Bewusst nur das, was die beiden Handler wirklich brauchen. IMAGE_W/IMAGE_H,
// FLUX_MODEL und bytesFromResult sind Interna von generateAzureFlux (das den
// Pricing-Key als `model` mitliefert).
module.exports = {
  stripMedium, isContentPolicyError, generateAzureFlux, SAFE_FALLBACK_PROMPT,
}
