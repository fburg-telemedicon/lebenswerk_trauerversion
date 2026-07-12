// api/cron/generate.js
// Worker für serverseitige Generierung (Rede/Buch/Bilder). Arbeitet Jobs aus
// generation_jobs schrittweise ab (ein LLM-Schritt = ein Abschnitt/Kapitel),
// speichert nach JEDEM Schritt den Fortschritt und setzt sich selbst fort, bis
// alle Jobs erledigt sind ODER das ~50s-Zeitbudget erreicht ist. So läuft die
// Erstellung weiter, auch wenn der Browser die Verbindung verliert.
//
// Auslösung: on-demand via genjobs.triggerWorker() beim Enqueue + Cron als Backstop.
// Schutz wie die anderen Crons: Header Authorization: Bearer <CRON_SECRET>.
//
// Job-Plan (params, vom Client gebaut – bewusst port-frei, nutzt categories.js):
//   { field, resultType:'text-join', combine, kind, memorialCode, steps:[{system,user,label}] }

const { callAzure } = require('../_lib/llm')
const { costLLM, recordCost } = require('../_lib/cost')
const { recordHeartbeat } = require('../_lib/heartbeat')
const genjobs = require('../_lib/genjobs')

const TIME_BUDGET_MS = Math.max(10000, parseInt(process.env.GENERATE_BUDGET_MS || '50000', 10))
const MAX_CHAIN = 60

const sleep = ms => new Promise(r => setTimeout(r, ms))
const isRateLimit = msg => /rate limit|exceeded|429|too many requests|throttl/i.test(String(msg || ''))

function authorized(req) {
  const secret = process.env.CRON_SECRET
  return Boolean(secret) && req.headers.authorization === `Bearer ${secret}`
}

// Azure-Aufruf mit Backoff bei Rate-Limit (pausiert und wiederholt).
async function callWithBackoff(args) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { return await callAzure(args) }
    catch (e) {
      if (attempt < 3 && isRateLimit(e.message)) { await sleep(6000 * attempt); continue }
      throw e
    }
  }
}

// Verarbeitet EINEN Job bis zum Zeit-Deadline oder bis fertig.
// Rückgabe: 'done' | 'paused' | 'error'.
async function processJob(job, deadline) {
  const p = job.params || {}
  const steps = Array.isArray(p.steps) ? p.steps : []
  const result = job.result && typeof job.result === 'object' ? job.result : {}
  if (!Array.isArray(result.parts)) result.parts = []
  if (!Array.isArray(result.errors)) result.errors = []
  let cursor = Number(job.progress?.cursor) || 0

  if (p.resultType !== 'text-join') {
    await genjobs.failJob(job.id, `Unbekannter resultType: ${p.resultType}`)
    return 'error'
  }

  while (cursor < steps.length) {
    if (Date.now() > deadline) {
      await genjobs.releaseJob(job.id, { progress: { phase: 'llm', cursor, total: steps.length }, result })
      return 'paused'
    }
    const step = steps[cursor]
    try {
      const r = await callWithBackoff({ system: step.system, messages: [{ role: 'user', content: step.user }] })
      if (r.inT || r.outT) {
        await recordCost({ memorial_id: job.memorial_id, kind: p.kind || 'generate', provider: r.provider, model: r.model, input_tokens: r.inT, output_tokens: r.outT, cost_usd: costLLM(r.model, r.inT, r.outT) }).catch(() => {})
      }
      const text = String(r.text || '').trim()
      if (!text) throw new Error('leere Antwort')
      result.parts.push(text)
    } catch (e) {
      result.errors.push(`${step.label || `Schritt ${cursor + 1}`}: ${e.message}`)
    }
    cursor++
    await genjobs.saveProgress(job.id, {
      progress: { phase: 'llm', cursor, total: steps.length, message: step.label || '' },
      result,
    })
  }

  // Alle Schritte durch → zusammensetzen und speichern.
  if (result.parts.length === 0) {
    await genjobs.failJob(job.id, `Kein Abschnitt konnte generiert werden.${result.errors[0] ? ' ' + result.errors[0] : ''}`, {
      progress: { phase: 'error', cursor, total: steps.length },
    })
    return 'error'
  }
  const value = result.parts.join(p.combine ?? '\n\n')
  try {
    await genjobs.saveMemorialField(p.memorialCode || job.memorial_id, p.field, value)
  } catch (e) {
    await genjobs.failJob(job.id, `Speichern fehlgeschlagen: ${e.message}`)
    return 'error'
  }
  await genjobs.finishJob(job.id, {
    progress: { phase: 'done', cursor, total: steps.length, errors: result.errors.length },
    result: { ...result, saved: true },
  })
  return 'done'
}

module.exports = async function handler(req, res) {
  if (!authorized(req)) return res.status(401).json({ error: 'Nicht autorisiert.' })
  const chain = Math.max(0, parseInt(req.query?.chain || '0', 10))
  const startedAt = Date.now()
  const deadline = startedAt + TIME_BUDGET_MS
  try {
    const job = await genjobs.claimNext()
    if (!job) {
      if (chain === 0) await recordHeartbeat(genjobs.supabase, 'generate', 'ok', { idle: true }).catch(() => {})
      return res.json({ ok: true, idle: true })
    }

    let outcome
    try { outcome = await processJob(job, deadline) }
    catch (e) {
      console.error('[cron/generate] processJob', job.id, e.message)
      try { await genjobs.failJob(job.id, e.message) } catch {}
      outcome = 'error'
    }

    // Weiter, solange Jobs offen sind und Kette nicht gekappt.
    let remaining = 0
    try { remaining = await genjobs.countPending() } catch {}
    let chained = false
    if (remaining > 0 && chain < MAX_CHAIN) { await genjobs.triggerWorker(); chained = true }

    const summary = { job: job.id, outcome, remaining, chain, chained, ms: Date.now() - startedAt }
    if (chain === 0) await recordHeartbeat(genjobs.supabase, 'generate', outcome === 'error' ? 'partial' : 'ok', summary).catch(() => {})
    console.log('[cron/generate]', JSON.stringify(summary))
    return res.json({ ok: true, ...summary })
  } catch (e) {
    console.error('/api/cron/generate:', e)
    res.status(500).json({ error: e.message })
  }
}
