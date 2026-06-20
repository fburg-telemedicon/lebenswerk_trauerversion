// api/speak.js
// POST /api/speak  { text, memorialCode?, contributionId? }  → audio/mpeg
//
// TTS-Anbieter umschaltbar (DSGVO/EU-Migration):
//   SPEECH_PROVIDER = 'openai' (Default) | 'azure'
// Azure nutzt Azure AI Speech (deutsche Neural-Stimmen, EU-Region). Nötige Env:
//   AZURE_SPEECH_KEY, AZURE_SPEECH_REGION (z. B. westeurope)
//   AZURE_SPEECH_TTS_VOICE  optional (Default de-DE-KatjaNeural)

const { createClient } = require('@supabase/supabase-js')
const { costTTS, recordCost } = require('./_lib/cost')
const { memorialExists } = require('./_lib/access')
const { enforce } = require('./_lib/ratelimit')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

const PROVIDER = (process.env.SPEECH_PROVIDER || 'openai').toLowerCase()

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

// ── OpenAI TTS ────────────────────────────────────────────────────
async function speakOpenAI(text) {
  const model = 'tts-1-hd'
  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input: text, voice: 'shimmer', speed: 0.95 }),
  })
  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.error?.message || `HTTP ${response.status}`)
  }
  return { buffer: Buffer.from(await response.arrayBuffer()), model }
}

// ── Azure AI Speech (Neural TTS) ──────────────────────────────────
async function speakAzure(text) {
  const region = process.env.AZURE_SPEECH_REGION
  const key    = process.env.AZURE_SPEECH_KEY
  if (!region || !key) throw new Error('Azure Speech ist nicht konfiguriert (AZURE_SPEECH_REGION/KEY).')
  const voice = process.env.AZURE_SPEECH_TTS_VOICE || 'de-DE-KatjaNeural'
  const lang  = voice.slice(0, 5) || 'de-DE' // z. B. "de-DE"
  const ssml  = `<speak version='1.0' xml:lang='${lang}'><voice name='${voice}'>`
              + `<prosody rate='-5%'>${xmlEscape(text)}</prosody></voice></speak>`

  const response = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': key,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
      'User-Agent': 'lebensgeschichten',
    },
    body: ssml,
  })
  if (!response.ok) {
    const errTxt = await response.text().catch(() => '')
    throw new Error(`Azure TTS HTTP ${response.status}${errTxt ? ` – ${errTxt.slice(0, 200)}` : ''}`)
  }
  return { buffer: Buffer.from(await response.arrayBuffer()), model: 'azure-tts-neural' }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  try {
    if (!(await enforce(req, res, { name: 'speak', limit: 30, windowSeconds: 60 }))) return

    const { text, memorialCode, contributionId } = req.body
    if (!text) return res.status(400).json({ error: 'text fehlt.' })

    // An einen echten Gedenkbuch-Code gebunden (offener Endpunkt, aber kein
    // anonymer TTS-Proxy auf fremde Rechnung). Prüfung VOR dem Anbieter-Aufruf.
    const code = String(memorialCode || '').toUpperCase().trim()
    if (!code) return res.status(400).json({ error: 'memorialCode fehlt.' })
    if (!(await memorialExists(supabase, code))) {
      return res.status(403).json({ error: 'Ungültiger Code.' })
    }

    let result
    try {
      result = PROVIDER === 'azure' ? await speakAzure(text) : await speakOpenAI(text)
    } catch (e) {
      return res.status(500).json({ error: e.message })
    }

    res.setHeader('Content-Type', 'audio/mpeg')
    res.setHeader('Cache-Control', 'no-store')
    res.send(result.buffer)

    {
      const chars = String(text).length
      await recordCost({
        memorial_id: code,
        contribution_id: contributionId || null,
        kind: 'tts',
        provider: PROVIDER === 'azure' ? 'azure' : 'openai',
        model: result.model,
        characters: chars,
        cost_usd: costTTS(result.model, chars),
      })
    }
  } catch (e) {
    console.error('/api/speak error:', e)
    res.status(500).json({ error: e.message })
  }
}
