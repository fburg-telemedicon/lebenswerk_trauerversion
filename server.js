// server.js
// ============================================================================
// Azure Container Apps – HTTP-Server (ersetzt Vercel-Functions + vercel.json).
//
// Registriert jede Datei unter api/ (außer _lib/_fonts) als Route, exakt so wie
// Vercel sie unter /api/<pfad> ausgeliefert hat, und übergibt (req, res) an den
// vorhandenen Handler (module.exports = async (req, res) => …). Danach wird das
// gebaute SPA aus dist/ statisch ausgeliefert (SPA-Fallback → index.html),
// analog zum bisherigen vercel.json-Rewrite.
//
// Die Handler funktionieren unverändert: Express liefert req.query/req.headers/
// req.method und res.status().json()/res.send()/res.setHeader() wie Vercel.
// Der JSON-Body wird hier zentral geparst (großes Limit für Base64-Audio/Bilder).
//
// ENV: PORT (Standard 8080), DEMO_BOOK_URL (Weiterleitung /demobuch → Blob).
// ============================================================================

const path = require('path')
const fs = require('fs')
const express = require('express')

const app = express()
app.disable('x-powered-by')

// Base64-Audio (STT), Bilder (Upload/Referenz) → großzügiges Limit.
app.use(express.json({ limit: process.env.JSON_LIMIT || '50mb' }))
app.use(express.urlencoded({ extended: true, limit: process.env.JSON_LIMIT || '50mb' }))

// ---------------------------------------------------------------------------
// API-Routen aus dem Dateibaum ableiten (wie Vercel: Datei = Endpunkt)
// ---------------------------------------------------------------------------
const API_DIR = path.join(__dirname, 'api')

function collectHandlers(dir, base = '') {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('_')) continue // _lib, _fonts
    const abs = path.join(dir, entry.name)
    const rel = base ? `${base}/${entry.name}` : entry.name
    if (entry.isDirectory()) out.push(...collectHandlers(abs, rel))
    else if (entry.name.endsWith('.js')) out.push({ route: '/api/' + rel.replace(/\.js$/, ''), abs })
  }
  return out
}

function wrap(handler) {
  return async (req, res) => {
    try {
      await handler(req, res)
    } catch (e) {
      console.error(`Unhandled error in ${req.method} ${req.path}:`, e)
      if (!res.headersSent) res.status(500).json({ error: 'Interner Serverfehler' })
    }
  }
}

let registered = 0
for (const { route, abs } of collectHandlers(API_DIR)) {
  const mod = require(abs)
  const handler = typeof mod === 'function' ? mod : mod && mod.default
  if (typeof handler !== 'function') { console.warn('Kein Handler-Export:', abs); continue }
  app.all(route, wrap(handler))
  registered++
}
console.log(`API-Routen registriert: ${registered}`)

// Bekannte Weiterleitung aus vercel.json: Demo-Buch-PDF.
app.get('/demobuch', (req, res) => {
  const url = process.env.DEMO_BOOK_URL
  if (!url) return res.status(404).send('Demo-Buch nicht konfiguriert')
  res.redirect(302, url)
})

// Dynamisches PWA-Manifest: Die installierte App soll direkt in DAS Interview führen,
// aus dem heraus installiert wurde – deshalb steckt der Code in der start_url. Das ist
// nötig, weil iOS-PWAs einen eigenen Speicher haben (localStorage von Safari ist dort
// NICHT sichtbar) und iOS beim Öffnen die manifest-start_url nutzt. `?code=` = Interview,
// `?lw=1` = Lebenswerk-Branding. Wird per JS auf den Interview-Seiten verlinkt
// (src/pwa.js → setPwaProduct); das Manager-Dashboard verlinkt kein Manifest.
app.get('/app.webmanifest', (req, res) => {
  const code = String(req.query.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16)
  const lw = req.query.lw === '1'
  const startUrl = code ? `/?code=${code}` : '/'
  const manifest = {
    id: startUrl,
    name: lw ? 'Lebenswerk.ai' : 'Lebensgeschichten.ai',
    short_name: lw ? 'Lebenswerk' : 'Lebensgeschichten',
    start_url: startUrl,
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#ffffff',
    theme_color: '#c1272d',
    lang: 'de',
    dir: 'ltr',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
  res.set('Content-Type', 'application/manifest+json')
  res.set('Cache-Control', 'no-store')
  res.send(JSON.stringify(manifest))
})

// Unbekannte /api-Pfade → 404 (nicht in den SPA-Fallback laufen lassen).
app.all('/api/*', (req, res) => res.status(404).json({ error: 'Not found' }))

// ---------------------------------------------------------------------------
// Statisches SPA (dist/) + SPA-Fallback
// ---------------------------------------------------------------------------
const DIST = path.join(__dirname, 'dist')
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST))
  app.get('*', (req, res) => res.sendFile(path.join(DIST, 'index.html')))
} else {
  console.warn('dist/ fehlt – SPA wird nicht ausgeliefert (nur API).')
}

// ---------------------------------------------------------------------------
// HTTP-Server + WebSocket-Relay fürs Live-Sprachgespräch
// ---------------------------------------------------------------------------
// Der Relay braucht den rohen HTTP-Server (Upgrade-Ereignis), deshalb hier
// http.createServer(app) statt app.listen(). Ohne konfigurierte Voice-Live-
// Ressource wird er nicht angehängt — der Beitragenden-Flow merkt davon nichts
// und bleibt bei den bisherigen Mikrofon-Modi.
const http = require('http')
const server = http.createServer(app)

const { isVoiceLiveConfigured } = require('./api/_lib/voicelive')
if (isVoiceLiveConfigured() && process.env.ADMIN_TOKEN_SECRET) {
  const { attachVoiceLiveRelay, RELAY_PATH } = require('./api/_lib/voicelive-relay')
  attachVoiceLiveRelay(server)
  console.log(`Live-Sprachgespräch: Relay aktiv auf ${RELAY_PATH}`)
} else {
  console.log('Live-Sprachgespräch: nicht konfiguriert (AZURE_VOICELIVE_* fehlt) – Relay aus.')
}

const PORT = Number(process.env.PORT || 8080)
server.listen(PORT, () => console.log(`Lebenswerk-Server läuft auf :${PORT}`))
