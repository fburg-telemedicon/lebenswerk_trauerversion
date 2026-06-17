// src/CategoryIcon.jsx
// Einheitliches, linienbasiertes SVG-Icon-Set für die Produktkategorien.
// Einfarbig über `currentColor` — die Farbe wird vom umgebenden Element
// gesetzt (z. B. color:'#1c1917'). Slugs siehe src/categories.js.

const PATHS = {
  // Kerze (Gedenkbuch)
  memorial: (
    <>
      <path d="M12 3.2c1.8 1.9 1.8 3.9 0 5.1-1.8-1.2-1.8-3.2 0-5.1z" />
      <rect x="9.2" y="8.8" width="5.6" height="11" rx="1.2" />
      <line x1="6" y1="20.4" x2="18" y2="20.4" />
    </>
  ),
  // Torte (Geburtstag)
  birthday: (
    <>
      <path d="M12 3.6c1.2 1.2 1.2 2.5 0 3.4-1.2-.9-1.2-2.2 0-3.4z" />
      <line x1="12" y1="7.2" x2="12" y2="10.5" />
      <path d="M5 13.5c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2V19H5z" />
      <line x1="3.5" y1="19.2" x2="20.5" y2="19.2" />
    </>
  ),
  // Zwei Ringe (Hochzeitsjubiläum)
  anniversary: (
    <>
      <path d="M9.5 6.4l1.6-2 1.6 2-1.6 1.9z" />
      <circle cx="9.4" cy="15" r="3.9" />
      <circle cx="15" cy="15" r="3.9" />
    </>
  ),
  // Tür mit Pfeil hinaus (Abschied & Ruhestand)
  farewell: (
    <>
      <path d="M4 4h6.5v16H4z" />
      <circle cx="8.4" cy="12" r="0.7" />
      <line x1="12.5" y1="12" x2="20.5" y2="12" />
      <polyline points="17.5 9 20.5 12 17.5 15" />
    </>
  ),
  // Medaille (Dienstjubiläum)
  service: (
    <>
      <line x1="9" y1="3" x2="11" y2="8.2" />
      <line x1="15" y1="3" x2="13" y2="8.2" />
      <circle cx="12" cy="14.5" r="5" />
      <path d="M12 11.7l.9 1.9 2 .3-1.45 1.45.35 2.05L12 16.5l-1.85.9.35-2.05L9.05 13.9l2-.3z" />
    </>
  ),
  // Gebäude (Betriebsjubiläum)
  company: (
    <>
      <path d="M5 3.5h14v17H5z" />
      <line x1="3.5" y1="20.5" x2="20.5" y2="20.5" />
      <rect x="8" y="6.5" width="2.3" height="2.3" />
      <rect x="13.7" y="6.5" width="2.3" height="2.3" />
      <rect x="8" y="11" width="2.3" height="2.3" />
      <rect x="13.7" y="11" width="2.3" height="2.3" />
      <path d="M9.8 20.5v-4.2h4.4v4.2" />
    </>
  ),
  // Schnuller (Geburt/Willkommen)
  newborn: (
    <>
      <ellipse cx="12" cy="6.8" rx="1.7" ry="2.1" />
      <ellipse cx="12" cy="11" rx="4.6" ry="2.4" />
      <circle cx="12" cy="16.6" r="3.2" />
    </>
  ),
  // Regenbogen (Mutmachbuch)
  encouragement: (
    <>
      <path d="M4 18a8 8 0 0 1 16 0" />
      <path d="M7 18a5 5 0 0 1 10 0" />
      <path d="M10 18a2 2 0 0 1 4 0" />
      <line x1="3" y1="18.2" x2="21" y2="18.2" />
    </>
  ),
}

export default function CategoryIcon({ slug, size = 24, strokeWidth = 1.6, style }) {
  const content = PATHS[slug] || PATHS.memorial
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
    >
      {content}
    </svg>
  )
}
