// api/admin/generate-image.js
// POST /api/admin/generate-image  { memorialCode, prompt } → { storagePath }
// Generiert ein druckfertiges Doppelseiten-Bild und lädt es in den (privaten)
// Supabase-Storage-Bucket "memorial-images".
//
// Einziges Bildmodul: FLUX.2 [pro] von Black Forest Labs (deutscher Anbieter)
// über Microsoft Foundry – Verarbeitung bleibt in Azure (kein Forwarding an
// BFL, kein Training auf den Daten), gleicher Microsoft-AVV wie Azure OpenAI.
// (Der frühere OpenAI/gpt-image-1-Pfad wurde am 2026-06-21 entfernt.)
// Nötige Env:
//   AZURE_FLUX_ENDPOINT    z. B. https://<resource>.services.ai.azure.com
//   AZURE_FLUX_KEY         Schlüssel der Foundry-Ressource
//   AZURE_FLUX_MODEL       optional, Body-Feld "model" (Default FLUX.2-pro)
//   AZURE_FLUX_MODEL_PATH  optional, Endpunkt-Pfad   (Default flux-2-pro)
//   AZURE_FLUX_API_VERSION optional (Default 'preview')

const { createClient } = require('../_lib/store')
const crypto = require('crypto')
const { costImage, recordCost } = require('../_lib/cost')
const { checkAuth } = require('../_lib/auth')
const { loadAccessibleMemorial } = require('../_lib/access')
const { IMAGE_BUCKET } = require('../_lib/delete-memorial')
const { normalizeStyle, styleDirective, styleAnchor, DEFAULT_STYLE } = require('../_lib/image-styles')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

const BUCKET = IMAGE_BUCKET
// Pricing-Key (cost.js): FLUX nach `${model}-${size}`. Zielformat 1536×1024.
const IMAGE_W = 1536, IMAGE_H = 1024
const FLUX_MODEL = `flux-2-pro-${IMAGE_W}x${IMAGE_H}`

// Kompositions-Direktive für das druckfertige Doppelseiten-Layout. Jedes
// Kapitelbild läuft im Druck über zwei gegenüberliegende Seiten: die exakte
// vertikale Mitte wird zum Buchfalz (Bundsteg), die vier Außenkanten werden
// beschnitten (Cover-Platzierung im Druck-PDF). Das Bildmodell liefert das
// Zielformat 30,8 × 21,6 cm (~1,43:1) nicht exakt — wir erzeugen die breiteste
// verfügbare Größe (1536×1024) und lassen das Motiv bewusst für die Doppelseite
// komponieren, damit weder Falz noch Beschnitt wichtige Bildteile zerstören.
// WICHTIG: nicht von einem "book spread" sprechen – das Modell malt sonst ein
// echtes aufgeschlagenes Buch (auf einem Tisch, mit Bild darin). Wir beschreiben
// nur Seitenverhältnis und Sicherheitszonen und verbieten jede Rahmung/Requisite
// explizit. Das Motiv IST das Bild, nicht ein abfotografiertes Objekt.
// MEDIEN-NEUTRAL: Wörter wie "illustration" oder "artwork" haben hier früher das
// Medium mitbestimmt und die Stil-Direktive überstimmt (die Bilder eines Buchs
// sahen dann unterschiedlich aus). Nur noch "image"/"picture" verwenden.
const SPREAD_DIRECTIVE =
  'Composition: ONE single continuous panoramic landscape image in a wide format (roughly 1.43:1). ' +
  'The picture itself must fill the entire frame edge to edge (full-bleed). ' +
  'It is the scene itself — NOT a photo of a printed image. ' +
  // Personen sind ausdrücklich erwünscht: das Bild soll die Person(en) des
  // Kapitels in ihrer Handlung und im Zeitkolorit der jeweiligen Epoche zeigen
  // (periodengerechte Kleidung, Umgebung und Foto-/Filmanmutung dieser Zeit).
  // Medien-NEUTRAL formuliert: das konkrete Medium (Foto/Aquarell/Zeichnung) gibt
  // die separate Stil-Direktive vor (image-styles.js), nicht diese Zeile.
  'People are welcome and preferred when the chapter is about a person: depict them warmly and authentically, dressed and set in the correct historical period of the chapter, evoking the mood and atmosphere of that era. ' +
  'Do NOT depict a book, an open book, pages, a page spread, a printed photograph, a poster, a postcard, a screen, a frame, a border, a mat, a passe-partout, a tabletop, a desk, a wall, or any object that contains or displays the picture. No mockup, no product shot. ' +
  'Keep the main focal elements — especially faces — away from the exact vertical center and away from all four outer edges (these zones may be folded or trimmed). ' +
  'Balanced, warm, atmospheric, edge-to-edge and spanning the full width; no text, no lettering, no captions.'

// ── Vignetten für das Lebensposter ────────────────────────────────
// Ein Poster besteht nicht aus Doppelseiten-Landschaften, sondern aus vielen
// kleinen, freigestellten Illustrationen, die auf dem Papier „schweben" (siehe
// die Vorbilder: Haus, Lokomotive, Akkordeon, Vespa …). Deshalb ein eigener
// Prompt-Aufbau: KEINE SPREAD_DIRECTIVE, KEINE Stil-Direktive des Buchs — der
// Posterstil ist einheitlich flach-illustrativ, und der Hintergrund ist exakt
// die Papierfarbe des Posters, damit sich die Vignette nahtlos einfügt.
// Fünf Illustrationsstile — sie korrespondieren 1:1 mit POSTER_STYLES in
// src/lifeworkExtras.js (Schlüssel identisch), damit Vignetten und Layout
// zusammenpassen. Die Papierfarbe steht im Prompt, damit die Vignette optisch
// mit dem Poster verschmilzt.
const VIGNETTE_STYLES = {
  storybook: {
    paper: '#F6EFE1',
    look: 'Warm hand-drawn storybook illustration: soft muted earth tones (terracotta, ochre, sage green, dusty blue, cream), confident inked outlines, gentle flat shading, a little paper texture. No photorealism.',
  },
  journal: {
    paper: '#F7F2E5',
    look: 'Hand-kept travel sketchbook page: loose confident ink pen lines with visible sketchy hatching, filled in with translucent watercolour washes that run slightly outside the lines — indigo, terracotta, olive, ochre, muted teal on warm notebook paper. Unpolished and hand-made, like decades of sketches on one page. No photorealism.',
  },
  atlas: {
    paper: '#F0E5CD',
    look: 'Antique atlas engraving: fine sepia and ink line work, cross-hatching, aged copperplate feel, restrained washes of faded brown and olive. Looks drawn into an old map. No photorealism.',
  },
  watercolor: {
    paper: '#FCFAF7',
    look: 'Delicate watercolour illustration: translucent washes, soft bleeding edges, airy pastel palette (rose, sage, dusty blue, sand), visible paper grain, plenty of white space. No harsh outlines, no photorealism.',
  },
  nouveau: {
    paper: '#F3ECDC',
    look: 'Ornamental art nouveau / stained-glass illustration on ivory paper: flowing sinuous contour lines like leading in a window, deep jewel colours (emerald, peacock blue, deep rose, aubergine) with warm gold accents, stylised organic plant forms curling around each scene, decorative and festive. Flat luminous colour, no photorealism.',
  },
}

// Das ganze Lebensposter als EIN illustriertes Blatt (Variante 'scene'). Genau
// die Optik der Vorbilder — mäandernder Weg, viele kleine Szenen — aber ohne ein
// einziges Schriftzeichen: Beschriftungen setzt das Layout als Vektortext, weil
// Bildmodelle sich verschreiben („Goburt in Segen"). Damit dafür Platz bleibt,
// verlangt der Prompt großzügige ruhige Flächen.
const sceneDirective = (key) => {
  const s = VIGNETTE_STYLES[key] || VIGNETTE_STYLES.storybook
  return `${s.look} ` +
    'ONE single wide illustrated "map of a life", drawn like a page from a children\'s picture book. ' +
    // WICHTIG (teuer gelernt): Die Ansage „keine Karten, keine Rechtecke" (für die
    // Szenen) und die Bitte um leere Schild-KARTEN widersprachen sich — FLUX löste
    // den Widerspruch, indem es die Schilder wegließ. Deshalb steht hier jetzt
    // ausdrücklich, dass das Blatt aus GENAU ZWEI Arten von Elementen besteht.
    'THE SHEET CONTAINS EXACTLY TWO KINDS OF ELEMENTS, nothing else: ' +
    '(1) about twelve SCENES (buildings, interiors, tools, vehicles, gardens, landscapes), arranged as a LOOSE GRID in READING ORDER: left to right, row by row, top to bottom. Each scene is an ORGANIC, IRREGULAR painted shape whose edges dissolve softly into the bare paper — like a watercolour blot. A scene is NEVER a rectangle and NEVER framed. ' +
    '(2) exactly ONE EMPTY LABEL CARD under EVERY scene: a small cream-white ROUNDED RECTANGLE with a thin ink outline, lying flat on the bare paper directly BELOW its scene, roughly as wide as that scene and about one fifth as tall. These label cards are the ONLY rectangular shapes on the whole sheet. Every scene has exactly one card; no scene without a card, no card without a scene. ' +
    'The label cards are COMPLETELY BLANK and EMPTY — a flat, clean, uniform pale surface, no writing, no lines, no ornament, no scribbles, nothing on them at all. They are clearly LIGHTER than everything around them. ' +
    'A road WINDS and LOOPS wildly ACROSS THE WHOLE SHEET, from the bottom left corner to the top right, through the gaps between the scenes — many bends and curves, never a straight line — passing EVERY scene in reading order. It reaches all four regions of the sheet, not just one half. ' +
    `The paper is a flat plain background of the exact colour ${s.paper}. ` +
    'CRUCIAL SPACING: the scenes must be clearly SEPARATED by WIDE alleys of that plain paper colour — each scene stands alone with generous plain space around it; scenes must never touch or merge. ' +
    'About one third of the sheet stays plain paper, distributed as those alleys between the scenes (NOT as one large empty region). ' +
    'Keep a narrow empty margin of about 4% around the outer edge. ' +
    'No human faces, no portraits — figures only small and from a distance. ' +
    // Bildmodelle malen auf „Poster"-Motiven reflexhaft Schrift (Schilder, Titel,
    // Jahreszahlen) — und verschreiben sich dabei. Deshalb hier maximal deutlich:
    // Jede Fläche, die im Trainingsbild Text getragen hätte, bleibt leer.
    'ABSOLUTELY NO TEXT OF ANY KIND. No letters, no words, no numbers, no dates, no captions, no labels, no titles, no headings, no legends, no signage, no shop signs, no book covers with lettering, no newspapers, no posters within the picture, no handwriting, no scribbles that resemble writing, no calligraphy, no watermark, no signature. ' +
    'Signs, boards, book spines and papers that would normally carry writing must be left completely BLANK. ' +
    'The sheet must be entirely free of any glyph, character or symbol resembling a letter or digit.'
}

// Eine Szene = eine Kachel des Posters. Der Renderer setzt die Kacheln direkt
// aneinander, also muss die Szene ihre Fläche FÜLLEN (früher schwebte sie in der
// Mitte, das Blatt wirkte dadurch leer). Nur die äußersten Ränder laufen weich in
// die Papierfarbe aus, damit benachbarte Kacheln zu einem Blatt verschmelzen.
const vignetteDirective = (key) => {
  const s = VIGNETTE_STYLES[key] || VIGNETTE_STYLES.storybook
  return `${s.look} ` +
    'A SCENE: a place with objects, light and atmosphere. ' +
    'The scene FILLS the whole frame from edge to edge — a full illustrated picture, not a small motif floating in space. ' +
    `Only the outermost few percent of the frame soften and fade into the flat paper colour ${s.paper}, so the picture blends into the paper: ` +
    'NO frame, NO border, NO outline, NO drop shadow, no hard cut-out edges, no white box around the picture. ' +
    'No human faces and no portraits — show objects, places, tools, vehicles, animals or figures seen from a distance/from behind. ' +
    'Absolutely NO text, NO letters, NO numbers, NO captions, NO labels, NO signage anywhere in the image.'
}

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

// Lädt ein Referenzbild aus dem eigenen Gedenkbuch-Ordner und gibt es klein
// skaliert als base64-JPEG zurück (hält die Anfrage kompakt). Nur Pfade unter
// <CODE>/ sind zulässig. Fehlertolerant: liefert null bei Problemen.
async function loadReferenceB64(refPath, code) {
  try {
    if (!refPath || !String(refPath).startsWith(`${code}/`)) return null
    const { data, error } = await supabase.storage.from(BUCKET).download(refPath)
    if (error || !data) return null
    const buf = Buffer.from(await data.arrayBuffer())
    const sharp = require('sharp')
    const small = await sharp(buf).rotate()
      .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 88 }).toBuffer()
    return small.toString('base64')
  } catch (e) {
    console.warn('Referenzbild nicht ladbar:', e.message)
    return null
  }
}

module.exports = async function handler(req, res) {
  if (!checkAuth(req, res)) return
  if (req.method !== 'POST') return res.status(405).end()
  try {
    const { prompt, memorialCode, variant, chapterNumber, chapterHeading, referencePaths, imageStyle } = req.body || {}
    if (!prompt || !memorialCode) return res.status(400).json({ error: 'prompt und memorialCode erforderlich.' })

    // Nur für eigene Gedenkbücher (bzw. Admin) Bilder generieren – sonst könnte
    // ein Benutzer auf fremde Rechnung/in fremde Ordner generieren.
    const access = await loadAccessibleMemorial(supabase, req.auth, memorialCode)
    if (access.error) return res.status(access.status).json({ error: access.error })

    const code = String(memorialCode).toUpperCase().trim()

    // Grafikstil bestimmen: primär aus dem Request (der Generierungs-Loop kennt den
    // Stil des Buchs), sonst defensiv aus der DB, sonst Default. So bleibt jedes
    // Bild eines Buchs konsistent im gewählten Stil – ohne harte Migrations-Abhängigkeit.
    let style = normalizeStyle(imageStyle)
    if (!style) {
      try {
        const { data } = await supabase.from('memorials').select('image_style').eq('id', code).maybeSingle()
        style = normalizeStyle(data?.image_style)
      } catch { /* Spalte evtl. noch nicht vorhanden → Default */ }
    }
    style = style || DEFAULT_STYLE
    const styleDir = styleDirective(style)
    const anchor = styleAnchor(style)
    // Reihenfolge zaehlt: Stil rahmt den Prompt (vorne) UND schliesst ihn ab
    // (hinten, staerkste Gewichtung). Das Motiv selbst wird von Medien-Woertern
    // befreit, damit ein "vintage photo"-Motiv nicht den Aquarell-Stil kippt.
    // Poster-Vignette: eigener Aufbau (freigestellte Illustration auf Papierfarbe,
    // kein Doppelseiten-Motiv, kein Buch-Grafikstil). Siehe VIGNETTE_DIRECTIVE.
    const isScene = variant === 'scene'
    const isVignette = variant === 'vignette' || isScene
    const vigDir = isScene ? sceneDirective(req.body?.posterStyle)
      : (isVignette ? vignetteDirective(req.body?.posterStyle) : null)
    const build = isVignette
      // Bei Vignetten wird das Motiv NICHT von Medium-Wörtern befreit — der Stil
      // steckt hier gerade in der Direktive, und das Motiv ist ohnehin ein reines
      // Objekt ("an old accordion"). Direktive rahmt vorne und hinten.
      ? (motif) => `${vigDir}\n\nSubject: ${motif}\n\n${vigDir}`
      : (motif) => `${styleDir}\n\nSubject: ${stripMedium(motif)}\n\n${SPREAD_DIRECTIVE}\n\n${anchor}`
    const fullPrompt = build(prompt)
    const fallbackPrompt = build(SAFE_FALLBACK_PROMPT)

    // image-to-image (echte Personen-Ähnlichkeit, in die Kapitelzeit versetzt):
    // NUR wenn AZURE_FLUX_IMG2IMG gesetzt ist UND ein Referenzbild vorliegt.
    // Voraussetzung ist ein Consent, der die KI-Verarbeitung deckt – das prüft
    // der Aufrufer (nur solche Pfade werden übergeben).
    let referenceB64 = null
    const img2imgEnabled = Boolean(process.env.AZURE_FLUX_IMG2IMG)
    if (img2imgEnabled && Array.isArray(referencePaths) && referencePaths.length) {
      referenceB64 = await loadReferenceB64(referencePaths[0], code)
    }

    let result
    let usedFallback = false
    let usedImg2img = Boolean(referenceB64)
    try {
      result = await generateAzureFlux(fullPrompt, referenceB64)
    } catch (e) {
      // Inhaltsfilter-Block: GENAU dieser Prompt wird dauerhaft abgelehnt –
      // einmalig auf ein neutrales Ersatzmotiv ausweichen, statt das Kapitel
      // ganz ohne Bild zu lassen.
      if (isContentPolicyError(e.message)) {
        console.warn('FLUX Inhaltsfilter-Block, weiche auf neutrales Motiv aus:', e.message)
        try {
          result = await generateAzureFlux(fallbackPrompt)
          usedFallback = true
          usedImg2img = false
        } catch (e2) {
          return res.status(502).json({ error: `Bildgenerierung fehlgeschlagen (Inhaltsfilter): ${e.message}` })
        }
      } else if (referenceB64) {
        // Referenzbild evtl. vom Endpunkt nicht akzeptiert → ohne Referenz erneut
        // (text-to-image), damit das Kapitel trotzdem ein Bild bekommt.
        console.warn('FLUX image-to-image fehlgeschlagen, weiche auf text-to-image aus:', e.message)
        try {
          result = await generateAzureFlux(fullPrompt)
          usedImg2img = false
        } catch (e2) {
          if (isContentPolicyError(e2.message)) {
            try { result = await generateAzureFlux(fallbackPrompt); usedFallback = true; usedImg2img = false }
            catch (e3) { return res.status(502).json({ error: `Bildgenerierung fehlgeschlagen (Inhaltsfilter): ${e2.message}` }) }
          } else {
            return res.status(502).json({ error: `Bildgenerierung fehlgeschlagen: ${e2.message}` })
          }
        }
      } else {
        return res.status(502).json({ error: `Bildgenerierung fehlgeschlagen: ${e.message}` })
      }
    }

    const storagePath = `${code}/${crypto.randomUUID()}.png`

    const { error: upErr } = await supabase.storage.from(BUCKET).upload(storagePath, result.buffer, {
      contentType: 'image/png',
      upsert: false,
    })
    if (upErr) {
      console.error('Storage upload error:', upErr)
      return res.status(500).json({ error: `Storage-Upload fehlgeschlagen: ${upErr.message}` })
    }

    // Kleine JPEG-Vorschau (Thumbnail) miterzeugen und unter <pfad>_thumb.jpg
    // ablegen — fürs schnelle Bilder-Raster. Der Pfad wird beim Signieren aus
    // image_path abgeleitet, daher kein Schema-/Kapitelfeld nötig. Voll
    // fehlertolerant: schlägt es fehl, bleibt einfach nur das Vollbild.
    try {
      const sharp = require('sharp')
      const thumbBuf = await sharp(result.buffer)
        .resize(480, 320, { fit: 'cover' })
        .jpeg({ quality: 72 })
        .toBuffer()
      const thumbPath = storagePath.replace(/\.png$/i, '_thumb.jpg')
      const { error: tErr } = await supabase.storage.from(BUCKET).upload(thumbPath, thumbBuf, {
        contentType: 'image/jpeg',
        upsert: true,
      })
      if (tErr) console.warn('Thumbnail-Upload fehlgeschlagen (nicht kritisch):', tErr.message)
    } catch (e) {
      console.warn('Thumbnail-Erzeugung übersprungen (nicht kritisch):', e.message)
    }

    await recordCost({
      memorial_id: code,
      kind: 'image',
      provider: result.provider,
      model: result.model,
      images: 1,
      cost_usd: costImage(result.model, 1),
      metadata: {
        storage_path: storagePath,
        // Zuordnung für die Kostenansicht (welche Variante / welches Kapitel)
        ...(variant ? { variant: String(variant) } : {}),
        ...(chapterNumber != null ? { chapter: Number(chapterNumber) } : {}),
        ...(chapterHeading ? { chapter_heading: String(chapterHeading).slice(0, 200) } : {}),
        ...(usedFallback ? { fallback: 'content_policy' } : {}),
        ...(usedImg2img ? { img2img: true } : {}),
      },
    })

    // img2img im Response melden → macht die Verifizierung von AZURE_FLUX_IMG2IMG
    // eindeutig (true = Referenzbild wurde tatsächlich mitgeschickt & akzeptiert;
    // fehlt es trotz gesetztem Flag+Referenz, ist der Endpunkt/das Feldname-Mapping
    // zu prüfen – dann wurde auf reines Text-zu-Bild zurückgefallen).
    return res.json({ storagePath, ...(usedFallback ? { fallback: 'content_policy' } : {}), ...(usedImg2img ? { img2img: true } : {}) })
  } catch (e) {
    console.error('/api/admin/generate-image:', e)
    res.status(500).json({ error: e.message })
  }
}
