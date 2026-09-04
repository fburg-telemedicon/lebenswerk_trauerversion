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

import { isLifework } from './categories.js'

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

// ── Dynamisches Manifest je Interview + iOS-Titel ─────────────────
// Muss VOR der Installation gesetzt sein (der Browser liest das gerade verlinkte
// Manifest beim Installieren). Das Manifest kommt vom Server (/app.webmanifest) und
// bekommt den Code in die start_url gebacken → das installierte Icon öffnet direkt
// dieses Interview (nötig für iOS, dessen PWA einen eigenen Speicher hat). lifework →
// Lebenswerk.ai, sonst → Lebensgeschichten.ai. Ohne Code (z. B. Dashboard) NICHT
// aufgerufen → dort bleibt der Manifest-Link ohne href = nicht installierbar.
export function setPwaProduct(category, code) {
  if (typeof document === 'undefined') return
  const lw = isLifework(category)
  const c = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  const params = new URLSearchParams()
  if (c) params.set('code', c)
  if (lw) params.set('lw', '1')
  const href = `/app.webmanifest${params.toString() ? `?${params.toString()}` : ''}`
  const link = document.getElementById('pwa-manifest')
  if (link && link.getAttribute('href') !== href) link.setAttribute('href', href)
  const title = lw ? 'Lebenswerk' : 'Lebensgeschichten'
  const appleTitle = document.getElementById('pwa-apple-title')
  if (appleTitle && appleTitle.getAttribute('content') !== title) appleTitle.setAttribute('content', title)
}
