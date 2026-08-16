// src/bookLayouts.js
// Buchlayouts (Typografie/Design). Gleiches Format, nur Schriften/Überschriften
// unterscheiden sich. Pro Layout die Schrift je Renderer:
//   css  – Browser-Leseansicht           (font-family)
//   pdf  – Druck-PDF: 'times' | 'helvetica'. Diese Namen zeigen NICHT mehr auf die
//          nicht eingebetteten jsPDF-Standardschriften, sondern auf maßgleiche
//          eingebettete Schriften (src/pdfFonts.js) — Druckereien verlangen das.
//          'courier' wäre möglich, ist dort aber noch nicht hinterlegt: erst die
//          vier LiberationMono-Dateien nach public/fonts/ legen und in pdfFonts.js
//          eintragen, sonst landet er uneingebettet im Druck-PDF.
//   docx – DOCX-Export (Word-Schriftname, Office-sicher)
// heading.upper = Überschriften in Versalien; heading.track = CSS letter-spacing.

export const BOOK_LAYOUTS = [
  {
    key: 'classic',
    label: 'Klassisch',
    description: 'Serifenschrift durchgehend – traditionell und würdevoll.',
    heading: { css: 'Georgia, "Times New Roman", serif', pdf: 'times', docx: 'Georgia', upper: false, track: '0' },
    body:    { css: 'Georgia, "Times New Roman", serif', pdf: 'times', docx: 'Georgia' },
  },
  {
    key: 'modern',
    label: 'Modern',
    description: 'Klare serifenlose Schrift, Überschriften in Versalien.',
    heading: { css: '"Helvetica Neue", Arial, system-ui, sans-serif', pdf: 'helvetica', docx: 'Arial', upper: true, track: '0.12em' },
    body:    { css: '"Helvetica Neue", Arial, system-ui, sans-serif', pdf: 'helvetica', docx: 'Arial' },
  },
  {
    key: 'elegant',
    label: 'Elegant',
    description: 'Serifenlose Überschriften, Serifen-Fließtext – editorial.',
    heading: { css: '"Helvetica Neue", Arial, system-ui, sans-serif', pdf: 'helvetica', docx: 'Arial', upper: false, track: '0.03em' },
    body:    { css: 'Georgia, "Times New Roman", serif', pdf: 'times', docx: 'Georgia' },
  },
]

export const DEFAULT_BOOK_LAYOUT = 'classic'
export const getBookLayout = (key) => BOOK_LAYOUTS.find(l => l.key === key) || BOOK_LAYOUTS[0]
export const bookLayoutLabel = (key) => getBookLayout(key).label
