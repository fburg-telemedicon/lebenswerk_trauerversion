// Kill-Switch: Die PWA-/Install-Funktion wurde entfernt. Dieser Service Worker
// meldet sich selbst ab und löscht alle Caches, damit Geräte, die den früheren
// SW registriert hatten, sauber zurückgesetzt werden (neue Seitenaufrufe
// registrieren gar keinen SW mehr — die Registrierung in index.html ist entfernt).
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
      await self.registration.unregister()
      const clients = await self.clients.matchAll()
      clients.forEach((c) => { try { c.navigate(c.url) } catch { /* ignore */ } })
    } catch { /* ignore */ }
  })())
})
