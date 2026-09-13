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
const { costImage, recordCost, enforceBudget } = require('../_lib/cost')
const { checkAuth } = require('../_lib/auth')
const { loadAccessibleMemorial } = require('../_lib/access')
const { IMAGE_BUCKET } = require('../_lib/delete-memorial')
const { normalizeStyle, styleDirective, styleAnchor, DEFAULT_STYLE } = require('../_lib/image-styles')

const supabase = createClient()

const BUCKET = IMAGE_BUCKET
// Bilderzeugung + Prompt-Saeuberung liegen gemeinsam in api/_lib/flux.js (dort
// auch Bildgroesse und der Pricing-Key FLUX_MODEL, den generateAzureFlux
// zurueckgibt).
const {
  stripMedium, isContentPolicyError, generateAzureFlux, SAFE_FALLBACK_PROMPT,
} = require('../_lib/flux')

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
    // KEINE Schilder mehr im Blatt: Eine leere Karte im Bild lädt das Modell dazu
    // ein, sie vollzukritzeln („Four Cowip", „Snuchsmornings"). Die Beschriftungs-
    // felder entstehen deshalb als EIGENE Grafik (Variante 'bubble') und werden
    // vom Layout ins Blatt gesetzt — das Bildmodell sieht Text und Feld nie
    // zusammen und kann sich folglich auch nicht verschreiben.
    'EXACTLY TWELVE SCENES (buildings, interiors, tools, vehicles, gardens, landscapes), arranged as a LOOSE GRID in READING ORDER: left to right, row by row, top to bottom. ' +
    'Each scene is an ORGANIC, IRREGULAR painted shape whose edges dissolve softly into the bare paper — like a watercolour blot. A scene is NEVER a rectangle, NEVER framed, no panels, no cards, no signs, no labels, no plaques, no banners. ' +
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

// ── Das Beschriftungsfeld als EIGENE Grafik ───────────────────────
// Warum getrennt: Ein Bildmodell, das ein Beschriftungsfeld malt, schreibt fast
// zwangsläufig etwas hinein — und verschreibt sich dabei. Also bekommt es den
// Auftrag ohne jeden Textbezug: EIN leeres, handgemaltes Feld auf leerem Papier,
// im Stil des Posters. Das Layout schneidet es frei, setzt es so oft ins Blatt,
// wie es Stationen gibt, und druckt den echten Text als Vektor darauf.
const bubbleDirective = (key) => {
  const s = VIGNETTE_STYLES[key] || VIGNETTE_STYLES.storybook
  return `${s.look} ` +
    'ONE single hand-drawn blank LABEL PLAQUE, centred, seen straight from the front, filling most of the frame. ' +
    'It looks like a small paper tag or wooden signboard: a horizontal rounded shape with a hand-drawn ink outline and a slightly uneven, hand-made silhouette (never a perfect machine rectangle), with a soft warm highlight and a faint shadow. ' +
    `Its surface is a clean, uniform, PALE surface, clearly lighter than the surrounding paper, and the area AROUND the plaque is flat plain paper of the exact colour ${s.paper} — nothing else in the picture. ` +
    'The plaque is COMPLETELY BLANK: no writing, no letters, no numbers, no lines, no ruling, no ornament, no scribbles, no decoration, nothing on its surface at all. It is an empty label waiting to be written on. ' +
    'No scene, no objects, no people, no background motif. ' +
    'ABSOLUTELY NO TEXT ANYWHERE IN THE IMAGE.'
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
    // Kosten-Obergrenze je Buch erschöpft → keine Bilderzeugung mehr (402).
    if (!(await enforceBudget(res, code))) return

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
    const isBubble = variant === 'bubble'     // leeres Beschriftungsfeld als eigene Grafik
    const isVignette = variant === 'vignette' || isScene || isBubble
    const vigDir = isScene ? sceneDirective(req.body?.posterStyle)
      : isBubble ? bubbleDirective(req.body?.posterStyle)
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
