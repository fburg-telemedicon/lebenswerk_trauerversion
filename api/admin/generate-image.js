// api/admin/generate-image.js
// POST /api/admin/generate-image  { memorialCode, prompt } → { storagePath }
// Generiert ein Bild via DALL-E 3 (1792x1024, hd) und lädt es in
// den (privaten) Supabase-Storage-Bucket "memorial-images".

const { createClient } = require('@supabase/supabase-js')
const crypto = require('crypto')
const { costImage, recordCost } = require('../_lib/cost')

const supabase    = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const ADMIN_TOKEN = process.env.ADMIN_TOKEN    || 'lebenswerk-admin-secret'
const OPENAI_KEY  = process.env.OPENAI_API_KEY

const BUCKET = 'memorial-images'
const IMAGE_MODEL = 'gpt-image-1-high-1536x1024'

function checkAuth(req, res) {
  const token = (req.headers.authorization || '').replace('Bearer ', '')
  if (token !== ADMIN_TOKEN) { res.status(401).json({ error: 'Nicht autorisiert.' }); return false }
  return true
}

module.exports = async function handler(req, res) {
  if (!checkAuth(req, res)) return
  if (req.method !== 'POST') return res.status(405).end()
  try {
    if (!OPENAI_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY fehlt im Backend.' })
    const { prompt, memorialCode } = req.body || {}
    if (!prompt || !memorialCode) return res.status(400).json({ error: 'prompt und memorialCode erforderlich.' })

    const dalleResp = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({
        model: 'gpt-image-1',
        prompt,
        size: '1536x1024',
        quality: 'high',
        n: 1,
      }),
    })
    if (!dalleResp.ok) {
      const errBody = await dalleResp.text()
      console.error('DALL-E error:', dalleResp.status, errBody)
      let msg = `HTTP ${dalleResp.status}`
      try {
        const j = JSON.parse(errBody)
        if (j?.error?.message) msg = j.error.message
        else if (j?.error?.code) msg = j.error.code
      } catch {}
      return res.status(502).json({ error: `Bildgenerierung fehlgeschlagen: ${msg}` })
    }
    const dalleData = await dalleResp.json()
    const item = dalleData?.data?.[0]
    let buffer = null
    if (item?.b64_json) {
      buffer = Buffer.from(item.b64_json, 'base64')
    } else if (item?.url) {
      const imgResp = await fetch(item.url)
      if (!imgResp.ok) {
        console.error('Bild-Download fehlgeschlagen:', imgResp.status)
        return res.status(502).json({ error: `Bild-Download fehlgeschlagen: HTTP ${imgResp.status}` })
      }
      buffer = Buffer.from(await imgResp.arrayBuffer())
    } else {
      console.error('OpenAI lieferte weder b64_json noch url:', JSON.stringify(dalleData).slice(0, 500))
      return res.status(502).json({ error: 'Keine Bilddaten von OpenAI erhalten.' })
    }
    const code = String(memorialCode).toUpperCase().trim()
    const storagePath = `${code}/${crypto.randomUUID()}.png`

    const { error: upErr } = await supabase.storage.from(BUCKET).upload(storagePath, buffer, {
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
      provider: 'openai',
      model: IMAGE_MODEL,
      images: 1,
      cost_usd: costImage(IMAGE_MODEL, 1),
      metadata: { storage_path: storagePath },
    })

    return res.json({ storagePath })
  } catch (e) {
    console.error('/api/admin/generate-image:', e)
    res.status(500).json({ error: e.message })
  }
}
