// api/admin/generate-job.js
// Serverseitige Generierung anstoßen & pollen (Auth erforderlich).
//   POST /api/admin/generate-job   { memorialCode, kind, params }
//        → legt einen Job an, triggert den Worker, gibt { jobId } zurück.
//   GET  /api/admin/generate-job?id=JOB           → Job-Status (pollen)
//   GET  /api/admin/generate-job?memorialCode=XXX → aktive/letzte Jobs des Buchs
//
// Der Worker (api/cron/generate.js) arbeitet den Job robust ab; das UI pollt nur
// den Status. Bricht die Browser-Verbindung ab, läuft der Job serverseitig weiter.

const { checkAuth } = require('../_lib/auth')
const genjobs = require('../_lib/genjobs')

const ALLOWED_KINDS = new Set(['eulogy', 'book_v1', 'book_v2', 'images'])

// Prüft Zugriff auf das Buchprojekt (Admin = alles; sonst eigenes Buch der
// erlaubten Kategorien). Rückgabe: memorial-Row (id) oder null.
async function accessibleMemorial(req, code) {
  const { data: m } = await genjobs.supabase
    .from('memorials').select('id, owner_user, product_category').eq('id', code).maybeSingle()
  if (!m) return null
  if (req.auth.admin) return m
  const cats = Array.isArray(req.auth.cats) ? req.auth.cats : []
  if (!req.auth.uid || cats.length === 0) return null
  if (m.owner_user === req.auth.uid && cats.includes(m.product_category)) return m
  return null
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (!checkAuth(req, res)) return
  try {
    if (req.method === 'GET') {
      const id = (req.query.id || '').trim()
      const code = (req.query.memorialCode || '').trim()
      if (id) {
        const job = await genjobs.getJob(id)
        if (!job) return res.status(404).json({ error: 'Job nicht gefunden.' })
        if (!(await accessibleMemorial(req, job.memorial_id))) return res.status(403).json({ error: 'Kein Zugriff.' })
        return res.json({ job: genjobs.publicJob(job) })
      }
      if (code) {
        if (!(await accessibleMemorial(req, code))) return res.status(403).json({ error: 'Kein Zugriff.' })
        const { data } = await genjobs.supabase.from('generation_jobs')
          .select('*').eq('memorial_id', code).order('created_at', { ascending: false }).limit(10)
        return res.json({ jobs: (data || []).map(genjobs.publicJob) })
      }
      return res.status(400).json({ error: 'id oder memorialCode erforderlich.' })
    }

    if (req.method === 'POST') {
      const { memorialCode, kind, params } = req.body || {}
      const code = String(memorialCode || '').trim()
      if (!code) return res.status(400).json({ error: 'memorialCode fehlt.' })
      if (!ALLOWED_KINDS.has(kind)) return res.status(400).json({ error: 'Ungültige Generierungsart.' })
      if (!(await accessibleMemorial(req, code))) return res.status(403).json({ error: 'Kein Zugriff auf dieses Buchprojekt.' })
      // Rede nutzt params.steps, Buch params.chapterSteps – eines von beiden muss da sein.
      const hasSteps = params && (
        (Array.isArray(params.steps) && params.steps.length > 0) ||
        (Array.isArray(params.chapterSteps) && params.chapterSteps.length > 0)
      )
      if (!hasSteps) return res.status(400).json({ error: 'params.steps/chapterSteps fehlt.' })
      // Nur EIN aktiver Job pro (Buch, Art): laufende zuerst abbrechen.
      await genjobs.supabase.from('generation_jobs')
        .update({ status: 'canceled', locked_at: null })
        .eq('memorial_id', code).eq('kind', kind).in('status', ['queued', 'running'])

      const jobId = await genjobs.enqueue({
        memorial_id: code, kind,
        params: { ...params, memorialCode: code, kind },
        owner_user: req.auth.uid || null,
      })
      // Worker sofort antriggern (nicht auf Cron warten).
      await genjobs.triggerWorker()
      return res.json({ jobId })
    }

    if (req.method === 'DELETE') {
      const id = (req.query.id || '').trim()
      if (!id) return res.status(400).json({ error: 'id fehlt.' })
      const job = await genjobs.getJob(id)
      if (!job) return res.json({ ok: true })
      if (!(await accessibleMemorial(req, job.memorial_id))) return res.status(403).json({ error: 'Kein Zugriff.' })
      if (job.status === 'queued' || job.status === 'running') {
        await genjobs.patchJob(id, { status: 'canceled', locked_at: null })
      }
      return res.json({ ok: true })
    }

    return res.status(405).end()
  } catch (e) {
    console.error('/api/admin/generate-job:', e)
    res.status(500).json({ error: e.message })
  }
}
