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

// Standard-Banner oben auf den Beitragenden-Seiten. Wird durch das eigene
// Firmenlogo des Benutzers ersetzt, sobald hinterlegt (logoUrl). Der Fallback
// ist bewusst produktneutral (keine Trauer-/Branchenbindung).
const PARTNER_NAME      = 'Lebensgeschichten.AI'
const PARTNER_MONOGRAM  = 'L'
export function PartnerBanner({ logoUrl }) {
  return (
    <div style={{ maxWidth: 600, margin: '0 auto' }}>
      <div style={{ background:'#fff', borderBottom:'1px solid #e7e5e4', padding:'10px 1.25rem', display:'flex', alignItems:'center', gap:12 }}>
        {logoUrl ? (
          // Vom Benutzer hinterlegtes Firmenlogo.
          <img
            src={logoUrl}
            alt="Logo"
            style={{ maxHeight:40, maxWidth:200, width:'auto', objectFit:'contain', flexShrink:0 }}
          />
        ) : (
          // Standard-/Demo-Logo (z. B. für Bücher des Administrators).
          <div style={{ display:'flex', alignItems:'center', gap:12 }}>
            <div style={{
              width:32, height:32, borderRadius:'50%',
              background:'#1c1917', color:'#fafaf9',
              display:'flex', alignItems:'center', justifyContent:'center',
              fontFamily:'Georgia, serif', fontWeight:700, fontSize:15,
              flexShrink:0,
            }}>{PARTNER_MONOGRAM}</div>
            <div style={{ minWidth:0, lineHeight:1.3 }}>
              <div style={{ fontWeight:600, fontSize:14, color:'#1c1917', fontFamily:'Georgia, serif' }}>{PARTNER_NAME}</div>
              <div style={{ fontSize:10.5, color:'#78716c', textTransform:'uppercase', letterSpacing:'.09em', marginTop:2 }}>Persönliche Bücher &amp; Reden</div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
