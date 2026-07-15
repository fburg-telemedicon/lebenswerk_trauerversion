// src/pickers.jsx — kleine Auswahl-/Info-Komponenten (Grafikstil, Buchlayout)
// + uploadPrintInfo. Aus App.jsx ausgelagert; self-contained, props-basiert.

import { useState } from 'react'
import { IMAGE_STYLES, DEFAULT_IMAGE_STYLE } from './imageStyles.js'
import { BOOK_LAYOUTS, DEFAULT_BOOK_LAYOUT } from './bookLayouts.js'
import { TEXT_STYLES, textStylesFor } from './categories.js'

// Auswahl des Textstils (WIE die KI schreibt). Kategorie-abhängig: „An den
// Erzählstil anpassen" gibt es nur beim Lebenswerk; das Trauerbuch bietet nur
// „Literarisch-warm" (dann keine Auswahl, nur ein Hinweis). Reiner Text.
export function TextStylePicker({ category, value, onChange, disabled }) {
  const keys = textStylesFor(category)
  const cur = keys.includes(value) ? value : keys[0]
  if (keys.length <= 1) {
    const s = TEXT_STYLES[keys[0]]
    return <div style={{ fontSize:13, color:'#78716c', lineHeight:1.5 }}><strong style={{ color:'#44403c' }}>{s.label}</strong> — {s.desc}</div>
  }
  return (
    <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(200px, 1fr))', gap:10 }}>
      {keys.map(k => {
        const s = TEXT_STYLES[k]; const on = cur === k
        return (
          <div key={k} onClick={() => !disabled && onChange(k)}
            style={{ cursor: disabled ? 'default' : 'pointer', border:`2px solid ${on ? '#1c1917' : '#e7e5e4'}`, borderRadius:10, background:'#fff', padding:'10px 12px', opacity: disabled ? 0.6 : 1 }}>
            <div style={{ fontSize:13, fontWeight:600, display:'flex', alignItems:'center', gap:6 }}>{on && <span>✓</span>}{s.label}</div>
            <div style={{ fontSize:11.5, color:'#78716c', lineHeight:1.4, marginTop:3 }}>{s.desc}</div>
          </div>
        )
      })}
    </div>
  )
}

export function uploadPrintInfo(u) {
  const w = Number(u.width) || 0, h = Number(u.height) || 0
  const res = (w && h) ? `${w} × ${h} px` : 'Auflösung unbekannt'
  const landscape = u.orientation === 'landscape' || (w > h * 1.05)
  const coverDpi = (w && h) ? Math.min(w * 25.4 / 308, h * 25.4 / 216) : 0
  if (landscape && coverDpi >= 150)
    return { res, label: 'Hohe Auflösung', use: 'füllt eine ganze Doppelseite (Vollbild)', color: '#15803d', bg: '#dcfce7' }
  if (u.quality_flag === 'low')
    return { res, label: 'Geringe Auflösung', use: 'wird klein oder mit anderen Fotos gruppiert', color: '#b45309', bg: '#fef3c7' }
  return { res, label: 'Gute Auflösung', use: 'als gerahmtes Einzelbild auf der Seite', color: '#0369a1', bg: '#e0f2fe' }
}

// Auswahl des Grafikstils (Anlage + Dashboard). Zeigt je Stil ein Beispielbild,
// Label und Beschreibung. Fehlt das Beispielbild, bleibt eine dezente Fläche.
export function ImageStylePicker({ value, onChange, disabled }) {
  const cur = value || DEFAULT_IMAGE_STYLE
  const [zoom, setZoom] = useState(null) // { url, label } – Beispielbild groß ansehen
  return (
    <>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(150px, 1fr))', gap:10 }}>
        {IMAGE_STYLES.map(s => {
          const on = cur === s.key
          return (
            <div key={s.key} onClick={() => !disabled && onChange(s.key)}
              style={{ cursor: disabled ? 'default' : 'pointer', border:`2px solid ${on ? '#1c1917' : '#e7e5e4'}`, borderRadius:10, overflow:'hidden', background:'#fff', opacity: disabled ? 0.6 : 1 }}>
              <div style={{ aspectRatio:'3 / 2', background:'#f5f5f4', position:'relative' }}>
                <img src={s.example} alt={s.label} loading="lazy"
                  onError={e => { e.currentTarget.style.display = 'none' }}
                  style={{ width:'100%', height:'100%', objectFit:'cover', display:'block' }} />
                <button type="button" title="Größer ansehen"
                  onClick={e => { e.stopPropagation(); setZoom({ url: s.example, label: s.label }) }}
                  style={{ position:'absolute', top:6, left:6, width:24, height:24, borderRadius:6, background:'rgba(255,255,255,.85)', border:'1px solid #d6d3d1', cursor:'zoom-in', display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, lineHeight:1, padding:0 }}>🔍</button>
                {on && <div style={{ position:'absolute', top:6, right:6, width:22, height:22, borderRadius:6, background:'#1c1917', color:'#fff', display:'flex', alignItems:'center', justifyContent:'center', fontSize:14, fontWeight:700 }}>✓</div>}
              </div>
              <div style={{ padding:'8px 10px' }}>
                <div style={{ fontSize:13, fontWeight:600 }}>{s.label}</div>
                <div style={{ fontSize:11.5, color:'#78716c', lineHeight:1.4, marginTop:2 }}>{s.description}</div>
              </div>
            </div>
          )
        })}
      </div>
      {zoom && (
        <div onClick={() => setZoom(null)}
          style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.82)', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', zIndex:200, padding:'2rem', cursor:'zoom-out' }}>
          <button type="button" onClick={() => setZoom(null)} title="Schließen"
            style={{ position:'fixed', top:14, right:20, fontSize:28, lineHeight:1, color:'#fff', background:'none', border:'none', cursor:'pointer' }}>×</button>
          <img src={zoom.url} alt={zoom.label} onClick={e => e.stopPropagation()}
            style={{ maxWidth:'95vw', maxHeight:'82vh', objectFit:'contain', borderRadius:8, boxShadow:'0 8px 40px rgba(0,0,0,.5)' }} />
          <div style={{ color:'#f5f5f4', fontSize:15, marginTop:14 }}>{zoom.label}</div>
        </div>
      )}
    </>
  )
}

// Auswahl des Buchlayouts (Typografie). Zeigt je Design eine LIVE-Schriftvorschau
// (Kapitel + Überschrift + Textzeilen) in den echten Fonts des Layouts.
export function BookLayoutPicker({ value, onChange, disabled }) {
  const cur = value || DEFAULT_BOOK_LAYOUT
  return (
    <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(180px, 1fr))', gap:10 }}>
      {BOOK_LAYOUTS.map(l => {
        const on = cur === l.key
        return (
          <div key={l.key} onClick={() => !disabled && onChange(l.key)}
            style={{ cursor: disabled ? 'default' : 'pointer', border:`2px solid ${on ? '#1c1917' : '#e7e5e4'}`, borderRadius:10, overflow:'hidden', background:'#fff', opacity: disabled ? 0.6 : 1 }}>
            <div style={{ padding:'12px 12px 11px', background:'#faf9f7', borderBottom:'1px solid #f0ede8' }}>
              <div style={{ fontSize:9, letterSpacing:'.15em', textTransform:'uppercase', color:'#a8a29e', fontFamily:l.heading.css }}>Kapitel 1</div>
              <div style={{ fontSize:16, fontWeight:700, color:'#1c1917', fontFamily:l.heading.css, letterSpacing:l.heading.track, textTransform: l.heading.upper ? 'uppercase' : 'none', margin:'2px 0 5px' }}>Sommertage</div>
              <div style={{ fontSize:10.5, lineHeight:1.5, color:'#57534e', fontFamily:l.body.css }}>Es war ein warmer Nachmittag, als wir gemeinsam im Garten saßen und alte Geschichten erzählten.</div>
            </div>
            <div style={{ padding:'8px 10px' }}>
              <div style={{ fontSize:13, fontWeight:600, display:'flex', alignItems:'center', gap:6 }}>{on && <span>✓</span>}{l.label}</div>
              <div style={{ fontSize:11.5, color:'#78716c', lineHeight:1.4, marginTop:2 }}>{l.description}</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
