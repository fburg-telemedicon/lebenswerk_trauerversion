// api/transcribe.js
// POST /api/transcribe  { audio: base64, mimeType, audioSeconds?, memorialCode?, contributionId?, language? }  →  { text }
//
// Einziges STT ist Azure AI Speech „Fast Transcription" (EU-Region) – KEIN
// Fallback. Der frühere OpenAI-Whisper-Fallback (SPEECH_PROVIDER) wurde am
// 2026-06-22 entfernt (nicht von der Datenschutzerklärung gedeckt: US-Transfer).
// Nötige Env:
//   AZURE_SPEECH_KEY, AZURE_SPEECH_REGION (z. B. westeurope)
//   AZURE_SPEECH_ENDPOINT  optional (sonst aus Region gebildet)

const { createClient } = require('./_lib/store')
const { costSTT, recordCost, enforceBudget } = require('./_lib/cost')
const { memorialExists } = require('./_lib/access')
const { enforce } = require('./_lib/ratelimit')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

// Erkennungssprache je Interview-Sprache. `de-CH` ist der Grund, warum hier der
// VOLLE Code steht: Azure erkennt Schweizerdeutsch (Mundart) nur mit dem Locale
// `de-CH` — mit `de-DE` bliebe von einem Mundart-Satz wenig übrig.
// Arabisch: `ar-EG` als breit verstandene Verkehrssprache (per Env änderbar).
const LOCALE = {
  de: 'de-DE',
  'de-CH': 'de-CH',
  en: 'en-US',
  pl: 'pl-PL',
  es: 'es-ES',
  it: 'it-IT',
  eu: 'eu-ES',
  he: 'he-IL',
  ar: process.env.AZURE_SPEECH_STT_LOCALE_AR || 'ar-EG',
  fr: 'fr-FR',
  ro: 'ro-RO',
  tr: 'tr-TR',
  ru: 'ru-RU',
  uk: 'uk-UA',
}

// Phrase-List / Bias (Azure Fast Transcription unterstützt `phraseList.phrases`
// ab api-version 2025-10-15). Isolierte Antworten wie „vier" wurden sonst als
// englisches „fear" erkannt; hier lenken wir die Erkennung je Interviewsprache
// auf die Zahlwörter (0–12) — die häufigste und für die Anamnese heikelste
// Verwechslung (Skala 0–10, Dosierungen, Zeiträume). Bewusst NUR die jeweilige
// Sprache biasen (bei englischem Interview keine deutschen Zahlwörter). Betreiber
// können über AZURE_SPEECH_STT_PHRASES (kommagetrennt) Fachbegriffe ergänzen.
const NUMBER_PHRASES = {
  de: ['null', 'eins', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun', 'zehn', 'elf', 'zwölf'],
  en: ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'],
  pl: ['zero', 'jeden', 'dwa', 'trzy', 'cztery', 'pięć', 'sześć', 'siedem', 'osiem', 'dziewięć', 'dziesięć'],
  es: ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez'],
  it: ['zero', 'uno', 'due', 'tre', 'quattro', 'cinque', 'sei', 'sette', 'otto', 'nove', 'dieci'],
}
// Schweizerdeutsch nutzt dieselben (hochdeutschen) Zahlwörter als Bias.
NUMBER_PHRASES['de-CH'] = NUMBER_PHRASES.de

function phraseListFor(language) {
  const base = NUMBER_PHRASES[language] || []
  const extra = (process.env.AZURE_SPEECH_STT_PHRASES || '').split(',').map(s => s.trim()).filter(Boolean)
  const all = [...base, ...extra]
  return all.length ? all.slice(0, 100) : null  // Azure kappt lange Listen; defensiv begrenzen
}

// ── Azure AI Speech (Fast Transcription) ──────────────────────────
async function transcribeAzure({ buffer, mimeType, ext, language }) {
  const region = process.env.AZURE_SPEECH_REGION
  const key    = process.env.AZURE_SPEECH_KEY
  if (!region || !key) throw new Error('Azure Speech ist nicht konfiguriert (AZURE_SPEECH_REGION/KEY).')
  const base = (process.env.AZURE_SPEECH_ENDPOINT || `https://${region}.api.cognitive.microsoft.com`).replace(/\/+$/, '')
  const url  = `${base}/speechtotext/transcriptions:transcribe?api-version=2025-10-15`

  const locales = LOCALE[language] ? [LOCALE[language]] : [] // [] = automatische Spracherkennung
  const definition = { locales }
  const phrases = phraseListFor(language)
  if (phrases) definition.phraseList = { phrases }  // Erkennung auf Zahlwörter (+ Env-Begriffe) lenken
  const form = new FormData()
  form.append('audio', new Blob([buffer], { type: mimeType || 'audio/webm' }), `audio.${ext}`)
  form.append('definition', JSON.stringify(definition))

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Ocp-Apim-Subscription-Key': key },
    body: form,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error?.message || data.message || `Azure STT HTTP ${response.status}`)
  const text = (data.combinedPhrases || []).map(p => p.text).join(' ').trim()
  return { text, provider: 'azure', model: 'azure-stt' }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  try {
    if (!(await enforce(req, res, { name: 'transcribe', limit: 30, windowSeconds: 60 }))) return

    const { audio, mimeType, audioSeconds, memorialCode, contributionId, language } = req.body
    if (!audio) return res.status(400).json({ error: 'audio fehlt.' })

    // An einen echten Gedenkbuch-Code gebunden (offener Endpunkt, aber kein
    // anonymer STT-Proxy auf fremde Rechnung). Prüfung VOR dem Anbieter-Aufruf.
    const code = String(memorialCode || '').toUpperCase().trim()
    if (!code) return res.status(400).json({ error: 'memorialCode fehlt.' })
    if (!(await memorialExists(supabase, code))) {
      return res.status(403).json({ error: 'Ungültiger Code.' })
    }
    // Kosten-Obergrenze je Buch erschöpft → keine Spracherkennung mehr (402).
    if (!(await enforceBudget(res, code))) return

    const buffer = Buffer.from(audio, 'base64')
    const ext    = mimeType?.includes('ogg') ? 'ogg'
                 : mimeType?.includes('mp4') ? 'mp4'
                 : 'webm'

    const result = await transcribeAzure({ buffer, mimeType, ext, language })

    {
      const secs = Number.isFinite(parseFloat(audioSeconds)) ? parseFloat(audioSeconds) : 0
      await recordCost({
        memorial_id: code,
        contribution_id: contributionId || null,
        kind: 'stt',
        provider: result.provider,
        model: result.model,
        audio_seconds: secs,
        cost_usd: costSTT(result.model, secs),
      })
    }

    return res.json({ text: result.text })
  } catch (e) {
    console.error('/api/transcribe error:', e)
    res.status(500).json({ error: 'Die Spracherkennung ist momentan nicht verfügbar. Bitte später erneut versuchen.' })
  }
}
