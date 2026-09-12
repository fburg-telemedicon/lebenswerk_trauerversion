// api/admin/profile-ask.js
// POST /api/admin/profile-ask  { code, question } → { answer, blocked?, topic?, hint?, redirect? }
// GET  /api/admin/profile-ask?code=ABC → { queries: [...] }  (Protokoll)
//
// Fragen an das Profil der Kategorie „Lebenslauf". Nur für den Manager des
// Buchprojekts (bzw. Admin); der IDOR-Schutz läuft wie überall über
// loadAccessibleMemorial, das für fremde Bücher 404 liefert.
//
// Jede Frage wird protokolliert — auch die geblockten. Das Protokoll steht in
// memorials.profile_queries und ist für die Person einsehbar; wer über einen
// Menschen Auskunft einholt, hinterlässt eine Spur.

const { createClient } = require('../_lib/store')
const { checkAuth } = require('../_lib/auth')
const { loadAccessibleMemorial } = require('../_lib/access')
const { ensureLifeworkSchema } = require('../_lib/lifework')
const { callAzure } = require('../_lib/llm')
const { costLLM, recordCost, budgetExceeded, BUDGET_MESSAGE } = require('../_lib/cost')
const { isCareerCategory } = require('../_lib/categories')
const { screenQuestion, buildSystem } = require('../_lib/profileqa')

const supabase = createClient()

const COLS = 'id, name, product_category, owner_user, cv, avoca, documents, profile_queries'
const MAX_LOG = 200   // Ringpuffer: das Protokoll darf die Zeile nicht sprengen.

// Beiträge des Buchprojekts (Selbstauskunft; Gastbeiträge kennt diese Kategorie
// nicht, der Filter schadet aber nicht).
async function loadContributions(code) {
  const { data } = await supabase
    .from('contributions')
    .select('contributor_name, relationship, messages, is_guest')
    .eq('memorial_id', code)
    .order('created_at', { ascending: true })
  return (data || []).filter(c => c.is_guest !== true)
}

async function appendLog(code, current, entry) {
  const list = Array.isArray(current) ? current : []
  const next = [...list, entry].slice(-MAX_LOG)
  await supabase.from('memorials').update({ profile_queries: next }).eq('id', code)
  return next
}

module.exports = async function handler(req, res) {
  if (!checkAuth(req, res)) return
  try {
    await ensureLifeworkSchema().catch(() => {})
    const code = String((req.method === 'GET' ? req.query.code : req.body?.code) || '').toUpperCase().trim()
    if (!code) return res.status(400).json({ error: 'code fehlt.' })

    const access = await loadAccessibleMemorial(supabase, req.auth, code, COLS)
    if (access.error) return res.status(access.status).json({ error: access.error })
    const m = access.memorial
    if (!isCareerCategory(m.product_category)) {
      return res.status(400).json({ error: 'Fragen an das Profil gibt es nur beim Lebenslauf.' })
    }

    if (req.method === 'GET') {
      return res.json({ queries: Array.isArray(m.profile_queries) ? m.profile_queries : [] })
    }
    if (req.method !== 'POST') return res.status(405).end()

    const question = String(req.body?.question || '').trim()
    if (!question) return res.status(400).json({ error: 'Frage fehlt.' })
    if (question.length > 500) return res.status(400).json({ error: 'Bitte die Frage kürzer fassen (max. 500 Zeichen).' })

    const who = req.auth?.admin ? 'admin' : (req.auth?.uid || 'manager')
    const at = new Date().toISOString()

    // 1. Regelbasierte Sperre — VOR jedem Modellaufruf. Eine unzulässige Frage
    //    wird gar nicht erst gestellt, kostet also auch nichts.
    const screen = screenQuestion(question)
    if (screen?.blocked) {
      const entry = { at, by: who, question, blocked: true, topic: screen.topic, answer: '' }
      await appendLog(code, m.profile_queries, entry).catch(() => {})
      return res.json({
        blocked: true, topic: screen.topic, hint: screen.hint,
        answer: `Diese Frage zielt auf ein geschütztes Merkmal (${screen.topic}) und wird nicht beantwortet. ${screen.hint}`,
      })
    }

    if (await budgetExceeded(code)) return res.status(402).json({ error: BUDGET_MESSAGE })

    const contributions = await loadContributions(code)
    if (!contributions.length) return res.status(400).json({ error: 'Es liegt noch kein Gespräch vor.' })

    const system = buildSystem(m, contributions, screen?.redirect)
    const r = await callAzure({ system, messages: [{ role: 'user', content: question }] })
    const answer = String(r.text || '').trim()

    if (r.inT || r.outT) {
      await recordCost({
        memorial_id: code, kind: 'profile_qa', provider: r.provider, model: r.model,
        input_tokens: r.inT, output_tokens: r.outT, cost_usd: costLLM(r.model, r.inT, r.outT),
      }).catch(() => {})
    }

    const entry = { at, by: who, question, answer, blocked: false, ...(screen?.redirect ? { redirect: screen.redirect } : {}) }
    const queries = await appendLog(code, m.profile_queries, entry).catch(() => null)
    return res.json({ answer, ...(screen?.redirect ? { redirect: screen.redirect } : {}), ...(queries ? { queries } : {}) })
  } catch (e) {
    console.error('[profile-ask]', e)
    return res.status(500).json({ error: e.message || 'Fehler bei der Anfrage.' })
  }
}
