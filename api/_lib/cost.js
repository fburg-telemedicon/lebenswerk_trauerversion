// api/_lib/cost.js
// Gemeinsame Pricing-Konstanten + recordCost-Helper für alle Serverless-Endpoints.
// Wird von ask.js, speak.js, transcribe.js und admin/generate-image.js benutzt.

const { createClient } = require('./store')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

const USD_TO_EUR = parseFloat(process.env.USD_TO_EUR || '0.92')

// Alle Preise in USD. Quelle: anbieter-Doku (Stand 2026). Bei Preisänderung anpassen.
const PRICING = {
  // Hinweis: Der Anthropic-/Claude-LLM-Fallback wurde am 2026-06-22 entfernt –
  // einziges LLM ist Azure OpenAI (EU). Bereits verbuchte cost_events behalten
  // ihre gespeicherten EUR-Werte (Anzeige liest cost_eur, nicht PRICING).

  // Azure OpenAI (USD pro 1.000.000 Tokens). Stand 2026 – gegen die aktuelle
  // Azure-OpenAI-Preisliste prüfen (Data-Zone-Preise liegen ggf. leicht höher).
  // Key = Deployment-Name (so wie in Azure benannt) → Deployment "gpt-4.1" nennen.
  'gpt-4.1':      { inputPerMTokens: 2.0,  outputPerMTokens: 8.0  },
  'gpt-4.1-mini': { inputPerMTokens: 0.4,  outputPerMTokens: 1.6  },
  'gpt-4o':       { inputPerMTokens: 2.5,  outputPerMTokens: 10.0 },
  'gpt-5.5':      { inputPerMTokens: 0,    outputPerMTokens: 0    }, // TODO: Preis eintragen, sobald genutzt

  // Hinweis: Die OpenAI-Sprach-Modelle (tts-1/-hd, whisper-1) wurden am
  // 2026-06-22 mit dem OpenAI-Sprach-Fallback entfernt – TTS/STT laufen nur
  // noch über Azure AI Speech (EU). Alte cost_events behalten ihre cost_eur-Werte.

  // Azure AI Speech – Stand Juli 2026 (Azure-Speech-Preisliste).
  // STT läuft über „Fast Transcription" = $0.36 / Stunde Audio → $0.006 / Minute
  // (NICHT der alte Standard-Tarif $1/h; wir nutzen ausdrücklich Fast Transcription).
  'azure-stt':        { perMinute: 0.006 },  // Fast Transcription, $0.36 / Std.
  'azure-tts-neural': { perMChars: 16.0 },   // Prebuilt Neural-TTS ~$16 / 1M Zeichen

  // Hinweis: gpt-image-1 / DALL-E (OpenAI) wurden am 2026-06-21 als Bildmodul
  // entfernt – einziges Bildmodell ist jetzt FLUX.2 [pro]. Bereits verbuchte
  // cost_events behalten ihre gespeicherten EUR-Werte (Anzeige liest cost_eur,
  // nicht PRICING), daher ist das Entfernen der alten Keys unkritisch.

  // Azure Foundry – FLUX.2 [pro] (Black Forest Labs). Gestaffelt pro Megapixel:
  // erste MP $0,03, jede weitere MP $0,015; Auflösung wird pro Bild auf die nächste
  // MP AUFGERUNDET (Stand Juli 2026). 1536×1024 = 1,57 MP → aufgerundet 2 MP →
  // $0,03 + $0,015 = $0,045/Bild (vs. $0,25 bei gpt-image-1 high). Key =
  // `flux-2-pro-${size}`; bei anderer Auflösung neuen Key ergänzen. Hinweis: Ein
  // img2img-Referenzbild kostet zusätzlich $0,015/MP (hier nicht separat verbucht).
  'flux-2-pro-1536x1024': { perImage: 0.045 },
}

// Token-Kosten für ein Chat-Modell aus PRICING (Key = Azure-Deployment-Name).
function costLLM(model, inT, outT) {
  const p = PRICING[model]; if (!p) return 0
  return (inT  || 0) / 1e6 * p.inputPerMTokens
       + (outT || 0) / 1e6 * p.outputPerMTokens
}

function costTTS(model, chars) {
  const p = PRICING[model]; if (!p) return 0
  return (chars || 0) / 1e6 * p.perMChars
}

function costSTT(model, seconds) {
  const p = PRICING[model]; if (!p) return 0
  return (seconds || 0) / 60 * p.perMinute
}

function costImage(model, n = 1) {
  const p = PRICING[model]; if (!p) return 0
  return n * p.perImage
}

async function recordCost(event) {
  if (!event?.memorial_id) return
  const usd = Number.isFinite(event.cost_usd) ? event.cost_usd : 0
  const eur = usd * USD_TO_EUR
  try {
    const { error } = await supabase.from('cost_events').insert({
      ...event,
      cost_usd: usd,
      cost_eur: eur,
    })
    if (error) console.error('Cost insert error:', error)
  } catch (e) {
    console.error('Cost tracking error:', e)
  }
}

module.exports = {
  USD_TO_EUR, PRICING,
  costLLM, costTTS, costSTT, costImage,
  recordCost,
}
