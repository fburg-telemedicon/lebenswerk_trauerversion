// api/voicelive-token.js
// POST /api/voicelive-token  { memorialCode, usage? }  → { token, region, endpoint, model, apiVersion, expiresInSeconds }
//
// Mintet ein KURZLEBIGES Auth-Token für die Azure Voice Live API (echtes
// Sprachgespräch / Realtime), damit der Browser eine stehende Audio-Verbindung
// öffnen kann, OHNE dass der Speech-Key je den Server verlässt. Muster wie
// api/speak.js: ratelimit → resolvePublicCode → enforceBudget → Anbieter.
//
// Voice Live läuft (Stand 2026-07) nur in wenigen Regionen; die einzige EU-Region
// ist **Sweden Central** (EU-Datenresidenz). Env:
//   AZURE_VOICELIVE_REGION   z. B. swedencentral   (für STS + WS-Host)
//   AZURE_VOICELIVE_KEY      Speech-/AI-Foundry-Ressourcenschlüssel (bleibt serverseitig)
//   AZURE_VOICELIVE_MODEL    Default 'gpt-realtime' (zugleich Pricing-Key in cost.js)
//   AZURE_VOICELIVE_ENDPOINT optional: voller wss-Host; sonst aus der Region abgeleitet
//   AZURE_VOICELIVE_API_VERSION optional (Default '2025-05-01-preview')
//
// Kosten-Metering (Phase 6): Bei jedem RENEW schickt der Client die seit dem
// letzten Aufruf verbrauchten Tokens (`usage`); die werden VOR der Budgetprüfung
// verbucht, damit auch ein geschlossener Tab die bereits verbrauchte Zeit bezahlt
// und ein erschöpftes Budget den nächsten Renew verweigert (402).

const { createClient } = require('./_lib/store')
const { costRealtime, recordCost, enforceBudget } = require('./_lib/cost')
const { resolvePublicCode } = require('./_lib/access')
const { enforce } = require('./_lib/ratelimit')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

const REALTIME_MODEL = process.env.AZURE_VOICELIVE_MODEL || 'gpt-realtime'
const API_VERSION    = process.env.AZURE_VOICELIVE_API_VERSION || '2025-05-01-preview'
// Azure-STS-Token gelten ~10 min; der Client soll deutlich vorher erneuern.
const TOKEN_TTL_SECONDS = 540

// Verbrauchte Tokens einer Voice-Live-Session verbuchen. `usage` sind die seit dem
// letzten Report NEU verbrauchten Tokens (Delta), getrennt nach Text/Audio; nur
// positive Zahlen zählen. Aggregiert wird in die vorhandenen cost_events-Spalten
// input_tokens/output_tokens (der genaue Split fließt nur in die Kostenformel).
async function accountUsage(memorialId, contributionId, usage) {
  const u = usage && typeof usage === 'object' ? usage : null
  if (!u) return
  const num = (x) => (Number.isFinite(x) && x > 0 ? Math.round(x) : 0)
  const textIn  = num(u.textIn),  textInCached = num(u.textInCached)
  const textOut = num(u.textOut), audioIn = num(u.audioIn), audioOut = num(u.audioOut)
  if (!(textIn || textInCached || textOut || audioIn || audioOut)) return
  await recordCost({
    memorial_id: memorialId,
    contribution_id: contributionId || null,
    kind: 'realtime',
    provider: 'azure',
    model: REALTIME_MODEL,
    input_tokens:  textIn + textInCached + audioIn,
    output_tokens: textOut + audioOut,
    cost_usd: costRealtime(REALTIME_MODEL, { textIn, textInCached, textOut, audioIn, audioOut }),
  })
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  try {
    if (!(await enforce(req, res, { name: 'voicelive-token', limit: 40, windowSeconds: 60 }))) return

    const { memorialCode, contributionId, usage } = req.body || {}
    const code = String(memorialCode || '').toUpperCase().trim()
    if (!code) return res.status(400).json({ error: 'memorialCode fehlt.' })

    // Buch-Code ODER Gast-Code; gebucht/geprüft wird auf das echte Buch.
    const target = await resolvePublicCode(supabase, code)
    if (!target) return res.status(403).json({ error: 'Ungültiger Code.' })

    // Zuerst das gerade verbrauchte Segment verbuchen (Metering-on-Renew), DANN
    // die Budgetgrenze prüfen — so bezahlt auch ein Abbruch das bereits Verbrauchte.
    await accountUsage(target.id, contributionId, usage)
    if (!(await enforceBudget(res, target.id))) return

    const region = process.env.AZURE_VOICELIVE_REGION
    const key    = process.env.AZURE_VOICELIVE_KEY
    if (!region || !key) {
      return res.status(503).json({ error: 'Das Live-Sprachgespräch ist derzeit nicht verfügbar.', code: 'realtime_unconfigured' })
    }

    // Kurzlebiges Auth-Token holen (der Ressourcenschlüssel bleibt hier).
    let token
    try {
      const r = await fetch(`https://${region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`, {
        method: 'POST',
        headers: { 'Ocp-Apim-Subscription-Key': key, 'Content-Length': '0' },
      })
      if (!r.ok) throw new Error(`STS HTTP ${r.status}`)
      token = await r.text()
    } catch (e) {
      console.error('/api/voicelive-token STS error:', e)
      return res.status(502).json({ error: 'Das Live-Sprachgespräch ist momentan nicht erreichbar.' })
    }

    const endpoint = process.env.AZURE_VOICELIVE_ENDPOINT
      || `wss://${region}.api.cognitive.microsoft.com/voice-live/realtime`

    res.setHeader('Cache-Control', 'no-store')
    return res.json({
      token,
      region,
      endpoint,
      model: REALTIME_MODEL,
      apiVersion: API_VERSION,
      expiresInSeconds: TOKEN_TTL_SECONDS,
    })
  } catch (e) {
    console.error('/api/voicelive-token error:', e)
    res.status(500).json({ error: 'Das Live-Sprachgespräch ist momentan nicht verfügbar.' })
  }
}
