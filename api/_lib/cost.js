// api/_lib/cost.js
// Gemeinsame Pricing-Konstanten + recordCost-Helper für alle Serverless-Endpoints.
// Wird von ask.js, speak.js, transcribe.js und admin/generate-image.js benutzt.

const { createClient, pool } = require('./store')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

const USD_TO_EUR = parseFloat(process.env.USD_TO_EUR || '0.92')

// Kosten-Obergrenze je Buchprojekt (EUR). Wird sie erreicht, verweigern alle
// kostenpflichtigen Endpunkte (Interview/TTS/STT, Buch-/Bild-/Redegenerierung)
// weitere Aufrufe für dieses Buch — Schutz vor unerwartet hohen Kosten. 0/negativ
// schaltet die Grenze ab. Per Env `MEMORIAL_COST_CAP_EUR` änderbar (Default 50 €).
const BUDGET_CAP_EUR = parseFloat(process.env.MEMORIAL_COST_CAP_EUR || '50')
const BUDGET_MESSAGE =
  'Für dieses Buchprojekt wurde die Kosten-Obergrenze erreicht. Zum Schutz vor unerwarteten Kosten sind alle KI-Funktionen (Interview, Sprachausgabe sowie Buch-, Text- und Bilderzeugung) für dieses Buch vorerst gestoppt. Bitte wenden Sie sich an support@lebensgeschichten.ai.'

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
  // Preise aus der Azure-Retail-Preis-API, Region westeurope (abgefragt 2026-07-22):
  //   Meter „S1 Neural Text To Speech Characters"  = $15 / 1M Zeichen
  //   Meter „Neural HD Text to Speech Characters"  = $22 / 1M Zeichen
  // HD/„Dragon" UND die MAI-Stimmen laufen über den HD-Meter (VoiceType NeuralHD).
  // Bis 2026-07-22 wurde ALLES als 'azure-tts-neural' zu $16 verbucht — seit der
  // Umstellung auf HD-Stimmen also rund 38 % zu niedrig. Ab jetzt getrennt; die
  // bereits verbuchten cost_events bleiben bewusst unverändert (keine Rückrechnung).
  'azure-tts-neural': { perMChars: 15.0 },
  'azure-tts-hd':     { perMChars: 22.0 },

  // Azure AI Speech – Voice Live API (Live-Sprachgespräch, Sweden Central).
  // Preise in USD je 1.000 Tokens, aus der Azure-Retail-Preis-API abgefragt
  // (armRegionName=swedencentral, 2026-07-28). Die Preisklasse ergibt sich aus
  // dem gewählten Chat-Modell und ist NICHT frei wählbar (Microsoft-Doku):
  //   pro   = gpt-realtime, gpt-4o, gpt-4.1, gpt-5, gpt-5-chat
  //   basic = *-mini (im Meter-Namen „Std")
  //   lite  = *-nano, phi4-mm-realtime, phi4-mini
  // Wir fahren CASCADED (azure-speech-STT + gpt-4.1 + azure-tts) → Klasse „pro".
  // Abgerechnet werden dabei drei Ströme:
  //   speechAudio* = Meter „<Klasse> - Standard Speech Audio Input/Output Tokens"
  //                  (der STT-/TTS-Anteil der Sitzung)
  //   text*        = Meter „<Klasse> - LLM Text Input/Output Tokens" (gpt-4.1)
  //   llmAudio*    = Meter „<Klasse> - LLM Audio Input/Output Tokens" — gilt NUR
  //                  für natives Speech-to-Speech (gpt-realtime). Steht hier
  //                  bereits drin, damit ein späterer Umstieg nicht still 0 €
  //                  verbucht (PRICING ist nach exaktem Schlüssel verschlüsselt).
  // Die drei Cache-Meter (Speech/LLM-Audio/LLM-Text) haben je Klasse denselben
  // Satz, deshalb reicht ein gemeinsames `cachedPer1K`.
  // Faustformel Microsoft: Eingangs-Audio ≈ 10 Tokens/Sekunde, Ausgabe-Audio
  // ≈ 20 Tokens/Sekunde (zur Abschätzung, verbucht wird die echte Usage).
  'voicelive-pro': {
    speechAudioInPer1K: 0.017, speechAudioOutPer1K: 0.031,
    llmAudioInPer1K:    0.032, llmAudioOutPer1K:    0.064,
    textInPer1K:        0.004, textOutPer1K:        0.016,
    cachedPer1K:        0.0004,
  },
  'voicelive-basic': {
    speechAudioInPer1K: 0.015,   speechAudioOutPer1K: 0.026,
    llmAudioInPer1K:    0.011,   llmAudioOutPer1K:    0.022,
    textInPer1K:        0.00066, textOutPer1K:        0.00264,
    cachedPer1K:        0.00033,
  },
  'voicelive-lite': {
    speechAudioInPer1K: 0.015,   speechAudioOutPer1K: 0.025,
    // Für „lite" gibt es KEINEN Meter „LLM Audio Output" (die Lite-Modelle geben
    // ihr Audio über Azure-TTS aus, nicht nativ) → bewusst 0, nicht geschätzt.
    llmAudioInPer1K:    0.004,   llmAudioOutPer1K:    0,
    textInPer1K:        0.00011, textOutPer1K:        0.00044,
    cachedPer1K:        0.00004,
  },

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

// Kosten einer Voice-Live-Runde (Live-Sprachgespräch).
// `tier` = 'pro' | 'basic' | 'lite' (ergibt sich aus dem Chat-Modell, siehe
// PRICING); `t` = bereits nach Strom getrennte Tokenzahlen aus dem
// `response.done`-Usage-Block einer Sitzung (siehe api/_lib/voicelive.js).
function costRealtime(tier, t = {}) {
  const p = PRICING[`voicelive-${tier || 'pro'}`]; if (!p) return 0
  const k = n => (n || 0) / 1000
  return k(t.speechAudioIn)  * p.speechAudioInPer1K
       + k(t.speechAudioOut) * p.speechAudioOutPer1K
       + k(t.llmAudioIn)     * p.llmAudioInPer1K
       + k(t.llmAudioOut)    * p.llmAudioOutPer1K
       + k(t.textIn)         * p.textInPer1K
       + k(t.textOut)        * p.textOutPer1K
       + k(t.cached)         * p.cachedPer1K
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

// Summe der bereits verbuchten EUR-Kosten eines Buchs.
async function memorialCostEur(memorialId) {
  if (!memorialId) return 0
  try {
    const r = await pool().query(
      'SELECT COALESCE(SUM(cost_eur),0)::float AS eur FROM cost_events WHERE memorial_id = $1',
      [memorialId]
    )
    return r.rows?.[0]?.eur || 0
  } catch (e) {
    // Fail-open: Ist die Summe nicht ermittelbar, NICHT sperren (lieber weiterlaufen
    // als den Betrieb wegen eines DB-Hakelns lahmlegen). Der Fehler wird geloggt.
    console.error('memorialCostEur error:', e.message)
    return 0
  }
}

// true, wenn das Buch seine Kosten-Obergrenze erreicht/überschritten hat.
async function budgetExceeded(memorialId) {
  if (!(BUDGET_CAP_EUR > 0) || !memorialId) return false
  return (await memorialCostEur(memorialId)) >= BUDGET_CAP_EUR
}

// Endpunkt-Guard: Ist das Budget erschöpft, antwortet 402 + Meldung und gibt false
// zurück (der Aufrufer bricht dann mit `return` ab). Sonst true.
async function enforceBudget(res, memorialId) {
  if (await budgetExceeded(memorialId)) {
    res.status(402).json({ error: BUDGET_MESSAGE, code: 'budget_exceeded' })
    return false
  }
  return true
}

module.exports = {
  USD_TO_EUR, PRICING,
  BUDGET_CAP_EUR, BUDGET_MESSAGE,
  costLLM, costTTS, costSTT, costImage, costRealtime,
  recordCost, memorialCostEur, budgetExceeded, enforceBudget,
}
