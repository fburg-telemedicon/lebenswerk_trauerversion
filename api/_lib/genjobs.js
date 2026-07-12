// api/_lib/genjobs.js
// Lebenszyklus-Helfer für serverseitige Generierungs-Jobs (Tabelle generation_jobs).
// Muster analog api/cron/transcript-check.js: ein Worker (api/cron/generate.js)
// arbeitet Jobs schrittweise ab, speichert nach jedem Schritt den Fortschritt und
// setzt sich selbst fort (triggerWorker), bis alle Jobs erledigt sind. So ist die
// Erstellung robust gegen Verbindungsabbrüche im Browser – das UI pollt nur.

const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

// Lock gilt 3 Minuten; danach darf ein anderer Worker einen „hängenden" Job
// (z. B. abgestürzte Invocation) übernehmen.
const LOCK_STALE_MS = 3 * 60 * 1000

// In der DB speicherbare Zielfelder (Allowlist, wie beim Admin-PATCH der Bücher).
const SAVE_FIELDS = new Set(['eulogy_text', 'book_v1', 'book_v2'])

async function enqueue({ memorial_id, kind, params, owner_user }) {
  const { data, error } = await supabase.from('generation_jobs')
    .insert({
      memorial_id, kind,
      status: 'queued',
      params: params || {},
      progress: { phase: 'queued' },
      owner_user: owner_user || null,
    })
    .select('id').single()
  if (error) throw error
  return data.id
}

async function getJob(id) {
  const { data, error } = await supabase.from('generation_jobs').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return data
}

// Öffentlich pollbarer Status (ohne internes params/lock). memorial_id dient der
// Zugriffsprüfung im Endpoint.
function publicJob(j) {
  if (!j) return null
  return {
    id: j.id, memorial_id: j.memorial_id, kind: j.kind, status: j.status,
    progress: j.progress || {}, error: j.error || null,
    created_at: j.created_at, updated_at: j.updated_at,
  }
}

// Nächsten bearbeitbaren Job holen und locken (queued/running mit freiem/abgelaufenem
// Lock). Optimistisches Locking über den locked_at-Filter im UPDATE.
async function claimNext() {
  const staleBefore = new Date(Date.now() - LOCK_STALE_MS).toISOString()
  const { data: cand } = await supabase.from('generation_jobs')
    .select('id')
    .in('status', ['queued', 'running'])
    .or(`locked_at.is.null,locked_at.lt.${staleBefore}`)
    .order('created_at', { ascending: true })
    .limit(1).maybeSingle()
  if (!cand) return null
  const now = new Date().toISOString()
  const { data: locked } = await supabase.from('generation_jobs')
    .update({ status: 'running', locked_at: now, updated_at: now })
    .eq('id', cand.id)
    .or(`locked_at.is.null,locked_at.lt.${staleBefore}`)
    .select('*').maybeSingle()
  return locked || null
}

async function jobStatus(id) {
  const { data } = await supabase.from('generation_jobs').select('status').eq('id', id).maybeSingle()
  return data?.status || null
}

async function patchJob(id, fields) {
  const { error } = await supabase.from('generation_jobs')
    .update({ ...fields, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}

// Fortschritt speichern und den Lock „auffrischen" (Worker lebt noch).
async function saveProgress(id, { progress, result }) {
  const patch = { locked_at: new Date().toISOString() }
  if (progress !== undefined) patch.progress = progress
  if (result !== undefined) patch.result = result
  await patchJob(id, patch)
}

async function finishJob(id, { progress, result }) {
  await patchJob(id, { status: 'done', locked_at: null, error: null, progress: progress || {}, result: result ?? null })
}

async function failJob(id, message, { progress } = {}) {
  await patchJob(id, { status: 'error', locked_at: null, error: String(message || 'Fehler'), ...(progress ? { progress } : {}) })
}

// Lock lösen, Job bleibt 'running' → nächster Worker/Trigger macht weiter.
async function releaseJob(id, { progress, result }) {
  const patch = { locked_at: null }
  if (progress !== undefined) patch.progress = progress
  if (result !== undefined) patch.result = result
  await patchJob(id, patch)
}

// Ergebnis in die Ziel-Spalte des Buchprojekts schreiben (Allowlist).
async function saveMemorialField(memorialCode, field, value) {
  if (!SAVE_FIELDS.has(field)) throw new Error(`Unerlaubtes Zielfeld: ${field}`)
  const { error } = await supabase.from('memorials').update({ [field]: value }).eq('id', memorialCode)
  if (error) throw error
}

// Wie viele Jobs warten noch (queued/running)? Für Selbst-Fortsetzung.
async function countPending() {
  const { count } = await supabase.from('generation_jobs')
    .select('*', { count: 'exact', head: true }).in('status', ['queued', 'running'])
  return count || 0
}

// Nächsten Worker-Lauf antriggern, ohne auf dessen Ende zu warten (Trigger genügt).
async function triggerWorker() {
  const base = (process.env.CRON_SELF_BASE_URL || 'https://lebensgeschichten.ai').replace(/\/+$/, '')
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), 800)
  try {
    await fetch(`${base}/api/cron/generate`, {
      headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
      signal: ac.signal,
    })
  } catch { /* Abbruch nach ~800ms ist gewollt – die neue Invocation läuft weiter */ }
  finally { clearTimeout(t) }
}

module.exports = {
  supabase, enqueue, getJob, publicJob, claimNext, patchJob, saveProgress,
  finishJob, failJob, releaseJob, saveMemorialField, countPending, triggerWorker, jobStatus,
}
