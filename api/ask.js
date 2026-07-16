// api/ask.js
// POST /api/ask  { system, messages, memorialCode?, kind?, provider? }  → { text }
//
// Einziges LLM ist Azure OpenAI (EU, Microsoft Foundry) – KEIN Fallback.
// Der frühere Anthropic-/Claude-Fallback (LLM_PROVIDER, { provider }-Override)
// wurde am 2026-06-22 entfernt. Ist Azure unkonfiguriert/nicht erreichbar,
// antwortet der Endpunkt mit Fehler (kein stiller Wechsel auf einen US-Anbieter).
// Azure-Konfiguration (Pflicht):
//   AZURE_OPENAI_ENDPOINT     Ressourcen-Endpoint OHNE Pfad. Microsoft-Foundry-
//                             Ressourcen: https://<resource>.services.ai.azure.com
//                             (klassische Azure-OpenAI-Ressourcen: …openai.azure.com)
//   AZURE_OPENAI_KEY          Schlüssel DERSELBEN Ressource wie der Endpoint
//   AZURE_OPENAI_DEPLOYMENT   Deployment-Name (z. B. "gpt-4.1") – zugleich Pricing-Key
//                             und der `model`-Wert im v1-Request-Body
//   AZURE_OPENAI_API_VERSION  optional, Default "preview" (die v1-API kennt nur
//                             "preview" bzw. keine; KEINE Datums-Version wie 2024-…)

const { createClient } = require('./_lib/store')
const { costLLM, recordCost, enforceBudget } = require('./_lib/cost')
const { memorialExists } = require('./_lib/access')
const { enforce } = require('./_lib/ratelimit')
const { verifyToken } = require('./_lib/auth')
const { callAzure } = require('./_lib/llm')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

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
    // Kosten-Obergrenze je Buch: erschöpft → alle KI-Funktionen gestoppt (402).
    if (!(await enforceBudget(res, code))) return

    // Einziges LLM: Azure OpenAI (EU). Kein Fallback – ist Azure nicht
    // erreichbar oder unkonfiguriert, wirft callAzure und der Handler
    // antwortet mit Fehler (siehe catch unten).
    const result = await callAzure({ system, messages })

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
    res.status(500).json({ error: 'Die KI-Antwort konnte nicht erstellt werden. Bitte später erneut versuchen.' })
  }
}
