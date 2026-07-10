// src/imageStyles.js
// Grafikstile für die Bildgenerierung (Frontend-Metadaten). Die KEYS müssen mit
// api/_lib/image-styles.js übereinstimmen; die eigentlichen Prompt-Direktiven
// liegen dort (Backend). Beispielbilder liegen unter public/styles/.

export const IMAGE_STYLES = [
  {
    key: 'realistic',
    label: 'Fotorealistisch',
    description: 'Natürliche Fotografie – zeitgetreue Farben und Texturen, wie ein echtes Foto der jeweiligen Epoche.',
    example: '/styles/realistic.jpg',
  },
  {
    key: 'watercolor',
    label: 'Aquarell',
    description: 'Weiche, lasierende Wasserfarben – warm, künstlerisch und zurückhaltend.',
    example: '/styles/watercolor.jpg',
  },
  {
    key: 'pencil',
    label: 'Bleistiftzeichnung',
    description: 'Feine Graphit-Skizze mit sanften Schraffuren – ruhig, intim, monochrom.',
    example: '/styles/pencil.jpg',
  },
  {
    key: 'oil',
    label: 'Ölgemälde',
    description: 'Klassische Malerei mit sichtbarem Pinselduktus – warm, zeitlos, würdevoll.',
    example: '/styles/oil.jpg',
  },
  {
    key: 'vintage',
    label: 'Vintage-Foto',
    description: 'Nostalgische Sepia-Töne, weicher Fokus – wie ein altes Familienfoto.',
    example: '/styles/vintage.jpg',
  },
]

export const DEFAULT_IMAGE_STYLE = 'realistic'

export const imageStyleLabel = (key) =>
  IMAGE_STYLES.find(s => s.key === key)?.label || IMAGE_STYLES[0].label
