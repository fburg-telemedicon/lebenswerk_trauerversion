// api/cron/generate.js
// Worker für serverseitige Generierung (Rede + Buch inkl. Bilder). Arbeitet Jobs
// aus generation_jobs schrittweise ab, speichert nach JEDEM Schritt den Fortschritt
// und setzt sich selbst fort, bis fertig ODER das Zeitbudget erreicht ist. So läuft
// die Erstellung weiter, auch wenn der Browser die Verbindung verliert.
//
// Auslösung: on-demand via genjobs.triggerWorker() beim Enqueue + Cron als Backstop.
// Schutz: Header Authorization: Bearer <CRON_SECRET>.
//
// Job-Pläne (params, vom Client mit categories.js gebaut – Outline/Kapitel port-frei):
//   Rede:  { resultType:'text-join', field, combine, kind, memorialCode, steps:[{system,user,label}] }
//   Buch:  { resultType:'book', field, variant, kind, memorialCode, language, title, subtitle,
//            dir, skipImages, imageStyle, uploads:[…], oldChapters:[…],
//            chapterSteps:[{system,user,meta:{number,heading?,contribution_id?,contributor_name?,relationship?}}] }

const { callAzure } = require('../_lib/llm')
const { costLLM, recordCost } = require('../_lib/cost')
const { recordHeartbeat } = require('../_lib/heartbeat')
const { issueToken } = require('../_lib/auth')
const genjobs = require('../_lib/genjobs')
const genprompts = require('../_lib/genprompts')
const { IMAGE_BUCKET } = require('../_lib/delete-memorial')

const TIME_BUDGET_MS = Math.max(10000, parseInt(process.env.GENERATE_BUDGET_MS || '240000', 10))
const MAX_CHAIN = 60

const sleep = ms => new Promise(r => setTimeout(r, ms))
const isRateLimit = msg => /rate limit|exceeded|429|too many requests|throttl/i.test(String(msg || ''))
const isContentFilter = msg => /content management policy|content[_ ]?filter|responsibleai|filtered due to/i.test(String(msg || ''))
const SOFTEN = '\n\nWICHTIG (Formulierung): Schreibe bewusst zurückhaltend, sanft und pietätvoll. Vermeide drastische, explizite oder belastende Formulierungen sowie detaillierte Schilderungen von Tod, Sterben, Krankheit, Gewalt, Suizid oder körperlichem Leid. Halte den Text ruhig, würdevoll, tröstlich und wertschätzend.'

function authorized(req) {
  const secret = process.env.CRON_SECRET
  return Boolean(secret) && req.headers.authorization === `Bearer ${secret}`
}
const canceled = async id => (await genjobs.jobStatus(id)) === 'canceled'

// Azure-Aufruf mit Backoff. Content-Policy → sofort abbrechen (ein erneuter
// Versuch mit demselben Prompt bringt nichts).
//
// RATE-LIMIT bekommt eigene, viel großzügigere Regeln: Wenn zwei Jobs desselben
// Buchs gleichzeitig laufen (z. B. Autobiographie + Pflegeexzerpt), teilen sie
// sich das Azure-Token-Kontingent — dann kommen 429er in Serie. Kurze Wartezeiten
// (früher 6 s/12 s, dann Aufgeben) haben in so einem Fall einzelne Abschnitte
// scheitern lassen. Jetzt: bis zu 6 Versuche mit exponentiell wachsender Pause
// (10/20/40/60/60 s, plus Jitter gegen Gleichtakt) — das überbrückt ein volles
// Kontingent-Fenster, statt den Abschnitt zu verlieren.
const MAX_ATTEMPTS = 6
const MAX_ATTEMPTS_OTHER = 3
async function callWithBackoff(args) {
  let lastErr
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await callAzure(args)
      if (!String(r.text || '').trim()) throw new Error('leere Antwort')
      return r
    } catch (e) {
      lastErr = e
      if (isContentFilter(e.message)) break
      const rate = isRateLimit(e.message)
      const limit = rate ? MAX_ATTEMPTS : MAX_ATTEMPTS_OTHER
      if (attempt >= limit) break
      const wait = rate
        ? Math.min(60000, 10000 * Math.pow(2, attempt - 1)) + Math.round(Math.random() * 3000)
        : 2000 * attempt
      await sleep(wait)
    }
  }
  throw lastErr
}

// Ein LLM-Schritt inkl. Kostenerfassung; bei Content-Filter EINMAL entschärften
// Prompt nachschieben. Gibt den Text zurück (oder wirft).
async function runLLMStep(job, kind, system, user) {
  const call = async sys => {
    const r = await callWithBackoff({ system: sys, messages: [{ role: 'user', content: user }] })
    if (r.inT || r.outT) {
      await recordCost({ memorial_id: job.memorial_id, kind: kind || 'generate', provider: r.provider, model: r.model, input_tokens: r.inT, output_tokens: r.outT, cost_usd: costLLM(r.model, r.inT, r.outT) }).catch(() => {})
    }
    return String(r.text || '').trim()
  }
  try { return await call(system) }
  catch (e) { if (!isContentFilter(e.message)) throw e; return await call(system + SOFTEN) }
}

// Inhalts-/Datenschutzprüfung des fertigen Textes (letzter Schritt jedes Jobs).
// System-Prompt + Beitrags-Kontext kommen aus dem Job (Browser hat sie mit
// review.js gebaut); den Buchtext baut der Worker aus dem Ergebnis. Läuft IMMER,
// unabhängig davon, ob der Browser noch verbunden ist. Fehler sind nicht fatal.
async function runReview(job, p, value) {
  if (!p.reviewSystem) return
  const code = p.memorialCode || job.memorial_id
  try {
    const user = `BUCHTEXT:\n${genprompts.extractReviewText(value)}\n\n${p.reviewContribContext || ''}`
    const raw = await runLLMStep(job, 'review', p.reviewSystem, user)
    const parsed = genprompts.tryParseJSON(raw) || {}
    await genjobs.mergeContentReport(code, p.field, {
      checked_at: new Date().toISOString(), model: 'KI (serverseitig)',
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
      findings: Array.isArray(parsed.findings) ? parsed.findings : [],
    })
  } catch (e) {
    console.warn('[generate] review', e.message)
    try { await genjobs.mergeContentReport(code, p.field, { checked_at: new Date().toISOString(), error: e.message }) } catch {}
  }
}

// ── Interne Aufrufe der (erprobten) Bild-Endpunkte mit frisch geminteten Admin-Token ──
function selfBase() { return (process.env.CRON_SELF_BASE_URL || 'https://lebensgeschichten.ai').replace(/\/+$/, '') }
async function adminPost(path, body) {
  const token = issueToken({ admin: true })
  const r = await fetch(`${selfBase()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
  return j
}

// ─────────────────────────── Rede / Endtext ────────────────────────────
async function processTextJoin(job, deadline) {
  const p = job.params || {}
  const steps = Array.isArray(p.steps) ? p.steps : []
  const result = job.result && typeof job.result === 'object' ? job.result : {}
  if (!Array.isArray(result.parts)) result.parts = []
  if (!Array.isArray(result.errors)) result.errors = []
  let cursor = Number(job.progress?.cursor) || 0

  while (cursor < steps.length) {
    if (Date.now() > deadline) { await genjobs.releaseJob(job.id, { progress: { phase: 'llm', cursor, total: steps.length }, result }); return 'paused' }
    if (await canceled(job.id)) return 'canceled'
    const step = steps[cursor]
    try {
      const text = await runLLMStep(job, p.kind, step.system, step.user)
      if (!text) throw new Error('leere Antwort')
      // `prefix` (z. B. "## Gewohnheiten und Tagesstruktur"): Der Abschnitts-Prompt
      // verlangt reinen Text OHNE Überschrift — die setzt das Layout, damit sie in
      // jeder Fassung gleich lautet. Nur Dokumente, die gegliedert sein sollen
      // (Pflegeexzerpt), schicken einen prefix; eine Rede bleibt ohne.
      result.parts.push(step.prefix ? `${step.prefix}\n\n${text}` : text)
    } catch (e) {
      result.errors.push(`${step.label || `Schritt ${cursor + 1}`}: ${isContentFilter(e.message) ? 'auch nach entschärftem Prompt vom KI-Inhaltsfilter blockiert (Azure Content-Policy)' : e.message}`)
    }
    cursor++
    await genjobs.saveProgress(job.id, { progress: { phase: 'llm', cursor, total: steps.length, message: step.label || '' }, result })
  }
  if (result.parts.length === 0) {
    await genjobs.failJob(job.id, `Kein Abschnitt konnte generiert werden.${result.errors[0] ? ' ' + result.errors[0] : ''}`, { progress: { phase: 'error' } })
    return 'error'
  }
  const value = result.parts.join(p.combine ?? '\n\n')
  try { await genjobs.saveMemorialField(p.memorialCode || job.memorial_id, p.field, value) }
  catch (e) { await genjobs.failJob(job.id, `Speichern fehlgeschlagen: ${e.message}`); return 'error' }
  await genjobs.saveProgress(job.id, { progress: { phase: 'review', cursor: steps.length, total: steps.length, message: 'Inhaltsprüfung' }, result })
  await runReview(job, p, value)
  await genjobs.finishJob(job.id, { progress: { phase: 'done', cursor: steps.length, total: steps.length, errors: result.errors.length, firstError: result.errors[0] || null }, result: { ...result, saved: true } })
  return 'done'
}

// ─────────────────────────────── Buch ──────────────────────────────────
const normH = s => String(s || '').trim().toLowerCase()

// Nach den Kapiteln: Fotos den Kapiteln zuordnen (deterministisch + KI) und je
// Kapitel ein Referenzfoto wählen. Ergebnisse in result ablegen (crash-sicher).
async function computeAssignments(job, p, result) {
  const uploads = Array.isArray(p.uploads) ? p.uploads : []
  const chapters = result.chapters
  const assignById = {}; for (const u of uploads) assignById[u.id] = u
  const chapterAssign = {}; const assignedIds = new Set()
  const take = (num, id) => { (chapterAssign[num] = chapterAssign[num] || []).push(id); assignedIds.add(id) }
  if (p.variant === 'book_v1') {
    for (const ch of chapters) {
      if (!ch.contribution_id) continue
      for (const u of uploads) if (u.contribution_id && u.contribution_id === ch.contribution_id && !assignedIds.has(u.id)) take(ch.number, u.id)
    }
  }
  const remaining = uploads.filter(u => !assignedIds.has(u.id))
  if (remaining.length > 0) {
    try {
      const raw = await runLLMStep(job, `${p.kind}_image_assign`, genprompts.imageAssignSystem(chapters, remaining) + (p.dir || ''), 'Ordne die Fotos jetzt zu (JSON).')
      const parsed = genprompts.tryParseJSON(raw)
      for (const a of (Array.isArray(parsed?.assignments) ? parsed.assignments : [])) {
        for (const id of (Array.isArray(a.image_ids) ? a.image_ids : [])) if (assignById[id] && !assignedIds.has(id)) take(Number(a.chapter), id)
      }
    } catch (e) { console.warn('[generate] imageAssign', e.message) }
  }
  // Referenzfotos (image-to-image Personen-Ähnlichkeit)
  const faceRef = uploads.find(u => u.orientation === 'portrait') || uploads[0]
  const faceRefGlobal = faceRef?.path || null
  const faceRefByChapter = {}
  if (uploads.length > 0 && chapters.length > 0) {
    try {
      const raw = await runLLMStep(job, `${p.kind}_face_ref`, genprompts.faceRefSystem(chapters, uploads) + (p.dir || ''), 'Wähle die Referenzfotos jetzt (JSON).')
      const parsed = genprompts.tryParseJSON(raw)
      for (const r of (Array.isArray(parsed?.refs) ? parsed.refs : [])) { const u = assignById[r.image_id]; if (u?.path) faceRefByChapter[Number(r.chapter)] = u.path }
    } catch (e) { console.warn('[generate] faceRef', e.message) }
  }
  result.chapterAssign = chapterAssign
  result.faceRefByChapter = faceRefByChapter
  result.faceRefGlobal = faceRefGlobal
}

async function processBook(job, deadline) {
  const p = job.params || {}
  const steps = Array.isArray(p.chapterSteps) ? p.chapterSteps : []
  const result = job.result && typeof job.result === 'object' ? job.result : {}
  if (!Array.isArray(result.chapters)) result.chapters = []
  if (!Array.isArray(result.errors)) result.errors = []
  // Initial ist progress.phase 'queued' → als Kapitelphase behandeln. Nur ein
  // ausdrückliches 'images' (Wiederaufnahme nach den Kapiteln) überspringt sie.
  let phase = job.progress?.phase === 'images' ? 'images' : 'chapters'

  // ── Phase 1: Kapitel schreiben (Cursor = Anzahl bereits geschriebener Kapitel) ──
  if (phase === 'chapters') {
    while (result.chapters.length < steps.length) {
      if (Date.now() > deadline) { await genjobs.releaseJob(job.id, { progress: { phase: 'chapters', cursor: result.chapters.length, total: steps.length }, result }); return 'paused' }
      if (await canceled(job.id)) return 'canceled'
      const step = steps[result.chapters.length]
      const meta = step.meta || {}
      let ch = null
      for (let attempt = 1; attempt <= 3 && !ch; attempt++) {
        try {
          const text = await runLLMStep(job, `${p.kind}_chapter`, step.system, step.user)
          const parsed = genprompts.tryParseJSON(text)
          if (parsed && (parsed.body || parsed.heading)) ch = parsed
        } catch (e) {
          if (attempt === 3) result.errors.push(`Kapitel ${meta.number}: ${isContentFilter(e.message) ? 'vom KI-Inhaltsfilter blockiert' : e.message}`)
        }
        if (!ch && attempt < 3) await sleep(1500 * attempt)
      }
      const extra = meta.contribution_id ? { contribution_id: meta.contribution_id, contributor_name: meta.contributor_name, relationship: meta.relationship } : {}
      result.chapters.push(ch
        ? { number: ch.number || meta.number, heading: ch.heading || meta.heading || `Kapitel ${meta.number}`, body: ch.body || '', image_prompt: ch.image_prompt || '', ...extra }
        : { number: meta.number, heading: meta.heading || `Kapitel ${meta.number}`, body: '', image_prompt: '', generate_error: 'Kapitel konnte nicht erzeugt werden', ...extra })
      await genjobs.saveProgress(job.id, { progress: { phase: 'chapters', cursor: result.chapters.length, total: steps.length, message: `Kapitel ${result.chapters.length}/${steps.length}` }, result })
    }
    // Kapitel fertig → Bildzuordnung + Referenzfotos (einmalig), dann Bildphase.
    await computeAssignments(job, p, result)
    phase = 'images'
    await genjobs.saveProgress(job.id, { progress: { phase: 'images', cursor: 0, total: result.chapters.length }, result })
  }

  // ── Phase 2: Bilder je Kapitel (Cursor = Kapitel mit image_done) ──
  if (phase === 'images' && !p.skipImages) {
    const uploads = Array.isArray(p.uploads) ? p.uploads : []
    const upById = {}; for (const u of uploads) upById[u.id] = u
    const oldChapters = Array.isArray(p.oldChapters) ? p.oldChapters : []
    const oldByContrib = new Map(); const oldByHeading = new Map()
    for (const oc of oldChapters) { if (!oc?.image_path) continue; if (oc.contribution_id) oldByContrib.set(oc.contribution_id, oc.image_path); if (oc.heading) oldByHeading.set(normH(oc.heading), oc.image_path) }
    const code = (p.memorialCode || job.memorial_id)

    let idx = result.chapters.findIndex(c => !c.image_done)
    while (idx !== -1) {
      if (Date.now() > deadline) { await genjobs.releaseJob(job.id, { progress: { phase: 'images', cursor: result.chapters.filter(c => c.image_done).length, total: result.chapters.length }, result }); return 'paused' }
      if (await canceled(job.id)) return 'canceled'
      const ch = result.chapters[idx]
      const assignedIds = result.chapterAssign?.[ch.number] || []
      const assigned = assignedIds.map(id => upById[id]).filter(Boolean).slice(0, 4)
      try {
        if (assigned.length > 0) {
          const { storagePath } = await adminPost('/api/admin/compose-image', { memorialCode: code, images: assigned.map(u => ({ path: u.path, caption: u.caption, orientation: u.orientation })), variant: p.variant, chapterNumber: ch.number, chapterHeading: ch.heading })
          ch.image_path = storagePath; ch.image_error = null; ch.from_upload = true
        } else {
          let reused = null
          if (ch.contribution_id && oldByContrib.has(ch.contribution_id)) reused = oldByContrib.get(ch.contribution_id)
          else if (oldByHeading.has(normH(ch.heading))) reused = oldByHeading.get(normH(ch.heading))
          else if (oldChapters[idx]?.image_path) reused = oldChapters[idx].image_path
          if (reused) { ch.image_path = reused; ch.image_error = null }
          else if (!ch.image_prompt) { ch.image_error = 'kein image_prompt im Kapitel' }
          else {
            const refPath = result.faceRefByChapter?.[ch.number] || result.faceRefGlobal
            const { storagePath, img2img } = await adminPost('/api/admin/generate-image', { memorialCode: code, prompt: ch.image_prompt, imageStyle: p.imageStyle, variant: p.variant, chapterNumber: ch.number, chapterHeading: ch.heading, ...(refPath ? { referencePaths: [refPath] } : {}) })
            // `img2img` = ein echtes Referenzfoto ging in die Bildgenerierung ein.
            // Wird am Kapitel festgehalten, weil der KI-Hinweis im Buch genau das
            // offenlegen muss (Personen-Ähnlichkeit auf Basis eines Fotos).
            ch.image_path = storagePath; ch.image_error = null; ch.image_ref = Boolean(img2img)
          }
        }
      } catch (e) {
        ch.image_error = e.message || String(e)
        result.errors.push(`Bild Kapitel ${ch.number}: ${e.message}`)
      }
      ch.image_done = true
      await genjobs.saveProgress(job.id, { progress: { phase: 'images', cursor: result.chapters.filter(c => c.image_done).length, total: result.chapters.length, message: `Bild ${result.chapters.filter(c => c.image_done).length}/${result.chapters.length}` }, result })
      idx = result.chapters.findIndex(c => !c.image_done)
    }
  }

  // ── Phase 3: Speichern ──
  const chapters = result.chapters.map(c => { const { image_done, ...rest } = c; return rest })
  const value = { title: p.title, subtitle: p.subtitle || '', language: p.language, chapters }
  try { await genjobs.saveMemorialField(p.memorialCode || job.memorial_id, p.field, value) }
  catch (e) { await genjobs.failJob(job.id, `Speichern fehlgeschlagen: ${e.message}`); return 'error' }
  await genjobs.saveProgress(job.id, { progress: { phase: 'review', total: result.chapters.length, message: 'Inhaltsprüfung' }, result })
  await runReview(job, p, value)
  await genjobs.finishJob(job.id, { progress: { phase: 'done', total: result.chapters.length, errors: result.errors.length, firstError: result.errors[0] || null }, result: { saved: true, errors: result.errors } })
  return 'done'
}


// ─────────── Lebenswerk-Nebenprodukte: Stammbaum & Lebensposter ───────────
// Beide liefen bisher im Browser (schloss man den Tab, war die Arbeit weg und es
// gab keinen Abbrechen-Knopf). Jetzt laufen sie wie Buch und Rede als Job:
//   Stammbaum: { resultType:'json', field:'family_tree', system, user }
//   Poster:    { resultType:'poster', field:'life_poster', system, user, posterStyle }
async function processJson(job, deadline) {
  const p = job.params || {}
  if (await canceled(job.id)) return 'canceled'
  await genjobs.saveProgress(job.id, { progress: { phase: 'llm', cursor: 0, total: 1, message: p.label || 'Wird gelesen' } })
  let data = null
  for (let attempt = 1; attempt <= 2 && !data; attempt++) {
    const raw = await runLLMStep(job, p.kind, p.system, p.user || 'Gib jetzt das JSON aus.')
    data = genprompts.tryParseJSON(raw)
    if (!data && attempt < 2) await sleep(1500)
  }
  if (!data) { await genjobs.failJob(job.id, 'Die KI hat kein gültiges JSON geliefert.'); return 'error' }
  if (await canceled(job.id)) return 'canceled'
  await genjobs.saveMemorialField(p.memorialCode || job.memorial_id, p.field, data)
  await genjobs.finishJob(job.id, { progress: { phase: 'done', cursor: 1, total: 1 }, result: { saved: true } })
  return 'done'
}

// Motiv-Prompt für das Poster-Gesamtbild (aus den Stationen). Muss zu
// posterSceneSystem() in src/lifeworkExtras.js passen — hier serverseitig, weil
// er erst gebaut werden kann, wenn die Stationen feststehen.
function sceneSystemFor(data) {
  const scenes = []
  for (const sec of (data.sections || [])) {
    for (const st of (sec.stations || [])) if (st.image_prompt) scenes.push(String(st.image_prompt))
  }
  const list = scenes.slice(0, 12).map((s, i) => `${i + 1}. ${s}`).join(String.fromCharCode(10))
  return `Du bist Illustrator. Beschreibe EIN einziges, weites Illustrationsblatt (Lebenskarte) in ENGLISCH — es zeigt den Lebensweg als mäandernden Pfad, an dem die folgenden Szenen liegen (von links unten nach rechts oben):

${list}

Gib NUR die englische Bildbeschreibung aus (60–110 Wörter), keine Erklärung, kein Markdown, keine Anführungszeichen.

Regeln:
- Beschreibe Weg, Szenen, Anordnung und Atmosphäre.
- Verlange ausdrücklich große, ruhige, leere Papierflächen zwischen und um die Szenen (dort wird später Text gedruckt).
- KEIN Text im Bild, keine Schrift, keine Zahlen, keine Schilder. Keine Gesichter.
- Nenne kein Medium und keinen Kunststil.`
}


// ── Schrift-Kontrolle des Poster-Motivs ───────────────────────────
// Bildmodelle malen auf Poster-Motiven trotz Verbot gelegentlich Buchstaben —
// und verschreiben sich dabei („Goburt in Segen"). Das Poster trägt aber echten
// Vektortext; gemalte Schrift ist dort IMMER ein Fehler. Deshalb sieht sich das
// (multimodale) Sprachmodell das fertige Bild an: Erkennt es Schrift, wird das
// Motiv verworfen und neu gezeichnet.
async function imageHasLettering(job, storagePath) {
  try {
    const { data, error } = await genjobs.supabase.storage.from(IMAGE_BUCKET).download(storagePath)
    if (error || !data) return false
    const buf = Buffer.from(await data.arrayBuffer())
    const b64 = buf.toString('base64')
    const r = await callWithBackoff({
      system: 'Du prüfst Illustrationen auf gemalte Schrift. Antworte AUSSCHLIESSLICH mit JSON.',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Enthält dieses Bild irgendwelche Buchstaben, Wörter, Zahlen, Beschriftungen, Schilder mit Text, Titel oder schriftähnliche Kritzel? Antworte NUR: {"text":true} oder {"text":false}. Im Zweifel {"text":true}.' },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
        ],
      }],
    })
    const parsed = genprompts.tryParseJSON(r.text) || {}
    if (r.inT || r.outT) {
      await recordCost({ memorial_id: job.memorial_id, kind: 'poster_text_check', provider: r.provider, model: r.model, input_tokens: r.inT, output_tokens: r.outT, cost_usd: costLLM(r.model, r.inT, r.outT) }).catch(() => {})
    }
    return parsed.text === true
  } catch (e) {
    console.warn('[generate] Schriftprüfung übersprungen:', e.message)
    return false   // im Zweifel durchlassen: lieber ein Poster mit Kritzel als gar keins
  }
}


// ── Wo liegt welche Szene? ────────────────────────────────────────
// Die Beschriftungen sollen NEBEN der Szene stehen, die sie meinen — nicht
// irgendwo. Wo das Bildmodell die Szenen platziert hat, weiß nur das Bild selbst.
// Also fragen wir es ab: Das multimodale Modell bekommt das fertige Motiv und die
// Liste der Stationen und ordnet jeder Station eine Zelle in einem 8×6-Raster zu.
// Schlägt das fehl, bleibt es beim bisherigen Verhalten (ruhigste freie Zelle).
async function locateScenes(job, storagePath, data) {
  try {
    const items = []
    ;(data.sections || []).forEach((sec, si) => (sec.stations || []).forEach((st, ti) => {
      items.push(`${items.length}: ${st.title} — ${st.image_prompt || ''}`)
    }))
    if (!items.length) return null
    const { data: file, error } = await genjobs.supabase.storage.from(IMAGE_BUCKET).download(storagePath)
    if (error || !file) return null
    const b64 = Buffer.from(await file.arrayBuffer()).toString('base64')
    const r = await callWithBackoff({
      system: 'Du lokalisierst Bildelemente. Antworte AUSSCHLIESSLICH mit rohem JSON.',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: `Das Bild ist eine illustrierte Lebenskarte. An (fast) jeder Szene wurde ein LEERES Schild mitgemalt: ein heller, glatter, unbeschrifteter Streifen, Anhänger, Banner oder ein Holzschild. Dort wird gleich der Text gedruckt.

Ordne jeder der folgenden Stationen ihr Schild zu und gib dessen Rechteck in RELATIVEN Koordinaten an: x/y = linke obere Ecke, w/h = Breite/Höhe, jeweils 0.0–1.0 (Ursprung oben links, x nach rechts, y nach unten).

Zusätzlich: das Raster der Szene selbst (8 Spalten col 0–7, 6 Zeilen row 0–5) — als Rückfall, falls kein Schild da ist.

Findest du zu einer Station weder Szene noch Schild, lass sie ganz weg. Erfinde nichts.

Stationen:
${items.join(String.fromCharCode(10))}

Antworte NUR so:
{"spots":[{"i":0,"col":1,"row":4,"x":0.12,"y":0.66,"w":0.10,"h":0.045},{"i":1,"col":3,"row":2}]}` },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
        ],
      }],
    })
    if (r.inT || r.outT) {
      await recordCost({ memorial_id: job.memorial_id, kind: 'poster_locate', provider: r.provider, model: r.model, input_tokens: r.inT, output_tokens: r.outT, cost_usd: costLLM(r.model, r.inT, r.outT) }).catch(() => {})
    }
    const parsed = genprompts.tryParseJSON(r.text) || {}
    const spots = Array.isArray(parsed.spots) ? parsed.spots : []
    return spots.length ? spots : null
  } catch (e) {
    console.warn('[generate] Szenen-Lokalisierung übersprungen:', e.message)
    return null
  }
}



// ── Das Lebensposter: EIN gemaltes Blatt je Stil ──────────────────
// Der Umweg über einzeln gezeichnete Szenen (die das Layout selbst zusammensetzt)
// hat den Text zwar sicher platziert, aber das Blatt sah aus wie ein Kontaktbogen:
// Der WEG und die freie, wilde Anordnung entstehen nur, wenn die Bild-KI das ganze
// Blatt in einem Zug malt. Also wieder so — und der Text bleibt Vektor, denn
// Bildmodelle verschreiben sich. Wo die Szenen im Bild liegen, misst `locateScenes`
// nach, damit die Beschriftung zu ihrer Szene findet.
//
// Inhalte und Motivbeschreibung entstehen EINMAL und gelten für alle Stile; teuer
// (und stilabhängig) ist nur das Bild.
const POSTER_STYLE_FALLBACK = ['storybook', 'journal', 'atlas', 'watercolor', 'nouveau']

// Motive rund um Abschied, Krankheit oder Krieg werden vom Bild-Dienst mitunter
// verweigert — und genau die gehören zu einem Leben. Statt aufzugeben, wird das
// Motiv entschärft: belastende Begriffe raus, ruhiger Ton rein.
const HEAVY = /\b(funeral|coffin|casket|grave|graveyard|cemetery|corpse|death|dead|dying|died|mourning|cancer|tumou?r|surgery|blood|wound|injur\w*|war|bomb\w*|weapon|gun|soldier)\w*/gi
function softenScenePrompt(p) {
  const cleaned = String(p || '').replace(HEAVY, '').replace(/\s{2,}/g, ' ').replace(/\s+,/g, ',').trim()
  return `${cleaned || 'a quiet sheet with a winding path and a few gentle everyday scenes'}, calm and tender atmosphere, nothing distressing`
}

// Ein Blatt in einem Stil malen lassen — und prüfen, dass keine Schrift drin ist.
// Bis zu drei Anläufe; danach das letzte Bild (ein Poster mit einem Kritzel ist
// besser als gar keins).
async function drawPosterSheet(job, code, motif, style, note) {
  let lastPath = null
  for (let attempt = 1; attempt <= 3; attempt++) {
    const prompt = attempt === 1 ? motif : softenScenePrompt(motif)
    try {
      const { storagePath } = await adminPost('/api/admin/generate-image', {
        memorialCode: code, prompt, variant: 'scene', posterStyle: style,
      })
      lastPath = storagePath
    } catch (e) {
      if (attempt === 3) { console.warn(`[generate] Poster-Blatt ${style} fehlgeschlagen: ${e.message}`); return null }
      await sleep(4000 * attempt)
      continue
    }
    await note('Motiv wird auf gemalte Schrift geprüft')
    if (!(await imageHasLettering(job, lastPath))) break
    console.warn(`[generate] Poster-Motiv (${style}) enthält Schrift — Versuch ${attempt} verworfen`)
    if (attempt < 3) await note(`Motiv enthielt Schrift — wird neu gezeichnet (${attempt + 1}/3)`)
  }
  return lastPath
}

async function processPoster(job, deadline) {
  const p = job.params || {}
  const code = p.memorialCode || job.memorial_id
  const result = job.result && typeof job.result === 'object' ? job.result : {}
  const styles = (Array.isArray(p.posterStyles) && p.posterStyles.length ? p.posterStyles
    : p.posterStyle ? [p.posterStyle] : POSTER_STYLE_FALLBACK).map(String)
  const total = 2 + styles.length

  // Schritt 1: Inhalte (Stationen, Jahre, Titel) — gelten für alle Stile.
  if (!result.data) {
    if (await canceled(job.id)) return 'canceled'
    await genjobs.saveProgress(job.id, { progress: { phase: 'llm', cursor: 0, total, message: 'Lebensstationen werden gesammelt' }, result })
    let data = null
    for (let attempt = 1; attempt <= 2 && !data; attempt++) {
      const raw = await runLLMStep(job, 'life_poster', p.system, p.user || 'Gib jetzt das JSON aus.')
      data = genprompts.tryParseJSON(raw)
      if (!data && attempt < 2) await sleep(1500)
    }
    if (!data) { await genjobs.failJob(job.id, 'Die KI hat kein gültiges JSON geliefert.'); return 'error' }
    result.data = data
    await genjobs.saveProgress(job.id, { progress: { phase: 'llm', cursor: 1, total, message: 'Motiv wird beschrieben' }, result })
  }

  // Schritt 2: die Bildbeschreibung des ganzen Blattes — stilfrei, also EINE für alle.
  if (!result.motif) {
    if (await canceled(job.id)) return 'canceled'
    try {
      result.motif = await runLLMStep(job, 'life_poster_scene', sceneSystemFor(result.data), 'Gib jetzt die Bildbeschreibung aus.')
    } catch (e) {
      result.motif = 'A winding path across a wide sheet with small scenes of a life along it: a bakery window, a meadow, a hospital ward, a workshop, a garden, a choir; generous empty paper between the scenes.'
    }
  }

  // Schritt 3…n: je Stil ein Blatt, danach die Szenen darin verorten.
  if (!Array.isArray(result.variants)) result.variants = []
  while (result.variants.length < styles.length) {
    if (await canceled(job.id)) return 'canceled'
    const idx = result.variants.length
    if (Date.now() > deadline) {
      await genjobs.releaseJob(job.id, { progress: { phase: 'image', cursor: 2 + idx, total }, result })
      return 'paused'
    }
    const style = styles[idx]
    const step = (msg) => genjobs.saveProgress(job.id, {
      progress: { phase: 'image', cursor: 2 + idx, total, message: `Stil ${idx + 1}/${styles.length}: ${msg}` }, result,
    })
    await step('Das Blatt wird gezeichnet')
    const scenePath = await drawPosterSheet(job, code, result.motif, style, step)
    let spots = null
    if (scenePath) {
      if (await canceled(job.id)) return 'canceled'
      await step('Szenen im Motiv werden verortet')
      spots = await locateScenes(job, scenePath, result.data)
    }

    // Das leere Beschriftungsfeld als EIGENE Grafik im selben Stil. Getrennt, weil
    // ein Bildmodell in ein Feld, das es zusammen mit dem Blatt malt, reflexhaft
    // Buchstaben kritzelt — und sich dabei verschreibt. So sieht es nie Text und
    // Feld zusammen; den Text druckt das Layout später als Vektor darauf.
    let bubblePath = null
    if (scenePath) {
      if (await canceled(job.id)) return 'canceled'
      await step('Beschriftungsfeld wird gezeichnet')
      try {
        const r = await adminPost('/api/admin/generate-image', {
          memorialCode: code, prompt: 'a blank label plaque', variant: 'bubble', posterStyle: style,
        })
        bubblePath = r.storagePath
      } catch (e) {
        console.warn(`[generate] Beschriftungsfeld (${style}) fehlgeschlagen: ${e.message}`)
      }
    }
    result.variants.push({ style, scene_path: scenePath, scene_spots: spots, bubble_path: bubblePath })
    await genjobs.saveProgress(job.id, { progress: { phase: 'image', cursor: 3 + idx, total }, result })
    if (result.variants.length < styles.length) await sleep(3000)
  }

  const ok = result.variants.filter(v => v.scene_path)
  if (!ok.length) { await genjobs.failJob(job.id, 'Es konnte kein Poster-Motiv erzeugt werden.'); return 'error' }

  // Gespeichert wird EIN Datensatz mit allen Blättern; die Felder scene_path/
  // scene_spots/style tragen zusätzlich das erste Blatt, damit ältere Poster und
  // der bestehende PDF-Weg unverändert funktionieren.
  result.data.variants = ok
  result.data.style = ok[0].style
  result.data.scene_path = ok[0].scene_path
  result.data.scene_spots = ok[0].scene_spots || undefined
  result.data.scene_prompt = result.motif

  if (await canceled(job.id)) return 'canceled'
  await genjobs.saveMemorialField(code, p.field, result.data)
  await genjobs.finishJob(job.id, { progress: { phase: 'done', cursor: total, total, errors: styles.length - ok.length }, result: { saved: true } })
  return 'done'
}


async function processJob(job, deadline) {
  const rt = job.params?.resultType
  if (rt === 'text-join') return processTextJoin(job, deadline)
  if (rt === 'book') return processBook(job, deadline)
  if (rt === 'json') return processJson(job, deadline)
  if (rt === 'poster') return processPoster(job, deadline)
  await genjobs.failJob(job.id, `Unbekannter resultType: ${rt}`)
  return 'error'
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
    catch (e) { console.error('[cron/generate] processJob', job.id, e.message); try { await genjobs.failJob(job.id, e.message) } catch {} outcome = 'error' }

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
