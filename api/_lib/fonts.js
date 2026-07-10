// api/_lib/fonts.js
// Richtet fontconfig auf die gebündelten Serif-Fonts (api/_fonts) aus, damit
// librsvg (über sharp) in der Serverless-Linux-Umgebung Text zeichnen kann statt
// Platzhalter-Kästchen. Idempotent; setzt FONTCONFIG_FILE nur einmal. Wird von
// den Report-Funktionen genutzt (compose-image.js hat eine eigene Kopie).
// Voraussetzung im Serverless-Bundle: vercel.json includeFiles "api/_fonts/**".

const os = require('os')
const path = require('path')
const fs = require('fs')

const SERIF = 'DejaVu Serif, Georgia, serif'

function setupFonts() {
  try {
    if (process.env.FONTCONFIG_FILE) return
    const fontDir = path.join(__dirname, '..', '_fonts')
    if (!fs.existsSync(path.join(fontDir, 'DejaVuSerif.ttf'))) return
    const cacheDir = path.join(os.tmpdir(), 'lw-fontconfig')
    try { fs.mkdirSync(cacheDir, { recursive: true }) } catch {}
    const confPath = path.join(os.tmpdir(), 'lw-fonts.conf')
    fs.writeFileSync(confPath,
      `<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "fonts.dtd">\n<fontconfig>\n  <dir>${fontDir}</dir>\n  <cachedir>${cacheDir}</cachedir>\n</fontconfig>\n`)
    process.env.FONTCONFIG_FILE = confPath
  } catch (e) {
    console.warn('Font-Setup übersprungen:', e.message)
  }
}

module.exports = { setupFonts, SERIF }
