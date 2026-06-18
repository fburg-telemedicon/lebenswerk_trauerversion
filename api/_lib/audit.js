// api/_lib/audit.js
// Dauerhaftes Zugriffs-/Audit-Log sicherheitsrelevanter Aktionen
// (siehe supabase/audit.sql). Bewusst PII-arm: nur Akteur, Aktion, Ziel, IP.
//
// Fail-open / non-fatal: Ein Logging-Fehler darf NIE die eigentliche Aktion
// abbrechen. Es wird nur auf der Server-Konsole vermerkt.

const { createClient } = require('@supabase/supabase-js')
const { clientIp } = require('./ratelimit')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

// req    : eingehende Anfrage (für die IP)
// fields : { actor?, action, target?, detail? }
//   actor  : { uid?, name?, admin? } – i.d.R. req.auth (+ optional name)
//   action : Pflicht, kurze Kennung wie 'memorial.delete'
//   target : Code/ID des betroffenen Objekts
//   detail : kleines, PII-armes JSON
async function audit(req, { actor, action, target, detail } = {}) {
  try {
    await supabase.from('audit_log').insert({
      actor_uid:  actor?.uid ?? null,
      actor_name: actor?.name ?? null,
      is_admin:   typeof actor?.admin === 'boolean' ? actor.admin : null,
      action,
      target:     target ?? null,
      ip:         clientIp(req),
      detail:     detail ?? null,
    })
  } catch (e) {
    console.error('audit error (non-fatal):', e.message)
  }
}

module.exports = { audit }
