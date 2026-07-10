// api/cron/transcript-check.js
// Hintergrund-Prüfung der Beiträge auf Transkriptions-Rauschen (STT-Fehler,
// Fremdgeräusche, Eigennamen). Läuft als Vercel-Cron, damit die Buch-Detailseite
// sofort lädt (kein Live-KI-Call/Fortschrittsbalken im UI). Verarbeitet pro Lauf
// bis zu BATCH ungeprüfte Beiträge (transcript_checked_at IS NULL); der Rest folgt
// im nächsten Lauf. Gefundene Korrekturen werden angewandt und in
// transcript_corrections abgelegt (Bericht + Undo im Dashboard).
//
// Schutz wie die anderen Crons: Header Authorization: Bearer <CRON_SECRET>.
// Test ohne Speichern:  GET /api/cron/transcript-check?dry=1  (mit Bearer-Secret)

const { createClient } = require('@supabase/supabase-js')
const { callAzure } = require('../_lib/llm')
const { costLLM, recordCost } = require('../_lib/cost')
const { recordHeartbeat } = require('../_lib/heartbeat')
const { transcriptCheckSystem, applyCorrectionToMessages, newCorrectionId, parseCorrectionsJSON } = require('../_lib/transcript')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const BATCH = Math.max(1, parseInt(process.env.TRANSCRIPT_BATCH || '10', 10))

function authorized(req) {
  const secret = process.env.CRON_SECRET
  return Boolean(secret) && req.headers.authorization === `Bearer ${secret}`
}

module.exports = async function handler(req, res) {
  if (!authorized(req)) return res.status(401).json({ error: 'Nicht autorisiert.' })
  const dry = req.query?.dry === '1' || req.query?.dry === 'true'
  try {
    const { data: rows, error } = await supabase
      .from('contributions')
      .select('id, memorial_id, contributor_name, messages')
      .is('transcript_checked_at', null)
      .limit(BATCH)
    if (error) {
      // Migration transcript-check.sql noch nicht ausgeführt → sauber überspringen.
      if (/transcript_|column/i.test(error.message || '')) {
        return res.json({ ok: true, skipped: 'Spalten fehlen (Migration transcript-check.sql ausstehend).' })
      }
      throw error
    }

    const pending = (rows || []).filter(c => Array.isArray(c.messages) && c.messages.some(m => m?.role === 'user' && String(m.content || '').trim()))

    // Memorial-Namen für Eigennamen-Hinweise vorladen.
    const memIds = [...new Set(pending.map(c => c.memorial_id))]
    const memName = {}
    if (memIds.length) {
      const { data: ms } = await supabase.from('memorials').select('id, name').in('id', memIds)
      for (const m of ms || []) memName[m.id] = m.name
    }

    let checked = 0, corrected = 0, errors = 0
    const results = []
    for (const c of pending) {
      try {
        const userAnswers = c.messages
          .map((m, idx) => ({ index: idx, role: m.role, content: m.content }))
          .filter(a => a.role === 'user' && String(a.content || '').trim())
        const sys = transcriptCheckSystem({ name: memName[c.memorial_id] }, c, userAnswers)
        const r = await callAzure({ system: sys, messages: [{ role: 'user', content: 'Prüfe und liste die Korrekturen als JSON.' }] })
        if (r.inT || r.outT) {
          await recordCost({ memorial_id: c.memorial_id, contribution_id: c.id, kind: 'transcript_check', provider: r.provider, model: r.model, input_tokens: r.inT, output_tokens: r.outT, cost_usd: costLLM(r.model, r.inT, r.outT) })
        }
        let msgs = c.messages
        const applied = []
        for (const rc of parseCorrectionsJSON(r.text)) {
          const corr = {
            id: newCorrectionId(),
            message_index: Number(rc.message_index),
            before: String(rc.before || ''),
            after: String(rc.after || ''),
            reason: String(rc.reason || '').slice(0, 300),
            applied: true,
          }
          if (!corr.before || corr.after === corr.before || !Number.isInteger(corr.message_index)) continue
          const out = applyCorrectionToMessages(msgs, corr)
          if (out.ok) { msgs = out.messages; applied.push(corr) }
        }
        if (!dry) {
          const { error: upErr } = await supabase.from('contributions')
            .update({ messages: msgs, transcript_checked_at: new Date().toISOString(), transcript_corrections: applied })
            .eq('id', c.id)
          if (upErr) throw upErr
        }
        checked++; corrected += applied.length
        results.push({ id: c.id, corrections: applied.length })
      } catch (e) {
        errors++
        console.warn('[transcript-check]', c.id, e.message)
      }
    }

    const summary = { checked, corrected, errors, batch: pending.length, dry }
    if (!dry) await recordHeartbeat(supabase, 'transcript', errors ? 'partial' : 'ok', summary)
    console.log('[cron/transcript-check]', JSON.stringify(summary))
    return res.json({ ok: true, ...summary, results })
  } catch (e) {
    console.error('/api/cron/transcript-check:', e)
    res.status(500).json({ error: e.message })
  }
}
