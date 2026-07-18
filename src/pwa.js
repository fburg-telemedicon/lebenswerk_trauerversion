// src/pwa.js
// PWA-Helfer für den Install-Vorgang und das produktabhängige Manifest.
// Der Service Worker selbst wird in index.html registriert.
//
// Best practice für den Install-Button:
//  - Android/Chrome feuert `beforeinstallprompt`; wir fangen es ab und zeigen einen
//    EIGENEN Button (installState()==='prompt'), der promptInstall() aufruft.
//  - iOS/Safari kennt keinen Prompt → wir zeigen eine kurze Anleitung
//    (installState()==='ios': „Teilen → Zum Home-Bildschirm").
//  - Bereits installiert (Standalone) → kein Button (installState()==='installed').

let deferredPrompt = null
const listeners = new Set()
const emit = () => listeners.forEach((fn) => { try { fn() } catch { /* ignore */ } })

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()          // Chrome-eigene Mini-Infobar unterdrücken – wir bieten einen eigenen Button
    deferredPrompt = e
    emit()
  })
  window.addEventListener('appinstalled', () => { deferredPrompt = null; emit() })
}

export function isStandalone() {
  if (typeof window === 'undefined') return false
  return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true
}

export function isIOS() {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

// Nur echtes Safari kann „Zum Home-Bildschirm" (Chrome/Firefox auf iOS nicht).
export function isIOSSafari() {
  if (!isIOS()) return false
  const ua = navigator.userAgent || ''
  return /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua)
}

export function canPromptInstall() { return !!deferredPrompt }

export async function promptInstall() {
  if (!deferredPrompt) return false
  deferredPrompt.prompt()
  const choice = await deferredPrompt.userChoice.catch(() => ({ outcome: 'dismissed' }))
  deferredPrompt = null
  emit()
  return choice.outcome === 'accepted'
}

// Zustand für die UI: 'installed' | 'prompt' | 'ios' | 'none'
// iOS: Button IMMER anbieten (nicht nur in Safari) — ist der Nutzer in Chrome/einem
// In-App-Browser, erklärt die Anleitung, dass es nur in Safari geht. So steht man
// nie vor einem leeren Menü.
export function installState() {
  if (isStandalone()) return 'installed'
  if (canPromptInstall()) return 'prompt'
  if (isIOS()) return 'ios'
  return 'none'
}

export function onInstallChange(fn) { listeners.add(fn); return () => listeners.delete(fn) }

// ── Produktabhängiges Manifest / iOS-Titel ────────────────────────
// Muss VOR der Installation gesetzt sein (der Browser liest das gerade verlinkte
// Manifest beim Installieren). lifework → Lebenswerk.ai, sonst → Lebensgeschichten.ai.
const PRODUCTS = {
  lebenswerk: { manifest: '/manifest-lebenswerk.webmanifest', title: 'Lebenswerk' },
  default:    { manifest: '/manifest.webmanifest',            title: 'Lebensgeschichten' },
}
export function setPwaProduct(category) {
  if (typeof document === 'undefined') return
  const p = category === 'lifework' ? PRODUCTS.lebenswerk : PRODUCTS.default
  const link = document.getElementById('pwa-manifest')
  if (link && link.getAttribute('href') !== p.manifest) link.setAttribute('href', p.manifest)
  const appleTitle = document.getElementById('pwa-apple-title')
  if (appleTitle && appleTitle.getAttribute('content') !== p.title) appleTitle.setAttribute('content', p.title)
}
