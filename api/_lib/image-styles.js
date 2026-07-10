// api/_lib/image-styles.js
// Grafikstile für die Bildgenerierung. Der Stil wird pro Gedenkbuch gewählt
// (memorials.image_style) und als Direktive in JEDEN FLUX-Prompt eingebaut, damit
// alle Bilder eines Buchs konsistent im selben Stil entstehen.
//
// Frontend-Pendant (Labels/Beschreibungen/Beispielbilder) liegt in src/imageStyles.js;
// die KEYS müssen übereinstimmen.

const DEFAULT_STYLE = 'realistic'

const STYLES = {
  realistic: {
    directive:
      'realistic photographic style — natural lighting, true-to-life colors and textures, ' +
      'authentic depth of field and a subtle film grain fitting the depicted era. Photographic realism throughout.',
  },
  watercolor: {
    directive:
      'soft watercolor painting — translucent layered washes of color, visible paper texture, ' +
      'gently blended edges and delicate brushwork, in a warm and tender palette. A hand-painted, artistic look throughout.',
  },
  pencil: {
    directive:
      'fine graphite pencil drawing — soft hand-drawn shading and subtle cross-hatching on warm off-white paper, ' +
      'restrained near-monochrome tones with gentle highlights. An intimate, hand-sketched look throughout.',
  },
  oil: {
    directive:
      'a classic oil painting — rich impasto brushstrokes, warm layered glazes and painterly depth, ' +
      'in the timeless, dignified manner of fine portrait art. A hand-painted, museum-like look throughout.',
  },
  vintage: {
    directive:
      'a nostalgic vintage photograph — warm sepia and gently faded tones, soft focus, fine analog film grain ' +
      'and a subtle vignette, evoking a treasured, lovingly kept old family photo.',
  },
}

function normalizeStyle(key) {
  return (key && Object.prototype.hasOwnProperty.call(STYLES, key)) ? key : null
}

// Prompt-Zusatz, der den gewählten Stil verbindlich für das GANZE Bild vorgibt.
function styleDirective(key) {
  const s = STYLES[normalizeStyle(key) || DEFAULT_STYLE]
  return `Apply this artistic medium and style consistently across the ENTIRE image: ${s.directive}`
}

module.exports = { STYLES, DEFAULT_STYLE, normalizeStyle, styleDirective }
