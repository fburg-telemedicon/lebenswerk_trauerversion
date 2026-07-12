// api/_lib/store.js
// ============================================================================
// Interner Ersatz für @supabase/supabase-js (Azure-Migration).
//
// Bildet die im Projekt tatsächlich genutzte Teilmenge des Supabase-Clients auf
// native Azure-Dienste ab:
//   - DB  → Azure Database for PostgreSQL (Flexible Server) via node-postgres
//   - Storage → Azure Blob Storage (privater Container = ehem. Bucket)
//
// createClient() liefert ein Objekt mit derselben Aufruf-Oberfläche wie bisher:
//   supabase.from('tabelle').select/insert/update/delete/upsert…
//   supabase.rpc('funktion', args)
//   supabase.storage.from('container').upload/download/remove/list/createSignedUrls
//
// Dadurch ändern sich die ~30 Aufrufer nur an EINER Stelle (Import + createClient),
// nicht in der Query-Logik. Ergebnisformen ({ data, error, count }) sind
// absichtlich supabase-kompatibel gehalten.
//
// ENV:
//   DATABASE_URL            postgres://user:pass@host:5432/db  (Azure Flexible Server)
//   PGSSL                   'disable' schaltet TLS ab (nur lokal); Standard: TLS an
//   PG_POOL_MAX             max. Pool-Verbindungen (Standard 8)
//   AZURE_STORAGE_ACCOUNT   Storage-Accountname
//   AZURE_STORAGE_KEY       Storage-Account-Key (für SAS-Signatur)
// ============================================================================

const { Pool } = require('pg')
const {
  BlobServiceClient,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
  BlobSASPermissions,
  SASProtocol,
} = require('@azure/storage-blob')

// ----------------------------------------------------------------------------
// Spaltentyp-Register (aus supabase/*.sql + CLAUDE.md abgeleitet)
// Entscheidet bei INSERT/UPDATE, wie ein JS-Wert kodiert wird. Nötig, weil sich
// z. B. ein leeres Array [] nicht selbst ansehen lässt, ob es text[] oder jsonb
// werden soll.
// ----------------------------------------------------------------------------
const JSONB_COLS = new Set([
  // memorials
  'intake', 'uploaded_images', 'content_reports', 'pickup_address', 'purge_info',
  'book_v1', 'book_v2',
  // contributions
  'messages', 'transcript_corrections',
  // cost_events
  'metadata',
  // generation_jobs
  'params', 'progress', 'result',
  // question_catalogs
  'chapters',
  // job_heartbeats / audit_log
  'detail',
])
const TEXTARR_COLS = new Set(['allowed_categories', 'languages', 'product_categories'])

// ----------------------------------------------------------------------------
// Postgres-Pool (Singleton pro warmem Container/Prozess)
// ----------------------------------------------------------------------------
let _pool = null
function pool() {
  if (!_pool) {
    _pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false },
      max: Number(process.env.PG_POOL_MAX || 8),
      idleTimeoutMillis: 30000,
    })
    _pool.on('error', (e) => console.error('pg pool error:', e.message))
  }
  return _pool
}

// Bezeichner (Tabellen-/Spaltennamen) stammen ausschließlich aus Code-Literalen,
// werden aber trotzdem streng validiert und gequotet (Defense in Depth).
function ident(name) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) throw new Error(`Ungültiger Bezeichner: ${name}`)
  return `"${name}"`
}

// Spaltenliste eines select('a, b, c') → '"a", "b", "c"' ; '*' bleibt '*'.
function selectCols(cols) {
  const c = String(cols || '*').trim()
  if (c === '*') return '*'
  return c.split(',').map((s) => {
    const t = s.trim()
    return t === '*' ? '*' : ident(t)
  }).join(', ')
}

function pushParam(params, val) {
  params.push(val)
  return `$${params.length}`
}

// Wert für eine bekannte Spalte (INSERT/UPDATE SET) kodieren.
function encodeAssign(col, val, params) {
  if (val === undefined) val = null
  if (TEXTARR_COLS.has(col)) {
    return `${pushParam(params, val)}::text[]` // pg serialisiert JS-Array → text[]
  }
  if (JSONB_COLS.has(col)) {
    return `${pushParam(params, val === null ? null : JSON.stringify(val))}::jsonb`
  }
  // Unbekannte Spalte mit Objekt/Array-Wert → sicherheitshalber jsonb.
  if (val !== null && typeof val === 'object' && !(val instanceof Date) && !Buffer.isBuffer(val)) {
    return `${pushParam(params, JSON.stringify(val))}::jsonb`
  }
  return pushParam(params, val)
}

// Einen einzelnen or()-Token (PostgREST-Syntax "col.op.val") in SQL übersetzen.
function orToken(tok, params) {
  const parts = tok.split('.')
  const col = parts[0]
  if (parts[1] === 'is' && parts[2] === 'null') return `${ident(col)} IS NULL`
  if (parts[1] === 'not' && parts[2] === 'is' && parts[3] === 'null') return `${ident(col)} IS NOT NULL`
  const map = { eq: '=', gte: '>=', lte: '<=', gt: '>', lt: '<' }
  const op = parts[1]
  const val = parts.slice(2).join('.')
  if (map[op]) return `${ident(col)} ${map[op]} ${pushParam(params, val)}`
  throw new Error(`or(): Operator nicht unterstützt: ${op}`)
}

function encodeFilter(f, params) {
  const map = { eq: '=', gte: '>=', lte: '<=', gt: '>', lt: '<' }
  switch (f.t) {
    case 'eq':
    case 'gte':
    case 'lte':
    case 'gt':
    case 'lt':
      return `${ident(f.c)} ${map[f.t]} ${pushParam(params, f.v)}`
    case 'ilike':
      return `${ident(f.c)} ILIKE ${pushParam(params, f.v)}`
    case 'in':
      return `${ident(f.c)} = ANY(${pushParam(params, f.v)})`
    case 'is':
      return f.v === null ? `${ident(f.c)} IS NULL` : `${ident(f.c)} IS ${pushParam(params, f.v)}`
    case 'not':
      // genutzt als .not(col, 'is', null) → IS NOT NULL
      if (f.op === 'is' && f.v === null) return `${ident(f.c)} IS NOT NULL`
      throw new Error(`not(): nur 'is null' unterstützt (col=${f.c}, op=${f.op})`)
    case 'or':
      return `(${f.s.split(',').map((t) => orToken(t.trim(), params)).join(' OR ')})`
    default:
      throw new Error(`Filter nicht unterstützt: ${f.t}`)
  }
}

function buildWhere(filters, params) {
  if (!filters.length) return ''
  return ' WHERE ' + filters.map((f) => encodeFilter(f, params)).join(' AND ')
}

// ----------------------------------------------------------------------------
// Query-Builder (thenable – wird beim await ausgeführt)
// ----------------------------------------------------------------------------
class Query {
  constructor(table) {
    this.table = table
    this._op = 'select'
    this._cols = '*'
    this._filters = []
    this._order = null
    this._limit = null
    this._range = null
    this._single = false
    this._maybe = false
    this._count = null
    this._head = false
    this._values = null
    this._returning = null
    this._onConflict = null
  }

  select(cols, opts) {
    if (this._op === 'select') this._cols = cols || '*'
    else this._returning = cols || '*' // .insert(..).select() etc. → RETURNING
    if (opts && opts.count) { this._count = opts.count; this._head = !!opts.head }
    return this
  }
  insert(v) { this._op = 'insert'; this._values = v; return this }
  update(v) { this._op = 'update'; this._values = v; return this }
  upsert(v, opts) { this._op = 'upsert'; this._values = v; this._onConflict = (opts && opts.onConflict) || null; return this }
  delete() { this._op = 'delete'; return this }

  eq(c, v) { this._filters.push({ t: 'eq', c, v }); return this }
  in(c, v) { this._filters.push({ t: 'in', c, v }); return this }
  is(c, v) { this._filters.push({ t: 'is', c, v }); return this }
  not(c, op, v) { this._filters.push({ t: 'not', c, op, v }); return this }
  gte(c, v) { this._filters.push({ t: 'gte', c, v }); return this }
  lte(c, v) { this._filters.push({ t: 'lte', c, v }); return this }
  gt(c, v) { this._filters.push({ t: 'gt', c, v }); return this }
  lt(c, v) { this._filters.push({ t: 'lt', c, v }); return this }
  ilike(c, v) { this._filters.push({ t: 'ilike', c, v }); return this }
  or(s) { this._filters.push({ t: 'or', s }); return this }

  order(c, opts) { this._order = { c, asc: !opts || opts.ascending !== false }; return this }
  limit(n) { this._limit = n; return this }
  range(a, b) { this._range = [a, b]; return this }
  single() { this._single = true; return this }
  maybeSingle() { this._maybe = true; return this }

  // Thenable
  then(resolve, reject) { return this._run().then(resolve, reject) }
  catch(f) { return this._run().catch(f) }

  async _run() {
    try { return await this._exec() }
    catch (e) { return { data: null, error: { message: e.message }, count: null } }
  }

  _finalize(rows) {
    if (this._single) {
      if (rows.length !== 1) return { data: null, error: { message: `Expected 1 row, got ${rows.length}`, code: 'PGRST116' }, count: null }
      return { data: rows[0], error: null, count: null }
    }
    if (this._maybe) {
      if (rows.length > 1) return { data: null, error: { message: `Expected ≤1 row, got ${rows.length}` }, count: null }
      return { data: rows[0] || null, error: null, count: null }
    }
    return { data: rows, error: null, count: this._count ? rows.length : null }
  }

  async _exec() {
    const params = []
    if (this._op === 'select') {
      const where = buildWhere(this._filters, params)
      if (this._head && this._count) {
        const r = await pool().query(`SELECT count(*)::int AS count FROM ${ident(this.table)}${where}`, params)
        return { data: null, error: null, count: r.rows[0].count }
      }
      let text = `SELECT ${selectCols(this._cols)} FROM ${ident(this.table)}${where}`
      if (this._order) text += ` ORDER BY ${ident(this._order.c)} ${this._order.asc ? 'ASC' : 'DESC'}`
      if (this._range) text += ` OFFSET ${Number(this._range[0])} LIMIT ${Number(this._range[1]) - Number(this._range[0]) + 1}`
      else if (this._limit != null) text += ` LIMIT ${Number(this._limit)}`
      const r = await pool().query(text, params)
      return this._finalize(r.rows)
    }

    if (this._op === 'insert' || this._op === 'upsert') {
      const rows = Array.isArray(this._values) ? this._values : [this._values]
      if (!rows.length) return { data: [], error: null, count: null }
      const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))]
      const tuples = rows.map((row) =>
        '(' + cols.map((c) => encodeAssign(c, row[c] !== undefined ? row[c] : null, params)).join(', ') + ')')
      let text = `INSERT INTO ${ident(this.table)} (${cols.map(ident).join(', ')}) VALUES ${tuples.join(', ')}`
      if (this._op === 'upsert') {
        const conflict = (this._onConflict || cols[0]).split(',').map((s) => ident(s.trim())).join(', ')
        const upd = cols.map((c) => `${ident(c)} = EXCLUDED.${ident(c)}`).join(', ')
        text += ` ON CONFLICT (${conflict}) DO UPDATE SET ${upd}`
      }
      if (this._returning) text += ` RETURNING ${selectCols(this._returning)}`
      const r = await pool().query(text, params)
      return this._returning ? this._finalize(r.rows) : { data: null, error: null, count: null }
    }

    if (this._op === 'update') {
      const patch = this._values || {}
      const sets = Object.keys(patch).map((c) => `${ident(c)} = ${encodeAssign(c, patch[c], params)}`)
      if (!sets.length) return { data: null, error: { message: 'update() ohne Werte' }, count: null }
      const where = buildWhere(this._filters, params)
      let text = `UPDATE ${ident(this.table)} SET ${sets.join(', ')}${where}`
      if (this._returning) text += ` RETURNING ${selectCols(this._returning)}`
      const r = await pool().query(text, params)
      return this._returning ? this._finalize(r.rows) : { data: null, error: null, count: null }
    }

    if (this._op === 'delete') {
      const where = buildWhere(this._filters, params)
      let text = `DELETE FROM ${ident(this.table)}${where}`
      if (this._returning) text += ` RETURNING ${selectCols(this._returning)}`
      const r = await pool().query(text, params)
      return this._returning ? this._finalize(r.rows) : { data: null, error: null, count: null }
    }

    throw new Error(`Operation nicht unterstützt: ${this._op}`)
  }
}

// ----------------------------------------------------------------------------
// RPC (Postgres-Funktionen memorial_contrib_stats() + rate_limit_hit(...))
// ----------------------------------------------------------------------------
async function rpc(name, args) {
  try {
    const params = []
    let call = `${ident(name)}()`
    if (args && Object.keys(args).length) {
      // Benannte Argumente (name => $n), wie supabase.rpc(name, {p_x: ...})
      const parts = Object.keys(args).map((k) => {
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k)) throw new Error(`Ungültiger Parametername: ${k}`)
        params.push(args[k])
        return `${k} => $${params.length}`
      })
      call = `${ident(name)}(${parts.join(', ')})`
    }
    const r = await pool().query(`SELECT * FROM ${call}`, params)
    // Skalar-Funktionen (z. B. rate_limit_hit → boolean): 1 Zeile, 1 Spalte →
    // supabase liefert den Skalar direkt. Tabellen-Funktionen → Array.
    if (r.rows.length === 1 && r.fields.length === 1) {
      return { data: r.rows[0][r.fields[0].name], error: null }
    }
    return { data: r.rows, error: null }
  } catch (e) {
    return { data: null, error: { message: e.message } }
  }
}

// ----------------------------------------------------------------------------
// Blob Storage (ersetzt Supabase Storage)
// ----------------------------------------------------------------------------
let _blobService = null
let _sharedKey = null
function blobService() {
  if (!_blobService) {
    const account = process.env.AZURE_STORAGE_ACCOUNT
    const key = process.env.AZURE_STORAGE_KEY
    if (!account || !key) throw new Error('AZURE_STORAGE_ACCOUNT/AZURE_STORAGE_KEY fehlen')
    _sharedKey = new StorageSharedKeyCredential(account, key)
    _blobService = new BlobServiceClient(`https://${account}.blob.core.windows.net`, _sharedKey)
  }
  return _blobService
}

function storageFrom(container) {
  const getContainer = () => blobService().getContainerClient(container)
  return {
    // upload(path, data, { contentType, upsert }) → { data, error }
    async upload(path, data, opts = {}) {
      try {
        const block = getContainer().getBlockBlobClient(path)
        if (opts.upsert === false) {
          const exists = await block.exists()
          if (exists) return { data: null, error: { message: 'Objekt existiert bereits' } }
        }
        const body = Buffer.isBuffer(data) ? data : Buffer.from(data)
        await block.uploadData(body, {
          blobHTTPHeaders: opts.contentType ? { blobContentType: opts.contentType } : undefined,
        })
        return { data: { path }, error: null }
      } catch (e) { return { data: null, error: { message: e.message } } }
    },

    // download(path) → { data: { arrayBuffer() }, error }
    async download(path) {
      try {
        const buf = await getContainer().getBlockBlobClient(path).downloadToBuffer()
        return {
          data: {
            arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
          },
          error: null,
        }
      } catch (e) { return { data: null, error: { message: e.message } } }
    },

    // remove(paths[]) → { data, error }
    async remove(paths) {
      try {
        const list = Array.isArray(paths) ? paths : [paths]
        const c = getContainer()
        await Promise.all(list.map((p) => c.getBlockBlobClient(p).deleteIfExists()))
        return { data: list.map((p) => ({ name: p })), error: null }
      } catch (e) { return { data: null, error: { message: e.message } } }
    },

    // list(prefix, { limit }) → { data: [{ name }], error }  (name RELATIV zum prefix)
    async list(prefix, opts = {}) {
      try {
        const p = prefix ? (prefix.endsWith('/') ? prefix : `${prefix}/`) : ''
        const out = []
        const limit = opts.limit || 1000
        for await (const b of getContainer().listBlobsFlat({ prefix: p })) {
          out.push({ name: b.name.slice(p.length) }) // Präfix abschneiden (supabase-kompatibel)
          if (out.length >= limit) break
        }
        return { data: out, error: null }
      } catch (e) { return { data: null, error: { message: e.message } } }
    },

    // createSignedUrls(paths[], expiresInSeconds) → { data: [{ path, signedUrl, error }], error }
    async createSignedUrls(paths, expiresIn) {
      try {
        blobService() // init _sharedKey
        const now = new Date()
        const expiresOn = new Date(now.getTime() + Number(expiresIn || 3600) * 1000)
        const startsOn = new Date(now.getTime() - 60 * 1000) // Uhren-Toleranz
        const data = (paths || []).map((path) => {
          try {
            const blob = getContainer().getBlockBlobClient(path)
            const sas = generateBlobSASQueryParameters({
              containerName: container,
              blobName: path,
              permissions: BlobSASPermissions.parse('r'),
              startsOn,
              expiresOn,
              protocol: SASProtocol.Https,
            }, _sharedKey).toString()
            return { path, signedUrl: `${blob.url}?${sas}`, error: null }
          } catch (e) {
            return { path, signedUrl: null, error: e.message }
          }
        })
        return { data, error: null }
      } catch (e) { return { data: null, error: { message: e.message } } }
    },
  }
}

// ----------------------------------------------------------------------------
// Client-Fabrik (drop-in für createClient(URL, KEY))
// ----------------------------------------------------------------------------
function createClient(/* url, key — ignoriert, Verbindung kommt aus DATABASE_URL */) {
  return {
    from: (table) => new Query(table),
    rpc,
    storage: { from: storageFrom },
  }
}

module.exports = { createClient }
