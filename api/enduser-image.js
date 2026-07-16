// api/enduser-image.js
// POST /api/enduser-image?code=ABC   { chapterNumber, prompt, token, imageStyle }
//
// Endnutzer-Bildgenerierung für die vorläufige DRUCKVERSION (nur Lebenswerk).
// Erzeugt EIN Kapitel-Doppelseitenbild via FLUX.2 [pro] (Azure Foundry) und legt es
// im Bucket ab. Pro Kapitel sind 1 Erstbild + (proof_max) Neugenerierungen erlaubt
// (serverseitig gezählt in memorials.image_regen). Die Historie/Zuordnung pflegt der
// Client im Buch (book_v2.chapters[].image_path / image_history) und speichert sie
// über /api/enduser-book (save-book).
//
// HINWEIS: Der FLUX-Kern (Prompt-Aufbau + Aufruf) spiegelt bewusst
// api/admin/generate-image.js (Kapitelpfad) — Duplikat statt Refactor, um den
// kritischen Admin-Bildpfad nicht anzufassen. Kein Poster/Vignette, kein img2img.
// Autorisierung wie die übrigen Endnutzer-Pfade: eu-Token ODER Buch-Code (Lebenswerk).

const crypto = require('crypto')
const { createClient } = require('./_lib/store')
const { enforce } = require('./_lib/ratelimit')
const { checkAuth } = require('./_lib/auth')
const { LIFEWORK } = require('./_lib/lifework')
const { costImage, recordCost, enforceBudget } = require('./_lib/cost')
const { normalizeStyle, styleDirective, styleAnchor, DEFAULT_STYLE } = require('./_lib/image-styles')
const { IMAGE_BUCKET } = require('./_lib/delete-memorial')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

const BUCKET = IMAGE_BUCKET
const IMAGE_W = 1536, IMAGE_H = 1024
const FLUX_MODEL = `flux-2-pro-${IMAGE_W}x${IMAGE_H}`

// — Kompositions-Direktive (Doppelseiten-Landschaft), identisch zum Admin-Pfad —
const SPREAD_DIRECTIVE =
  'Composition: ONE single continuous panoramic landscape image in a wide format (roughly 1.43:1). ' +
  'The picture itself must fill the entire frame edge to edge (full-bleed). ' +
  'It is the scene itself — NOT a photo of a printed image. ' +
  'People are welcome and preferred when the chapter is about a person: depict them warmly and authentically, dressed and set in the correct historical period of the chapter, evoking the mood and atmosphere of that era. ' +
  'Do NOT depict a book, an open book, pages, a page spread, a printed photograph, a poster, a postcard, a screen, a frame, a border, a mat, a passe-partout, a tabletop, a desk, a wall, or any object that contains or displays the picture. No mockup, no product shot. ' +
  'Keep the main focal elements — especially faces — away from the exact vertical center and away from all four outer edges (these zones may be folded or trimmed). ' +
  'Balanced, warm, atmospheric, edge-to-edge and spanning the full width; no text, no lettering, no captions.'

const MEDIUM_SRC =
  '\\b(?:hyper-?realistic|photo-?realistic|photorealism|cinematic|filmic|movie still|film still|' +
  '(?:vintage|sepia|black[- ]and[- ]white|b&w|analog|polaroid|old|archival|documentary|candid|studio|dslr|35mm|film)?\\s*' +
  '(?:photograph|photography|photo|snapshot)|' +
  'oil painting|watercolou?r(?:\\s+painting)?|gouache|acrylic|pastel|charcoal|ink drawing|pencil (?:drawing|sketch)|sketch|' +
  'etching|engraving|woodcut|lithograph|painting|painterly|illustration|illustrated|drawing|artwork|' +
  'digital art|concept art|matte painting|3-?d render|3-?d|render(?:ed|ing)?|cgi|unreal engine|octane|' +
  'anime|manga|comic|cartoon|storybook|pixar|disney|impressionist|expressionist|art nouveau|art deco)\\b'
const MEDIUM_WORDS = new RegExp(MEDIUM_SRC, 'gi')
const MEDIUM_LEAD = new RegExp('^[^,.]{0,40}?(?:(?:' + MEDIUM_SRC + ')[\\s,:;-]*){1,3}(?:of|showing|depicting|featuring|capturing)?[\\s,:;-]*', 'i')
function stripMedium(text) {
  const cleaned = String(text || '')
    .replace(MEDIUM_LEAD, '').replace(MEDIUM_WORDS, ' ')
    .replace(/\b(?:in|as|a|an|the|of|with|style|styled|look|aesthetic|vibe|quality)\b(?=[\s,;.]*(?:$|[,;.]))/gi, ' ')
    .replace(/,\s*(?=,)/g, '').replace(/\s{2,}/g, ' ').replace(/\s+([,;.])/g, '$1')
    .replace(/^[\s,;.\-]+|[\s,;.\-]+$/g, '').trim()
  return cleaned.length >= 15 ? cleaned : String(text || '').trim()
}

const SAFE_FALLBACK_PROMPT =
  'A serene, atmospheric memorial scene: a peaceful natural landscape at soft golden-hour light, a gentle meadow with wildflowers, distant calm hills and a tender sky. ' +
  'Quiet, comforting and dignified mood, evoking remembrance, love and gratitude. No people, no faces, no text, no lettering, no logos, no symbols, no religious icons.'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function isContentPolicyError(msg) {
  return /RAI policy|BingBlockList|responsible ai|content (policy|filter|management)|blocklist|block list|moderat|flagged/i.test(String(msg || ''))
}
async function bytesFromResult(out) {
  if (out?.b64) return Buffer.from(out.b64, 'base64')
  if (out?.url) {
    const r = await fetch(out.url)
    if (!r.ok) throw new Error(`Bild-Download fehlgeschlagen: HTTP ${r.status}`)
    return Buffer.from(await r.arrayBuffer())
  }
  throw new Error('Keine Bilddaten erhalten.')
}
async function generateAzureFlux(fullPrompt) {
  const endpoint = (process.env.AZURE_FLUX_ENDPOINT || '').replace(/\/+$/, '')
  const key = process.env.AZURE_FLUX_KEY
  const model = process.env.AZURE_FLUX_MODEL || 'FLUX.2-pro'
  const modelPath = process.env.AZURE_FLUX_MODEL_PATH || 'flux-2-pro'
  const apiVersion = process.env.AZURE_FLUX_API_VERSION || 'preview'
  if (!endpoint || !key) throw new Error('Azure FLUX ist nicht konfiguriert (AZURE_FLUX_ENDPOINT/KEY).')
  const startedAt = Date.now()
  const url = `${endpoint}/providers/blackforestlabs/v1/${modelPath}?api-version=${apiVersion}`
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, prompt: fullPrompt, width: IMAGE_W, height: IMAGE_H, output_format: 'png', num_images: 1 }),
  })
  if (!resp.ok) {
    const errBody = await resp.text()
    let msg = `HTTP ${resp.status}`
    try { const j = JSON.parse(errBody); msg = j?.error?.message || j?.error?.code || j?.detail || msg } catch {}
    throw new Error(msg)
  }
  let data = await resp.json()
  const hasImageData = (d) => Boolean(d?.b64_json || d?.image || d?.data?.[0]?.b64_json || d?.result?.sample || d?.sample || d?.url || d?.data?.[0]?.url)
  const POLL_DEADLINE_MS = 50000
  let polled = false
  const pollUrl = data?.polling_url || data?.poll_url
  if (pollUrl && !hasImageData(data)) {
    polled = true
    while (Date.now() - startedAt < POLL_DEADLINE_MS) {
      await sleep(1500)
      const pr = await fetch(pollUrl, { headers: { Authorization: `Bearer ${key}` } })
      data = await pr.json().catch(() => ({}))
      const st = String(data?.status || data?.state || '')
      if (hasImageData(data)) break
      if (/error|fail|moderat/i.test(st)) throw new Error(`FLUX: ${st || 'Fehler'}`)
    }
  }
  const b64 = data?.b64_json || data?.image || data?.data?.[0]?.b64_json
  const out = b64 ? { b64 } : { url: data?.result?.sample || data?.sample || data?.url || data?.data?.[0]?.url }
  if (!b64 && !out.url) {
    const st = String(data?.status || data?.state || '')
    throw new Error(polled ? `FLUX-Bild nicht rechtzeitig fertig (timeout, Status: ${st || 'pending'}).` : 'Keine Bilddaten von FLUX erhalten.')
  }
  const buffer = await bytesFromResult(out)
  return { buffer, model: FLUX_MODEL, provider: 'azure-flux' }
}

// Autorisierung + Laden (mirror von enduser-book.js).
async function authAndLoad(req, res, code) {
  const { data: m } = await supabase.from('memorials')
    .select('id, product_category, proof_enabled, proof_max, book_finalized, edit_lock, image_regen, image_style')
    .eq('id', code).maybeSingle()
  if (!m) { res.status(404).json({ error: 'Buch nicht gefunden.' }); return null }
  if (m.product_category !== LIFEWORK) { res.status(403).json({ error: 'Nur beim Lebenswerk verfügbar.' }); return null }
  const hasToken = /^Bearer\s/.test(req.headers.authorization || '')
  if (hasToken) {
    if (!checkAuth(req, res)) return null
    if (req.auth.eu !== code && !req.auth.admin) { res.status(403).json({ error: 'Kein Zugriff.' }); return null }
  }
  return m
}
function lockActive(lk) { return lk && lk.expires && Date.now() < new Date(lk.expires).getTime() }

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try {
    // FLUX kostet — streng begrenzen.
    if (!(await enforce(req, res, { name: 'enduser-image', limit: 40, windowSeconds: 600 }))) return
    const code = (req.query.code || '').toUpperCase().trim()
    if (!code) return res.status(400).json({ error: 'Code fehlt.' })
    const { chapterNumber, prompt, token, imageStyle } = req.body || {}
    if (chapterNumber == null || !prompt) return res.status(400).json({ error: 'chapterNumber und prompt erforderlich.' })

    const m = await authAndLoad(req, res, code)
    if (!m) return
    // Kosten-Obergrenze je Buch erschöpft → keine Bilderzeugung mehr (402).
    if (!(await enforceBudget(res, code))) return
    if (!m.proof_enabled) return res.status(403).json({ error: 'Nicht freigeschaltet.' })
    if (m.book_finalized) return res.status(409).json({ error: 'Das Buch ist bereits abgeschlossen.' })
    if (!lockActive(m.edit_lock) || m.edit_lock.token !== String(token || '') || m.edit_lock.holder !== 'enduser') {
      return res.status(409).json({ error: 'Ihre Bearbeitungssitzung ist abgelaufen. Bitte neu laden.' })
    }

    // Pro Kapitel: 1 Erstbild + proof_max Neugenerierungen.
    const ch = String(chapterNumber)
    const maxTotal = (Number.isFinite(m.proof_max) ? m.proof_max : 3) + 1
    const cur = Number((m.image_regen && m.image_regen[ch]) || 0)
    if (cur >= maxTotal) return res.status(409).json({ error: `Für dieses Kapitel sind keine Neugenerierungen mehr übrig (${maxTotal - 1} verbraucht).`, count: cur, max: maxTotal })

    // Prompt aufbauen: Grafikstil des Buchs. Der AKTUELLE DB-Wert (m.image_style)
    // hat Vorrang vor dem evtl. veralteten Client-Wert — so wirkt eine Stiländerung
    // im Einstellungs-Tab sofort auch auf neu erzeugte Bilder der Endversion.
    const style = normalizeStyle(m.image_style) || normalizeStyle(imageStyle) || DEFAULT_STYLE
    const fullPrompt = `${styleDirective(style)}\n\nSubject: ${stripMedium(prompt)}\n\n${SPREAD_DIRECTIVE}\n\n${styleAnchor(style)}`
    const fallbackPrompt = `${styleDirective(style)}\n\nSubject: ${stripMedium(SAFE_FALLBACK_PROMPT)}\n\n${SPREAD_DIRECTIVE}\n\n${styleAnchor(style)}`
    let result, usedFallback = false
    try {
      result = await generateAzureFlux(fullPrompt)
    } catch (e) {
      if (isContentPolicyError(e.message)) {
        try { result = await generateAzureFlux(fallbackPrompt); usedFallback = true }
        catch (e2) { return res.status(502).json({ error: `Bildgenerierung fehlgeschlagen (Inhaltsfilter): ${e.message}` }) }
      } else {
        return res.status(502).json({ error: `Bildgenerierung fehlgeschlagen: ${e.message}` })
      }
    }

    const storagePath = `${code}/${crypto.randomUUID()}.png`
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(storagePath, result.buffer, { contentType: 'image/png', upsert: false })
    if (upErr) return res.status(500).json({ error: `Storage-Upload fehlgeschlagen: ${upErr.message}` })
    try {
      const sharp = require('sharp')
      const thumbBuf = await sharp(result.buffer).resize(480, 320, { fit: 'cover' }).jpeg({ quality: 72 }).toBuffer()
      await supabase.storage.from(BUCKET).upload(storagePath.replace(/\.png$/i, '_thumb.jpg'), thumbBuf, { contentType: 'image/jpeg', upsert: true })
    } catch (e) { console.warn('Thumbnail übersprungen:', e.message) }

    await recordCost({
      memorial_id: code, kind: 'image', provider: result.provider, model: result.model, images: 1,
      cost_usd: costImage(result.model, 1),
      metadata: { storage_path: storagePath, variant: 'enduser_print', chapter: Number(chapterNumber), ...(usedFallback ? { fallback: 'content_policy' } : {}) },
    })

    // Zähler hochsetzen (read-modify-write; ein Endnutzer je Buch → Race unkritisch).
    const nextRegen = { ...(m.image_regen && typeof m.image_regen === 'object' ? m.image_regen : {}), [ch]: cur + 1 }
    await supabase.from('memorials').update({ image_regen: nextRegen }).eq('id', code)

    // Signierte Anzeige-URL für die sofortige Darstellung im Client (Bucket ist privat).
    let url = null
    try { const { data: s } = await supabase.storage.from(BUCKET).createSignedUrls([storagePath], 3600); url = s?.[0]?.signedUrl || null } catch {}

    return res.json({ storagePath, url, count: cur + 1, max: maxTotal, ...(usedFallback ? { fallback: 'content_policy' } : {}) })
  } catch (e) {
    console.error('/api/enduser-image error:', e)
    return res.status(500).json({ error: 'Bildgenerierung fehlgeschlagen. Bitte später erneut versuchen.' })
  }
}
