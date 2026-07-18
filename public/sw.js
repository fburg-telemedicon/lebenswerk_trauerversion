// Minimaler Service Worker für die PWA (Installierbarkeit + schnellere Ladezeiten).
// Strategie:
//  - /api/* NIE cachen (immer live vom Server).
//  - Navigationsanfragen (HTML): network-first, damit nach einem Deploy sofort die
//    neue Version geladen wird; nur bei Offline aus dem Cache.
//  - Gehashte statische Assets (Vite: name.<hash>.js/css …): cache-first (immutabel).
// Cache-Name bei Bedarf hochzählen, um alte Einträge zu verwerfen.
const CACHE = 'lw-shell-v1'
const SHELL = '/'

self.addEventListener('install', () => {
  // Sofort aktiv werden, nicht auf das Schließen aller Tabs warten.
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return   // nur eigene Origin
  if (url.pathname.startsWith('/api/')) return       // API immer direkt zum Server

  // HTML-Navigation: network-first (frische App-Shell nach Deploys), Offline-Fallback.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const net = await fetch(req)
        const cache = await caches.open(CACHE)
        cache.put(SHELL, net.clone())
        return net
      } catch {
        const cached = await caches.match(SHELL)
        return cached || Response.error()
      }
    })())
    return
  }

  // Statische, gehashte Assets: cache-first.
  if (/\.(js|css|woff2?|ttf|png|jpe?g|svg|webp|ico|json|webmanifest)$/i.test(url.pathname)) {
    event.respondWith((async () => {
      const cached = await caches.match(req)
      if (cached) return cached
      const net = await fetch(req)
      if (net && net.ok) {
        const cache = await caches.open(CACHE)
        cache.put(req, net.clone())
      }
      return net
    })())
  }
})
