// api/enduser-book.js
// POST /api/enduser-book?code=ABC…   { action, ... }
//
// Endnutzer-Operationen rund um die „Probedruck"-Buchvorschau (nur Lebenswerk):
//   lock-acquire   → Bearbeitungs-Lock holen/erneuern (Checkout)  → { token, expires }
//   lock-heartbeat → Lock am Leben halten                          → { expires }
//   lock-release   → Lock freigeben (Check-in)                     → { ok }
//   proof-consume  → einen Probedruck „verbrauchen" (atomar)       → { used, max, remaining }
//   save-book      → bearbeitetes Buch (book_v2, NUR Text) sichern → { ok }
//
// Konfliktvermeidung: Ein Lock (edit_lock am Buch) mit TTL + Heartbeat. Läuft er
// ab (Endnutzer vergisst das Freigeben), gilt das Buch wieder als frei. Der Admin
// kann den Lock aus der Ferne lösen (PATCH /api/admin/memorials meta.releaseLock).
// Speichern setzt einen gültigen Lock voraus → kein gleichzeitiges Überschreiben.
//
// Autorisierung wie bei den übrigen Endnutzer-Pfaden (api/memorial.js): eingeloggter
// Endnutzer (eu-Claim == code) ODER – beim Lebenswerk – der Buch-Code allein.

const crypto = require('crypto')
const { createClient, pool } = require('./_lib/store')
const { checkAuth } = require('./_lib/auth')
const { enforce } = require('./_lib/ratelimit')
const { LIFEWORK } = require('./_lib/lifework')
const { sendMail } = require('./_lib/graphmail')
const { IMAGE_BUCKET } = require('./_lib/delete-memorial')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

const LOCK_TTL_MS = 15 * 60 * 1000   // 15 Min ohne Heartbeat → Lock läuft ab
// „Buch fertig – muss gedruckt werden" geht IMMER an den Betreiber (Manager
// drucken nicht selbst). Per Env überschreibbar.
const FINALIZE_NOTIFY = process.env.FINALIZE_NOTIFY || process.env.INVITE_BCC || 'florian.burg@lebensgeschichten.ai'

// Buch säubern und gegen Größenmissbrauch begrenzen. Bilder-Felder (image_path für
// die vorläufige Druckversion + Historie/Regenerierungszähler) bleiben erhalten;
// der textbasierte Zwischenstand hat sie schlicht nicht.
function sanitizeBook(book) {
  if (!book || typeof book !== 'object') return null
  const clip = (s, n) => (typeof s === 'string' ? s.slice(0, n) : '')
  const chapters = Array.isArray(book.chapters) ? book.chapters.slice(0, 60).map((c, i) => ({
    number: Number.isFinite(c?.number) ? c.number : (i + 1),
    heading: clip(c?.heading, 300),
    body: clip(c?.body, 40000),
    ...(c?.contributor_name ? { contributor_name: clip(c.contributor_name, 200) } : {}),
    ...(c?.relationship ? { relationship: clip(c.relationship, 200) } : {}),
    ...(c?.contribution_id ? { contribution_id: clip(c.contribution_id, 40) } : {}),
    ...(c?.image_path ? { image_path: clip(c.image_path, 200) } : {}),
    ...(Array.isArray(c?.image_history) ? { image_history: c.image_history.filter(p => typeof p === 'string').slice(0, 20).map(p => p.slice(0, 200)) } : {}),
    ...(Number.isFinite(c?.image_regen_used) ? { image_regen_used: Math.max(0, Math.min(50, c.image_regen_used)) } : {}),
  })) : []
  if (!chapters.length) return null
  return {
    title: clip(book.title, 300), subtitle: clip(book.subtitle, 300), chapters,
    ...(book.language ? { language: clip(book.language, 8) } : {}),
    proof: true, ...(book.print ? { print: true } : {}),
  }
}

// Autorisierung + Laden des Buchs. Gibt die Memorial-Zeile zurück oder null (Antwort
// wurde dann bereits gesendet).
async function authAndLoad(req, res, code) {
  const { data: m } = await supabase.from('memorials')
    .select('id, name, product_category, proof_enabled, proof_max, proof_used, edit_lock, book_v2, interview_closed, book_finalized, image_regen, image_style')
    .eq('id', code).maybeSingle()
  if (!m) { res.status(404).json({ error: 'Buch nicht gefunden.' }); return null }
  if (m.product_category !== LIFEWORK) { res.status(403).json({ error: 'Nur beim Lebenswerk verfügbar.' }); return null }
  const hasToken = /^Bearer\s/.test(req.headers.authorization || '')
  if (hasToken) {
    if (!checkAuth(req, res)) return null            // ungültiges Token → 401 in checkAuth
    if (req.auth.eu !== code && !req.auth.admin) { res.status(403).json({ error: 'Kein Zugriff auf dieses Buch.' }); return null }
  }
  return m
}

function lockActive(lk) {
  return lk && lk.expires && Date.now() < new Date(lk.expires).getTime()
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try {
    if (!(await enforce(req, res, { name: 'enduser-book', limit: 120, windowSeconds: 60 }))) return
    const code = (req.query.code || '').toUpperCase().trim()
    if (!code) return res.status(400).json({ error: 'Code fehlt.' })
    const action = String(req.body?.action || '')
    const m = await authAndLoad(req, res, code)
    if (!m) return

    // ── Bestehende Buchvorschau lesen (kein Verbrauch) ──
    // Der öffentliche /api/memorial gibt book_v2 bewusst NICHT heraus; für den
    // Endnutzer seines EIGENEN Lebenswerks ist die Textvorschau hier aber ok.
    if (action === 'get-book') {
      const book = sanitizeBook(m.book_v2)
      // ALLE Bildpfade signieren (aktuelles Bild + Historie jedes Kapitels), damit
      // der Client jede Version anzeigen kann. Rückgabe als Map path→signierte URL.
      const signed = {}
      if (book && Array.isArray(book.chapters)) {
        const all = new Set()
        for (const c of book.chapters) {
          if (c.image_path) all.add(c.image_path)
          if (Array.isArray(c.image_history)) for (const p of c.image_history) if (p) all.add(p)
        }
        const paths = [...all]
        if (paths.length) {
          try {
            const { data: sg } = await supabase.storage.from(IMAGE_BUCKET).createSignedUrls(paths, 3600)
            for (const s of (sg || [])) if (s?.path && s?.signedUrl) signed[s.path] = s.signedUrl
          } catch {}
        }
      }
      const lk = m.edit_lock
      const lock = lockActive(lk) ? { holder: lk.holder || null, expires: lk.expires } : null
      return res.json({ book, signed, proof_used: m.proof_used || 0, proof_max: m.proof_max ?? 3, image_regen: m.image_regen || {}, lock, interview_closed: !!m.interview_closed, book_finalized: !!m.book_finalized })
    }

    // ── Lock holen/erneuern ──
    if (action === 'lock-acquire') {
      const token = crypto.randomBytes(18).toString('base64url')
      const lock = { holder: 'enduser', token, at: new Date().toISOString(), expires: new Date(Date.now() + LOCK_TTL_MS).toISOString() }
      // Nur setzen, wenn frei/abgelaufen ODER schon vom Endnutzer gehalten (der Admin
      // hält keinen solchen Lock; sein Bearbeiten prüft edit_lock separat).
      const { rows } = await pool().query(
        `update memorials set edit_lock = $2::jsonb
           where id = $1
             and (edit_lock is null
                  or (edit_lock->>'expires')::timestamptz < now()
                  or edit_lock->>'holder' = 'enduser')
         returning id`, [code, JSON.stringify(lock)])
      if (!rows.length) return res.status(409).json({ error: 'Das Buch wird gerade an anderer Stelle bearbeitet.' })
      return res.json({ ok: true, token, expires: lock.expires })
    }

    // ── Heartbeat (Lock verlängern) ──
    if (action === 'lock-heartbeat') {
      const token = String(req.body?.token || '')
      const expires = new Date(Date.now() + LOCK_TTL_MS).toISOString()
      const { rows } = await pool().query(
        `update memorials
            set edit_lock = jsonb_set(edit_lock, '{expires}', to_jsonb($3::text))
          where id = $1 and edit_lock->>'token' = $2
          returning id`, [code, token, expires])
      if (!rows.length) return res.status(409).json({ error: 'Ihre Bearbeitungssitzung ist abgelaufen.' })
      return res.json({ ok: true, expires })
    }

    // ── Lock freigeben ──
    if (action === 'lock-release') {
      const token = String(req.body?.token || '')
      await pool().query(`update memorials set edit_lock = null where id = $1 and edit_lock->>'token' = $2`, [code, token])
      return res.json({ ok: true })
    }

    // ── Einen Probedruck verbrauchen (atomar) ──
    if (action === 'proof-consume') {
      if (!m.proof_enabled) return res.status(403).json({ error: 'Der Probedruck ist für dieses Buch nicht freigeschaltet.' })
      const { rows } = await pool().query(
        `update memorials set proof_used = coalesce(proof_used,0) + 1
           where id = $1 and coalesce(proof_enabled,false) = true
             and coalesce(proof_used,0) < coalesce(proof_max,3)
         returning proof_used, proof_max`, [code])
      if (!rows.length) {
        const max = m.proof_max ?? 3
        return res.status(409).json({ error: `Keine Probedrucke mehr übrig (${max} von ${max} verbraucht).`, used: max, max, remaining: 0 })
      }
      const used = rows[0].proof_used, max = rows[0].proof_max ?? 3
      return res.json({ ok: true, used, max, remaining: Math.max(0, max - used) })
    }

    // ── Bearbeitetes Buch sichern ──
    if (action === 'save-book') {
      if (m.book_finalized) return res.status(409).json({ error: 'Das Buch ist bereits abgeschlossen und kann nicht mehr bearbeitet werden.' })
      const token = String(req.body?.token || '')
      // Gültigen, eigenen Lock verlangen (sonst könnte parallel überschrieben werden).
      if (!lockActive(m.edit_lock) || m.edit_lock.token !== token || m.edit_lock.holder !== 'enduser') {
        return res.status(409).json({ error: 'Ihre Bearbeitungssitzung ist abgelaufen. Bitte neu laden.' })
      }
      const book = sanitizeBook(req.body?.book)
      if (!book) return res.status(400).json({ error: 'Kein gültiges Buch übergeben.' })
      const { error } = await supabase.from('memorials').update({ book_v2: book }).eq('id', code)
      if (error) throw error
      return res.json({ ok: true })
    }

    // ── Vorläufige Druckversion starten: Interview ENDGÜLTIG abschließen ──
    // Danach ist die Buchvorschau editierbar (mit Bildern); das Interview kann nicht
    // mehr genutzt werden. Holt zugleich den Bearbeitungs-Lock.
    if (action === 'start-print') {
      if (!m.proof_enabled) return res.status(403).json({ error: 'Nicht freigeschaltet.' })
      if (m.book_finalized) return res.status(409).json({ error: 'Das Buch ist bereits abgeschlossen.' })
      const token = crypto.randomBytes(18).toString('base64url')
      const lock = { holder: 'enduser', token, at: new Date().toISOString(), expires: new Date(Date.now() + LOCK_TTL_MS).toISOString() }
      const { rows } = await pool().query(
        `update memorials set interview_closed = true, edit_lock = $2::jsonb
           where id = $1
             and (edit_lock is null or (edit_lock->>'expires')::timestamptz < now() or edit_lock->>'holder' = 'enduser')
         returning id`, [code, JSON.stringify(lock)])
      if (!rows.length) return res.status(409).json({ error: 'Das Buch wird gerade an anderer Stelle bearbeitet.' })
      return res.json({ ok: true, token, expires: lock.expires, interview_closed: true })
    }

    // ── Bearbeitung ABSCHLIESSEN (unwiderruflich) ──
    // Danach keine weitere Bearbeitung; Betreiber wird per E-Mail informiert
    // („Buch fertig – muss gedruckt werden"); der Nachtreport zählt solche Bücher.
    if (action === 'finalize') {
      if (m.book_finalized) return res.json({ ok: true, already: true })
      if (!m.book_v2) return res.status(400).json({ error: 'Es gibt noch keine Druckversion.' })
      const token = String(req.body?.token || '')
      if (!lockActive(m.edit_lock) || m.edit_lock.token !== token || m.edit_lock.holder !== 'enduser') {
        return res.status(409).json({ error: 'Ihre Bearbeitungssitzung ist abgelaufen. Bitte neu laden.' })
      }
      const { error } = await supabase.from('memorials')
        .update({ book_finalized: true, book_finalized_at: new Date().toISOString(), edit_lock: null })
        .eq('id', code)
      if (error) throw error
      // Betreiber-Mail (nicht kritisch — Abschluss darf daran nicht scheitern).
      try {
        const name = m.name || `(ohne Name)`
        const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
        await sendMail({
          to: FINALIZE_NOTIFY,
          subject: `Buch fertig – muss gedruckt werden: ${name} (${code})`,
          text: `Ein Lebenswerk-Buch wurde vom Endnutzer abgeschlossen und muss gedruckt werden.\n\nName: ${name}\nCode: ${code}\nAbgeschlossen: ${new Date().toLocaleString('de-DE')}\n`,
          html: `<p>Ein Lebenswerk-Buch wurde vom Endnutzer <b>abgeschlossen</b> und muss gedruckt werden.</p><p>Name: <b>${esc(name)}</b><br>Code: ${esc(code)}</p>`,
        })
      } catch (e) { console.error('/api/enduser-book finalize mail:', e.message) }
      return res.json({ ok: true })
    }

    return res.status(400).json({ error: 'Unbekannte Aktion.' })
  } catch (e) {
    console.error('/api/enduser-book error:', e)
    return res.status(500).json({ error: 'Aktion fehlgeschlagen. Bitte später erneut versuchen.' })
  }
}
