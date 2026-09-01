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

// Druck-PDFs werden NICHT als Base64-JSON hochgeladen: ein Buchblock mit vollen
// Druck-PNGs liegt schnell bei 60–100 MB, als Base64 nochmal +33 % — das lief in
// das JSON-Limit unten (413) und war auch im Speicher teuer. Die Ablage nimmt den
// Blob deshalb roh entgegen (Variante/Dateiname stehen in der Query).
app.use('/api/admin/store-pdf', express.raw({
  type: ['application/pdf', 'application/octet-stream'],
  limit: process.env.PDF_LIMIT || '200mb',
}))

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
  // Ohne Code führt die installierte App in die ANWENDUNG (/app) — „/" trägt seit
  // dem Website-Start die Startseite und wäre für eine installierte PWA falsch.
  const startUrl = code ? `/?code=${code}` : '/app'
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
const SITE = path.join(__dirname, 'public-site')

// ---------------------------------------------------------------------------
// Website (public-site/) auf „/" — Anwendung bleibt erreichbar
// ---------------------------------------------------------------------------
// Die Domain trägt jetzt eine echte Website. Die Anwendung liegt auf DERSELBEN
// Herkunft (kein eigener Host), weil sonst alles im localStorage verloren ginge:
// gespeicherte Interview-Sitzungen, gewählter Mikrofon-Modus, installierte PWAs.
// Zwei Einstiege in die Anwendung:
//   • „/" MIT einem der bekannten Parameter (?code=, ?zugang, ?register=1, …) —
//     damit funktionieren alle gedruckten Einladungen, QR-Codes und Mail-Links
//     unverändert weiter. Diese Regel darf nie entfallen.
//   • „/app" für Anmeldung und Dashboard.
const APP_PARAMS = ['code', 'session', 'invite', 'register', 'zugang', 'lang', 'lw', 'guest']
const wantsApp = req => APP_PARAMS.some(k => req.query[k] !== undefined)

if (fs.existsSync(DIST)) {
  if (fs.existsSync(SITE)) {
    // ── Zweite Domain: lebenswerk.ai ──────────────────────────────────────
    // Beide Websites liegen in DIESEM Container und teilen sich alles, was es
    // nur einmal geben darf: Impressum, Datenschutzerklärung, AGB und Widerruf
    // (eine Quelle — src/LegalPages.jsx + AGB.md, ausgeliefert vom SPA unter
    // /app#…) sowie den Shop (eine Ecwid-Filiale, eine Seite: _shared/kaufen.html).
    // Die Host-Weiche ist wirkungslos, solange lebenswerk.ai noch woanders liegt;
    // sie greift von selbst, sobald die Domain auf diesen Container zeigt.
    const LW_HOSTS = new Set(['lebenswerk.ai', 'www.lebenswerk.ai'])
    // Nicht req.hostname: hinter dem Container-Apps-Ingress steht der Ursprungs-
    // Host je nach Konfiguration in X-Forwarded-Host. Beide Wege prüfen.
    const hostOf = req => String(req.headers['x-forwarded-host'] || req.headers.host || '')
      .split(',')[0].trim().split(':')[0].toLowerCase()
    const isLebenswerk = req => LW_HOSTS.has(hostOf(req))

    // MUSS vor express.static(DIST) stehen — sonst liefert der Static-Handler
    // schon dist/index.html für „/" aus und die Website wäre nie sichtbar.
    app.get('/', (req, res, next) => {
      if (wantsApp(req)) return next()
      res.sendFile(path.join(SITE, isLebenswerk(req) ? 'lebenswerk/index.html' : 'index.html'))
    })
    // Weitere Seiten der Website. Bewusst eine feste Liste statt eines
    // Static-Handlers auf „/", damit nichts versehentlich den SPA-Fallback
    // überschattet (dort liegen u. a. /assets und die Icon-Pfade).
    for (const [route, file] of [['/kontakt', 'kontakt.html']]) {
      app.get(route, (req, res) => res.sendFile(path.join(SITE, file)))
    }
    // Kurzadresse für gedruckte Einladungen: „lebensgeschichten.ai/zugang".
    // Auf Papier ist das die einzige Adresse, die jemand fehlerfrei abtippt —
    // die vollständige ?code=-Adresse ist zehn Zeichen länger und fehleranfällig.
    app.get(['/zugang', '/code'], (req, res) => res.redirect(302, '/?zugang'))

    // Vorschau der Lebenswerk-Startseite unabhängig vom Host — damit sie sich
    // abnehmen lässt, bevor die Domain umgezogen ist.
    app.get('/lebenswerk', (req, res) => res.sendFile(path.join(SITE, 'lebenswerk/index.html')))
    // Shop: EINE Seite, EINE Ecwid-Filiale, unter beiden Domains erreichbar.
    // Die Seite erkennt am Host, welche Wort-Bild-Marke sie oben zeigt.
    app.get('/kaufen', (req, res) => res.sendFile(path.join(SITE, '_shared/kaufen.html')))
    // Die Rechtstexte gibt es nur einmal (im SPA). Diese Weiterleitungen halten
    // die alten lebenswerk.ai-Adressen gültig — sie stehen so in deren sitemap.xml
    // und damit im Google-Index. Bewusst 302, nicht 301: eine dauerhafte
    // Weiterleitung bekäme man aus den Browser-Caches nie wieder zurück.
    for (const p of ['impressum', 'datenschutz', 'agb', 'widerruf']) {
      app.get('/' + p, (req, res) => res.redirect(302, '/app#' + p))
    }
    // Gemeinsames Stylesheet beider Websites.
    // Bewusst OHNE Cache-Dauer: der Dateiname enthaelt keine Versionskennung,
    // eine Stunde Cache hiesse eine Stunde altes Aussehen nach jeder Aenderung.
    // Mit ETag kostet die Rueckfrage nur ein 304 ohne Inhalt.
    app.use('/_shared', express.static(path.join(SITE, '_shared'), { maxAge: 0, etag: true }))
    // Bilder der Website. OHNE diese Zeile fallen /img/… in den SPA-Fallback ganz
    // unten und liefern index.html mit Status 200 — im Browser ein kaputtes Bild,
    // das keine Fehlermeldung erzeugt. Muss vor dem Fallback stehen.
    app.use('/img', express.static(path.join(SITE, 'img'), { maxAge: '7d' }))
    app.use('/site', express.static(SITE))
  }
  app.get(['/app', '/app/*'], (req, res) => res.sendFile(path.join(DIST, 'index.html')))
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
