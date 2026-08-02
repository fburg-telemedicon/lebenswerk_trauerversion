// api/_lib/report-data.js
// Sammelt alle Kennzahlen für den Tagesreport – AUSSCHLIESSLICH aggregierte Zahlen
// (DSGVO): keine Namen, keine E-Mails, keine Beitragenden-/Verstorbenen-Details,
// keine Inhaltstexte. Zeitfenster ist der VORTAG in Europe/Berlin.
//
// Jede Teilabfrage ist gekapselt: schlägt eine fehl, bleibt ihr Wert 0/leer und
// der restliche Report entsteht trotzdem. Nutzt den service_role-Client (RLS wird
// umgangen), der vom Aufrufer übergeben wird.

const { changelogForDate } = require('./changelog')
const { purgeDueAt } = require('./retention')

const DAY_MS = 24 * 60 * 60 * 1000

// ── Europe/Berlin Zeit-Helfer (ohne externe tz-Bibliothek) ────────
function berlinDateStr(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d))
}
function berlinHour(d) {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', hour12: false }).format(new Date(d))) % 24
}
function berlinParts(d) {
  const [y, m, day] = berlinDateStr(d).split('-').map(Number)
  return { y, m, d: day }
}
// Verschiebung Berlin-Wanduhr ↔ UTC am gegebenen Zeitpunkt (in ms).
function berlinOffsetMs(d) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Berlin', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const p = f.formatToParts(d).reduce((a, x) => (a[x.type] = x.value, a), {})
  const hh = p.hour === '24' ? 0 : Number(p.hour)
  const asUTC = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), hh, Number(p.minute), Number(p.second))
  return asUTC - d.getTime()
}
// Beginn eines Berlin-Kalendertags (Y-M-D) als UTC-Date.
function berlinDayStartUTC(y, m, d) {
  const guess = Date.UTC(y, m - 1, d, 0, 0, 0)
  return new Date(guess - berlinOffsetMs(new Date(guess)))
}
function addDays(y, m, d, n) {
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + n)
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() }
}

function moduleOf(kind) {
  if (kind === 'tts') return 'tts'
  if (kind === 'stt') return 'stt'
  if (kind === 'image') return 'image'
  return 'llm'
}

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100 }

async function safe(label, fn, fallback) {
  try { return await fn() }
  catch (e) { console.error(`[report-data] ${label}:`, e.message); return fallback }
}

// Zählt Zeilen (build liefert eine ...select('*',{count:'exact',head:true})-Query).
async function countRows(supabase, build) {
  const { count, error } = await build(supabase)
  if (error) throw error
  return count || 0
}

// Aggregiert die Kennzahlen. opts.now = Referenzzeitpunkt (Default: jetzt).
async function gatherReport(supabase, opts = {}) {
  const now = opts.now ? new Date(opts.now) : new Date()
  const bToday = berlinParts(now)
  const yday = addDays(bToday.y, bToday.m, bToday.d, -1)          // Zieltag = gestern
  const dayStart = berlinDayStartUTC(yday.y, yday.m, yday.d)
  const dayEnd = berlinDayStartUTC(bToday.y, bToday.m, bToday.d)  // = heute 00:00 Berlin
  const s30 = addDays(yday.y, yday.m, yday.d, -29)
  const start30 = berlinDayStartUTC(s30.y, s30.m, s30.d)
  const mtdStart = berlinDayStartUTC(yday.y, yday.m, 1)
  const pm = addDays(yday.y, yday.m, 1, -1)                       // letzter Tag Vormonat
  const prevMonthStart = berlinDayStartUTC(pm.y, pm.m, 1)
  const prevMonthEnd = mtdStart

  const dateStr = `${yday.y}-${String(yday.m).padStart(2, '0')}-${String(yday.d).padStart(2, '0')}`
  const iso = d => d.toISOString()
  const inWin = (t, a, b) => { const x = new Date(t).getTime(); return x >= a.getTime() && x < b.getTime() }

  // 30-Tage-Tagesliste (Berlin) als Achsen-Gerüst.
  const days = []
  for (let i = 0; i < 30; i++) {
    const d = addDays(s30.y, s30.m, s30.d, i)
    days.push(`${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`)
  }
  const dayIndex = Object.fromEntries(days.map((d, i) => [d, i]))

  // ── Memorials (Stammdaten, klein) ────────────────────────────────
  // *_at-Spalten existieren evtl. noch nicht (Migration report.sql). Fallback.
  let memorials = await safe('memorials(full)', async () => {
    const { data, error } = await supabase.from('memorials')
      .select('id, product_category, created_at, book_v1_at, book_v2_at, eulogy_at, funeral_date, uploaded_images, languages, purge_info')
    if (error) throw error
    return data || []
  }, null)
  let genTimestamps = true
  if (memorials === null) {
    genTimestamps = false
    memorials = await safe('memorials(minimal)', async () => {
      const { data, error } = await supabase.from('memorials')
        .select('id, product_category, created_at, funeral_date, uploaded_images, languages, purge_info')
      if (error) throw error
      return data || []
    }, [])
  }

  // Heartbeats geplanter Jobs (für den Systemstatus).
  const heartbeats = await safe('job_heartbeats', async () => {
    const { data, error } = await supabase.from('job_heartbeats').select('job, last_run_at, last_status, detail')
    if (error) throw error
    return data || []
  }, [])

  // ── Kostenevents letzte 30 Tage (+ gestern) ─────────────────────
  const costRange = await safe('cost(30d)', async () => {
    const { data, error } = await supabase.from('cost_events')
      .select('kind, cost_eur, model, provider, created_at').gte('created_at', iso(start30))
    if (error) throw error
    return data || []
  }, [])

  // ── Beiträge: Zeitstempel 30 Tage (leicht) + Nachrichten nur gestern ─
  // Abgelehnte Gastbeiträge (Kuratierung des Managers) zählen nirgends mit — sie
  // fließen in kein Produkt. `guest_status` ist jung: fehlt die Spalte, wird ohne
  // sie gelesen, damit die Kennzahl nicht auf 0 fällt.
  const notRejected = r => r.guest_status !== 'rejected'
  const selectContribs = async (cols, apply) => {
    let { data, error } = await apply(supabase.from('contributions').select(`${cols}, guest_status`))
    if (error && /guest_status/i.test(error.message || '')) {
      ;({ data, error } = await apply(supabase.from('contributions').select(cols)))
    }
    if (error) throw error
    return (data || []).filter(notRejected)
  }
  const contribCreated = await safe('contrib(created,30d)', () =>
    selectContribs('created_at', q => q.gte('created_at', iso(start30))), [])
  const contribMsgsYday = await safe('contrib(messages,yday)', () =>
    selectContribs('messages', q => q.gte('created_at', iso(dayStart)).lt('created_at', iso(dayEnd))), [])

  // ── MTD / Vormonat Kosten ────────────────────────────────────────
  const costMtd = await safe('cost(mtd)', async () => {
    const { data, error } = await supabase.from('cost_events')
      .select('cost_eur').gte('created_at', iso(mtdStart)).lt('created_at', iso(dayEnd))
    if (error) throw error
    return (data || []).reduce((s, r) => s + Number(r.cost_eur || 0), 0)
  }, 0)
  const costPrevMonth = await safe('cost(prevMonth)', async () => {
    const { data, error } = await supabase.from('cost_events')
      .select('cost_eur').gte('created_at', iso(prevMonthStart)).lt('created_at', iso(prevMonthEnd))
    if (error) throw error
    return (data || []).reduce((s, r) => s + Number(r.cost_eur || 0), 0)
  }, 0)

  // ── Zähler (head:true, keine Datenübertragung) ──────────────────
  const memorialsTotal = await safe('count(memorials)', () => countRows(supabase, s => s.from('memorials').select('*', { count: 'exact', head: true })), memorials.length)
  const contributionsRaw = await safe('count(contributions)', () => countRows(supabase, s => s.from('contributions').select('*', { count: 'exact', head: true })), 0)
  // Abgelehnte Gastbeiträge abziehen (siehe oben). Eigener Zähler statt eines
  // NOT-Filters: `NOT (guest_status = 'rejected')` ist für NULL selbst NULL und
  // würde alle Nicht-Gast-Beiträge mit herauswerfen.
  const rejectedGuests = await safe('count(rejectedGuests)', () => countRows(supabase, s => s.from('contributions').select('*', { count: 'exact', head: true }).eq('guest_status', 'rejected')), 0)
  const contributionsTotal = Math.max(0, contributionsRaw - rejectedGuests)
  const managersTotal = await safe('count(managers)', () => countRows(supabase, s => s.from('app_users').select('*', { count: 'exact', head: true })), 0)
  const newManagers = await safe('count(newManagers)', () => countRows(supabase, s => s.from('app_users').select('*', { count: 'exact', head: true }).gte('created_at', iso(dayStart)).lt('created_at', iso(dayEnd))), 0)
  const imagesTotal = await safe('count(images)', () => countRows(supabase, s => s.from('cost_events').select('*', { count: 'exact', head: true }).eq('kind', 'image')), 0)
  const booksTotal = await safe('count(books)', () => countRows(supabase, s => s.from('memorials').select('*', { count: 'exact', head: true }).or('book_v1.not.is.null,book_v2.not.is.null')), 0)
  const eulogiesTotal = await safe('count(eulogies)', () => countRows(supabase, s => s.from('memorials').select('*', { count: 'exact', head: true }).not('eulogy_text', 'is', null)), 0)
  // Vom Endnutzer ABGESCHLOSSENE Bücher (vorläufige Druckversion finalisiert) →
  // müssen gedruckt werden. Gestern abgeschlossen (aktionabel) + Gesamtbestand.
  const finalizedTotal = await safe('count(finalized)', () => countRows(supabase, s => s.from('memorials').select('*', { count: 'exact', head: true }).eq('book_finalized', true)), 0)
  const finalizedYday = await safe('count(finalizedYday)', () => countRows(supabase, s => s.from('memorials').select('*', { count: 'exact', head: true }).gte('book_finalized_at', iso(dayStart)).lt('book_finalized_at', iso(dayEnd))), 0)

  // ── Serien (30 Tage) ────────────────────────────────────────────
  const contributionsPerDay = new Array(30).fill(0)
  for (const r of contribCreated) { const i = dayIndex[berlinDateStr(r.created_at)]; if (i != null) contributionsPerDay[i]++ }
  const costPerDay = new Array(30).fill(0)
  for (const r of costRange) { const i = dayIndex[berlinDateStr(r.created_at)]; if (i != null) costPerDay[i] += Number(r.cost_eur || 0) }
  const memorialsPerDay = new Array(30).fill(0)
  const memByCat30 = {}
  for (const m of memorials) {
    const i = dayIndex[berlinDateStr(m.created_at)]
    if (i != null) { memorialsPerDay[i]++; memByCat30[m.product_category || 'memorial'] = (memByCat30[m.product_category || 'memorial'] || 0) + 1 }
  }

  // ── Gestern-Kennzahlen ──────────────────────────────────────────
  const newMemorials = memorials.filter(m => inWin(m.created_at, dayStart, dayEnd))
  const newMemorialsByCat = {}
  for (const m of newMemorials) { const c = m.product_category || 'memorial'; newMemorialsByCat[c] = (newMemorialsByCat[c] || 0) + 1 }

  let newBooks = 0, newEulogies = 0
  if (genTimestamps) {
    for (const m of memorials) {
      if (m.book_v1_at && inWin(m.book_v1_at, dayStart, dayEnd)) newBooks++
      if (m.book_v2_at && inWin(m.book_v2_at, dayStart, dayEnd)) newBooks++
      if (m.eulogy_at && inWin(m.eulogy_at, dayStart, dayEnd)) newEulogies++
    }
  }

  // Neue Fotos gestern (uploaded_images[].uploaded_at) + Fotos gesamt.
  let newPhotos = 0, photosTotal = 0
  for (const m of memorials) {
    const list = Array.isArray(m.uploaded_images) ? m.uploaded_images : []
    photosTotal += list.length
    for (const u of list) { if (u?.uploaded_at && inWin(u.uploaded_at, dayStart, dayEnd)) newPhotos++ }
  }

  // Kosten gestern nach Modul + Provider/Modell.
  const costByModule = { llm: 0, tts: 0, stt: 0, image: 0 }
  const costByModel = {}
  let costYesterday = 0
  for (const r of costRange) {
    if (!inWin(r.created_at, dayStart, dayEnd)) continue
    const eur = Number(r.cost_eur || 0)
    costYesterday += eur
    costByModule[moduleOf(r.kind)] += eur
    const key = `${r.provider || '?'} · ${r.model || '?'}`
    costByModel[key] = (costByModel[key] || 0) + eur
  }
  const costPrevDay = costPerDay[28] || 0   // vorgestern (Serie: 29=gestern, 28=vorgestern)

  // Zeichen-/Wortvolumen der gestrigen Beiträge (nur Nutzer-Nachrichten, nur Länge).
  let chars = 0, words = 0
  for (const c of contribMsgsYday) {
    const msgs = Array.isArray(c.messages) ? c.messages : []
    for (const msg of msgs) {
      if (msg?.role !== 'user') continue
      const t = typeof msg.content === 'string' ? msg.content : ''
      chars += t.length
      if (t.trim()) words += t.trim().split(/\s+/).length
    }
  }

  // Spitzen-Uhrzeiten: gestrige Beiträge nach Berlin-Stunde (0..23).
  const peakHours = new Array(24).fill(0)
  for (const r of contribCreated) { if (inWin(r.created_at, dayStart, dayEnd)) peakHours[berlinHour(r.created_at)]++ }

  // Sprachverteilung (aus allen Memorials, Angebot der Sprachen).
  const langDist = {}
  for (const m of memorials) { for (const l of (Array.isArray(m.languages) ? m.languages : ['de'])) langDist[l] = (langDist[l] || 0) + 1 }
  // Kategorienverteilung gesamt.
  const catDist = {}
  for (const m of memorials) { const c = m.product_category || 'memorial'; catDist[c] = (catDist[c] || 0) + 1 }

  // Retention-Vorschau: fällige Löschungen in den nächsten 7/30 Tagen +
  // ÜBERFÄLLIGE (Frist seit >1 Tag vorbei, aber noch nicht bereinigt → Purge klemmt).
  let retention7 = 0, retention30 = 0, retentionOverdue = 0
  const nowMs = now.getTime()
  for (const m of memorials) {
    // Fälligkeit NICHT hier nachrechnen — sonst driftet der Report von dem ab,
    // was der Purge-Cron tatsächlich tut (Nutzungsdauer + Frist, je Kategorie).
    const dueIso = purgeDueAt(m)
    if (!dueIso) continue
    const due = new Date(dueIso).getTime()
    const inDays = (due - nowMs) / DAY_MS
    if (inDays >= 0 && inDays <= 7) retention7++
    if (inDays >= 0 && inDays <= 30) retention30++
    if (!m.purge_info?.purged_at && due + DAY_MS < nowMs) retentionOverdue++
  }

  // ── Mikrofon-Telemetrie (anonyme Tageszähler aus usage_daily) ────
  // Interessant ist nicht die absolute Zahl, sondern der ANTEIL blockierter
  // Mikrofone an den begonnenen Interviews — und ob er auf einer Plattform
  // (installierte App!) auffällig höher liegt. Tabelle jung → Fallback 0.
  const micRows = await safe('usage_daily(30d)', async () => {
    const { data, error } = await supabase.from('usage_daily')
      .select('day, kind, platform, count').gte('day', days[0])
    if (error) throw error
    return data || []
  }, [])
  const micSum = (rows, kind) => rows.filter(r => r.kind === kind).reduce((s, r) => s + Number(r.count || 0), 0)
  const dayStr = r => String(r.day).slice(0, 10)
  const micYday = micRows.filter(r => dayStr(r) === dateStr)
  const micByPlatform = {}
  for (const r of micRows) {
    if (r.kind !== 'mic_blocked' && r.kind !== 'interview_start') continue
    const p = micByPlatform[r.platform] || (micByPlatform[r.platform] = { starts: 0, blocked: 0 })
    if (r.kind === 'interview_start') p.starts += Number(r.count || 0)
    else p.blocked += Number(r.count || 0)
  }
  const share = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null)
  const micStats = {
    yesterday: {
      starts: micSum(micYday, 'interview_start'),
      ok: micSum(micYday, 'mic_ok'),
      blocked: micSum(micYday, 'mic_blocked'),
      missing: micSum(micYday, 'mic_missing'),
    },
    last30: {
      starts: micSum(micRows, 'interview_start'),
      blocked: micSum(micRows, 'mic_blocked'),
      missing: micSum(micRows, 'mic_missing'),
    },
    byPlatform: Object.fromEntries(Object.entries(micByPlatform)
      .map(([k, v]) => [k, { ...v, sharePct: share(v.blocked, v.starts) }])
      .sort((a, b) => b[1].starts - a[1].starts)),
  }
  micStats.yesterday.sharePct = share(micStats.yesterday.blocked, micStats.yesterday.starts)
  micStats.last30.sharePct = share(micStats.last30.blocked, micStats.last30.starts)

  // ── Systemstatus: geplante Jobs ─────────────────────────────────
  // Erwartete Jobs + max. Alter, ab dem "überfällig". Purge läuft täglich (GitHub
  // Action 03:00 UTC), der Report täglich (Vercel-Cron). 26 h Toleranz.
  const EXPECTED_JOBS = [
    { job: 'purge', label: 'DSGVO-Löschung (Purge)', maxAgeH: 26 },
    { job: 'report', label: 'Tagesreport', maxAgeH: 26 },
    { job: 'transcript', label: 'Transkript-Prüfung', maxAgeH: 26 },
  ]
  const hbByJob = Object.fromEntries((heartbeats || []).map(h => [h.job, h]))
  const jobs = EXPECTED_JOBS.map(({ job, label, maxAgeH }) => {
    const hb = hbByJob[job]
    if (!hb) return { job, label, ok: null, ageHours: null, lastRunAt: null, status: 'unbekannt' }
    const ageHours = Math.round((nowMs - new Date(hb.last_run_at).getTime()) / 3600000)
    const fresh = ageHours <= maxAgeH
    const statusOk = !hb.last_status || hb.last_status === 'ok'
    return { job, label, ok: fresh && statusOk, ageHours, lastRunAt: hb.last_run_at, status: hb.last_status || 'ok' }
  })
  const health = {
    jobs,
    retentionOverdue,
    allOk: jobs.every(j => j.ok !== false) && retentionOverdue === 0,
  }

  const prevMemorials = memorialsPerDay[28] || 0
  const prevContributions = contributionsPerDay[28] || 0

  return {
    date: dateStr,
    dateLabel: new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Europe/Berlin' }).format(dayStart),
    generatedAt: now.toISOString(),
    genTimestamps,
    yesterday: {
      newMemorials: newMemorials.length,
      newMemorialsByCat,
      newContributions: contributionsPerDay[29] || 0,
      newBooks, newEulogies, newPhotos, newManagers,
      finalizedBooks: finalizedYday,
      costEur: round2(costYesterday),
      costByModule: { llm: round2(costByModule.llm), tts: round2(costByModule.tts), stt: round2(costByModule.stt), image: round2(costByModule.image) },
      costByModel: Object.fromEntries(Object.entries(costByModel).map(([k, v]) => [k, round2(v)]).sort((a, b) => b[1] - a[1])),
      chars, words,
      peakHours,
      delta: {
        memorials: newMemorials.length - prevMemorials,
        contributions: (contributionsPerDay[29] || 0) - prevContributions,
        costEur: round2(costYesterday - costPrevDay),
      },
    },
    totals: {
      memorials: memorialsTotal,
      contributions: contributionsTotal,
      managers: managersTotal,
      books: booksTotal,
      eulogies: eulogiesTotal,
      photos: photosTotal,
      images: imagesTotal,
      finalizedBooks: finalizedTotal,
    },
    mtd: { costEur: round2(costMtd), prevMonthCostEur: round2(costPrevMonth) },
    series: { days, contributionsPerDay, costPerDay: costPerDay.map(round2), memorialsPerDay, memByCat30 },
    distributions: { langDist, catDist },
    retention: { next7: retention7, next30: retention30, overdue: retentionOverdue },
    micStats,
    health,
    changelog: changelogForDate(dateStr),
  }
}

module.exports = { gatherReport, berlinDateStr }
