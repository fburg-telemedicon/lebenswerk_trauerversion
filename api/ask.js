// api/ask.js
// POST /api/ask  { system, messages, memorialCode?, kind?, provider? }  → { text }
//
// LLM-Anbieter ist umschaltbar (DSGVO/EU-Migration):
//   LLM_PROVIDER = 'anthropic' (Default) | 'azure'
// Eingeloggte Admins können pro Request via { provider } übersteuern
// (für den A/B-Vergleich Claude vs. Azure-GPT auf demselben Memorial).
// Azure-Konfiguration (nur für den azure-Pfad nötig):
//   AZURE_OPENAI_ENDPOINT     Ressourcen-Endpoint OHNE Pfad. Microsoft-Foundry-
//                             Ressourcen: https://<resource>.services.ai.azure.com
//                             (klassische Azure-OpenAI-Ressourcen: …openai.azure.com)
//   AZURE_OPENAI_KEY          Schlüssel DERSELBEN Ressource wie der Endpoint
//   AZURE_OPENAI_DEPLOYMENT   Deployment-Name (z. B. "gpt-4.1") – zugleich Pricing-Key
//                             und der `model`-Wert im v1-Request-Body
//   AZURE_OPENAI_API_VERSION  optional, Default "preview" (die v1-API kennt nur
//                             "preview" bzw. keine; KEINE Datums-Version wie 2024-…)

const { createClient } = require('@supabase/supabase-js')
const { costLLM, recordCost } = require('./_lib/cost')
const { memorialExists } = require('./_lib/access')
const { enforce } = require('./_lib/ratelimit')
const { verifyToken } = require('./_lib/auth')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

const DEFAULT_PROVIDER = (process.env.LLM_PROVIDER || 'anthropic').toLowerCase()
const MAX_TOKENS = 8000

// ── Anthropic (Claude) ────────────────────────────────────────────
async function callAnthropic({ system, messages }) {
  const model = 'claude-sonnet-4-5'
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model, max_tokens: MAX_TOKENS, system: system || '', messages }),
  })
  const data = await response.json()
  if (data.error) throw new Error(data.error.message)
  return {
    text: data.content?.[0]?.text || '',
    provider: 'anthropic',
    model,
    inT: data.usage?.input_tokens || 0,
    outT: data.usage?.output_tokens || 0,
  }
}

// ── Azure OpenAI (GPT) ────────────────────────────────────────────
// Neue OpenAI-v1-API der Microsoft-Foundry-Ressourcen:
//   POST {endpoint}/openai/v1/chat/completions?api-version=preview
//   Body enthält `model` = Deployment-Name (NICHT im URL-Pfad).
// Der Anthropic-Stil { system, messages } wird auf OpenAI gemappt: system wird
// als erste Nachricht (role 'system') vorangestellt. Antwort- und Usage-Format
// sind identisch zur klassischen Chat-Completions-API (choices[].message.content).
async function callAzure({ system, messages }) {
  const endpoint   = (process.env.AZURE_OPENAI_ENDPOINT || '').replace(/\/+$/, '')
  const key        = process.env.AZURE_OPENAI_KEY
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || 'preview'
  if (!endpoint || !key || !deployment) {
    throw new Error('Azure OpenAI ist nicht konfiguriert (AZURE_OPENAI_ENDPOINT/KEY/DEPLOYMENT).')
  }
  const url = `${endpoint}/openai/v1/chat/completions?api-version=${apiVersion}`
  const oaiMessages = (system ? [{ role: 'system', content: system }] : []).concat(messages || [])
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-key': key },
    // temperature bewusst nicht gesetzt (Modell-Default) – manche neueren
    // Modelle erlauben nur den Default-Wert.
    body: JSON.stringify({ model: deployment, messages: oaiMessages, max_tokens: MAX_TOKENS }),
  })
  const data = await response.json()
  if (data.error) throw new Error(data.error.message || 'Azure-OpenAI-Fehler')
  return {
    text: data.choices?.[0]?.message?.content || '',
    provider: 'azure-openai',
    model: deployment, // Deployment-Name = Pricing-Key in cost.js
    inT: data.usage?.prompt_tokens || 0,
    outT: data.usage?.completion_tokens || 0,
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    // Eingeloggte BENUTZER (gültiger Bearer-Token – Superadmin ODER app_user,
    // nicht nur Admins) sind von der IP-Drossel ausgenommen: die Buch-
    // generierung macht legitim viele Calls in Folge. Maßgeblich ist allein
    // ein gültiger Token, nicht das Admin-Flag. Anonyme Beitragende bleiben
    // auf 20/min begrenzt.
    const isLoggedIn = !!verifyToken((req.headers.authorization || '').replace('Bearer ', '').trim())
    if (!isLoggedIn && !(await enforce(req, res, { name: 'ask', limit: 20, windowSeconds: 60 }))) return

    const { system, messages, memorialCode, kind, contributionId } = req.body
    if (!messages) return res.status(400).json({ error: 'messages fehlt.' })

    // Offener Endpunkt (kein Login im Beitragenden-Flow), aber an einen echten
    // Gedenkbuch-Code gebunden – damit kein anonymer LLM-Proxy auf fremde
    // Rechnung. Prüfung VOR dem (kostenpflichtigen) Modell-Aufruf.
    const code = String(memorialCode || '').toUpperCase().trim()
    if (!code) return res.status(400).json({ error: 'memorialCode fehlt.' })
    if (!(await memorialExists(supabase, code))) {
      return res.status(403).json({ error: 'Ungültiger Code.' })
    }

    // Anbieter: Default aus Env; eingeloggte Admins dürfen pro Request
    // übersteuern (A/B-Vergleich). Anonyme Beitragende können das NICHT.
    const requested = (isLoggedIn && typeof req.body.provider === 'string')
      ? req.body.provider.toLowerCase()
      : null
    const provider = requested || DEFAULT_PROVIDER

    const result = provider === 'azure'
      ? await callAzure({ system, messages })
      : await callAnthropic({ system, messages })

    if (result.inT || result.outT) {
      await recordCost({
        memorial_id: code,
        contribution_id: contributionId || null,
        kind: kind || 'reasoning',
        provider: result.provider,
        model: result.model,
        input_tokens: result.inT,
        output_tokens: result.outT,
        cost_usd: costLLM(result.model, result.inT, result.outT),
      })
    }

    return res.json({ text: result.text })
  } catch (e) {
    console.error('/api/ask error:', e)
    res.status(500).json({ error: e.message })
  }
}
