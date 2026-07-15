// src/ui.jsx — geteilte UI-Primitive (Styles + kleine Präsentationskomponenten).
// Aus App.jsx ausgelagert, damit weitere Views sie ohne Import-Zyklus nutzen können.

export const S = {
  page:    { maxWidth: 600, margin: '0 auto', padding: '1.5rem' },
  card:    { background: '#fff', border: '1px solid #e7e5e4', borderRadius: 12, padding: '1.25rem' },
  muted:   { color: '#78716c', fontSize: 14, lineHeight: 1.65 },
  label:   { fontSize: 12, color: '#78716c', letterSpacing: '.06em', textTransform: 'uppercase', display: 'block', marginBottom: 6 },
  divider: { borderTop: '1px solid #e7e5e4', margin: '1.25rem 0' },
  err:     { background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#dc2626', marginBottom: 12 },
}
export const Lbl = ({ children }) => <span style={S.label}>{children}</span>
export const Err = ({ msg }) => msg ? <div style={S.err}>⚠ {msg}</div> : null
export function Back({ onClick }) {
  return <button className="ghost" onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: '1.25rem', color: '#78716c', fontSize: 14 }}>← Zurück</button>
}
export function Dots() {
  return <div style={{ display: 'flex', gap: 6, padding: '8px 0' }}>{[0,1,2].map(i => <div key={i} style={{ width: 8, height: 8, borderRadius: '50%', background: '#a8a29e', animation: 'lw-dot 1.2s ease-in-out infinite', animationDelay: `${i*.2}s` }} />)}</div>
}

// Standard-Banner oben auf den Beitragenden-Seiten. Zeigt das vom Manager
// hinterlegte Firmenlogo (logoUrl); solange keins hinterlegt ist, das
// Lebensgeschichten.ai-Standardlogo (statisches Asset in /public).
export const DEFAULT_LOGO = '/logo-lebensgeschichten.png'
// `category` = Produktkategorie des Buchs: Ein Lebenswerk trägt ohne eigenes
// Firmenlogo das Lebenswerk-Logo statt des Lebensgeschichten-Standardlogos.
export function PartnerBanner({ logoUrl, category }) {
  const fallback = category === 'lifework' ? '/lebenswerk-logo.png' : DEFAULT_LOGO
  return (
    <div style={{ maxWidth: 600, margin: '0 auto' }}>
      <div style={{ background:'#fff', borderBottom:'1px solid #e7e5e4', padding:'16px 1.25rem', display:'flex', alignItems:'center', gap:12 }}>
        {/* Das Lebenswerk-Logo ist fast 16:9 (1672×941) — eine niedrige Höhen-
            grenze drückt es auf einen schmalen Streifen. Deshalb großzügige Höhe;
            ein echtes Querformat-Banner wird stattdessen von der Breite begrenzt. */}
        <img
          src={logoUrl || fallback}
          alt="Lebensgeschichten.ai"
          style={{ maxHeight:104, maxWidth:'min(380px, 78%)', width:'auto', objectFit:'contain', flexShrink:0 }}
        />
      </div>
    </div>
  )
}

// Tabellen-Zellstile (aus Dashboard ausgelagert; von mehreren Admin-Views genutzt)
export const col = { padding: '11px 14px', textAlign: 'left', borderBottom: '1px solid #e7e5e4', fontSize: 14 }
export const th  = { ...col, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em', color: '#78716c', background: '#fafaf9' }
