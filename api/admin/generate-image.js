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

const { createClient } = require('@supabase/supabase-js')
const crypto = require('crypto')
const { costImage, recordCost } = require('../_lib/cost')
const { checkAuth } = require('../_lib/auth')
const { loadAccessibleMemorial } = require('../_lib/access')
const { IMAGE_BUCKET } = require('../_lib/delete-memorial')

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
const SPREAD_DIRECTIVE =
  'Render this as ONE single continuous panoramic landscape illustration in a wide format (roughly 1.43:1). ' +
  'The artwork itself must fill the entire frame edge to edge (full-bleed). ' +
  'It is the scene itself — NOT a photo of a printed image. ' +
  'Do NOT depict a book, an open book, pages, a page spread, a printed photograph, a poster, a postcard, a screen, a frame, a border, a mat, a passe-partout, a tabletop, a desk, a wall, or any object that contains or displays the picture. No mockup, no product shot, no hands. ' +
  'Keep the main focal elements and any important detail away from the exact vertical center and away from all four outer edges (these zones may be folded or trimmed). ' +
  'Balanced, atmospheric, edge-to-edge artwork that spans the full width; no text, no lettering, no captions.'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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
async function generateAzureFlux(fullPrompt) {
  const endpoint   = (process.env.AZURE_FLUX_ENDPOINT || '').replace(/\/+$/, '')
  const key        = process.env.AZURE_FLUX_KEY
  const model      = process.env.AZURE_FLUX_MODEL || 'FLUX.2-pro'
  const modelPath  = process.env.AZURE_FLUX_MODEL_PATH || 'flux-2-pro'
  const apiVersion = process.env.AZURE_FLUX_API_VERSION || 'preview'
  if (!endpoint || !key) throw new Error('Azure FLUX ist nicht konfiguriert (AZURE_FLUX_ENDPOINT/KEY).')

  const url = `${endpoint}/providers/blackforestlabs/v1/${modelPath}?api-version=${apiVersion}`
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      prompt: fullPrompt,
      width: IMAGE_W,
      height: IMAGE_H,
      output_format: 'png',
      num_images: 1,
    }),
  })
  if (!resp.ok) {
    const errBody = await resp.text()
    console.error('FLUX error:', resp.status, errBody)
    let msg = `HTTP ${resp.status}`
    try { const j = JSON.parse(errBody); msg = j?.error?.message || j?.error?.code || j?.detail || msg } catch {}
    throw new Error(msg)
  }
  let data = await resp.json()

  // Async-Variante: solange pollen, bis das Sample bereitsteht.
  const pollUrl = data?.polling_url || data?.poll_url
  if (pollUrl && !(data?.b64_json || data?.image || data?.result?.sample)) {
    for (let i = 0; i < 30; i++) {        // ~30 × 1,5 s ≈ 45 s, innerhalb des 60-s-Budgets
      await sleep(1500)
      const pr = await fetch(pollUrl, { headers: { Authorization: `Bearer ${key}` } })
      data = await pr.json().catch(() => ({}))
      const st = String(data?.status || data?.state || '')
      if (/ready|complete|succeed|success/i.test(st) || data?.result) break
      if (/error|fail|moderat/i.test(st)) throw new Error(`FLUX: ${st || 'Fehler'}`)
    }
  }

  const b64 = data?.b64_json || data?.image || data?.data?.[0]?.b64_json
  const out = b64 ? { b64 } : { url: data?.result?.sample || data?.sample || data?.url || data?.data?.[0]?.url }
  if (!b64 && !out.url) {
    console.error('FLUX: unerwartete Antwort:', JSON.stringify(data).slice(0, 500))
    throw new Error('Keine Bilddaten von FLUX erhalten.')
  }
  const buffer = await bytesFromResult(out)
  return { buffer, model: FLUX_MODEL, provider: 'azure-flux' }
}

module.exports = async function handler(req, res) {
  if (!checkAuth(req, res)) return
  if (req.method !== 'POST') return res.status(405).end()
  try {
    const { prompt, memorialCode, variant, chapterNumber, chapterHeading } = req.body || {}
    if (!prompt || !memorialCode) return res.status(400).json({ error: 'prompt und memorialCode erforderlich.' })

    // Nur für eigene Gedenkbücher (bzw. Admin) Bilder generieren – sonst könnte
    // ein Benutzer auf fremde Rechnung/in fremde Ordner generieren.
    const access = await loadAccessibleMemorial(supabase, req.auth, memorialCode)
    if (access.error) return res.status(access.status).json({ error: access.error })

    const fullPrompt = `${prompt}\n\n${SPREAD_DIRECTIVE}`

    let result
    try {
      result = await generateAzureFlux(fullPrompt)
    } catch (e) {
      return res.status(502).json({ error: `Bildgenerierung fehlgeschlagen: ${e.message}` })
    }

    const code = String(memorialCode).toUpperCase().trim()
    const storagePath = `${code}/${crypto.randomUUID()}.png`

    const { error: upErr } = await supabase.storage.from(BUCKET).upload(storagePath, result.buffer, {
      contentType: 'image/png',
      upsert: false,
    })
    if (upErr) {
      console.error('Storage upload error:', upErr)
      return res.status(500).json({ error: `Storage-Upload fehlgeschlagen: ${upErr.message}` })
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
      },
    })

    return res.json({ storagePath })
  } catch (e) {
    console.error('/api/admin/generate-image:', e)
    res.status(500).json({ error: e.message })
  }
}
