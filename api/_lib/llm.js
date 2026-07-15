// api/_lib/llm.js
// Gemeinsamer Azure-OpenAI-Aufruf (EU, Microsoft-Foundry v1-API). Genutzt von
// api/ask.js (interaktiv) und api/cron/transcript-check.js (Hintergrundprüfung).
// Kein Fallback: ist Azure unkonfiguriert/nicht erreichbar, wirft callAzure.

const MAX_TOKENS = 8000

async function callAzure({ system, messages, maxTokens = MAX_TOKENS }) {
  const endpoint   = (process.env.AZURE_OPENAI_ENDPOINT || '').replace(/\/+$/, '')
  const key        = process.env.AZURE_OPENAI_KEY
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || 'preview'
  if (!endpoint || !key || !deployment) {
    throw new Error('Azure OpenAI ist nicht konfiguriert (AZURE_OPENAI_ENDPOINT/KEY/DEPLOYMENT).')
  }
  const url = `${endpoint}/openai/v1/chat/completions?api-version=${apiVersion}`
  // NUR role + content an die API geben. Unsere Nachrichten können Zusatzfelder
  // tragen (z. B. `speaker` im begleiteten Co-Interview-Modus); Azure OpenAI lehnt
  // unbekannte Properties in Message-Objekten ab → sonst schlägt der Call fehl.
  const clean = (messages || []).map(m => ({ role: m.role, content: m.content }))
  const oaiMessages = (system ? [{ role: 'system', content: system }] : []).concat(clean)
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-key': key },
    body: JSON.stringify({ model: deployment, messages: oaiMessages, max_tokens: maxTokens }),
  })
  const data = await response.json()
  if (data.error) throw new Error(data.error.message || 'Azure-OpenAI-Fehler')
  return {
    text: data.choices?.[0]?.message?.content || '',
    provider: 'azure-openai',
    model: deployment,               // Deployment-Name = Pricing-Key in cost.js
    inT: data.usage?.prompt_tokens || 0,
    outT: data.usage?.completion_tokens || 0,
  }
}

module.exports = { callAzure, MAX_TOKENS }
