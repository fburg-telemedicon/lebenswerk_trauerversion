// api/cron/transcript-check.js
// Hintergrund-Prüfung der Beiträge auf Transkriptions-Rauschen (STT-Fehler,
// Fremdgeräusche, Eigennamen). Läuft nächtlich (Cron, siehe vercel.json), damit
// die Buch-Detailseite sofort lädt (kein Live-KI-Call/Fortschrittsbalken im UI).
//
// Skalierungssicher: prüft ungeprüfte Beiträge (transcript_checked_at IS NULL)
// PARALLEL (CONCURRENCY) und so lange, bis alle erledigt sind ODER ein Zeitbudget
// (~50 s) erreicht ist. Bleiben dann noch welche offen, TRIGGERT der Lauf sich
// selbst erneut (chain) und arbeitet den Rest in weiteren 60-s-Häppchen ab – so
// läuft die Warteschlange in derselben Nacht komplett leer, egal wie groß.
//
// Schutz wie die anderen Crons: Header Authorization: Bearer <CRON_SECRET>.
// Test ohne Speichern:  GET /api/cron/transcript-check?dry=1  (mit Bearer-Secret)

const { createClient } = require('@supabase/supabase-js')
const { callAzure } = require('../_lib/llm')
const { costLLM, recordCost } = require('../_lib/cost')
const { recordHeartbeat } = require('../_lib/heartbeat')
const { transcriptCheckSystem, applyCorrectionToMessages, newCorrectionId, parseCorrectionsJSON } = require('../_lib/transcript')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

// Niedrige Parallelität + Backoff: das Azure-gpt-4.1-Rate-Limit (westeurope) ist
// der Engpass, nicht die Serverless-Zeit. Zu viel Parallelität/zu schnelle Ketten
// erzeugen nur 429-Stürme. Werte per Env feinjustierbar.
const CONCURRENCY = Math.max(1, parseInt(process.env.TRANSCRIPT_CONCURRENCY || '6', 10))
const TIME_BUDGET_MS = Math.max(10000, parseInt(process.env.TRANSCRIPT_BUDGET_MS || '50000', 10))
const PAGE = 200          // ungeprüfte pro Invocation nachladen (Rest via Selbst-Fortsetzung)
const MAX_CHAIN = 40      // Sicherheitskappe gegen Endlos-Ketten

const sleep = ms => new Promise(r => setTimeout(r, ms))
const isRateLimit = msg => /rate limit|exceeded|429|too many requests|throttl/i.test(String(msg || ''))

function authorized(req) {
  const secret = process.env.CRON_SECRET
  return Boolean(secret) && req.headers.authorization === `Bearer ${secret}`
}

// Azure-Aufruf mit Backoff bei Rate-Limit (pausiert und wiederholt), damit sich
// der Cron auf das TPM-Kontingent einpegelt statt es zu hämmern.
async function callWithBackoff(args) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { return await callAzure(args) }
    catch (e) {
      if (attempt < 3 && isRateLimit(e.message)) { await sleep(7000 * attempt); continue }
      throw e
    }
  }
}

async function countPending() {
  const { count, error } = await supabase.from('contributions')
    .select('*', { count: 'exact', head: true }).is('transcript_checked_at', null)
  if (error) throw error
  return count || 0
}

// Prüft EINEN Beitrag, wendet Korrekturen an, speichert. Rückgabe: Anzahl Korrekturen.
async function processOne(c, memName, dry) {
  const userAnswers = c.messages
    .map((m, idx) => ({ index: idx, role: m.role, content: m.content }))
    .filter(a => a.role === 'user' && String(a.content || '').trim())
  const sys = transcriptCheckSystem({ name: memName[c.memorial_id] }, c, userAnswers)
  const r = await callWithBackoff({ system: sys, messages: [{ role: 'user', content: 'Prüfe und liste die Korrekturen als JSON.' }] })
  if (r.inT || r.outT) {
    await recordCost({ memorial_id: c.memorial_id, contribution_id: c.id, kind: 'transcript_check', provider: r.provider, model: r.model, input_tokens: r.inT, output_tokens: r.outT, cost_usd: costLLM(r.model, r.inT, r.outT) })
  }
  let msgs = c.messages
  const corrs = []
  for (const rc of parseCorrectionsJSON(r.text)) {
    const kind = rc.kind === 'suggestion' ? 'suggestion' : 'correction'
    const corr = {
      id: newCorrectionId(),
      kind,
      message_index: Number(rc.message_index),
      before: String(rc.before || ''),
      after: String(rc.after || ''),
      reason: String(rc.reason || '').slice(0, 300),
      applied: false,
    }
    if (!corr.before || !Number.isInteger(corr.message_index)) continue
    const target = msgs[corr.message_index]
    if (!target || typeof target.content !== 'string' || target.content.indexOf(corr.before) < 0) continue
    if (kind === 'correction') {
      // Klarer Fehler → automatisch anwenden.
      if (corr.after === corr.before) continue
      const out = applyCorrectionToMessages(msgs, corr)
      if (out.ok) { msgs = out.messages; corr.applied = true; corrs.push(corr) }
    } else {
      // Vorschlag (z. B. Störeinschub) → NICHT anwenden, nur flaggen. Der Manager
      // wendet ihn per Knopfdruck an; 'before' ist auffindbar, also anwendbar.
      corrs.push(corr)
    }
  }
  if (!dry) {
    const { error: upErr } = await supabase.from('contributions')
      .update({ messages: msgs, transcript_checked_at: new Date().toISOString(), transcript_corrections: corrs })
      .eq('id', c.id)
    if (upErr) throw upErr
  }
  return corrs.length
}

// Feuert den nächsten Ketten-Lauf an, ohne auf dessen Ende zu warten (Trigger
// genügt: Vercel startet die neue Invocation, sobald die Anfrage ankommt).
async function triggerNext(chain) {
  const base = (process.env.CRON_SELF_BASE_URL || 'https://lebensgeschichten.ai').replace(/\/+$/, '')
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), 800)
  try {
    await fetch(`${base}/api/cron/transcript-check?chain=${chain + 1}`, {
      headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
      signal: ac.signal,
    })
  } catch { /* Abbruch nach ~800ms ist gewollt – die neue Invocation läuft weiter */ }
  finally { clearTimeout(t) }
}

module.exports = async function handler(req, res) {
  if (!authorized(req)) return res.status(401).json({ error: 'Nicht autorisiert.' })
  const dry = req.query?.dry === '1' || req.query?.dry === 'true'
  const chain = Math.max(0, parseInt(req.query?.chain || '0', 10))
  const startedAt = Date.now()
  try {
    const { data: rows, error } = await supabase
      .from('contributions')
      .select('id, memorial_id, contributor_name, messages')
      .is('transcript_checked_at', null)
      .limit(PAGE)
    if (error) {
      if (/transcript_|column/i.test(error.message || '')) {
        return res.json({ ok: true, skipped: 'Spalten fehlen (Migration transcript-check.sql ausstehend).' })
      }
      throw error
    }

    const pending = (rows || []).filter(c => Array.isArray(c.messages) && c.messages.some(m => m?.role === 'user' && String(m.content || '').trim()))

    const memIds = [...new Set(pending.map(c => c.memorial_id))]
    const memName = {}
    if (memIds.length) {
      const { data: ms } = await supabase.from('memorials').select('id, name').in('id', memIds)
      for (const m of ms || []) memName[m.id] = m.name
    }

    // Parallel-Pool: bis Zeitbudget erreicht oder Seite abgearbeitet.
    let idx = 0, checked = 0, corrected = 0, errors = 0, budgetHit = false
    async function worker() {
      while (idx < pending.length) {
        if (Date.now() - startedAt > TIME_BUDGET_MS) { budgetHit = true; return }
        const c = pending[idx++]
        try { corrected += await processOne(c, memName, dry); checked++ }
        catch (e) { errors++; console.warn('[transcript-check]', c.id, e.message) }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length || 1) }, worker))

    // Rest ermitteln + ggf. selbst fortsetzen (nur echte Läufe).
    let remaining = 0
    try { remaining = await countPending() } catch {}
    let chained = false
    // Nur weiterketten, wenn dieser Lauf Fortschritt gemacht hat. Bei Nullfortschritt
    // (z. B. anhaltendes Rate-Limit) stoppen → keine Leerlauf-Kette; der nächste
    // nächtliche Lauf holt den Rest nach.
    if (!dry && remaining > 0 && chain < MAX_CHAIN && checked > 0) { await triggerNext(chain); chained = true }

    const summary = { checked, corrected, errors, remaining, chain, chained, budgetHit, dry, ms: Date.now() - startedAt }
    // Heartbeat nur am Kettenanfang (chain 0) setzen – markiert „Job lief heute".
    if (!dry && chain === 0) await recordHeartbeat(supabase, 'transcript', errors ? 'partial' : 'ok', summary)
    console.log('[cron/transcript-check]', JSON.stringify(summary))
    return res.json({ ok: true, ...summary })
  } catch (e) {
    console.error('/api/cron/transcript-check:', e)
    res.status(500).json({ error: e.message })
  }
}
