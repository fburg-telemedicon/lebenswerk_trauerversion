// scripts/cron-run.js
// ============================================================================
// Entrypoint für die geplanten Azure Container Apps Jobs (ersetzt Vercel-Crons
// UND den GitHub-Actions-Purge). Ruft den vorhandenen Cron-Handler direkt im
// Prozess auf – ohne HTTP, ohne 230-s-Frontdoor-Limit.
//
// Aufruf:   node scripts/cron-run.js <name> [key=value ...]
//   <name> ∈ purge | report | transcript-check | generate
//   z. B.:  node scripts/cron-run.js purge
//           node scripts/cron-run.js purge dry=1
//
// Der Handler autorisiert über Authorization: Bearer <CRON_SECRET>; der Runner
// setzt diesen Header aus der Env, sodass die bestehende Prüfung unverändert
// greift. Exit-Code ≠ 0 bei HTTP-Status ≥ 400 → der Job gilt als fehlgeschlagen.
// ============================================================================

const path = require('path')

const ALLOWED = ['purge', 'report', 'transcript-check', 'generate']

async function main() {
  const [, , name, ...rest] = process.argv
  if (!ALLOWED.includes(name)) {
    console.error(`Unbekannter Cron: ${name || '(leer)'} — erlaubt: ${ALLOWED.join(', ')}`)
    process.exit(2)
  }
  if (!process.env.CRON_SECRET) {
    console.error('CRON_SECRET nicht gesetzt – Job wird abgelehnt.')
    process.exit(2)
  }

  // key=value → req.query
  const query = {}
  for (const kv of rest) {
    const i = kv.indexOf('=')
    if (i > 0) query[kv.slice(0, i)] = kv.slice(i + 1)
  }

  const handler = require(path.join(__dirname, '..', 'api', 'cron', `${name}.js`))

  const req = {
    method: 'GET',
    query,
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
  }

  let statusCode = 200
  let done
  const finished = new Promise((r) => { done = r })
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; statusCode = code; return this },
    setHeader() { return this },
    json(obj) { console.log(JSON.stringify(obj)); done(); return this },
    send(body) { if (body != null) console.log(String(body)); done(); return this },
    end(body) { if (body != null) console.log(String(body)); done(); return this },
  }

  const t0 = Date.now()
  await Promise.race([handler(req, res), finished])
  // dem Handler kurz Zeit geben, falls er nach res.json noch awaited (best effort)
  await finished
  console.error(`[cron:${name}] fertig in ${Date.now() - t0}ms, HTTP ${statusCode}`)
  process.exit(statusCode >= 400 ? 1 : 0)
}

main().catch((e) => {
  console.error('[cron] Ausnahme:', e)
  process.exit(1)
})
