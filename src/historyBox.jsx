// Zeitgeschehen-Kasten am Bildschirm (Admin-Buchansicht und Endnutzer-Ansicht).
// Er stammt NICHT aus dem Gespräch, sondern ist KI-Sachtext über ein Ereignis
// (api/admin/history-box.js). Deshalb optisch klar vom Buch abgesetzt: eigener
// Farbton, Etikett „Zeitgeschehen · Jahr", Hinweiszeile und — falls vorhanden —
// die Kennzeichnung der Grafik als KI-generiert. Die Druckfassung zeichnet
// dasselbe in src/bookExport.js nach.
import { historyBoxYear } from './categories.js'

export function HistoryBox({ box, t, bodyFont, compact = false }) {
  const year = historyBoxYear(box)
  return (
    <aside style={{
      marginTop: compact ? 14 : '1.75rem', padding: compact ? '12px 16px 14px' : '16px 20px 18px',
      background: '#f8f4ec', border: '1px solid #e6dcc8', borderLeft: '4px solid #a8844a', borderRadius: 10,
    }}>
      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom: 8 }}>
        <span style={{ fontSize:11, fontWeight:700, letterSpacing:'.14em', textTransform:'uppercase', color:'#8a6d3b' }}>
          {t.historyBoxLabel}{year ? ` · ${year}` : ''}
        </span>
        <span style={{ flex:1, height:1, background:'#e6dcc8' }} />
      </div>
      {box.title && (
        <p style={{ fontSize: compact ? 16 : 18, fontWeight:700, color:'#3f3423', margin:'0 0 10px', ...(bodyFont || {}) }}>{box.title}</p>
      )}
      {box.image_url && (
        <figure style={{ margin:'0 0 12px' }}>
          <img src={box.image_url} alt={box.title || ''} loading="lazy"
               style={{ width:'100%', maxHeight:240, objectFit:'cover', borderRadius:6, display:'block' }} />
          <figcaption style={{ fontSize:11, fontStyle:'italic', color:'#8a7a60', marginTop:4 }}>{t.historyBoxImageNote}</figcaption>
        </figure>
      )}
      <p style={{ fontSize: compact ? 15 : 16, lineHeight:1.75, color:'#44403c', margin:0, whiteSpace:'pre-wrap', ...(bodyFont || {}) }}>{box.text}</p>
      <p style={{ fontSize:11.5, fontStyle:'italic', color:'#8a7a60', margin:'12px 0 0', paddingTop:8, borderTop:'1px dashed #e6dcc8' }}>
        {t.historyBoxNote}
      </p>
    </aside>
  )
}
