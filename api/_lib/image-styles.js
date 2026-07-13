// api/_lib/image-styles.js
// Grafikstile für die Bildgenerierung. Der Stil wird pro Gedenkbuch gewählt
// (memorials.image_style) und als Direktive in JEDEN FLUX-Prompt eingebaut, damit
// alle Bilder eines Buchs konsistent im selben Stil entstehen.
//
// Frontend-Pendant (Labels/Beschreibungen/Beispielbilder) liegt in src/imageStyles.js;
// die KEYS müssen übereinstimmen.

const DEFAULT_STYLE = 'realistic'

// Jeder Stil definiert:
//   medium    – das Medium in EINEM Begriff; wird im Anker am Prompt-Ende wiederholt
//   directive – die ausführliche Beschreibung
//   exclude   – konkurrierende Medien, die explizit verboten werden. Ohne dieses
//               Negativ driftet FLUX zwischen Foto / Malerei / 3D-Render / Anime
//               hin und her, und die Kapitel eines Buchs sehen unterschiedlich aus.
const STYLES = {
  realistic: {
    medium: 'photograph',
    directive:
      'a REAL PHOTOGRAPH taken with a camera — natural lighting, true-to-life colors and textures, ' +
      'authentic optical depth of field and a subtle film grain fitting the depicted era. Photographic realism throughout.',
    exclude: 'painting, illustration, drawing, sketch, anime, comic, 3D render, CGI, digital art, stylized art',
  },
  watercolor: {
    medium: 'watercolor painting',
    directive:
      'a WATERCOLOR PAINTING on paper — translucent layered washes of color, visible paper texture, ' +
      'gently blended edges and delicate brushwork, in a warm and tender palette. Hand-painted throughout.',
    exclude: 'photograph, photorealism, oil painting, 3D render, CGI, digital art, anime, comic',
  },
  pencil: {
    medium: 'pencil drawing',
    directive:
      'a GRAPHITE PENCIL DRAWING on warm off-white paper — soft hand-drawn shading and subtle cross-hatching, ' +
      'restrained near-monochrome tones with gentle highlights. Hand-sketched throughout.',
    exclude: 'photograph, photorealism, color painting, 3D render, CGI, digital art, anime, comic',
  },
  oil: {
    medium: 'oil painting',
    directive:
      'a CLASSIC OIL PAINTING on canvas — rich impasto brushstrokes, warm layered glazes and painterly depth, ' +
      'visible canvas texture, in the timeless, dignified manner of fine portrait art. Hand-painted throughout.',
    exclude: 'photograph, photorealism, watercolor, pencil sketch, 3D render, CGI, digital art, anime, comic',
  },
  vintage: {
    medium: 'vintage photograph',
    directive:
      'a NOSTALGIC VINTAGE PHOTOGRAPH — warm sepia and gently faded tones, soft focus, fine analog film grain ' +
      'and a subtle vignette, evoking a treasured, lovingly kept old family photo.',
    exclude: 'painting, illustration, drawing, sketch, 3D render, CGI, digital art, anime, comic, modern digital photo',
  },
}

function normalizeStyle(key) {
  return (key && Object.prototype.hasOwnProperty.call(STYLES, key)) ? key : null
}

// Prompt-Zusatz, der den gewählten Stil verbindlich für das GANZE Bild vorgibt.
// Steht bewusst am ANFANG des Prompts (Rahmen) …
function styleDirective(key) {
  const s = STYLES[normalizeStyle(key) || DEFAULT_STYLE]
  return `MEDIUM (mandatory, applies to the ENTIRE image): ${s.directive}\n` +
    `This is NOT: ${s.exclude}.`
}

// … und wird als kurzer Anker am ENDE wiederholt. FLUX gewichtet die letzten
// Tokens am stärksten; ohne diesen Anker überschreiben die Kompositions-
// Anweisungen das Medium und die Bilder eines Buchs driften stilistisch
// auseinander.
function styleAnchor(key) {
  const s = STYLES[normalizeStyle(key) || DEFAULT_STYLE]
  return `The final image is ${s.medium.match(/^[aeiou]/i) ? 'an' : 'a'} ${s.medium} — nothing else.`
}

module.exports = { STYLES, DEFAULT_STYLE, normalizeStyle, styleDirective, styleAnchor }
