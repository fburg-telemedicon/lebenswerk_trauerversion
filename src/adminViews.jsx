// src/adminViews.jsx — aus Dashboard() ausgelagerte Admin-Views.
// Jede View bekommt State + Handler als GLEICHNAMIGE Props -> Body verbatim,
// verhaltensneutral. Modul-Helfer (S/Back/Err) werden importiert.

import { Fragment, useState, useEffect } from 'react'
import { S, Back, Err, Lbl, col, th, PartnerBanner, Dots } from './ui.jsx'
import { POSTER_STYLES, getPosterStyle, renderPosterPreview } from './lifeworkExtras.js'
import { formatEur, formatEurSum, costKindLabel, PASSWORD_RULES_TEXT, qrCodeUrl, cutoffDate, cutoffDays, cutoffString, imageErrorDe } from './shared.js'
import { CATEGORIES, CATEGORY_ORDER, getCategory, categoryColor } from './categories.js'
import CategoryIcon from './CategoryIcon.jsx'
import { GENDERS, EMPTY_PICKUP, BOOK_VARIANTS } from './constants.js'
import { LANGUAGES, uiText, canPrintPdf } from './i18n.js'
import { ImageStylePicker, BookLayoutPicker, TextStylePicker } from './pickers.jsx'
import { getBookLayout } from './bookLayouts.js'
import { dedupeContributors } from './bookExport.js'
import { useAdminT, AdminLangToggle } from './adminI18n.jsx'

export function AuditView({ auditData, auditLoading, err, logout, loadAudit, setView }) {
    const t = useAdminT()
    const fmtTime = ts => { try { return new Date(ts).toLocaleString('de-DE') } catch { return ts } }
    const th = { textAlign:'left', padding:'8px 10px', fontSize:12, color:'#78716c', fontWeight:600, borderBottom:'1px solid #e7e5e4', whiteSpace:'nowrap' }
    const td = { padding:'8px 10px', fontSize:12, borderBottom:'1px solid #f5f5f4', verticalAlign:'top' }
    const actionColor = a => a === 'login.failure' ? '#b91c1c'
      : a?.endsWith('.delete') ? '#c2410c'
      : a === 'login.success' ? '#15803d' : '#1c1917'
    return (
      <div style={{ minHeight:'100vh', background:'#fafaf9' }}>
        <div style={{ background:'#fff', borderBottom:'1px solid #e7e5e4', padding:'14px 24px', position: 'sticky', top: 0, zIndex: 50, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div style={{ display:'flex', alignItems:'center', gap:16 }}>
            <button className="ghost" onClick={() => setView('list')} style={{ fontSize:14, color:'#78716c' }}>{t('← Zurück', '← Back')}</button>
            <span style={{ fontWeight:700, fontSize:16 }}>Lebenswerk Admin</span>
          </div>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            <AdminLangToggle />
            <button className="secondary" onClick={logout} style={{ fontSize:13, padding:'7px 14px' }}>{t('Abmelden', 'Log out')}</button>
          </div>
        </div>
        <div style={{ maxWidth:1000, margin:'2rem auto', padding:'0 1.5rem' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:8 }}>
            <h2 style={{ fontSize:22, fontWeight:700, marginBottom:4 }}>{t('Audit-Log', 'Audit log')}</h2>
            <button className="secondary" onClick={loadAudit} disabled={auditLoading} style={{ fontSize:12, padding:'6px 12px' }}>{auditLoading ? t('Lädt…', 'Loading…') : t('Aktualisieren', 'Refresh')}</button>
          </div>
          <p style={{ ...S.muted, marginBottom:'1.5rem' }}>{t('Sicherheitsrelevante Aktionen (neueste zuerst, max. 200). Aufbewahrung 365 Tage.', 'Security-relevant actions (newest first, max. 200). Retention 365 days.')}</p>
          <Err msg={err} />
          <div style={{ ...S.card, padding:0, overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>{t('Zeit', 'Time')}</th><th style={th}>{t('Aktion', 'Action')}</th><th style={th}>{t('Akteur', 'Actor')}</th>
                  <th style={th}>{t('Ziel', 'Target')}</th><th style={th}>IP</th><th style={th}>{t('Detail', 'Detail')}</th>
                </tr>
              </thead>
              <tbody>
                {auditData.entries.map(e => (
                  <tr key={e.id}>
                    <td style={{ ...td, whiteSpace:'nowrap', color:'#78716c' }}>{fmtTime(e.created_at)}</td>
                    <td style={{ ...td, fontWeight:600, color:actionColor(e.action) }}>{e.action}</td>
                    <td style={td}>{e.actor_name || (e.actor_uid ? e.actor_uid.slice(0,8) : '—')}{e.is_admin ? t(' (Admin)', ' (Admin)') : ''}</td>
                    <td style={{ ...td, fontFamily:'monospace' }}>{e.target || '—'}</td>
                    <td style={{ ...td, fontFamily:'monospace', color:'#78716c' }}>{e.ip || '—'}</td>
                    <td style={{ ...td, fontFamily:'monospace', color:'#78716c', maxWidth:220, wordBreak:'break-all' }}>{e.detail ? JSON.stringify(e.detail) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {auditData.entries.length === 0 && <p style={{ ...S.muted, padding:'16px' }}>{auditLoading ? t('Lädt…', 'Loading…') : t('Noch keine Einträge.', 'No entries yet.')}</p>}
          </div>
        </div>
      </div>
    )
}

export function ReportsView({ err, reportMsg, recipients, recipientForm, busy, logout, setView, toggleRecipient, removeRecipient, submitRecipient, sendReportNow, setRecipientForm }) {
  const t = useAdminT()
  return (
    <div style={{ minHeight:'100vh', background:'#fafaf9' }}>
      <div style={{ background: '#fff', borderBottom: '1px solid #e7e5e4', padding: '14px 24px', position: 'sticky', top: 0, zIndex: 50, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div style={{ display:'flex', alignItems:'center', gap:16 }}><button className="ghost" onClick={() => setView('list')} style={{ fontSize:14, color:'#78716c' }}>{t('← Zurück', '← Back')}</button><span style={{ fontWeight: 700, fontSize: 16 }}>Lebenswerk Admin</span></div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <AdminLangToggle />
          <button className="secondary" onClick={logout} style={{ fontSize: 13, padding: '7px 14px' }}>{t('Abmelden', 'Log out')}</button>
        </div>
      </div>
      <div style={{ maxWidth: 720, margin: '2rem auto', padding: '0 1.5rem' }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>{t('Tagesreport', 'Daily report')}</h2>
        <p style={{ ...S.muted, marginBottom: '1.5rem' }}>
          {t('Jede Nacht (gegen 1:00 Uhr) geht ein Report mit den wichtigsten Kennzahlen des Vortags an die aktiven Empfänger – kompakte Zahlen im Text, ausführlicher Bericht mit Diagrammen als PDF-Anhang. Es werden ausschließlich aggregierte Zahlen versendet (keine personenbezogenen Daten).', 'Every night (around 1:00 a.m.) a report with the previous day’s key figures is sent to the active recipients – compact numbers in the text, a detailed report with charts as a PDF attachment. Only aggregated figures are sent (no personal data).')}
        </p>
        <Err msg={err} />
        {reportMsg && (
          <div style={{ ...S.card, marginBottom:20, borderColor:'#bbf7d0', background:'#f0fdf4', fontSize:13, color:'#166534' }}>{reportMsg}</div>
        )}

        {/* Empfängerliste */}
        <div style={{ display:'flex', flexDirection:'column', gap:10, marginBottom:24 }}>
          {recipients.map(r => (
            <div key={r.id} style={{ ...S.card, display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, flexWrap:'wrap' }}>
              <div>
                <strong style={{ fontSize:15 }}>{r.email}</strong>
                {r.name && <span style={{ ...S.muted, fontSize:13, marginLeft:8 }}>{r.name}</span>}
                {!r.active && <span style={{ fontSize:11, marginLeft:8, color:'#b45309' }}>{t('pausiert', 'paused')}</span>}
              </div>
              <div style={{ display:'flex', gap:8 }}>
                <button className="secondary" onClick={() => toggleRecipient(r)} style={{ fontSize:12, padding:'5px 10px' }}>{r.active ? t('Pausieren', 'Pause') : t('Aktivieren', 'Activate')}</button>
                <button className="secondary" onClick={() => removeRecipient(r)} style={{ fontSize:12, padding:'5px 10px', color:'#dc2626', borderColor:'#fecaca' }}>{t('Löschen', 'Delete')}</button>
              </div>
            </div>
          ))}
          {recipients.length === 0 && <p style={S.muted}>{t('Noch keine Empfänger. Fügen Sie unten die erste Adresse hinzu.', 'No recipients yet. Add the first address below.')}</p>}
        </div>

        {/* Neuer Empfänger */}
        <div style={{ ...S.card, marginBottom:24 }}>
          <Lbl>{t('Empfänger hinzufügen', 'Add recipient')}</Lbl>
          <input value={recipientForm.email} onChange={e => setRecipientForm({ ...recipientForm, email: e.target.value })} placeholder={t('E-Mail-Adresse', 'Email address')} type="email" style={{ marginBottom:8 }} />
          <input value={recipientForm.name} onChange={e => setRecipientForm({ ...recipientForm, name: e.target.value })} placeholder={t('Name (optional)', 'Name (optional)')} style={{ marginBottom:12 }} />
          <button onClick={submitRecipient} disabled={busy || !recipientForm.email.trim()} style={{ fontSize:14, padding:'9px 16px' }}>{busy ? t('Wird gespeichert …', 'Saving …') : t('Hinzufügen', 'Add')}</button>
        </div>

        {/* Test-Versand */}
        <div style={{ ...S.card }}>
          <Lbl>{t('Report jetzt testen', 'Test report now')}</Lbl>
          <p style={{ ...S.muted, fontSize:12, margin:'0 0 12px' }}>
            {t('Erzeugt den Report sofort mit den aktuellen Zahlen (Vortag) und verschickt ihn – praktisch zur Kontrolle, ohne bis 1:00 Uhr zu warten.', 'Generates the report immediately with the current figures (previous day) and sends it – handy for checking without waiting until 1:00 a.m.')}
          </p>
          <input value={recipientForm.test || ''} onChange={e => setRecipientForm({ ...recipientForm, test: e.target.value })} placeholder={t('Test-Adresse (leer = alle aktiven Empfänger)', 'Test address (empty = all active recipients)')} type="email" style={{ marginBottom:12 }} />
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            <button onClick={() => sendReportNow((recipientForm.test || '').trim() || undefined)} disabled={busy} style={{ fontSize:14, padding:'9px 16px' }}>{busy ? t('Wird gesendet …', 'Sending …') : t('Report senden', 'Send report')}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function CostsView({ selected, costData, costsLoading, err, setView, logout }) {
    const t = useAdminT()
    const kinds = costData?.byKind ? Object.entries(costData.byKind).sort((a, b) => b[1].cost_eur - a[1].cost_eur) : []
    return (
      <div style={{ minHeight: '100vh', background: '#fafaf9' }}>
        <div style={{ background: '#fff', borderBottom: '1px solid #e7e5e4', padding: '14px 24px', position: 'sticky', top: 0, zIndex: 50, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display:'flex', alignItems:'center', gap:16 }}>
            <button className="ghost" onClick={() => setView('list')} style={{ fontSize:14, color:'#78716c' }}>{t('← Zurück', '← Back')}</button>
            <div>
              <span style={{ fontWeight: 700, fontSize: 16 }}>{t('Kosten', 'Costs')}</span>
              <span style={{ fontSize:13, color:'#78716c', marginLeft:10 }}>· {selected.name}</span>
            </div>
          </div>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            <AdminLangToggle />
            <button className="secondary" onClick={logout} style={{ fontSize: 13, padding: '7px 14px' }}>{t('Abmelden', 'Log out')}</button>
          </div>
        </div>

        <div style={{ maxWidth: 920, margin: '2rem auto', padding: '0 1.5rem' }}>
          <Err msg={err} />
          {costsLoading && <p style={S.muted}>{t('Wird geladen …', 'Loading …')}</p>}
          {!costsLoading && costData && (
            <>
              <div style={{ ...S.card, marginBottom:'1.5rem', textAlign:'center' }}>
                <Lbl>{t('Gesamtkosten dieses Buchs', 'Total cost of this book')}</Lbl>
                <div style={{ fontSize:32, fontWeight:700, fontFamily:'Georgia,serif', marginTop:6 }}>{formatEurSum(costData.total_eur)}</div>
                <div style={{ fontSize:13, color:'#78716c', marginTop:4 }}>≈ {Number(costData.total_usd || 0).toFixed(2)} USD</div>
              </div>

              <h3 style={{ fontSize:16, fontWeight:600, marginBottom:'.75rem' }}>{t('Aufschlüsselung nach Kategorie', 'Breakdown by category')}</h3>
              {kinds.length === 0 ? (
                <p style={S.muted}>{t('Noch keine Kosten erfasst.', 'No costs recorded yet.')}</p>
              ) : (
                <div style={{ background:'#fff', border:'1px solid #e7e5e4', borderRadius:12, overflow:'hidden', marginBottom:'1.5rem' }}>
                  <table style={{ width:'100%', borderCollapse:'collapse' }}>
                    <thead>
                      <tr>
                        {[t('Kategorie', 'Category'), t('Calls', 'Calls'), t('Mengen', 'Quantities'), 'EUR'].map(h => <th key={h} style={th}>{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {kinds.map(([k, agg]) => {
                        const units = []
                        if (agg.input_tokens || agg.output_tokens) units.push(`${agg.input_tokens.toLocaleString('de-DE')} in / ${agg.output_tokens.toLocaleString('de-DE')} out ${t('Tokens', 'tokens')}`)
                        if (agg.characters)    units.push(`${agg.characters.toLocaleString('de-DE')} ${t('Zeichen', 'characters')}`)
                        if (agg.audio_seconds) units.push(`${Math.round(agg.audio_seconds)} ${t('Sek. Audio', 'sec audio')}`)
                        if (agg.images)        units.push(`${agg.images} ${agg.images > 1 ? t('Bilder', 'images') : t('Bild', 'image')}`)
                        return (
                          <tr key={k}>
                            <td style={{ ...col, fontWeight:500 }}>{costKindLabel(k)}</td>
                            <td style={{ ...col, color:'#78716c' }}>{agg.count}</td>
                            <td style={{ ...col, color:'#78716c', fontSize:13 }}>{units.join(' · ') || '—'}</td>
                            <td style={{ ...col, textAlign:'right', fontWeight:600, whiteSpace:'nowrap' }}>{formatEur(agg.cost_eur)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              <h3 style={{ fontSize:16, fontWeight:600, marginBottom:'.75rem' }}>{t('Alle Vorgänge', 'All events')} ({costData.events.length})</h3>
              {costData.events.length === 0 ? (
                <p style={S.muted}>{t('Keine Einträge.', 'No entries.')}</p>
              ) : (
                <div style={{ background:'#fff', border:'1px solid #e7e5e4', borderRadius:12, overflow:'hidden' }}>
                  <table style={{ width:'100%', borderCollapse:'collapse' }}>
                    <thead>
                      <tr>
                        {[t('Zeit', 'Time'), t('Kategorie', 'Category'), t('Modell', 'Model'), t('Detail', 'Detail'), 'EUR'].map(h => <th key={h} style={th}>{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {costData.events.map(e => {
                        const parts = []
                        if (e.input_tokens || e.output_tokens) parts.push(`${e.input_tokens || 0} in / ${e.output_tokens || 0} out`)
                        if (e.characters)    parts.push(`${e.characters} ${t('Zeichen', 'characters')}`)
                        if (e.audio_seconds) parts.push(`${Math.round(e.audio_seconds)} s`)
                        if (e.images) {
                          // Variante/Kapitel aus den Metadaten (sofern vorhanden)
                          const md = e.metadata || {}
                          const vlabel = md.variant === 'book_v1' ? 'V1' : md.variant === 'book_v2' ? 'V2' : null
                          const chPart = md.chapter != null
                            ? `${t('Kapitel', 'Chapter')} ${md.chapter}${md.chapter_heading ? ` – „${md.chapter_heading}"` : ''}`
                            : null
                          const seg = [vlabel, chPart].filter(Boolean).join(' · ')
                          parts.push(`${e.images} ${t('Bild', 'image')}${seg ? ` (${seg})` : ''}`)
                        }
                        return (
                          <tr key={e.id}>
                            <td style={{ ...col, fontSize:12, color:'#78716c', whiteSpace:'nowrap' }}>{new Date(e.created_at).toLocaleString('de-DE')}</td>
                            <td style={{ ...col }}>{costKindLabel(e.kind)}</td>
                            <td style={{ ...col, fontFamily:'monospace', fontSize:12, color:'#78716c' }}>{e.model || '—'}</td>
                            <td style={{ ...col, fontSize:12, color:'#78716c' }}>{parts.join(' · ') || '—'}</td>
                            <td style={{ ...col, textAlign:'right', fontWeight:500, whiteSpace:'nowrap' }}>{formatEur(e.cost_eur)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    )
}

export function SettingsView({ err, logoLoading, logo, busy, logoSaved, pwErr, pwForm, pwSaved, logout, setView, onLogoFile, saveLogo, saveOwnPassword, setPwForm }) {
  const t = useAdminT()
  return (
    <div style={{ minHeight:'100vh', background:'#fafaf9' }}>
      <div style={{ background: '#fff', borderBottom: '1px solid #e7e5e4', padding: '14px 24px', position: 'sticky', top: 0, zIndex: 50, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div style={{ display:'flex', alignItems:'center', gap:16 }}><button className="ghost" onClick={() => setView('list')} style={{ fontSize:14, color:'#78716c' }}>{t('← Zurück', '← Back')}</button><span style={{ fontWeight: 700, fontSize: 16 }}>Lebenswerk Admin</span></div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <AdminLangToggle />
          <button className="secondary" onClick={logout} style={{ fontSize: 13, padding: '7px 14px' }}>{t('Abmelden', 'Log out')}</button>
        </div>
      </div>
      <div style={{ maxWidth: 540, margin: '2rem auto', padding: '0 1.5rem' }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>{t('Einstellungen', 'Settings')}</h2>
        <p style={{ ...S.muted, marginBottom: '1.5rem' }}>
          {t('Hinterlegen Sie Ihr Firmenlogo. Es wird den Beitragenden Ihrer Bücher oben angezeigt – anstelle des Standard-Logos.', 'Add your company logo. It is shown to the contributors of your books at the top – instead of the default logo.')}
        </p>
        <Err msg={err} />

        <div style={{ ...S.card }}>
          <Lbl>{t('Firmenlogo', 'Company logo')}</Lbl>
          {logoLoading ? (
            <p style={S.muted}>{t('Wird geladen …', 'Loading …')}</p>
          ) : (
            <>
              <div style={{
                marginTop:8, marginBottom:14, padding:'18px',
                border:'1px dashed #d6d3d1', borderRadius:10, background:'#fff',
                display:'flex', alignItems:'center', justifyContent:'center', minHeight:90,
              }}>
                {logo
                  ? <img src={logo} alt={t('Logo-Vorschau', 'Logo preview')} style={{ maxHeight:80, maxWidth:'100%', objectFit:'contain' }} />
                  : <span style={{ fontSize:13, color:'#a8a29e' }}>{t('Noch kein Logo hinterlegt', 'No logo added yet')}</span>}
              </div>

              <div style={{ background:'#f5f5f4', border:'1px solid #e7e5e4', borderRadius:8, padding:'10px 14px', marginBottom:14 }}>
                <div style={{ fontSize:12, color:'#78716c', marginBottom:6 }}>{t('So sehen es die Beitragenden:', 'This is how contributors see it:')}</div>
                <PartnerBanner logoUrl={logo} />
              </div>

              <p style={{ fontSize:12, color:'#78716c', margin:'0 0 12px' }}>
                {t('PNG, JPG, SVG, WebP oder GIF · max. 1 MB. Querformat mit transparentem Hintergrund wirkt am besten.', 'PNG, JPG, SVG, WebP or GIF · max. 1 MB. Landscape format with a transparent background works best.')}
              </p>

              <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                <label className="secondary" style={{ fontSize:13, padding:'9px 16px', cursor:'pointer', display:'inline-block', borderRadius:8, border:'1px solid #d6d3d1' }}>
                  {t('📁 Logo auswählen', '📁 Choose logo')}
                  <input type="file" accept="image/*" onChange={onLogoFile} style={{ display:'none' }} />
                </label>
                <button onClick={() => saveLogo(logo)} disabled={busy || !logo} style={{ fontSize:13, padding:'9px 16px' }}>
                  {busy ? t('Wird gespeichert …', 'Saving …') : t('Speichern', 'Save')}
                </button>
                <button onClick={() => saveLogo(null)} disabled={busy || !logo} className="secondary" style={{ fontSize:13, padding:'9px 16px', color:'#dc2626', borderColor:'#fecaca' }}>
                  {t('Logo entfernen', 'Remove logo')}
                </button>
              </div>
              {logoSaved && <p style={{ fontSize:13, color:'#16a34a', marginTop:12, marginBottom:0 }}>{t('✓ Gespeichert.', '✓ Saved.')}</p>}
            </>
          )}
        </div>

        <form onSubmit={saveOwnPassword} style={{ ...S.card, marginTop:'1.25rem' }}>
          <Lbl>{t('Passwort ändern', 'Change password')}</Lbl>
          <p style={{ fontSize:12, color:'#78716c', margin:'4px 0 14px' }}>{PASSWORD_RULES_TEXT}</p>
          <Err msg={pwErr} />
          <div style={{ marginBottom:12 }}>
            <Lbl>{t('Aktuelles Passwort', 'Current password')}</Lbl>
            <input type="password" autoComplete="current-password" value={pwForm.current}
              onChange={e => setPwForm(f => ({ ...f, current: e.target.value }))} placeholder="••••" />
          </div>
          <div style={{ marginBottom:12 }}>
            <Lbl>{t('Neues Passwort', 'New password')}</Lbl>
            <input type="password" autoComplete="new-password" value={pwForm.next}
              onChange={e => setPwForm(f => ({ ...f, next: e.target.value }))} placeholder="••••" />
          </div>
          <div style={{ marginBottom:14 }}>
            <Lbl>{t('Neues Passwort wiederholen', 'Repeat new password')}</Lbl>
            <input type="password" autoComplete="new-password" value={pwForm.next2}
              onChange={e => setPwForm(f => ({ ...f, next2: e.target.value }))} placeholder="••••" />
          </div>
          <button type="submit" disabled={busy || !pwForm.current || !pwForm.next || !pwForm.next2} style={{ fontSize:13, padding:'9px 16px' }}>
            {busy ? t('Wird geändert …', 'Changing …') : t('Passwort ändern', 'Change password')}
          </button>
          {pwSaved && <p style={{ fontSize:13, color:'#16a34a', marginTop:12, marginBottom:0 }}>{t('✓ Passwort geändert.', '✓ Password changed.')}</p>}
        </form>
      </div>
    </div>
  )
}

// Standardwerte der Anlage-Maske („Neues Buch anlegen"). Gilt anwendungsweit für
// alle künftig angelegten Bücher; bestehende Bücher bleiben unberührt.
export function BookDefaultsView({ err, busy, bdForm, bdSaved, bdMsg, setBdForm, setView, logout, saveBookDefaults, resetBookDefaults }) {
  const t = useAdminT()
  const set = patch => setBdForm(f => ({ ...f, ...patch }))
  const setAddr = patch => setBdForm(f => ({ ...f, pickupAddress: { ...f.pickupAddress, ...patch } }))
  const toggleLang = code => setBdForm(f => {
    const cur = f.languages || []
    const next = cur.includes(code) ? cur.filter(l => l !== code) : [...cur, code]
    return { ...f, languages: next.length ? next : cur }   // mindestens eine Sprache
  })
  const Check = ({ on, onChange, title, text, hint }) => (
    <div style={{ marginBottom: 22 }}>
      <Lbl>{title}</Lbl>
      <label style={{ display:'flex', alignItems:'center', gap:10, cursor:'pointer', marginTop:8 }}>
        <input type="checkbox" checked={on} onChange={e => onChange(e.target.checked)} style={{ width:18, height:18, cursor:'pointer', accentColor:'#1c1917', flexShrink:0 }} />
        <span style={{ fontSize:14 }}>{text}</span>
      </label>
      {hint && <p style={{ fontSize:12, color:'#78716c', marginTop:6, marginLeft:28 }}>{hint}</p>}
    </div>
  )

  return (
    <div style={{ minHeight:'100vh', background:'#fafaf9' }}>
      <div style={{ background:'#fff', borderBottom:'1px solid #e7e5e4', padding:'14px 24px', position:'sticky', top:0, zIndex:50, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div style={{ display:'flex', alignItems:'center', gap:16 }}>
          <button className="ghost" onClick={() => setView('list')} style={{ fontSize:14, color:'#78716c' }}>{t('← Zurück', '← Back')}</button>
          <span style={{ fontWeight:700, fontSize:16 }}>Lebenswerk Admin</span>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <AdminLangToggle />
          <button className="secondary" onClick={logout} style={{ fontSize:13, padding:'7px 14px' }}>{t('Abmelden', 'Log out')}</button>
        </div>
      </div>

      <div style={{ maxWidth:640, margin:'2rem auto', padding:'0 1.5rem' }}>
        <h2 style={{ fontSize:22, fontWeight:700, marginBottom:4 }}>{t('Standardwerte für neue Bücher', 'Defaults for new books')}</h2>
        <p style={{ ...S.muted, marginBottom:'1.5rem' }}>
          {t('Mit diesen Werten ist die Maske „Neues Buch anlegen" vorbelegt. Beim Anlegen lässt sich jeder Wert weiterhin einzeln ändern. Die Standardwerte wirken nur auf künftige Bücher – bereits angelegte bleiben unverändert.', 'These values pre-fill the “Create new book” form. Each value can still be changed individually when creating a book. The defaults apply only to future books – existing ones stay unchanged.')}
        </p>
        <Err msg={err} />

        {!bdForm ? <p style={S.muted}>{t('Lädt …', 'Loading …')}</p> : (<>
          <div style={{ ...S.card, padding:'20px 20px 4px' }}>
            <div style={{ marginBottom:22 }}>
              <Lbl>{t('Buch-Variante', 'Book variant')}</Lbl>
              <div style={{ display:'grid', gridTemplateColumns:'1fr', gap:8, marginTop:8 }}>
                {BOOK_VARIANTS.map(v => (
                  <div
                    key={v.value}
                    onClick={() => set({ bookVariant: v.value })}
                    style={{
                      ...S.card, cursor:'pointer', padding:'14px',
                      borderColor: bdForm.bookVariant === v.value ? '#1c1917' : '#e7e5e4',
                      borderWidth: bdForm.bookVariant === v.value ? 2 : 1,
                    }}
                  >
                    <div style={{ fontWeight:600, fontSize:14, marginBottom:4 }}>{v.title}</div>
                    <div style={{ fontSize:13, color:'#78716c', lineHeight:1.5 }}>{v.sub}</div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ marginBottom:22 }}>
              <Lbl>{t('Sprachen für Beitragende', 'Languages for contributors')}</Lbl>
              <div style={{ display:'flex', gap:16, flexWrap:'wrap', marginTop:8 }}>
                {LANGUAGES.map(l => (
                  <label key={l.code} style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer' }}>
                    <input type="checkbox" checked={(bdForm.languages || []).includes(l.code)} onChange={() => toggleLang(l.code)} style={{ width:18, height:18, cursor:'pointer', accentColor:'#1c1917' }} />
                    <span style={{ fontSize:14 }}>{l.label}</span>
                  </label>
                ))}
              </div>
              <p style={{ fontSize:12, color:'#78716c', marginTop:6 }}>{t('Bei mehreren Sprachen wählen die Beitragenden zu Beginn selbst.', 'With multiple languages, contributors choose at the start themselves.')}</p>
            </div>

            <div style={{ marginBottom:22 }}>
              <Lbl>{t('Erfassungsfrist (Tage nach dem Termin)', 'Collection deadline (days after the date)')}</Lbl>
              <input
                type="number" min={0} max={90} step={1} value={bdForm.cutoffDays}
                onChange={e => { const v = e.target.value; set({ cutoffDays: v === '' ? '' : Math.max(0, Math.min(90, parseInt(v, 10) || 0)) }) }}
                style={{ width:120 }}
              />
              <p style={{ fontSize:12, color:'#78716c', marginTop:6 }}>{t('Bisheriger Standard: 7 Tage.', 'Previous default: 7 days.')}</p>
            </div>

            <Check
              on={bdForm.showContributors !== false}
              onChange={v => set({ showContributors: v })}
              title={t('Namensliste der Beitragenden im Buch', 'List of contributor names in the book')}
              text={t('Namen der Beitragenden am Ende des Buches drucken', 'Print the contributors’ names at the end of the book')}
              hint={t('Am Buchende erscheint eine Seite „Mitwirkende“ mit Namen und Beziehung.', 'At the end of the book a “Contributors” page appears with names and relationship.')}
            />
            <Check
              on={bdForm.showTranscript !== false}
              onChange={v => set({ showTranscript: v })}
              title={t('Transkript-Schalter im Sprach-Interview', 'Transcript toggle in the voice interview')}
              text={t('Beitragende dürfen das Transkript einblenden', 'Contributors may show the transcript')}
              hint={t('Das Interview startet immer ohne Transkript; diese Option blendet nur den Schalter dafür ein.', 'The interview always starts without a transcript; this option only shows the toggle for it.')}
            />
            <Check
              on={bdForm.photoUploadTab === true}
              onChange={v => set({ photoUploadTab: v })}
              title={t('Foto-Upload als Tab im Interview', 'Photo upload as a tab in the interview')}
              text={t('Foto-Upload schon während des Interviews anbieten', 'Offer photo upload already during the interview')}
              hint={t('Ohne diese Option können Beitragende keine Fotos hochladen.', 'Without this option, contributors cannot upload any photos.')}
            />
            <Check
              on={bdForm.showIntroVideo === true}
              onChange={v => set({ showIntroVideo: v })}
              title={t('Einführungsvideo', 'Intro video')}
              text={t('Einführungsvideo vor dem Sprach-Interview anzeigen', 'Show the intro video before the voice interview')}
              hint={t('Nur in der Kategorie Gedenkbuch wirksam.', 'Only effective in the memorial book category.')}
            />

            <div style={{ marginBottom:22 }}>
              <Lbl>{t('Nachfragen pro Katalogfrage (max.)', 'Follow-ups per catalog question (max.)')}</Lbl>
              <input
                type="number" min={0} max={30} step={1} value={bdForm.followups}
                onChange={e => { const v = e.target.value; set({ followups: v === '' ? '' : Math.max(0, Math.min(30, parseInt(v, 10) || 0)) }) }}
                style={{ width:120 }}
              />
              <p style={{ fontSize:12, color:'#78716c', marginTop:6 }}>{t('Gilt nur, wenn beim Anlegen ein Fragenkatalog gewählt wird. Bisheriger Standard: 7.', 'Applies only if a question catalog is chosen when creating. Previous default: 7.')}</p>
            </div>

            <div style={{ marginBottom:22 }}>
              <Lbl>{t('Grafikstil der Bilder', 'Graphic style of the images')}</Lbl>
              <ImageStylePicker value={bdForm.imageStyle} onChange={k => set({ imageStyle: k })} />
            </div>

            <div style={{ marginBottom:22 }}>
              <Lbl>{t('Buchlayout (Schrift & Design)', 'Book layout (font & design)')}</Lbl>
              <BookLayoutPicker value={bdForm.bookLayout} onChange={k => set({ bookLayout: k })} />
            </div>

            <div style={{ marginBottom:22 }}>
              <Lbl>{t('Sammelbestellungs-Adresse', 'Bulk order address')}</Lbl>
              <p style={{ fontSize:12, color:'#78716c', margin:'2px 0 10px' }}>
                {t('Wird in jedes neue Buch übernommen – sinnvoll, wenn die gedruckten Bücher immer an dieselbe Adresse gehen. Leer lassen, wenn nicht gewünscht.', 'Applied to every new book – useful if the printed books always go to the same address. Leave empty if not wanted.')}
              </p>
              <input value={bdForm.pickupAddress?.name || ''} onChange={e => setAddr({ name: e.target.value })} placeholder={t('Name / Empfänger', 'Name / recipient')} style={{ marginBottom:8 }} />
              <input value={bdForm.pickupAddress?.addon || ''} onChange={e => setAddr({ addon: e.target.value })} placeholder={t('Adresszusatz (z. B. c/o, Firma)', 'Address addition (e.g. c/o, company)')} style={{ marginBottom:8 }} />
              <input value={bdForm.pickupAddress?.street || ''} onChange={e => setAddr({ street: e.target.value })} placeholder={t('Straße und Hausnummer', 'Street and house number')} style={{ marginBottom:8 }} />
              <div style={{ display:'flex', gap:8, marginBottom:8 }}>
                <input value={bdForm.pickupAddress?.zip || ''} onChange={e => setAddr({ zip: e.target.value })} placeholder={t('PLZ', 'ZIP')} style={{ flex:'0 0 120px' }} />
                <input value={bdForm.pickupAddress?.city || ''} onChange={e => setAddr({ city: e.target.value })} placeholder={t('Ort', 'City')} style={{ flex:1 }} />
              </div>
              <input value={bdForm.pickupAddress?.country || ''} onChange={e => setAddr({ country: e.target.value })} placeholder={t('Land', 'Country')} />
            </div>
          </div>

          <div style={{ display:'flex', gap:10, alignItems:'center', margin:'20px 0 40px' }}>
            <button onClick={saveBookDefaults} disabled={busy} style={{ fontSize:14, padding:'10px 18px' }}>
              {busy ? t('Wird gespeichert …', 'Saving …') : t('Als Standard speichern', 'Save as default')}
            </button>
            {bdSaved && (
              <button className="secondary" onClick={resetBookDefaults} disabled={busy} style={{ fontSize:13, padding:'9px 14px' }}>
                {t('Auf Auslieferungszustand zurücksetzen', 'Reset to factory defaults')}
              </button>
            )}
            {bdMsg && <span style={{ fontSize:13, color:'#16a34a' }}>✓ {bdMsg}</span>}
          </div>
        </>)}
      </div>
    </div>
  )
}

export function CreatedView({ createdCode, copied, token, logout, copyInvite, copyQR, loadMemorials }) {
    const t = useAdminT()
    const inviteUrl = `${window.location.origin}/?code=${createdCode}`
    return (
      <div style={{ minHeight:'100vh', background:'#fafaf9' }}>
        <div style={{ background:'#fff', borderBottom:'1px solid #e7e5e4', padding:'14px 24px', position: 'sticky', top: 0, zIndex: 50, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div style={{ display:'flex', alignItems:'center', gap:16 }}>
            <button className="ghost" onClick={() => loadMemorials(token)} style={{ fontSize:14, color:'#78716c' }}>{t('← Zurück', '← Back')}</button>
            <span style={{ fontWeight: 700, fontSize: 16 }}>Lebenswerk Admin</span>
          </div>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            <AdminLangToggle />
            <button className="secondary" onClick={logout} style={{ fontSize:13, padding:'7px 14px' }}>{t('Abmelden', 'Log out')}</button>
          </div>
        </div>
        <div style={{ maxWidth: 540, margin: '2rem auto', padding: '0 1.5rem', textAlign:'center' }}>
          <div style={{ fontSize: 40, marginBottom: '1rem' }}>✅</div>
          <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>{t('Buch erstellt', 'Book created')}</h2>
          <p style={{ ...S.muted, marginBottom: '1.5rem' }}>{t('Teilen Sie diesen Link oder den QR-Code mit Familie und Freunden:', 'Share this link or the QR code with family and friends:')}</p>
          <div style={{ ...S.card, marginBottom: '1.5rem' }}>
            <Lbl>{t('Einladungslink', 'Invitation link')}</Lbl>
            <a
              href={inviteUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display:'block', fontFamily:'monospace', fontSize:13, wordBreak:'break-all', color:'#1d4ed8', margin:'6px 0 10px', textDecoration:'underline' }}
            >{inviteUrl}</a>
            <button className="secondary" onClick={() => copyInvite(createdCode)} style={{ fontSize: 13 }}>
              {copied === createdCode ? t('✓ Kopiert', '✓ Copied') : t('📋 Link kopieren', '📋 Copy link')}
            </button>
            <div style={{ marginTop:16, display:'flex', flexDirection:'column', alignItems:'center', gap:10 }}>
              <img
                src={qrCodeUrl(inviteUrl, 240)}
                alt={`QR-Code für ${inviteUrl}`}
                width={240}
                height={240}
                style={{ borderRadius:8, background:'#fff' }}
              />
              <button className="secondary" onClick={() => copyQR(createdCode)} style={{ fontSize: 13 }}>
                {copied === `qr-${createdCode}` ? t('✓ QR kopiert', '✓ QR copied') : t('📋 QR-Code kopieren', '📋 Copy QR code')}
              </button>
            </div>
          </div>
          <button onClick={() => loadMemorials(token)} style={{ padding: '11px 28px' }}>{t('Zur Übersicht', 'To overview')}</button>
        </div>
      </div>
    )
}

export function UsersView({ err, usersData, createdInvite, userForm, busy, logout, setView, resetUserPassword, copyInviteLink, regenerateInvite, removeUser, saveUserCats, setCreatedInvite, setUserForm, toggleUserFormCat, submitUser }) {
  const t = useAdminT()
  return (
    <div style={{ minHeight:'100vh', background:'#fafaf9' }}>
      <div style={{ background: '#fff', borderBottom: '1px solid #e7e5e4', padding: '14px 24px', position: 'sticky', top: 0, zIndex: 50, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div style={{ display:'flex', alignItems:'center', gap:16 }}><button className="ghost" onClick={() => setView('list')} style={{ fontSize:14, color:'#78716c' }}>{t('← Zurück', '← Back')}</button><span style={{ fontWeight: 700, fontSize: 16 }}>Lebenswerk Admin</span></div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <AdminLangToggle />
          <button className="secondary" onClick={logout} style={{ fontSize: 13, padding: '7px 14px' }}>{t('Abmelden', 'Log out')}</button>
        </div>
      </div>
      <div style={{ maxWidth: 720, margin: '2rem auto', padding: '0 1.5rem' }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>{t('Benutzer', 'Users')}</h2>
        <p style={{ ...S.muted, marginBottom: '1.5rem' }}>{t('Pro Benutzer legen Sie fest, welche Produktkategorien er anlegen darf.', 'For each user you define which product categories they may create.')}</p>
        <Err msg={err} />

        {/* Bestehende Benutzer */}
        <div style={{ display:'flex', flexDirection:'column', gap:10, marginBottom:24 }}>
          {usersData.users.map(u => (
            <div key={u.id} style={{ ...S.card }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10, gap:12, flexWrap:'wrap' }}>
                <div>
                  <strong style={{ fontSize:15 }}>{u.username}</strong>
                  {u.is_admin && <span style={{ fontSize:11, marginLeft:8, color:'#1d4ed8' }}>Admin</span>}
                  {!u.has_password && <span style={{ fontSize:11, marginLeft:8, color:'#b45309' }}>{t('Einladung offen', 'Invitation pending')}</span>}
                </div>
                <div style={{ display:'flex', gap:8 }}>
                  {u.has_password ? (
                    <button className="secondary" onClick={() => resetUserPassword(u)} style={{ fontSize:12, padding:'5px 10px' }}>{t('Passwort', 'Password')}</button>
                  ) : (
                    <>
                      <button className="secondary" onClick={() => copyInviteLink(u)} style={{ fontSize:12, padding:'5px 10px' }}>{t('Link kopieren', 'Copy link')}</button>
                      <button className="secondary" onClick={() => regenerateInvite(u)} style={{ fontSize:12, padding:'5px 10px' }}>{t('Neu senden', 'Resend')}</button>
                    </>
                  )}
                  <button className="secondary" onClick={() => removeUser(u)} style={{ fontSize:12, padding:'5px 10px', color:'#dc2626', borderColor:'#fecaca' }}>{t('Löschen', 'Delete')}</button>
                </div>
              </div>
              {u.is_admin ? (
                <p style={{ ...S.muted, fontSize:12, margin:0 }}>{t('Administrator – sieht alle Produktkategorien.', 'Administrator – sees all product categories.')}</p>
              ) : (
                <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
                  {CATEGORY_ORDER.map(slug => {
                    const on = (u.allowed_categories || []).includes(slug)
                    return (
                      <span key={slug} onClick={() => saveUserCats(u, slug)}
                        style={{ cursor:'pointer', fontSize:12, padding:'5px 10px', borderRadius:999, border:'1px solid',
                          borderColor: on ? '#1c1917' : '#e7e5e4', background: on ? '#1c1917' : '#fff', color: on ? '#fafaf9' : '#78716c' }}>
                        {CATEGORIES[slug].label}
                      </span>
                    )
                  })}
                </div>
              )}
            </div>
          ))}
          {usersData.users.length === 0 && <p style={S.muted}>{t('Noch keine Benutzer.', 'No users yet.')}</p>}
        </div>

        {/* Einladungslink des zuletzt angelegten / neu erzeugten Benutzers */}
        {createdInvite && (
          <div style={{ ...S.card, marginBottom:24, borderColor:'#bbf7d0', background:'#f0fdf4' }}>
            <Lbl>{t(`Einladung für „${createdInvite.username}"`, `Invitation for “${createdInvite.username}”`)}</Lbl>
            {createdInvite.emailSent === true && (
              <p style={{ fontSize:13, color:'#3f6212', margin:'4px 0 6px', fontWeight:600 }}>{t(`✓ Einladungs-E-Mail an ${createdInvite.username} gesendet (BCC an den Betreiber).`, `✓ Invitation email sent to ${createdInvite.username} (BCC to the operator).`)}</p>
            )}
            {createdInvite.emailSent === false && (
              <p style={{ fontSize:13, color:'#b45309', margin:'4px 0 6px' }}>{t(`⚠ Die E-Mail konnte nicht gesendet werden${createdInvite.emailError ? ` (${createdInvite.emailError})` : ''}. Bitte den Link unten manuell senden.`, `⚠ The email could not be sent${createdInvite.emailError ? ` (${createdInvite.emailError})` : ''}. Please send the link below manually.`)}</p>
            )}
            <p style={{ fontSize:13, color:'#3f6212', margin:'4px 0 10px' }}>
              {t('Alternativ diesen Link an den Benutzer schicken. Beim ersten Aufruf vergibt er sich selbst ein Passwort. (14 Tage gültig, wurde in die Zwischenablage kopiert.)', 'Alternatively send this link to the user. On first opening they set their own password. (Valid 14 days, copied to the clipboard.)')}
            </p>
            {createdInvite.demo && (
              <p style={{ fontSize:12, color:'#3f6212', margin:'0 0 10px' }}>{t(`✓ ${createdInvite.demo.memorials} Demo-Bücher mit ${createdInvite.demo.contributions} Beiträgen angelegt.`, `✓ ${createdInvite.demo.memorials} demo books with ${createdInvite.demo.contributions} contributions created.`)}</p>
            )}
            {createdInvite.demoError && (
              <p style={{ fontSize:12, color:'#b45309', margin:'0 0 10px' }}>{t(`Hinweis: Demo-Daten konnten nicht angelegt werden (${createdInvite.demoError}).`, `Note: demo data could not be created (${createdInvite.demoError}).`)}</p>
            )}
            <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
              <a href={createdInvite.url} style={{ fontSize:13, wordBreak:'break-all', flex:'1 1 220px' }}>{createdInvite.url}</a>
              <button className="secondary" onClick={() => { navigator.clipboard?.writeText(createdInvite.url) }} style={{ fontSize:12, padding:'5px 10px' }}>{t('Kopieren', 'Copy')}</button>
              <button className="secondary" onClick={() => setCreatedInvite(null)} style={{ fontSize:12, padding:'5px 10px' }}>{t('Schließen', 'Close')}</button>
            </div>
          </div>
        )}

        {/* Neuer Benutzer */}
        <div style={{ ...S.card }}>
          <Lbl>{t('Neuer Benutzer – E-Mail-Adresse', 'New user – email address')}</Lbl>
          <input type="email" value={userForm.username} onChange={e => setUserForm({ ...userForm, username: e.target.value })} placeholder={t('name@beispiel.de', 'name@example.com')} style={{ marginBottom:6 }} />
          <p style={{ ...S.muted, fontSize:12, margin:'0 0 12px' }}>
            {t('Die E-Mail-Adresse ist zugleich der Login. Nach dem Anlegen wird automatisch eine Einladungs-E-Mail versendet, über die sich der Benutzer selbst ein Passwort vergibt (kein Passwort nötig). Den Link können Sie zusätzlich kopieren.', 'The email address is also the login. After creation an invitation email is sent automatically, via which the user sets their own password (no password needed). You can also copy the link.')}
          </p>
          <Lbl>{t('Erlaubte Produktkategorien', 'Allowed product categories')}</Lbl>
          <div style={{ display:'flex', flexWrap:'wrap', gap:8, margin:'6px 0 14px' }}>
            {CATEGORY_ORDER.map(slug => {
              const on = userForm.cats.includes(slug)
              return (
                <span key={slug} onClick={() => toggleUserFormCat(slug)}
                  style={{ cursor:'pointer', fontSize:12, padding:'5px 10px', borderRadius:999, border:'1px solid',
                    borderColor: on ? '#1c1917' : '#e7e5e4', background: on ? '#1c1917' : '#fff', color: on ? '#fafaf9' : '#78716c' }}>
                  {CATEGORIES[slug].label}
                </span>
              )
            })}
          </div>
          <label style={{ display:'flex', alignItems:'flex-start', gap:8, margin:'4px 0 16px', cursor:'pointer', fontSize:14 }}>
            <input type="checkbox" checked={userForm.demo} onChange={e => setUserForm({ ...userForm, demo: e.target.checked })} style={{ marginTop:3 }} />
            <span>
              <strong>{t('Demo-Daten anreichern', 'Add demo data')}</strong>
              <span style={{ ...S.muted, display:'block', fontSize:12 }}>{t('Legt dem Benutzer 3 Beispiel-Trauerbücher mit je 10 Beitragenden an; das erste Buch ist bereits in beiden Varianten produziert.', 'Creates 3 sample memorial books with 10 contributors each for the user; the first book is already produced in both variants.')}</span>
            </span>
          </label>
          <button onClick={submitUser} disabled={busy || !userForm.username.trim()} style={{ fontSize:14, padding:'9px 16px' }}>{busy ? t('Wird angelegt …', 'Creating …') : t('Benutzer anlegen', 'Create user')}</button>
        </div>
      </div>
    </div>
  )
}

export function CatalogsView({ err, catalogForm, catalogs, busy, logout, setView, setCatalogForm, saveCatalog, setErr, newCatalog, editCatalog, removeCatalog }) {
  const t = useAdminT()
  return (
    <div style={{ minHeight:'100vh', background:'#fafaf9' }}>
      <div style={{ background: '#fff', borderBottom: '1px solid #e7e5e4', padding: '14px 24px', position: 'sticky', top: 0, zIndex: 50, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div style={{ display:'flex', alignItems:'center', gap:16 }}><button className="ghost" onClick={() => { setCatalogForm(null); setView('list') }} style={{ fontSize:14, color:'#78716c' }}>{t('← Zurück', '← Back')}</button><span style={{ fontWeight: 700, fontSize: 16 }}>Lebenswerk Admin</span></div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <AdminLangToggle />
          <button className="secondary" onClick={logout} style={{ fontSize: 13, padding: '7px 14px' }}>{t('Abmelden', 'Log out')}</button>
        </div>
      </div>
      <div style={{ maxWidth: 760, margin: '2rem auto', padding: '0 1.5rem' }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>{t('Fragenkataloge', 'Question catalogs')}</h2>
        <p style={{ ...S.muted, marginBottom: '1.5rem' }}>
          {t('Vordefinierte Kataloge aus Kapiteln und Fragen. Manager wählen sie beim Anlegen eines Buchs (nur für passende Produktkategorien); die KI führt das Interview dann daran entlang.', 'Predefined catalogs of chapters and questions. Managers select them when creating a book (only for matching product categories); the AI then conducts the interview along them.')}
        </p>
        <Err msg={err} />

        {catalogForm ? (() => {
          const cf = catalogForm
          const setCf         = patch      => setCatalogForm(f => ({ ...f, ...patch }))
          const setChapter    = (ci, patch)=> setCatalogForm(f => { const chapters=[...f.chapters]; chapters[ci]={...chapters[ci],...patch}; return { ...f, chapters } })
          const setQuestion   = (ci,qi,val)=> setCatalogForm(f => { const chapters=[...f.chapters]; const questions=[...chapters[ci].questions]; questions[qi]=val; chapters[ci]={...chapters[ci],questions}; return { ...f, chapters } })
          const addQuestion   = ci         => setCatalogForm(f => { const chapters=[...f.chapters]; chapters[ci]={...chapters[ci],questions:[...chapters[ci].questions,'']}; return { ...f, chapters } })
          const removeQuestion= (ci,qi)    => setCatalogForm(f => { const chapters=[...f.chapters]; const questions=chapters[ci].questions.filter((_,i)=>i!==qi); chapters[ci]={...chapters[ci],questions:questions.length?questions:['']}; return { ...f, chapters } })
          const addChapter    = ()         => setCatalogForm(f => ({ ...f, chapters:[...f.chapters,{title:'',questions:['']}] }))
          const removeChapter = ci         => setCatalogForm(f => { const chapters=f.chapters.filter((_,i)=>i!==ci); return { ...f, chapters: chapters.length?chapters:[{title:'',questions:['']}] } })
          const toggleCat     = slug       => setCatalogForm(f => ({ ...f, cats: f.cats.includes(slug)?f.cats.filter(s=>s!==slug):[...f.cats,slug] }))
          return (
            <div style={{ ...S.card, marginBottom:24 }}>
              <Lbl>{cf.id ? t('Katalog bearbeiten', 'Edit catalog') : t('Neuer Katalog', 'New catalog')}</Lbl>
              <input value={cf.name} onChange={e=>setCf({ name:e.target.value })} placeholder={t('Name des Katalogs', 'Catalog name')} style={{ marginBottom:14 }} />
              <Lbl>{t('Produktkategorien', 'Product categories')}</Lbl>
              <div style={{ display:'flex', flexWrap:'wrap', gap:8, margin:'6px 0 16px' }}>
                {CATEGORY_ORDER.map(slug => {
                  const on = cf.cats.includes(slug)
                  return (
                    <span key={slug} onClick={()=>toggleCat(slug)}
                      style={{ cursor:'pointer', fontSize:12, padding:'5px 10px', borderRadius:999, border:'1px solid',
                        borderColor: on?'#1c1917':'#e7e5e4', background: on?'#1c1917':'#fff', color: on?'#fafaf9':'#78716c' }}>
                      {CATEGORIES[slug].label}
                    </span>
                  )
                })}
              </div>
              {cf.chapters.map((ch, ci) => (
                <div key={ci} style={{ border:'1px solid #e7e5e4', borderRadius:8, padding:12, marginBottom:12 }}>
                  <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:8 }}>
                    <span style={{ fontSize:12, color:'#78716c', fontWeight:600, whiteSpace:'nowrap' }}>{t('Kapitel', 'Chapter')} {ci+1}</span>
                    <input value={ch.title} onChange={e=>setChapter(ci,{ title:e.target.value })} placeholder={t('Kapitel-Titel', 'Chapter title')} style={{ flex:1 }} />
                    <button className="secondary" onClick={()=>removeChapter(ci)} title={t('Kapitel entfernen', 'Remove chapter')} style={{ fontSize:12, padding:'5px 10px', color:'#dc2626', borderColor:'#fecaca' }}>✕</button>
                  </div>
                  {ch.questions.map((q, qi) => (
                    <div key={qi} style={{ display:'flex', gap:8, alignItems:'center', marginBottom:6, marginLeft:12 }}>
                      <span style={{ fontSize:12, color:'#a8a29e', whiteSpace:'nowrap' }}>{qi+1}.</span>
                      <input value={q} onChange={e=>setQuestion(ci,qi,e.target.value)} placeholder={t('Frage', 'Question')} style={{ flex:1 }} />
                      <button className="secondary" onClick={()=>removeQuestion(ci,qi)} title={t('Frage entfernen', 'Remove question')} style={{ fontSize:12, padding:'4px 9px' }}>✕</button>
                    </div>
                  ))}
                  <button className="secondary" onClick={()=>addQuestion(ci)} style={{ fontSize:12, padding:'5px 10px', marginLeft:12, marginTop:4 }}>{t('+ Frage', '+ Question')}</button>
                </div>
              ))}
              <button className="secondary" onClick={addChapter} style={{ fontSize:13, padding:'7px 14px', marginBottom:16 }}>{t('+ Kapitel', '+ Chapter')}</button>
              <div style={{ display:'flex', gap:8 }}>
                <button onClick={saveCatalog} disabled={busy || !cf.name.trim()} style={{ fontSize:14, padding:'9px 16px' }}>{busy?t('Speichert …', 'Saving …'):t('Speichern', 'Save')}</button>
                <button className="secondary" onClick={()=>{ setCatalogForm(null); setErr('') }} style={{ fontSize:14, padding:'9px 16px' }}>{t('Abbrechen', 'Cancel')}</button>
              </div>
            </div>
          )
        })() : (
          <button onClick={newCatalog} style={{ fontSize:14, padding:'9px 16px', marginBottom:20 }}>{t('+ Neuer Katalog', '+ New catalog')}</button>
        )}

        {!catalogForm && (
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            {catalogs.map(c => (
              <div key={c.id} style={{ ...S.card }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12, flexWrap:'wrap' }}>
                  <div>
                    <strong style={{ fontSize:15 }}>{c.name}</strong>
                    <span style={{ fontSize:12, color:'#78716c', marginLeft:8 }}>
                      {(c.chapters||[]).length} {t('Kapitel', 'chapters')} · {(c.chapters||[]).reduce((n,ch)=>n+((ch.questions||[]).length),0)} {t('Fragen', 'questions')}
                    </span>
                    <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginTop:6 }}>
                      {(c.product_categories||[]).map(slug => CATEGORIES[slug] && (
                        <span key={slug} style={{ fontSize:11, padding:'3px 8px', borderRadius:999, background:'#f5f5f4', color:'#57534e' }}>{CATEGORIES[slug].label}</span>
                      ))}
                      {(c.product_categories||[]).length===0 && <span style={{ fontSize:11, color:'#b45309' }}>{t('keiner Kategorie zugeordnet – für Manager nicht wählbar', 'not assigned to any category – not selectable for managers')}</span>}
                    </div>
                  </div>
                  <div style={{ display:'flex', gap:8 }}>
                    <button className="secondary" onClick={()=>editCatalog(c)} style={{ fontSize:12, padding:'5px 10px' }}>{t('Bearbeiten', 'Edit')}</button>
                    <button className="secondary" onClick={()=>removeCatalog(c)} style={{ fontSize:12, padding:'5px 10px', color:'#dc2626', borderColor:'#fecaca' }}>{t('Löschen', 'Delete')}</button>
                  </div>
                </div>
              </div>
            ))}
            {catalogs.length===0 && <p style={S.muted}>{t('Noch keine Kataloge. Legen Sie einen an.', 'No catalogs yet. Create one.')}</p>}
          </div>
        )}
      </div>
    </div>
  )
}

export function ListView({ showCategoryColumn, auth, memorials, filters, sort, myName, myUid, loading, filterCol, hoveredRow, err, deletingId, setSort, setFilters, setFilterCol, setHoveredRow, loadUsers, setErr, setView, loadAudit, loadCatalogs, setCatalogForm, loadRecipients, setReportMsg, loadFeedback, openSettings, openBookDefaults, logout, startCreate, openMemorial, openCosts, handleDelete }) {
    const t = useAdminT()
    // Sortierbare + filterbare Spalten (Reihenfolge = Spaltenreihenfolge).
    //  val  = Sortierwert,  disp = angezeigter/filterbarer Wert (String)
    const sortCols = [
      { key: 'name',      label: t('Name', 'Name'),          val: m => (m.name || '').toLowerCase(), disp: m => m.name || '—' },
      ...(showCategoryColumn ? [{ key: 'category', label: t('Kategorie', 'Category'), val: m => getCategory(m.product_category).label.toLowerCase(), disp: m => getCategory(m.product_category).label }] : []),
      ...(auth.admin ? [{ key: 'owner', label: t('Inhaber', 'Owner'), val: m => (m.owner_username || '').toLowerCase(), disp: m => m.owner_username || '—' }] : []),
      { key: 'organizer', label: t('Organisator', 'Organizer'),   val: m => (m.organizer || '').toLowerCase(), disp: m => m.organizer || '—' },
      { key: 'variant',   label: t('Variante', 'Variant'),      val: m => m.book_variant || 0, disp: m => m.book_variant ? t(`Variante ${m.book_variant}`, `Variant ${m.book_variant}`) : '—' },
      { key: 'cutoff',    label: t('Erfassung bis', 'Collection until'), val: m => { const d = cutoffDate(m.funeral_date, cutoffDays(m)); return d ? d.getTime() : Infinity }, disp: m => cutoffString(m.funeral_date, cutoffDays(m)) },
      { key: 'answers',   label: t('Antworten', 'Responses'),     val: m => m.answer_count || 0, disp: m => `${m.answer_count || 0} ${t('Antworten', 'responses')}` },
      ...(auth.admin ? [{ key: 'cost', label: t('Kosten', 'Cost'), val: m => m.cost_total_eur || 0, disp: m => formatEurSum(m.cost_total_eur) }] : []),
    ]
    const colByKey = k => sortCols.find(c => c.key === k) || sortCols[0]
    const distinctVals = col => [...new Set(memorials.map(col.disp))].sort((a, b) => String(a).localeCompare(String(b), 'de', { numeric: true }))
    // Sichtbarkeit: ein Buch passt, wenn es in JEDER aktiven Filterspalte einen
    // ausgewählten Wert hat. Fehlt der Filtereintrag, ist die Spalte ungefiltert.
    const visibleMemorials = memorials.filter(m => sortCols.every(c => {
      const sel = filters[c.key]
      return !sel || sel.includes(c.disp(m))
    }))
    const activeCol = colByKey(sort.key)
    const sortedMemorials = [...visibleMemorials].sort((a, b) => {
      const va = activeCol.val(a), vb = activeCol.val(b)
      const cmp = (typeof va === 'number' && typeof vb === 'number')
        ? va - vb
        : String(va).localeCompare(String(vb), 'de')
      return sort.dir === 'asc' ? cmp : -cmp
    })
    const toggleSort = key => setSort(s => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }))

    // Filter-Helfer (filters[key] = Liste erlaubter disp-Werte; fehlt = alle).
    const filterActive = key => { const sel = filters[key]; return sel && sel.length < distinctVals(colByKey(key)).length }
    const valChecked = (key, v) => { const sel = filters[key]; return !sel || sel.includes(v) }
    const allChecked = key => { const sel = filters[key]; return !sel || sel.length === distinctVals(colByKey(key)).length }
    const toggleVal = (key, v) => setFilters(f => {
      const all = distinctVals(colByKey(key))
      const cur = f[key] ? [...f[key]] : [...all]
      const i = cur.indexOf(v)
      if (i >= 0) cur.splice(i, 1); else cur.push(v)
      if (cur.length === all.length) { const n = { ...f }; delete n[key]; return n } // alle = kein Filter
      return { ...f, [key]: cur }
    })
    const toggleAll = key => setFilters(f => {
      if (allChecked(key)) return { ...f, [key]: [] }        // alle abwählen
      const n = { ...f }; delete n[key]; return n             // alle anwählen = kein Filter
    })
    return (
    <div style={{ minHeight: '100vh', background: '#fafaf9' }}>
      <div style={{ background: '#fff', borderBottom: '1px solid #e7e5e4', padding: '14px 24px', position: 'sticky', top: 0, zIndex: 50, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <span style={{ fontWeight: 700, fontSize: 16 }}>Lebenswerk Admin</span>
          <span style={{ fontSize: 13, color: '#78716c', marginLeft: 12 }}>
            {visibleMemorials.length < memorials.length ? `${visibleMemorials.length} / ${memorials.length}` : memorials.length} {memorials.length === 1 ? t('Buch', 'book') : t('Bücher', 'books')}
          </span>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <span style={{ fontSize: 13, color: '#78716c', marginRight: 4 }}>
            {t('Angemeldet als', 'Signed in as')} <strong style={{ color:'#1c1917', fontWeight:600 }}>{myName}</strong>
          </span>
          {auth.admin && (
            <button className="secondary" onClick={() => { loadUsers(); setErr(''); setView('users') }} style={{ fontSize: 13, padding: '7px 14px' }}>{t('Benutzer', 'Users')}</button>
          )}
          {auth.admin && (
            <button className="secondary" onClick={() => { loadAudit(); setErr(''); setView('audit') }} style={{ fontSize: 13, padding: '7px 14px' }}>{t('Audit-Log', 'Audit log')}</button>
          )}
          {auth.admin && (
            <button className="secondary" onClick={() => { loadCatalogs(); setCatalogForm(null); setErr(''); setView('catalogs') }} style={{ fontSize: 13, padding: '7px 14px' }}>{t('Fragenkataloge', 'Question catalogs')}</button>
          )}
          {auth.admin && (
            <button className="secondary" onClick={openBookDefaults} style={{ fontSize: 13, padding: '7px 14px' }}>{t('Standardwerte', 'Defaults')}</button>
          )}
          {auth.admin && (
            <button className="secondary" onClick={() => { loadRecipients(); setReportMsg(''); setErr(''); setView('reports') }} style={{ fontSize: 13, padding: '7px 14px' }}>{t('Report', 'Report')}</button>
          )}
          {auth.admin && (
            <button className="secondary" onClick={() => { loadFeedback(); setErr(''); setView('quality') }} style={{ fontSize: 13, padding: '7px 14px' }}>{t('Qualität', 'Quality')}</button>
          )}
          {myUid && (
            <button className="secondary" onClick={openSettings} style={{ fontSize: 13, padding: '7px 14px' }}>{t('Einstellungen', 'Settings')}</button>
          )}
          <AdminLangToggle />
          <button className="secondary" onClick={logout} style={{ fontSize: 13, padding: '7px 14px' }}>{t('Abmelden', 'Log out')}</button>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: '2rem auto', padding: '0 1.5rem' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1.25rem', gap:12 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700 }}>{t('Alle Bücher', 'All books')}</h2>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            {Object.keys(filters).length > 0 && (
              <button className="secondary" onClick={() => setFilters({})} style={{ fontSize:13, padding:'8px 12px' }}>{t('Filter zurücksetzen', 'Reset filters')}</button>
            )}
            <button onClick={startCreate} style={{ fontSize:14, padding:'9px 16px' }}>
              {t('+ Neues Buch', '+ New book')}
            </button>
          </div>
        </div>
        <Err msg={err} />
        {loading ? (
          <p style={{ color: '#78716c', fontSize: 14 }}>{t('Wird geladen …', 'Loading …')}</p>
        ) : memorials.length === 0 ? (
          <div style={{ ...S.card, textAlign:'center', padding:'2rem' }}>
            <p style={S.muted}>{t('Noch keine Bücher angelegt. Beginnen Sie mit „+ Neues Buch".', 'No books yet. Start with “+ New book”.')}</p>
          </div>
        ) : (
          <>
            {filterCol && <div onClick={() => setFilterCol(null)} style={{ position: 'fixed', inset: 0, zIndex: 20 }} />}
          <div style={{ background: '#fff', border: '1px solid #e7e5e4', borderRadius: 12, overflow: 'visible' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {sortCols.map(c => (
                    <th key={c.key} style={{ ...th, whiteSpace: 'nowrap', position: 'relative', zIndex: filterCol === c.key ? 40 : undefined }}>
                      <span onClick={() => toggleSort(c.key)} title={t('Spalte sortieren', 'Sort column')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                        {c.label}{sort.key === c.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ' ⇅'}
                      </span>
                      <span onClick={(e) => { e.stopPropagation(); setFilterCol(k => k === c.key ? null : c.key) }}
                            title={t('Spalte filtern', 'Filter column')}
                            style={{ marginLeft: 6, cursor: 'pointer', display: 'inline-flex', verticalAlign: 'middle' }}>
                        <svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M3 4h18v2.2l-7 7v6.3l-4-2.2v-4.1l-7-7z" fill={filterActive(c.key) ? '#1d4ed8' : '#a8a29e'} />
                        </svg>
                      </span>
                      {filterCol === c.key && (
                        <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 30, marginTop: 4, background: '#fff', border: '1px solid #e7e5e4', borderRadius: 8, boxShadow: '0 8px 28px rgba(0,0,0,.14)', padding: 6, minWidth: 240, maxWidth: 360, maxHeight: 320, overflowY: 'auto', textAlign: 'left', textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>
                          <label style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-start', padding: '4px 6px', fontSize: 13, fontWeight: 600, color: '#1c1917', cursor: 'pointer' }}>
                            <input type="checkbox" checked={allChecked(c.key)}
                                   ref={el => { if (el) el.indeterminate = !allChecked(c.key) && (filters[c.key]?.length > 0) }}
                                   onChange={() => toggleAll(c.key)} style={{ flexShrink: 0, margin: 0, width: 15, height: 15 }} />
                            <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>{t('Alle', 'All')}</span>
                          </label>
                          <div style={{ borderTop: '1px solid #f5f5f4', margin: '4px 0' }} />
                          {distinctVals(c).map(v => (
                            <label key={v} style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-start', padding: '4px 6px', fontSize: 13, color: '#44403c', cursor: 'pointer' }}>
                              <input type="checkbox" checked={valChecked(c.key, v)} onChange={() => toggleVal(c.key, v)} style={{ flexShrink: 0, margin: 0, width: 15, height: 15 }} />
                              <span style={{ flex: 1, minWidth: 0, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={v}>{v}</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </th>
                  ))}
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {sortedMemorials.map(m => {
                  const isHover    = hoveredRow?.id === m.id
                  const mainHover  = isHover && hoveredRow.zone === 'main'
                  const costHover  = isHover && hoveredRow.zone === 'cost'
                  const MAIN_BG    = '#fef3c7' // warm amber
                  const COST_BG    = '#dbeafe' // cool blue
                  const mainCellBg = mainHover ? MAIN_BG : ''
                  const mainCell   = { ...col, cursor:'pointer', background: mainCellBg, transition:'background .1s' }
                  const enterMain  = () => setHoveredRow({ id: m.id, zone: 'main' })
                  const leaveRow   = () => setHoveredRow(null)
                  return (
                    <tr key={m.id}>
                      <td style={{ ...mainCell, fontWeight: 600 }}                       onMouseEnter={enterMain} onMouseLeave={leaveRow} onClick={() => openMemorial(m)}>{m.name || <span style={{ color:'#a8a29e', fontWeight:400 }}>{t('Name folgt', 'Name to follow')}</span>}</td>
                      {showCategoryColumn && (
                        <td style={{ ...mainCell, color:'#78716c', whiteSpace:'nowrap' }}     onMouseEnter={enterMain} onMouseLeave={leaveRow} onClick={() => openMemorial(m)}>
                        <span style={{ display:'inline-flex', alignItems:'center', gap:7 }}>
                          <span style={{ color:'#57534e', lineHeight:0 }}><CategoryIcon slug={m.product_category} size={18} /></span>
                          {getCategory(m.product_category).label}
                        </span>
                      </td>
                      )}
                      {auth.admin && (
                        <td style={{ ...mainCell, color:'#78716c', whiteSpace:'nowrap' }} onMouseEnter={enterMain} onMouseLeave={leaveRow} onClick={() => openMemorial(m)}>{m.owner_username || '—'}</td>
                      )}
                      <td style={mainCell}                                                onMouseEnter={enterMain} onMouseLeave={leaveRow} onClick={() => openMemorial(m)}>{m.organizer}</td>
                      <td style={{ ...mainCell, color:'#78716c' }}                       onMouseEnter={enterMain} onMouseLeave={leaveRow} onClick={() => openMemorial(m)}>{m.book_variant ? t(`Variante ${m.book_variant}`, `Variant ${m.book_variant}`) : '—'}</td>
                      <td style={{ ...mainCell, color:'#78716c' }}                       onMouseEnter={enterMain} onMouseLeave={leaveRow} onClick={() => openMemorial(m)}>{cutoffString(m.funeral_date, cutoffDays(m))}</td>
                      <td style={{ ...mainCell, color:'#78716c', whiteSpace:'nowrap' }}     onMouseEnter={enterMain} onMouseLeave={leaveRow} onClick={() => openMemorial(m)}>
                        {(m.contribution_count || 0)} {(m.contribution_count === 1) ? t('Beitrag', 'contribution') : t('Beiträge', 'contributions')} · {(m.answer_count || 0)} {(m.answer_count === 1) ? t('Antwort', 'response') : t('Antworten', 'responses')}
                      </td>
                      {auth.admin && (
                      <td
                        style={{ ...col, textAlign:'right', whiteSpace:'nowrap', padding:'6px 14px', background: costHover ? COST_BG : '', transition:'background .1s' }}
                        onMouseEnter={() => setHoveredRow({ id: m.id, zone: 'cost' })}
                        onMouseLeave={leaveRow}
                      >
                        <button
                          onClick={(e) => { e.stopPropagation(); openCosts(m) }}
                          title={t('Aufschlüsselung anzeigen', 'Show breakdown')}
                          style={{
                            background: costHover ? '#bfdbfe' : '#fff',
                            border:'1px solid #93c5fd',
                            borderRadius:8,
                            padding:'6px 12px',
                            fontSize:13,
                            fontWeight:600,
                            color:'#1d4ed8',
                            cursor:'pointer',
                            display:'inline-flex',
                            alignItems:'center',
                            gap:6,
                            transition:'background .1s, border-color .1s',
                            whiteSpace:'nowrap',
                          }}
                        >
                          <span aria-hidden="true">💶</span>
                          <span style={{ textDecoration:'underline', textUnderlineOffset:2 }}>{formatEurSum(m.cost_total_eur)}</span>
                        </button>
                      </td>
                      )}
                      <td style={{ ...col, textAlign:'right' }}>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(m) }}
                          disabled={deletingId === m.id}
                          className="secondary"
                          style={{ fontSize:12, padding:'6px 12px', color:'#dc2626', borderColor:'#fecaca' }}
                          title={t(`${getCategory(m.product_category).nounBook} löschen`, 'Delete')}
                        >
                          {deletingId === m.id ? '…' : t('🗑 Löschen', '🗑 Delete')}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>
    </div>
    )
}

export function CreateCategoryView({ err, allowedSlugs, logout, setView, chooseCategory }) {
  const t = useAdminT()
  return (
    <div style={{ minHeight:'100vh', background:'#fafaf9' }}>
      <div style={{ background: '#fff', borderBottom: '1px solid #e7e5e4', padding: '14px 24px', position: 'sticky', top: 0, zIndex: 50, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div style={{ display:'flex', alignItems:'center', gap:16 }}><button className="ghost" onClick={() => setView('list')} style={{ fontSize:14, color:'#78716c' }}>{t('← Zurück', '← Back')}</button><span style={{ fontWeight: 700, fontSize: 16 }}>Lebenswerk Admin</span></div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <AdminLangToggle />
          <button className="secondary" onClick={logout} style={{ fontSize: 13, padding: '7px 14px' }}>{t('Abmelden', 'Log out')}</button>
        </div>
      </div>
      <div style={{ maxWidth: 540, margin: '2rem auto', padding: '0 1.5rem' }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>{t('Produktkategorie wählen', 'Choose product category')}</h2>
        <p style={{ ...S.muted, marginBottom: '1.5rem' }}>{t('Für welchen Anlass soll das Buch entstehen?', 'What occasion is the book for?')}</p>
        <Err msg={err} />
        <div style={{ display:'grid', gridTemplateColumns:'1fr', gap:10 }}>
          {allowedSlugs.map(slug => {
            const c = categoryColor(slug)
            return (
            <div
              key={slug}
              onClick={() => chooseCategory(slug)}
              style={{ ...S.card, cursor:'pointer', padding:'16px 16px', borderLeft:`4px solid ${c}`, transition:'border-color .15s, background .15s' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = c; e.currentTarget.style.background = `${c}0d` }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#e7e5e4'; e.currentTarget.style.borderLeftColor = c; e.currentTarget.style.background = '#fff' }}
            >
              <div style={{ display:'flex', alignItems:'flex-start', gap:12 }}>
                <span style={{ color:c, flexShrink:0, lineHeight:0, marginTop:1 }}><CategoryIcon slug={slug} size={28} /></span>
                <div>
                  <div style={{ fontWeight:600, fontSize:15, marginBottom:4, color:c }}>{CATEGORIES[slug].label}</div>
                  <div style={{ fontSize:13, color:'#78716c', lineHeight:1.5 }}>{CATEGORIES[slug].description}</div>
                </div>
              </div>
            </div>
          )})}
        </div>
      </div>
    </div>
  )
}

export function CreateView({ createForm, busy, err, allowedSlugs, catalogs, logout, setView, setCreateForm, handleCreate }) {
    const cat = getCategory(createForm.productCategory)
    const ci  = cat.intake
    // Lebenswerk: Statt eines Einladungslinks für viele Beitragende bekommt EIN
    // Endnutzer ein eigenes Login — sofern eine E-Mail-Adresse hinterlegt wird.
    // Ohne Adresse entsteht kein Konto; der Zugang läuft dann über den
    // Einladungslink wie bei den anderen Kategorien. Eine ANGEGEBENE Adresse muss
    // aber gültig sein, sonst geht die Einladung ins Leere.
    const isLifework = createForm.productCategory === 'lifework'
    const euMail = (createForm.enduserEmail || '').trim()
    const emailOk = !isLifework || !euMail || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(euMail)
    // Beim Lebenswerk ist bei der Anlage ALLES optional (Name, Geschlecht, Anrede) —
    // der Endnutzer ergänzt beim Start, was fehlt. Deshalb hängt der Anlage-Button
    // dort nur an einer gültigen (oder leeren) E-Mail. Bei den anderen Kategorien
    // bleiben Name/Organisator/Geschlecht Pflicht wie bisher.
    const canSubmit = isLifework
      ? (emailOk && !busy)
      : (createForm.name && createForm.organizer && (!ci.useGender || createForm.gender) && emailOk && !busy)
    const pa = createForm.pickupAddress || EMPTY_PICKUP
    const setPa = patch => setCreateForm(f => ({ ...f, pickupAddress: { ...f.pickupAddress, ...patch } }))
    const [expertMode, setExpertMode] = useState(false)
    const t = useAdminT()
    return (
    <div style={{ minHeight:'100vh', background:'#fafaf9' }}>
      <div style={{ background: '#fff', borderBottom: '1px solid #e7e5e4', padding: '14px 24px', position: 'sticky', top: 0, zIndex: 50, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div style={{ display:'flex', alignItems:'center', gap:16 }}><button className="ghost" onClick={() => setView(allowedSlugs.length > 1 ? 'create-category' : 'list')} style={{ fontSize:14, color:'#78716c' }}>{t('← Zurück', '← Back')}</button><span style={{ fontWeight: 700, fontSize: 16 }}>Lebenswerk Admin</span></div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <AdminLangToggle />
          <button className="secondary" onClick={logout} style={{ fontSize: 13, padding: '7px 14px' }}>{t('Abmelden', 'Log out')}</button>
        </div>
      </div>
      <div style={{ maxWidth: 540, margin: '2rem auto', padding: '0 1.5rem' }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>{ci.createHeading}</h2>
        <p style={{ ...S.muted, marginBottom: '1.5rem' }}>{ci.createIntro}</p>
        <Err msg={err} />
        <div style={{ marginBottom: 14 }}>
          <Lbl>{ci.subjectLabel}</Lbl>
          <input value={createForm.name} onChange={e => setCreateForm({ ...createForm, name: e.target.value })} placeholder={ci.subjectPlaceholder} />
        </div>
        {isLifework && (
          <div style={{ marginBottom: 14 }}>
            <Lbl>E-Mail-Adresse des Endnutzers (optional)</Lbl>
            <input
              type="email"
              value={createForm.enduserEmail || ''}
              onChange={e => setCreateForm({ ...createForm, enduserEmail: e.target.value })}
              placeholder="name@beispiel.de"
            />
            <p style={{ fontSize:12, color:'#78716c', marginTop:6, lineHeight:1.5 }}>
              Mit Adresse: Der Endnutzer erhält eine Einladung in der gewählten Sprache, vergibt sich sein Passwort und
              landet nach dem Login direkt in seinem Interview – ohne Dashboard.<br />
              Ohne Adresse: kein eigenes Login – der Endnutzer kommt über den Einladungslink hinein, den Sie nach dem
              Anlegen erhalten. Den Einstellungs-Tab (Grafik-/Textstil) gibt es dann nicht.
            </p>
          </div>
        )}
        {isLifework && (
          <div style={{ marginBottom: 14 }}>
            <Lbl>Sprache des Endnutzers *</Lbl>
            <p style={{ fontSize:12, color:'#78716c', margin:'0 0 8px', lineHeight:1.5 }}>
              Genau eine Sprache – sie gilt für die Einladungs-E-Mail und das ganze Interview. Ohne Festlegung wählt der
              Endnutzer die Sprache beim ersten Start selbst (die Einladung geht dann auf Deutsch raus).
            </p>
            <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
              {[...LANGUAGES, { code: '', label: 'Endnutzer wählt selbst' }].map(l => {
                // Genau EINE Sprache = vom Admin festgelegt; alle drei = Wahl beim Start.
                const on = l.code
                  ? (createForm.languages.length === 1 && createForm.languages[0] === l.code)
                  : createForm.languages.length !== 1
                return (
                  <label key={l.code || 'auto'} style={{
                    display:'flex', alignItems:'center', gap:8, cursor:'pointer',
                    ...S.card, padding:'10px 14px',
                    borderColor: on ? '#1c1917' : '#e7e5e4', borderWidth: on ? 2 : 1,
                  }}>
                    <input
                      type="radio" name="lifework-lang" checked={on}
                      onChange={() => setCreateForm(f => ({ ...f, languages: l.code ? [l.code] : LANGUAGES.map(x => x.code) }))}
                      style={{ width:16, height:16, accentColor:'#1c1917', cursor:'pointer' }}
                    />
                    <span style={{ fontSize:14, fontWeight: on ? 600 : 400 }}>{l.label}</span>
                  </label>
                )
              })}
            </div>
          </div>
        )}
        {ci.useGender && (
          <div style={{ marginBottom: 14 }}>
            <Lbl>{ci.genderLabel}</Lbl>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8 }}>
              {/* Beim Lebenswerk ist der leere Wert eine echte Option: „Endnutzer
                  wählt selbst" (Default). Er wird beim Start abgefragt. */}
              {[...(ci.genderSelfOption ? [{ value: '', label: 'Endnutzer wählt selbst' }] : []), ...GENDERS].map(g => (
                <div
                  key={g.value || 'self'}
                  onClick={() => setCreateForm({ ...createForm, gender: g.value })}
                  style={{
                    ...S.card, cursor:'pointer', textAlign:'center', padding:'12px 8px',
                    borderColor: createForm.gender === g.value ? '#1c1917' : '#e7e5e4',
                    borderWidth: createForm.gender === g.value ? 2 : 1,
                    fontSize: 14, fontWeight: createForm.gender === g.value ? 600 : 400,
                  }}
                >
                  {g.label}
                </div>
              ))}
            </div>
          </div>
        )}
        {/* Anredeform (nur Lebenswerk): Wird sie hier gesetzt, fragt das Interview
            nicht mehr danach — der Endnutzer sieht beim Start nur noch, was fehlt. */}
        {ci.useAddressForm && (
          <div style={{ marginBottom: 14 }}>
            <Lbl>Anredeform im Interview</Lbl>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8 }}>
              {[
                { v:'Du',  label:'Du' },
                { v:'Sie', label:'Sie' },
                { v:'',    label:'Endnutzer wählt selbst' },
              ].map(o => {
                const on = (createForm.intake?.address || '') === o.v
                return (
                  <div
                    key={o.v || 'auto'}
                    onClick={() => setCreateForm({ ...createForm, intake: { ...createForm.intake, address: o.v } })}
                    style={{
                      ...S.card, cursor:'pointer', textAlign:'center', padding:'12px 8px',
                      borderColor: on ? '#1c1917' : '#e7e5e4', borderWidth: on ? 2 : 1,
                      fontSize: 14, fontWeight: on ? 600 : 400,
                    }}
                  >
                    {o.label}
                  </div>
                )
              })}
            </div>
          </div>
        )}
        {(ci.extra || []).map(f => (
          <div key={f.key} style={{ marginBottom: 14 }}>
            <Lbl>{f.label}</Lbl>
            <input
              value={createForm.intake?.[f.key] || ''}
              onChange={e => setCreateForm({ ...createForm, intake: { ...createForm.intake, [f.key]: e.target.value } })}
              placeholder={f.placeholder || ''}
            />
          </div>
        ))}
        {/* Lebenswerk: Es gibt keinen Organisator — der Endnutzer erzählt sein
            eigenes Leben, es sammelt niemand Beiträge Dritter ein. */}
        {!isLifework && (
        <div style={{ marginBottom: 14 }}>
          <Lbl>{t('Ihr Name (Organisator) *', 'Your name (organizer) *')}</Lbl>
          <input value={createForm.organizer} onChange={e => setCreateForm({ ...createForm, organizer: e.target.value })} placeholder={t('Ihr Name', 'Your name')} />
        </div>
        )}
        {ci.useDate && (
          <div style={{ marginBottom: 14 }}>
            <Lbl>{ci.dateLabel}</Lbl>
            <input type="date" value={createForm.funeralDate} onChange={e => setCreateForm({ ...createForm, funeralDate: e.target.value })} />
          </div>
        )}
        {ci.useCutoff && (
          <div style={{ marginBottom: 14 }}>
            <Lbl>{ci.cutoffLabel}</Lbl>
            <input
              type="number" min={0} max={90} step={1}
              value={createForm.cutoffDays}
              onChange={e => {
                const v = e.target.value
                setCreateForm({ ...createForm, cutoffDays: v === '' ? '' : Math.max(0, parseInt(v, 10) || 0) })
              }}
            />
            <p style={{ fontSize:12, color:'#78716c', marginTop:6 }}>
              {createForm.funeralDate && Number.isFinite(parseInt(createForm.cutoffDays, 10))
                ? <>Beiträge fließen bis zum <strong>{cutoffString(createForm.funeralDate, parseInt(createForm.cutoffDays, 10))}</strong> ein.</>
                : <>Standard sind 7 Tage.</>}
            </p>
          </div>
        )}
        {/* Lebenswerk kennt nur Variante 2 (durchkomponierte Autobiographie) —
            bei EINEM Erzähler ergäbe „ein Beitrag = ein Kapitel" kein Buch. */}
        {!isLifework && (
        <div style={{ marginBottom: 24 }}>
          <Lbl>{t('Buch-Variante *', 'Book variant *')}</Lbl>
          <div style={{ display:'grid', gridTemplateColumns:'1fr', gap:8 }}>
            {BOOK_VARIANTS.map(v => (
              <div
                key={v.value}
                onClick={() => setCreateForm({ ...createForm, bookVariant: v.value })}
                style={{
                  ...S.card, cursor:'pointer', padding:'14px 14px',
                  borderColor: createForm.bookVariant === v.value ? '#1c1917' : '#e7e5e4',
                  borderWidth: createForm.bookVariant === v.value ? 2 : 1,
                }}
              >
                <div style={{ fontWeight:600, fontSize:14, marginBottom:4 }}>{v.title}</div>
                <div style={{ fontSize:13, color:'#78716c', lineHeight:1.5 }}>{v.sub}</div>
              </div>
            ))}
          </div>
        </div>
        )}
        <button type="button" onClick={() => setExpertMode(v => !v)} className="secondary" style={{ fontSize:13, padding:'8px 14px', margin:'4px 0 16px' }}>
          {expertMode ? t('⚙ Expertenmodus ausblenden', '⚙ Hide expert mode') : t('⚙ Expertenmodus (weitere Optionen)', '⚙ Expert mode (more options)')}
        </button>
        {expertMode && (<>
        {/* Welche Fragen gestellt werden, entscheidet allein die Katalogauswahl
            weiter unten („kein Katalog“ = freie KI-Fragen). Eine zweite Checkbox
            dafür gab es einmal — sie war dieselbe Entscheidung an zweiter Stelle. */}
        <div style={{ marginBottom: 24 }}>
          <Lbl>Transkript-Schalter im Sprach-Interview</Lbl>
          <label style={{ display:'flex', alignItems:'center', gap:10, cursor:'pointer', marginTop:8 }}>
            <input type="checkbox" checked={createForm.showTranscript !== false} onChange={e => setCreateForm({ ...createForm, showTranscript: e.target.checked })} style={{ width:18, height:18, cursor:'pointer', accentColor:'#1c1917', flexShrink:0 }} />
            <span style={{ fontSize:14 }}>{isLifework ? 'Endnutzer darf das Transkript einblenden' : 'Beitragende dürfen das Transkript einblenden'}</span>
          </label>
          <p style={{ fontSize:12, color:'#78716c', marginTop:6, marginLeft:28 }}>
            Standard: aktiv. Das Interview startet immer als reines Sprach-Gespräch (kein Transkript). Ist diese Option aktiv, {isLifework ? 'sieht der Endnutzer' : 'sehen Beitragende'} einen Schalter, mit dem das Transkript der Antworten eingeblendet und einzelne Antworten gelöscht oder neu eingesprochen werden können. Deaktiviert: kein Schalter, reines Sprach-Interview.
          </p>
        </div>
        {/* Beim Lebenswerk erzählt nur der Endnutzer selbst — eine Namensliste der
            Beitragenden gibt es dort nicht, also auch keine Option dafür. */}
        {!isLifework && (
        <div style={{ marginBottom: 24 }}>
          <Lbl>Namensliste der Beitragenden im Buch</Lbl>
          <label style={{ display:'flex', alignItems:'center', gap:10, cursor:'pointer', marginTop:8 }}>
            <input type="checkbox" checked={createForm.showContributors !== false} onChange={e => setCreateForm({ ...createForm, showContributors: e.target.checked })} style={{ width:18, height:18, cursor:'pointer', accentColor:'#1c1917', flexShrink:0 }} />
            <span style={{ fontSize:14 }}>Namen der Beitragenden am Ende des Buches drucken</span>
          </label>
          <p style={{ fontSize:12, color:'#78716c', marginTop:6, marginLeft:28 }}>
            Standard: aktiv. Am Buchende erscheint eine Seite „Mitwirkende" mit Namen und Beziehung. Deaktiviert: Die Seite entfällt (der KI-Hinweis am Buchende bleibt). Wirkt auf DOCX- und Druck-PDF-Export; später im Dashboard änderbar.
          </p>
        </div>
        )}
        <div style={{ marginBottom: 24 }}>
          <Lbl>Foto-Upload als Tab im Interview</Lbl>
          <label style={{ display:'flex', alignItems:'center', gap:10, cursor:'pointer', marginTop:8 }}>
            <input type="checkbox" checked={createForm.photoUploadTab === true} onChange={e => setCreateForm({ ...createForm, photoUploadTab: e.target.checked })} style={{ width:18, height:18, cursor:'pointer', accentColor:'#1c1917', flexShrink:0 }} />
            <span style={{ fontSize:14 }}>Foto-Upload schon während des Interviews als Tab anbieten</span>
          </label>
          <p style={{ fontSize:12, color:'#78716c', marginTop:6, marginLeft:28 }}>
            Standard: nicht aktiv. Wenn aktiviert, sehen Beitragende unten eine Tab-Leiste („Interview" / „Foto-Upload") und können Fotos hochladen. Ohne diese Option gibt es keine Möglichkeit, Fotos hochzuladen.
          </p>
        </div>
        <div style={{ marginBottom: 24 }}>
          <Lbl>Textstil des Buchs</Lbl>
          <p style={{ ...S.muted, fontSize:12, margin:'0 0 8px' }}>Wie die KI schreibt. Später im Dashboard änderbar.</p>
          <TextStylePicker category={createForm.productCategory} value={createForm.textStyle} onChange={k => setCreateForm({ ...createForm, textStyle: k })} />
        </div>
        <div style={{ marginBottom: 24 }}>
          <Lbl>Grafikstil der Bilder</Lbl>
          <p style={{ ...S.muted, fontSize:12, margin:'0 0 8px' }}>Alle im Buch erzeugten Bilder entstehen konsistent in diesem Stil. Später im Dashboard änderbar.</p>
          <ImageStylePicker value={createForm.imageStyle} onChange={k => setCreateForm({ ...createForm, imageStyle: k })} />
        </div>
        <div style={{ marginBottom: 24 }}>
          <Lbl>Buchlayout (Schrift &amp; Design)</Lbl>
          <p style={{ ...S.muted, fontSize:12, margin:'0 0 8px' }}>Gleiches Format, unterschiedliche Typografie. Später im Dashboard änderbar.</p>
          <BookLayoutPicker value={createForm.bookLayout} onChange={k => setCreateForm({ ...createForm, bookLayout: k })} />
        </div>
        <div style={{ marginBottom: 24 }}>
          <Lbl>Sammelbestellungs-Adresse (optional)</Lbl>
          <p style={{ fontSize:12, color:'#78716c', margin:'2px 0 10px' }}>
            Adresse, an die die gedruckten Bücher gesammelt geliefert / wo sie abgeholt werden. Kann leer bleiben.
          </p>
          <input value={pa.name} onChange={e => setPa({ name: e.target.value })} placeholder="Name / Empfänger" style={{ marginBottom:8 }} />
          <input value={pa.addon} onChange={e => setPa({ addon: e.target.value })} placeholder="Adresszusatz (z. B. c/o, Firma)" style={{ marginBottom:8 }} />
          <input value={pa.street} onChange={e => setPa({ street: e.target.value })} placeholder="Straße und Hausnummer" style={{ marginBottom:8 }} />
          <div style={{ display:'flex', gap:8, marginBottom:8 }}>
            <input value={pa.zip} onChange={e => setPa({ zip: e.target.value })} placeholder="PLZ" style={{ flex:'0 0 120px' }} />
            <input value={pa.city} onChange={e => setPa({ city: e.target.value })} placeholder="Ort" style={{ flex:1 }} />
          </div>
          <input value={pa.country} onChange={e => setPa({ country: e.target.value })} placeholder="Land" />
        </div>
        {(() => {
          const avail = catalogs.filter(c => (c.product_categories || []).includes(createForm.productCategory))
          if (avail.length === 0) return null
          return (
            <div style={{ marginBottom: 24 }}>
              <Lbl>Fragenkatalog</Lbl>
              <p style={{ fontSize:12, color:'#78716c', margin:'0 0 8px' }}>
                {isLifework
                  ? 'Das Lebenswerk folgt dem Standardkatalog (12 Sitzungen mit je 10 Fragen). Wird kein Katalog gewählt, überlegt sich die KI die Fragen selbst.'
                  : 'Standard: die KI überlegt sich die Interviewfragen selbst. Alternativ führt sie das Interview entlang eines vordefinierten Katalogs.'}
              </p>
              <select
                value={createForm.catalogId}
                onChange={e => setCreateForm({ ...createForm, catalogId: e.target.value })}
                style={{ width:'100%', padding:'10px 12px', fontSize:14, fontFamily:'inherit' }}
              >
                <option value="">{isLifework ? 'Lebenswerk-Standardkatalog' : 'KI überlegt selbst (Standard)'}</option>
                {avail.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {createForm.catalogId && (
                <div style={{ marginTop:12 }}>
                  <Lbl>Nachfragen pro Frage (max.)</Lbl>
                  <input
                    type="number" min={0} max={30} step={1}
                    value={createForm.followups}
                    onChange={e => { const v = e.target.value; setCreateForm({ ...createForm, followups: v === '' ? '' : Math.max(0, Math.min(30, parseInt(v, 10) || 0)) }) }}
                    style={{ width:120 }}
                  />
                  <p style={{ fontSize:12, color:'#78716c', marginTop:6 }}>
                    Wie viele vertiefende Nachfragen die KI höchstens zu jeder Katalogfrage stellt. Der Beitragende kann jederzeit „weiter" sagen. Standard: 7.
                  </p>
                </div>
              )}
            </div>
          )
        })()}
        <div style={{ marginBottom: 24 }}>
          <Lbl>Bemerkung</Lbl>
          <textarea
            value={createForm.note}
            onChange={e => setCreateForm({ ...createForm, note: e.target.value })}
            placeholder="Interne Notiz zu diesem Buch (optional) – wird bei der Bucherstellung angezeigt."
            rows={3}
            style={{ width:'100%', resize:'vertical', fontFamily:'inherit', fontSize:14 }}
          />
          <p style={{ fontSize:12, color:'#78716c', marginTop:6 }}>
            Nur intern sichtbar. Wird bei der Bucherstellung angezeigt – z. B. Hinweise zur Gestaltung oder zum Inhalt.
          </p>
        </div>
        {createForm.productCategory === 'memorial' && (
        <div style={{ marginBottom: 24 }}>
          <Lbl>Einführungsvideo</Lbl>
          <label style={{ display:'flex', alignItems:'center', gap:10, cursor:'pointer', marginTop:8 }}>
            <input
              type="checkbox"
              checked={createForm.showIntroVideo}
              onChange={e => setCreateForm({ ...createForm, showIntroVideo: e.target.checked })}
              style={{ width:18, height:18, cursor:'pointer', accentColor:'#1c1917', flexShrink:0 }}
            />
            <span style={{ fontSize:14 }}>Einführungsvideo vor dem Sprach-Interview anzeigen</span>
          </label>
          <p style={{ fontSize:12, color:'#78716c', marginTop:6, marginLeft:28 }}>
            Standard: nicht aktiv. Wenn aktiviert, wird den Beitragenden vor dem Sprach-Interview ein kurzes Einführungsvideo gezeigt.
          </p>
        </div>
        )}
        {!isLifework && (
        <div style={{ marginBottom: 24 }}>
          <Lbl>Sprachen *</Lbl>
          <p style={{ fontSize:12, color:'#78716c', margin:'0 0 8px' }}>
            In welchen Sprachen sollen Beitragende den Prozess durchführen können? Bei mehreren Sprachen wählt der Beitragende zu Beginn seine Sprache.
          </p>
          <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
            {LANGUAGES.map(l => {
              const on = createForm.languages.includes(l.code)
              return (
                <label key={l.code} style={{
                  display:'flex', alignItems:'center', gap:8, cursor:'pointer',
                  ...S.card, padding:'10px 14px',
                  borderColor: on ? '#1c1917' : '#e7e5e4', borderWidth: on ? 2 : 1,
                }}>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => setCreateForm(f => {
                      const next = on ? f.languages.filter(c => c !== l.code) : [...f.languages, l.code]
                      return { ...f, languages: next.length ? next : f.languages }
                    })}
                    style={{ width:16, height:16, accentColor:'#1c1917', cursor:'pointer' }}
                  />
                  <span style={{ fontSize:14, fontWeight: on ? 600 : 400 }}>{l.label}</span>
                </label>
              )
            })}
          </div>
        </div>
        )}
        </>)}
        <button
          disabled={!canSubmit}
          onClick={handleCreate}
          style={{ width: '100%', padding: 13, fontSize: 15 }}
        >
          {busy ? t('Wird erstellt …', 'Creating …') : ci.createButton}
        </button>
      </div>
    </div>
    )
}

export function ContributionView({ selectedContrib, selected, setView, dlOne, exportContribution, deleteContribution, logout, deleteMessages, saveContribMeta, saveAnswerText }) {
    const t = useAdminT()
    const c = selectedContrib
    const [ansEdit, setAnsEdit] = useState(null)   // Index der Nachricht, die gerade editiert wird
    const [ansDraft, setAnsDraft] = useState('')
    const [ansSaving, setAnsSaving] = useState(false)
    const startAnsEdit = (idx, text) => { setAnsEdit(idx); setAnsDraft(text || '') }
    const submitAns = async (idx) => {
      setAnsSaving(true)
      const ok = await saveAnswerText?.(c, idx, ansDraft)
      setAnsSaving(false)
      if (ok) setAnsEdit(null)
    }
    const [editMeta, setEditMeta] = useState(false)
    const [nameDraft, setNameDraft] = useState('')
    const [relDraft, setRelDraft] = useState('')
    const [savingMeta, setSavingMeta] = useState(false)
    const startEditMeta = () => { setNameDraft(c.contributor_name || ''); setRelDraft(c.relationship || ''); setEditMeta(true) }
    const submitMeta = async () => {
      if (!nameDraft.trim()) return
      setSavingMeta(true)
      const ok = await saveContribMeta?.(c.id, { contributorName: nameDraft.trim(), relationship: relDraft.trim() })
      setSavingMeta(false)
      if (ok) setEditMeta(false)
    }
    const pairs = []
    for (let j = 0; j < c.messages.length; j++) {
      if (c.messages[j].role === 'assistant') {
        const hasAnswer = c.messages[j + 1]?.role === 'user'
        pairs.push({
          q: c.messages[j].content,
          a: hasAnswer ? c.messages[j + 1].content : undefined,
          indices: hasAnswer ? [j, j + 1] : [j],
        })
        if (hasAnswer) j++
      } else {
        pairs.push({ q: null, a: c.messages[j].content, indices: [j] })
      }
    }
    return (
      <div style={{ minHeight: '100vh', background: '#fafaf9' }}>
        <div style={{ background: '#fff', borderBottom: '1px solid #e7e5e4', padding: '14px 24px', position: 'sticky', top: 0, zIndex: 50, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display:'flex', alignItems:'center', gap:16 }}>
            <button className="ghost" onClick={() => setView('detail')} style={{ fontSize:14, color:'#78716c' }}>{t('← Zurück', '← Back')}</button>
            <div>
              <span style={{ fontWeight: 700, fontSize: 16 }}>{c.contributor_name}</span>
              <span style={{ fontSize:13, color:'#78716c', marginLeft:10 }}>· {selected.name}</span>
            </div>
          </div>
          <div style={{ display:'flex', gap:10, alignItems:'center' }}>
            <button onClick={() => dlOne(c)} style={{ fontSize:13, padding:'8px 16px' }}>{t('⬇ Herunterladen', '⬇ Download')}</button>
            <button className="secondary" onClick={() => exportContribution(c)} title={t('Daten dieses Beitragenden als .zip (lesbares PDF + JSON) exportieren – DSGVO Art. 15/20', 'Export this contributor’s data as .zip (readable PDF + JSON) – GDPR Art. 15/20')} style={{ fontSize:13, padding:'8px 16px' }}>{t('⬇ DSGVO-Export', '⬇ GDPR export')}</button>
            <button className="secondary" onClick={() => deleteContribution(c)} title={t('Beitrag löschen', 'Delete contribution')} style={{ fontSize:15, padding:'7px 12px', color:'#dc2626' }}>🗑</button>
            <AdminLangToggle />
            <button className="secondary" onClick={logout} style={{ fontSize: 13, padding: '7px 14px' }}>{t('Abmelden', 'Log out')}</button>
          </div>
        </div>

        <div style={{ maxWidth: 760, margin: '2rem auto', padding: '0 1.5rem' }}>
          <div style={{ ...S.card, marginBottom:'1.5rem' }}>
            <div style={{ display:'flex', alignItems:'center', gap:14, marginBottom:12 }}>
              <div style={{ width:48, height:48, borderRadius:'50%', background:'#dbeafe', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:700, fontSize:18, color:'#1d4ed8' }}>
                {c.contributor_name.charAt(0).toUpperCase()}
              </div>
              {editMeta ? (
                <div style={{ display:'flex', flexDirection:'column', gap:6, flex:1 }}>
                  <input value={nameDraft} onChange={e => setNameDraft(e.target.value)} placeholder={t('Name', 'Name')} style={{ fontSize:15, padding:'6px 9px' }} />
                  <input value={relDraft} onChange={e => setRelDraft(e.target.value)} placeholder={t('Beziehung zur Hauptperson (z. B. Tochter)', 'Relationship to the main person (e.g. daughter)')} style={{ fontSize:13, padding:'6px 9px' }} />
                  <div style={{ display:'flex', gap:8, marginTop:2 }}>
                    <button onClick={submitMeta} disabled={savingMeta || !nameDraft.trim()} style={{ fontSize:12, padding:'6px 12px' }}>{savingMeta ? t('Speichert …', 'Saving …') : t('Speichern', 'Save')}</button>
                    <button className="secondary" onClick={() => setEditMeta(false)} disabled={savingMeta} style={{ fontSize:12, padding:'6px 12px' }}>{t('Abbrechen', 'Cancel')}</button>
                  </div>
                </div>
              ) : (
                <div>
                  <div style={{ fontWeight:700, fontSize:18, display:'flex', alignItems:'center', gap:8 }}>
                    {c.contributor_name}
                    <button className="secondary" onClick={startEditMeta} title={t('Name & Beziehung ändern', 'Change name & relationship')} style={{ fontSize:11, padding:'3px 8px' }}>{t('✏ ändern', '✏ edit')}</button>
                  </div>
                  <div style={{ fontSize:13, color:'#78716c' }}>{c.relationship}</div>
                </div>
              )}
            </div>
            <div style={{ fontSize:13, color:'#57534e', lineHeight:1.8 }}>
              {c.contributor_gender && <div><span style={{ color:'#a8a29e' }}>{t('Geschlecht:', 'Gender:')}</span> {c.contributor_gender}</div>}
              {c.contributor_address && <div><span style={{ color:'#a8a29e' }}>{t('Anrede:', 'Form of address:')}</span> {c.contributor_address}</div>}
              <div><span style={{ color:'#a8a29e' }}>{t('Erstellt:', 'Created:')}</span> {new Date(c.created_at).toLocaleString('de-DE')}</div>
              <div><span style={{ color:'#a8a29e' }}>{t('Antworten:', 'Responses:')}</span> {c.messages.filter(m => m.role === 'user').length}</div>
            </div>
          </div>

          {pairs.length === 0 ? (
            <p style={S.muted}>{t('Dieser Beitrag enthält noch keine Inhalte.', 'This contribution has no content yet.')}</p>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:18 }}>
              {pairs.map((p, j) => (
                <div key={j} style={{ ...S.card, position:'relative' }}>
                  <button
                    onClick={() => deleteMessages(c, p.indices)}
                    title={t('Frage & Antwort löschen', 'Delete question & answer')}
                    className="ghost"
                    style={{ position:'absolute', top:10, right:10, fontSize:14, color:'#dc2626', padding:'4px 8px', lineHeight:1 }}
                  >
                    🗑
                  </button>
                  {p.q && (
                    <div style={{ marginBottom: p.a ? 12 : 0 }}>
                      <Lbl>{t('Frage', 'Question')}</Lbl>
                      <p style={{ fontSize:15, lineHeight:1.65, fontStyle:'italic', color:'#44403c', margin:'4px 0 0' }}>{p.q}</p>
                    </div>
                  )}
                  {p.a && (() => {
                    const ansIdx = p.indices[p.indices.length - 1]
                    return ansEdit === ansIdx ? (
                      <div>
                        <Lbl>{t('Antwort', 'Answer')}</Lbl>
                        <textarea value={ansDraft} onChange={e => setAnsDraft(e.target.value)} rows={4}
                          style={{ width:'100%', fontSize:15, lineHeight:1.6, padding:'8px 10px', fontFamily:'inherit', resize:'vertical', boxSizing:'border-box' }} />
                        <div style={{ display:'flex', gap:8, marginTop:8 }}>
                          <button onClick={() => submitAns(ansIdx)} disabled={ansSaving} style={{ fontSize:12, padding:'6px 12px' }}>{ansSaving ? t('Speichert …', 'Saving …') : t('Speichern', 'Save')}</button>
                          <button className="secondary" onClick={() => setAnsEdit(null)} disabled={ansSaving} style={{ fontSize:12, padding:'6px 12px' }}>{t('Abbrechen', 'Cancel')}</button>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                          <Lbl>{t('Antwort', 'Answer')}</Lbl>
                          <button className="ghost" onClick={() => startAnsEdit(ansIdx, p.a)} title={t('Antwort bearbeiten', 'Edit answer')} style={{ fontSize:11, color:'#78716c', padding:'2px 6px' }}>{t('✏ bearbeiten', '✏ edit')}</button>
                        </div>
                        <p style={{ fontSize:15, lineHeight:1.7, color:'#1c1917', margin:'4px 0 0', whiteSpace:'pre-wrap' }}>{p.a}</p>
                      </div>
                    )
                  })()}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    )
}

export function BookView({ view, selected, generating, genOwner, contributions, editMode, editDraft, savingEdit, err, genErr, genPct, genProgress, GENERATORS, cancelGenRef, setEditMode, setEditDraft, setView, cancelGenerate, saveEdit, setReportModal, downloadGenerated, requestDownload, dlLangOverlay, downloadGeneratedPdf, downloadCover, setEulogyStyleModal, requestGenerate, eulogyStyleOverlay, genLangOverlay, imgEditOverlay, coverOverlay, imgZoomOverlay, reportOverlay, transcriptReportOverlay, highlightParagraph, renderRichText, dlBusy }) {
    const t = useAdminT()
    const key  = view === 'book-v1' ? 'book_v1' : view === 'book-v2' ? 'book_v2' : 'eulogy'
    const gen  = GENERATORS[key]
    const data = selected[gen.field]
    const busy = !!generating[key] && genOwner[key] === selected.id
    const bt = uiText(data?.language)
    const reviewReport = selected.content_reports?.[gen.field]
    const reviewMarks = (reviewReport?.findings || []).filter(f => f.quote && f.status !== 'resolved').map(f => ({ quote: String(f.quote), severity: f.severity }))
    const subtitle = view === 'book-v1' ? `${getCategory(selected?.product_category).nounBook} · Version 1`
                   : view === 'book-v2' ? `${getCategory(selected?.product_category).nounBook} · Version 2`
                   : GENERATORS.eulogy.label
    // Buchlayout (Typografie) für die Leseansicht.
    const bookLayout = getBookLayout(selected.book_layout)
    const headFont = { fontFamily: bookLayout.heading.css, letterSpacing: bookLayout.heading.track, ...(bookLayout.heading.upper ? { textTransform: 'uppercase' } : {}) }
    const bodyFont = { fontFamily: bookLayout.body.css }
    return (
      <div style={{ maxWidth:720, margin:'0 auto', padding:'1.5rem', paddingBottom:'4rem' }}>
        <div style={{ position:'sticky', top:0, zIndex:40, background:'#fff', margin:'-1.5rem -1.5rem 1rem', padding:'0.75rem 1.5rem 0', borderBottom:'1px solid #f0ede8' }}>
          <Back onClick={() => { setEditMode(false); setEditDraft(null); setView('detail') }} />
        </div>
        <div style={{ textAlign:'center', marginBottom:'2.5rem' }}>
          <p style={{ fontSize:11, letterSpacing:'.12em', textTransform:'uppercase', color:'#a8a29e', marginBottom:10 }}>{subtitle}{editMode ? t(' · Bearbeiten', ' · Editing') : ''}</p>
          <h1 style={{ fontSize:24, fontWeight:600, ...headFont, color:'#78716c' }}>{selected.name}</h1>
        </div>

        {!busy && data && !editMode && (
          <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:'1.25rem' }}>
            <button onClick={() => { setEditDraft(structuredClone(data)); setEditMode(true) }} style={{ fontSize:13, padding:'8px 16px' }}>{t('✏ Bearbeiten', '✏ Edit')}</button>
          </div>
        )}

        {genOwner[key] === selected.id && <Err msg={genErr[key]} />}
        <Err msg={err} />

        {busy ? (
          <div style={{ textAlign:'center', padding:'3rem 0' }}>
            <Dots />
            {genPct[key] != null && (
              <>
                <div style={{ fontSize:32, fontWeight:700, color:'#1c1917', marginTop:16 }}>{genPct[key]} %</div>
                <div style={{ maxWidth:320, height:8, background:'#e7e5e4', borderRadius:999, margin:'12px auto 0', overflow:'hidden' }}>
                  <div style={{ width:`${genPct[key]}%`, height:'100%', background:'#1c1917', transition:'width .3s' }} />
                </div>
              </>
            )}
            <p style={{ ...S.muted, marginTop:16 }}>{genProgress[key] || t('Die KI arbeitet …', 'The AI is working …')}</p>
            <div style={{ marginTop:16 }}>
              <button onClick={() => cancelGenerate(key)} disabled={!!cancelGenRef.current[key]} className="secondary" style={{ fontSize:13, padding:'7px 14px', color:'#b91c1c', borderColor:'#fecaca' }}>{t('✕ Abbrechen', '✕ Cancel')}</button>
            </div>
          </div>
        ) : !data ? (
          <p style={{ ...S.muted, textAlign:'center', padding:'3rem 0' }}>{t('Noch nichts generiert. Geh zurück und klicke „Generieren".', 'Nothing generated yet. Go back and click “Generate”.')}</p>
        ) : editMode ? (
          <div style={{ borderTop:'1px solid #e7e5e4', paddingTop:'1.5rem' }}>
            <p style={{ ...S.muted, fontSize:13, marginBottom:16 }}>
              {t('Direkt im Text korrigieren (z. B. falsch verstandene Eigennamen). Änderungen werden beim Speichern übernommen. Bilder bleiben unverändert.', 'Correct directly in the text (e.g. misheard proper names). Changes are applied when saving. Images stay unchanged.')}
            </p>
            {gen.kind === 'book' && editDraft && typeof editDraft === 'object' ? (
              <>
                <Lbl>{t('Titel', 'Title')}</Lbl>
                <input value={editDraft.title || ''} onChange={e => setEditDraft(d => ({ ...d, title: e.target.value }))} style={{ marginBottom:12 }} />
                <Lbl>{t('Untertitel', 'Subtitle')}</Lbl>
                <input value={editDraft.subtitle || ''} onChange={e => setEditDraft(d => ({ ...d, subtitle: e.target.value }))} style={{ marginBottom:20 }} />
                {(editDraft.chapters || []).map((ch, i) => (
                  <div key={i} style={{ marginBottom:20, paddingTop:16, borderTop:'1px solid #f5f5f4' }}>
                    <Lbl>{bt.chapterLabel} {ch.number ?? i + 1} – {t('Überschrift', 'Heading')}</Lbl>
                    <input value={ch.heading || ''} onChange={e => setEditDraft(d => ({ ...d, chapters: d.chapters.map((c, idx) => idx === i ? { ...c, heading: e.target.value } : c) }))} style={{ marginBottom:8 }} />
                    <Lbl>{t('Text', 'Text')}</Lbl>
                    <textarea value={ch.body || ''} onChange={e => setEditDraft(d => ({ ...d, chapters: d.chapters.map((c, idx) => idx === i ? { ...c, body: e.target.value } : c) }))} rows={Math.max(6, String(ch.body || '').split('\n').length + 2)} style={{ width:'100%', fontFamily:'inherit', fontSize:14, lineHeight:1.6, resize:'vertical' }} />
                  </div>
                ))}
              </>
            ) : (
              <>
                <Lbl>Text</Lbl>
                <textarea value={typeof editDraft === 'string' ? editDraft : ''} onChange={e => setEditDraft(e.target.value)} rows={24} style={{ width:'100%', fontFamily:'inherit', fontSize:15, lineHeight:1.7, resize:'vertical' }} />
              </>
            )}
            <div style={{ display:'flex', gap:10, marginTop:16, position:'sticky', bottom:0, background:'#fff', padding:'12px 0', borderTop:'1px solid #f0ede8', zIndex:20 }}>
              <button onClick={() => saveEdit(gen.field, editDraft)} disabled={savingEdit} style={{ fontSize:14, padding:'9px 18px' }}>{savingEdit ? t('Speichert …', 'Saving …') : t('✓ Speichern', '✓ Save')}</button>
              <button onClick={() => { setEditMode(false); setEditDraft(null) }} disabled={savingEdit} className="ghost" style={{ fontSize:14 }}>{t('Abbrechen', 'Cancel')}</button>
            </div>
          </div>
        ) : gen.kind === 'book' ? (
          <>
            <div style={{ textAlign:'center', padding:'2rem 0 3rem', borderTop:'1px solid #e7e5e4' }}>
              <h2 style={{ fontSize:36, fontWeight:700, ...headFont, marginBottom:12, color:'#1c1917' }}>{data.title || '—'}</h2>
              {data.subtitle && <p style={{ fontSize:18, fontStyle:'italic', color:'#78716c', ...bodyFont }}>{data.subtitle}</p>}
            </div>
            {reviewMarks.length > 0 && (
              <div style={{ background:'#fef2f2', border:'1px solid #fecaca', borderRadius:8, padding:'10px 14px', marginBottom:'2rem', fontSize:13, color:'#991b1b', display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, flexWrap:'wrap' }}>
                <span>🛡 {reviewMarks.length} {reviewMarks.length === 1 ? t('Stelle', 'passage') : t('Stellen', 'passages')} {t('aus der Inhaltsprüfung sind im Text farbig markiert.', 'from the content check are highlighted in the text.')}</span>
                <button className="secondary" onClick={() => setReportModal({ title: gen.label, field: gen.field, report: reviewReport })} style={{ fontSize:12, padding:'5px 10px' }}>{t('Prüfbericht', 'Check report')}</button>
              </div>
            )}
            {(data.chapters || []).map((ch, i) => (
              <div key={i} style={{ marginBottom:'3rem' }}>
                <div style={{ textAlign:'center', marginBottom:'1.25rem' }}>
                  <p style={{ fontSize:11, letterSpacing:'.18em', textTransform:'uppercase', color:'#a8a29e', marginBottom:6 }}>{bt.chapterLabel} {ch.number ?? i + 1}</p>
                  <h3 style={{ fontSize:24, fontWeight:700, ...headFont }}>{ch.heading || ''}</h3>
                  {(() => {
                    // V1: Name + Beziehung des Beitragenden unter der Überschrift.
                    // Fallback über contribution_id für ältere Bücher ohne die Felder.
                    const src = ch.contributor_name ? ch : (contributions || []).find(x => x.id === ch.contribution_id)
                    const nm = ch.contributor_name || src?.contributor_name
                    const rel = ch.relationship || src?.relationship
                    return nm ? (
                      <p style={{ fontSize:15, fontStyle:'italic', color:'#78716c', ...bodyFont, marginTop:8 }}>
                        {rel ? `${nm} – ${rel}` : nm}
                      </p>
                    ) : null
                  })()}
                </div>
                {ch.image_url ? (
                  <img
                    src={ch.image_url}
                    alt={ch.heading || ''}
                    loading="lazy"
                    onError={(e) => { console.warn('Bild-Load fehlgeschlagen:', ch.image_url); e.currentTarget.style.outline = '2px solid #ef4444' }}
                    style={{ width:'100%', height:'auto', borderRadius:8, marginBottom:'2rem', display:'block', boxShadow:'0 2px 12px rgba(0,0,0,.08)' }}
                  />
                ) : ch.image_path ? (
                  <div style={{ background:'#fef3c7', border:'1px dashed #fde68a', padding:'1.5rem', borderRadius:8, marginBottom:'2rem', textAlign:'center', color:'#78350f', fontSize:13, lineHeight:1.5 }}>
                    🖼 Bild wurde generiert und gespeichert, aber die Anzeige-URL fehlt.<br />
                    <code style={{ fontFamily:'monospace', fontSize:12 }}>{ch.image_path}</code><br />
                    <span style={{ fontSize:12, color:'#92400e' }}>(Signing schlägt fehl — Bucket-Name prüfen oder Liste neu laden)</span>
                  </div>
                ) : ch.image_prompt ? (
                  ch.image_error ? (
                    <div style={{ background:'#fef2f2', border:'1px dashed #fecaca', padding:'1.5rem', borderRadius:8, marginBottom:'2rem', textAlign:'center', color:'#991b1b', fontSize:13, lineHeight:1.5 }}>
                      🖼 Bildgenerierung fehlgeschlagen.<br />
                      <span style={{ display:'inline-block', marginTop:6, padding:'4px 10px', background:'#fff', border:'1px solid #fecaca', borderRadius:6, fontSize:12, color:'#7f1d1d' }}>
                        {imageErrorDe(ch.image_error)}
                      </span>
                      <div style={{ fontSize:12, color:'#7f1d1d', marginTop:8 }}>Prompt war: „{ch.image_prompt}"</div>
                    </div>
                  ) : (
                    <div style={{ background:'#f5f5f4', border:'1px dashed #d6d3d1', padding:'1.5rem', borderRadius:8, marginBottom:'2rem', textAlign:'center', color:'#78716c', fontSize:13, lineHeight:1.5 }}>
                      🖼 Noch kein Bild – über „🖼 Bilder überarbeiten" erzeugen.
                      <div style={{ fontSize:12, color:'#a8a29e', marginTop:8 }}>Prompt: „{ch.image_prompt}"</div>
                    </div>
                  )
                ) : (
                  <div style={{ background:'#f5f5f4', border:'1px dashed #d6d3d1', padding:'1.5rem', borderRadius:8, marginBottom:'2rem', textAlign:'center', color:'#78716c', fontSize:13 }}>
                    🖼 Kein image_prompt im Kapitel-JSON.
                  </div>
                )}
                <div style={{ fontSize:17, lineHeight:1.9, ...bodyFont }}>
                  {String(ch.body || '').split('\n\n').filter(Boolean).map((p, j) => <p key={j} style={{ marginBottom:'1.4rem' }}>{highlightParagraph(p, reviewMarks)}</p>)}
                </div>
              </div>
            ))}
            {contributions.length > 0 && (
              <div style={{ marginTop:'2rem', paddingTop:'2rem', borderTop:'1px solid #e7e5e4', textAlign:'center' }}>
                <h3 style={{ fontSize:24, fontWeight:700, ...headFont, marginBottom:'1.5rem' }}>{bt.contributorsHeading}</h3>
                {dedupeContributors(contributions).map(c => (
                  <p key={c.id} style={{ fontSize:16, lineHeight:1.7, ...bodyFont, margin:'0 0 6px' }}>
                    <strong>{c.contributor_name}</strong>{c.relationship ? <span style={{ color:'#78716c' }}> — {c.relationship}</span> : null}
                  </p>
                ))}
              </div>
            )}
          </>
        ) : (
          <div style={{ borderTop:'1px solid #e7e5e4', paddingTop:'2rem', fontSize:17, lineHeight:1.9, ...bodyFont }}>
            {renderRichText(data)}
          </div>
        )}

        {!busy && data && !editMode && (
          <div style={{ marginTop:'2.5rem', paddingTop:'1.5rem', borderTop:'1px solid #e7e5e4' }}>
            <p style={{ fontSize:12, fontWeight:700, color:'#78716c', margin:'0 0 6px' }}>{bt.aiDisclaimerTitle}</p>
            {selected?.owner_logo && (
              <img src={selected.owner_logo} alt="Logo" style={{ maxHeight:64, maxWidth:'60%', objectFit:'contain', display:'block', margin:'8px 0 10px' }} />
            )}
            <p style={{ fontSize:12, color:'#a8a29e', fontStyle:'italic', lineHeight:1.6, margin:0 }}>{bt.aiDisclaimer}</p>
          </div>
        )}

        {!busy && data && !editMode && (
          <div style={{ marginTop:'1.5rem', paddingTop:'1.5rem', borderTop:'1px solid #e7e5e4', display:'flex', gap:10, flexWrap:'wrap' }}>
            <button onClick={() => requestDownload(key)} disabled={!!dlBusy} style={{ fontSize:13, padding:'8px 16px' }}>{dlBusy === `${key}:docx` ? t('⏳ Wird erstellt …', '⏳ Creating …') : t('⬇ Download .docx', '⬇ Download .docx')}</button>
            {gen.kind === 'book' ? (
              // Druck-PDF nur für Sprachen, deren Schrift jsPDF setzen kann. Bei
              // Rechts-nach-links (Hebräisch/Arabisch) fehlen die Buchstaben-
              // verbindungen — dort führt nur der Weg über DOCX (Word formt selbst).
              canPrintPdf(data?.language) ? (
                <button className="secondary" onClick={() => downloadGeneratedPdf(key)} disabled={!!dlBusy} style={{ fontSize:13, padding:'8px 16px' }}>{dlBusy === `${key}:pdf` ? t('⏳ Wird erstellt …', '⏳ Creating …') : t('🖨 Druck-PDF', '🖨 Print PDF')}</button>
              ) : (
                <span style={{ fontSize:12, color:'#78716c', alignSelf:'center', maxWidth:280, lineHeight:1.4 }}>
                  {t('🖨 Druck-PDF ist für diese Schreibrichtung nicht verfügbar — bitte den DOCX-Export nutzen (Word setzt die Schrift korrekt).', '🖨 Print PDF is not available for this writing direction — please use the DOCX export (Word sets the script correctly).')}
                </span>
              )
            ) : (
              <button className="secondary" onClick={() => requestDownload(key, 'pdf')} disabled={!!dlBusy} style={{ fontSize:13, padding:'8px 16px' }}>{dlBusy === `${key}:pdf` ? t('⏳ Wird erstellt …', '⏳ Creating …') : t('⬇ Download .pdf', '⬇ Download .pdf')}</button>
            )}
            {gen.kind === 'book' && (
              <button
                className="secondary"
                onClick={() => downloadCover(key)}
                disabled={!!dlBusy || !data?.print_pages}
                title={data?.print_pages
                  ? t(`Rückenstärke aus ${data.print_pages} Seiten`, `Spine width from ${data.print_pages} pages`)
                  : t('Erst das Druck-PDF erzeugen — daraus ergibt sich die Rückenstärke.', 'First create the print PDF — the spine width follows from it.')}
                style={{ fontSize:13, padding:'8px 16px' }}
              >
                {dlBusy === `${key}:cover-img` ? t('⏳ Hintergrund wird erzeugt …', '⏳ Creating background …')
                  : dlBusy === `${key}:cover` ? t('⏳ Wird erstellt …', '⏳ Creating …')
                  : t('📕 Druck-Cover', '📕 Print cover')}
              </button>
            )}
            <button className="secondary" onClick={() => key === 'eulogy' ? setEulogyStyleModal(true) : requestGenerate(key)} style={{ fontSize:13, padding:'8px 16px' }}>{t('↻ Neu generieren', '↻ Regenerate')}</button>
          </div>
        )}
        {eulogyStyleOverlay}
        {genLangOverlay}
        {dlLangOverlay}
        {posterZoomOverlay}{posterStyleOverlay}
        {imgEditOverlay}
        {coverOverlay}
        {imgZoomOverlay}
        {reportOverlay}
        {transcriptReportOverlay}
      </div>
    )
}

// Die fünf Poster-Stile als Vorschau. Das Blatt wird im Browser aus den Szenen
// zusammengesetzt (dieselbe Layoutfunktion, die auch das PDF zeichnet) — Thumbnail
// und Lightbox zeigen deshalb exakt das, was heruntergeladen wird.
function PosterGallery({ poster, onZoom, onDownload, extraDl }) {
  const [previews, setPreviews] = useState({})
  const [failed, setFailed] = useState({})
  const variants = Array.isArray(poster?.variants) ? poster.variants : []

  useEffect(() => {
    let alive = true
    setPreviews({}); setFailed({})
    ;(async () => {
      for (const v of variants) {
        try {
          const url = await renderPosterPreview(poster, v, v.style)
          if (!alive) return
          setPreviews(p => ({ ...p, [v.style]: url }))
        } catch (e) {
          if (!alive) return
          setFailed(f => ({ ...f, [v.style]: e.message }))
        }
      }
    })()
    return () => { alive = false }
    // Signierte Bild-URLs werden bei jedem Laden neu gemintet → an ihnen hängt die Vorschau.
  }, [variants.map(v => v.scene_url || v.style).join('|')])

  if (!variants.length) return null
  return (
    <div style={{ marginTop:14, display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(220px, 1fr))', gap:14 }}>
      {variants.map(v => {
        const st = getPosterStyle(v.style)
        const url = previews[v.style]
        const busy = extraDl === `poster:${v.style}`
        return (
          <div key={v.style} style={{ border:'1px solid #e7e5e4', borderRadius:8, overflow:'hidden', background:'#fafaf9' }}>
            <div
              onClick={() => url && onZoom({ url, label: st.label })}
              style={{ aspectRatio:'594 / 420', background:'#f5f5f4', display:'flex', alignItems:'center', justifyContent:'center', cursor: url ? 'zoom-in' : 'default' }}
            >
              {url
                ? <img src={url} alt={st.label} style={{ width:'100%', height:'100%', objectFit:'cover', display:'block' }} />
                : <span style={{ fontSize:12, color:'#a8a29e' }}>{failed[v.style] ? '⚠ Vorschau fehlgeschlagen' : 'Vorschau wird gezeichnet …'}</span>}
            </div>
            <div style={{ padding:'8px 10px', display:'flex', alignItems:'center', justifyContent:'space-between', gap:8 }}>
              <span style={{ fontSize:12.5, fontWeight:600 }}>{st.label}</span>
              <button
                onClick={() => onDownload(v.style)}
                disabled={!!extraDl}
                className="secondary"
                style={{ fontSize:12, padding:'5px 10px', whiteSpace:'nowrap' }}
              >
                {busy ? '⏳ …' : '⬇ PDF'}
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function DetailView({ selected, orderDraft, setOrderDraft, setView, reloadContributions, loading, contributions, dlAll, logout, err, copyInvite, copied, copyQR, setTranscriptReport, setSelectedContrib, dlOne, deleteContribution, token, setSelected, GENERATORS, generating, genOwner, setEulogyStyleModal, requestGenerate, setEditMode, setEditDraft, downloadGenerated, downloadGeneratedPdf, downloadCover, openImgEdit, recheck, reviewingKey, genPct, genProgress, cancelGenerate, cancelGenRef, genErr, reviewPct, skipImages, setSkipImages, setReportModal, orderEdit, startOrderEdit, saveOrderData, orderSaving, cancelOrderEdit, handleDelete, deletingId, eulogyStyleOverlay, genLangOverlay, imgEditOverlay, coverOverlay, imgZoomOverlay, reportOverlay, transcriptReportOverlay, ManagerPhotos, bookHasImages, dlBusy, generateExtra, downloadExtra, extraDl, requestDownload, dlLangOverlay, setPosterZoom, posterZoomOverlay, requestPoster, posterStyleOverlay }) {
    // Lebenswerk (Autobiographie): nur Variante 2, Pflegeexzerpt statt Rede,
    // zusätzlich Stammbaum und Lebensposter.
    const t = useAdminT()
    const isLifework = selected?.product_category === 'lifework'
    const inviteUrl = `${window.location.origin}/?code=${selected.id}`
    // Experten-Einstellungen im Auftragsdaten-Formular: zunächst eingeklappt.
    const [odExpert, setOdExpert] = useState(false)
    // Je Buch-Variante: „Druck-PDF beim Download auch auf dem Server ablegen" (Default aus).
    const [storePdf, setStorePdf] = useState({})
    // Auftragsdaten-Bearbeitung: Feldkonfiguration der Kategorie + Draft-Helfer.
    const oci = getCategory(selected.product_category).intake
    const od = orderDraft
    const setOd  = patch => setOrderDraft(o => ({ ...o, ...patch }))
    const setOdPa = patch => setOrderDraft(o => ({ ...o, pickupAddress: { ...o.pickupAddress, ...patch } }))
    const dash = '—'
    const orderVariant = BOOK_VARIANTS.find(v => v.value === selected.book_variant) || BOOK_VARIANTS[0]
    const orderLangLabels = (selected.languages || ['de']).map(c => (LANGUAGES.find(l => l.code === c) || { label: c }).label).join(', ')
    return (
      <div style={{ minHeight: '100vh', background: '#fafaf9' }}>
        <div style={{ background: '#fff', borderBottom: '1px solid #e7e5e4', padding: '14px 24px', position: 'sticky', top: 0, zIndex: 50, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <button className="ghost" onClick={() => setView('list')} style={{ fontSize: 14, color: '#78716c' }}>{t('← Zurück', '← Back')}</button>
            <div>
              <span style={{ fontWeight: 700, fontSize: 16 }}>{selected.name || t('Name folgt', 'Name to follow')}</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button className="secondary" onClick={reloadContributions} disabled={loading} style={{ fontSize: 13, padding: '8px 14px' }}>
              {loading ? '…' : t('↻ Aktualisieren', '↻ Refresh')}
            </button>
            {contributions.length > 0 && (
              <button onClick={dlAll} style={{ fontSize: 13, padding: '8px 16px' }}>
                {t('⬇ Alle herunterladen', '⬇ Download all')} ({contributions.length})
              </button>
            )}
            <AdminLangToggle />
            <button className="secondary" onClick={logout} style={{ fontSize: 13, padding: '7px 14px' }}>{t('Abmelden', 'Log out')}</button>
          </div>
        </div>

        <div style={{ maxWidth: 900, margin: '2rem auto', padding: '0 1.5rem' }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>{t('Beiträge', 'Contributions')}</h2>
          <p style={{ fontSize: 14, color: '#78716c', marginBottom: '1rem' }}>
            {t('Organisator:', 'Organizer:')} {selected.organizer}
            {selected.gender ? ` · ${selected.gender}` : ''}
            {selected.book_variant ? ` · ${t('Buch-Variante', 'Book variant')} ${selected.book_variant}` : ''}
            {selected.funeral_date ? ` · ${getCategory(selected.product_category).intake.dateLabel}: ${new Date(selected.funeral_date).toLocaleDateString('de-DE')}` : ''}
            {selected.funeral_date ? ` · ${t('Erfassung bis:', 'Collection until:')} ${cutoffString(selected.funeral_date, cutoffDays(selected))} (${cutoffDays(selected)} ${t('Tage vorher', 'days before')})` : ''}
          </p>

          <div style={{ ...S.card, marginBottom: '1.5rem' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:12 }}>
              <div style={{ minWidth:0 }}>
                <Lbl>{t('Einladungslink (für Beitragende)', 'Invitation link (for contributors)')}</Lbl>
                <a
                  href={inviteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display:'block', fontFamily:'monospace', fontSize:13, wordBreak:'break-all', color:'#1d4ed8', marginTop:6, textDecoration:'underline' }}
                >{inviteUrl}</a>
              </div>
              <button className="secondary" onClick={() => copyInvite(selected.id)} style={{ fontSize:13, flexShrink:0 }}>
                {copied === selected.id ? t('✓ Kopiert', '✓ Copied') : t('📋 Kopieren', '📋 Copy')}
              </button>
            </div>
            <div style={{ marginTop:16, display:'flex', flexDirection:'column', alignItems:'center', gap:10 }}>
              <img
                src={qrCodeUrl(inviteUrl, 220)}
                alt={`QR-Code für ${inviteUrl}`}
                width={220}
                height={220}
                style={{ borderRadius:8, background:'#fff' }}
              />
              <button className="secondary" onClick={() => copyQR(selected.id)} style={{ fontSize: 13 }}>
                {copied === `qr-${selected.id}` ? t('✓ QR kopiert', '✓ QR copied') : t('📋 QR-Code kopieren', '📋 Copy QR code')}
              </button>
            </div>
          </div>

          <Err msg={err} />
          {loading ? (
            <p style={{ color: '#78716c', fontSize: 14 }}>Wird geladen …</p>
          ) : (<>
            {(() => {
              const corrs = contributions.flatMap(c => (Array.isArray(c.transcript_corrections) ? c.transcript_corrections : []).map(x => ({ ...x, contribId: c.id, contributor: c.contributor_name })))
              const appliedN = corrs.filter(x => x.applied).length
              const suggestN = corrs.filter(x => !x.applied && x.kind === 'suggestion').length
              const checkedN = contributions.filter(c => c.transcript_checked_at).length
              const totalN = contributions.length
              if (totalN === 0) return null
              return (
                <div style={{ ...S.card, marginBottom:'1.5rem', display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, flexWrap:'wrap' }}>
                  <div style={{ minWidth:0 }}>
                    <div style={{ fontWeight:600, fontSize:15 }}>🔎 Transkriptions-Prüfung</div>
                    <p style={{ ...S.muted, fontSize:13, margin:'4px 0 0' }}>
                      {checkedN}/{totalN} Beiträge geprüft · {appliedN} übernommen{suggestN ? ` · ${suggestN} Vorschlag${suggestN === 1 ? '' : 'e'}` : ''}.
                      {checkedN < totalN ? ' Neue Beiträge werden im Hintergrund automatisch geprüft.' : ''}
                    </p>
                  </div>
                  <button className="secondary" onClick={() => setTranscriptReport(true)} disabled={corrs.length === 0} style={{ fontSize:13, padding:'8px 14px', flexShrink:0 }}>
                    Bericht öffnen{corrs.length ? ` (${corrs.length})` : ''}
                  </button>
                </div>
              )
            })()}
            {selected.purge_info ? (
              <div style={{ ...S.card, marginBottom:'1.5rem', background:'#fffbeb', borderColor:'#fde68a' }}>
                <div style={{ fontWeight:600, marginBottom:6 }}>🗄 Beiträge gelöscht (Aufbewahrungsfrist)</div>
                <p style={{ ...S.muted, fontSize:13, margin:'0 0 10px' }}>
                  Am {new Date(selected.purge_info.purged_at).toLocaleString('de-DE')} wurden die einzelnen Beiträge gemäß Aufbewahrungsfrist gelöscht. Das Buch bleibt vollständig erhalten (Ansehen &amp; Download weiterhin möglich).
                </p>
                {(selected.purge_info.contributions || []).length > 0 && (
                  <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                    {selected.purge_info.contributions.map((t, ti) => (
                      <div key={ti} style={{ fontSize:13, color:'#57534e', borderTop:'1px solid #fde68a', paddingTop:6 }}>
                        Beitrag #{ti + 1} — gelöscht am {new Date(t.deleted_at).toLocaleString('de-DE')} · {t.reason}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : contributions.length === 0 ? (
              <div style={{ ...S.card, textAlign:'center', padding:'1.5rem', marginBottom:'1.5rem' }}>
                <p style={S.muted}>Noch keine Beiträge für dieses Buch.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom:'1.5rem' }}>
              {contributions.map((c, i) => {
                const answerCount = c.messages.filter(m => m.role === 'user').length
                return (
                  <div
                    key={i}
                    onClick={() => { setSelectedContrib(c); setView('contribution') }}
                    style={{ background: '#fff', border: '1px solid #e7e5e4', borderRadius: 12, padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, cursor:'pointer', transition:'background .1s' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#fafaf9'}
                    onMouseLeave={e => e.currentTarget.style.background = '#fff'}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                      <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#dbeafe', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 15, color: '#1d4ed8', flexShrink: 0 }}>
                        {c.contributor_name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 15 }}>{c.contributor_name}</div>
                        <div style={{ fontSize: 13, color: '#78716c' }}>
                          {c.relationship} · {new Date(c.created_at).toLocaleDateString('de-DE')} · {answerCount} Antwort{answerCount !== 1 ? 'en' : ''}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                      <button
                        onClick={(e) => { e.stopPropagation(); dlOne(c) }}
                        className="secondary"
                        style={{ fontSize: 13, padding: '8px 16px' }}
                      >
                        ⬇ Herunterladen
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteContribution(c) }}
                        className="secondary"
                        title="Beitrag löschen"
                        style={{ fontSize: 15, padding: '8px 12px', color: '#dc2626' }}
                      >
                        🗑
                      </button>
                    </div>
                  </div>
                )
              })}
              </div>
            )}

            <ManagerPhotos
              code={selected.id}
              token={token}
              uploads={selected.uploaded_images}
              contributions={contributions}
              onChange={next => setSelected(s => ({ ...s, uploaded_images: next }))}
            />

            <h3 style={{ fontSize:16, fontWeight:600, marginBottom:'.75rem' }}>Buch & {GENERATORS.eulogy.label}</h3>
            {(() => {
              const variant = BOOK_VARIANTS.find(v => v.value === selected.book_variant) || BOOK_VARIANTS[0]
              return (
                <div style={{ ...S.card, marginBottom:'1rem', background:'#f5f5f4', borderColor:'#e7e5e4' }}>
                  <Lbl>Gewählte Buch-Variante</Lbl>
                  <div style={{ fontWeight:600, fontSize:15, margin:'4px 0 2px' }}>{variant.title}</div>
                  <p style={{ ...S.muted, fontSize:13, margin:0 }}>{variant.sub}</p>
                  {selected.note && (
                    <div style={{ marginTop:14, paddingTop:14, borderTop:'1px solid #e7e5e4' }}>
                      <Lbl>Bemerkung</Lbl>
                      <p style={{ fontSize:14, lineHeight:1.6, color:'#44403c', margin:'4px 0 0', whiteSpace:'pre-wrap' }}>{selected.note}</p>
                    </div>
                  )}
                  {selected.pickup_address && (
                    <div style={{ marginTop:14, paddingTop:14, borderTop:'1px solid #e7e5e4' }}>
                      <Lbl>Sammelbestellungs-Adresse</Lbl>
                      <p style={{ fontSize:14, lineHeight:1.6, color:'#44403c', margin:'4px 0 0' }}>
                        {[
                          selected.pickup_address.name,
                          selected.pickup_address.addon,
                          selected.pickup_address.street,
                          [selected.pickup_address.zip, selected.pickup_address.city].filter(Boolean).join(' '),
                          selected.pickup_address.country,
                        ].filter(Boolean).map((line, i) => <span key={i}>{line}<br /></span>)}
                      </p>
                    </div>
                  )}
                </div>
              )
            })()}
            <div style={{ display:'flex', flexDirection:'column', gap:10, marginBottom:'1.5rem' }}>
              {[
                // Lebenswerk kennt nur Variante 2 (eine Autobiographie), und das
                // Nebenprodukt heißt hier Pflegeexzerpt statt Rede.
                ...(isLifework ? [] : [{ key:'book_v1', icon:'📄', title:GENERATORS.book_v1.label, sub:t('Jede Person als eigenes Kapitel (Ich-Form, fließender Text).', 'Each person as their own chapter (first person, flowing text).') }]),
                { key:'book_v2', icon:'✨', title:GENERATORS.book_v2.label, sub: isLifework
                  ? t('KI schreibt aus dem Interview die Autobiographie – chronologisch, in der Ich-Form.', 'The AI writes the autobiography from the interview – chronological, in the first person.')
                  : t('KI webt alle Beiträge zu einem stimmigen, literarischen Text.', 'The AI weaves all contributions into one coherent, literary text.') },
                { key:'eulogy',  icon: isLifework ? '🩺' : '🕯', title:GENERATORS.eulogy.label, sub: isLifework
                  ? t('Zweiseitige Zusammenfassung für die Pflegeakte – Sprache wird beim Erzeugen abgefragt.', 'Two-page summary for the care record – language is asked when generating.')
                  : t(`KI verfasst einen persönlichen Text (${GENERATORS.eulogy.noun}) zum Vorlesen.`, `The AI writes a personal text (${GENERATORS.eulogy.noun}) to read aloud.`) },
              ].map(({ key, icon, title, sub }) => {
                const gen   = GENERATORS[key]
                const has   = !!selected[gen.field]
                // Druck-PDF entfällt bei Rechts-nach-links-Sprachen (jsPDF formt
                // keine arabischen Ligaturen); DOCX geht dort weiter.
                const pdfOk = canPrintPdf(selected[gen.field]?.language)
                const busy  = !!generating[key] && genOwner[key] === selected.id
                const report = selected.content_reports?.[gen.field]
                const totalFindings = report?.findings?.length || 0
                const openFindings = report?.findings?.filter(f => f.status !== 'resolved').length || 0
                return (
                  <div key={key} style={{ ...S.card }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12, marginBottom:12 }}>
                      <div>
                        <div style={{ fontWeight:600, marginBottom:4 }}>{icon} {title}</div>
                        <p style={{ ...S.muted, fontSize:13, margin:0 }}>{sub}</p>
                      </div>
                      {has && !busy && <span style={{ fontSize:11, color:'#16a34a', background:'#dcfce7', padding:'3px 8px', borderRadius:6, whiteSpace:'nowrap' }}>{t('✓ Generiert', '✓ Generated')}</span>}
                    </div>
                    <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                      <button onClick={() => key === 'eulogy' ? setEulogyStyleModal(true) : requestGenerate(key)} disabled={busy || contributions.length === 0} style={{ fontSize:13, padding:'8px 14px' }}>
                        {busy ? t('Wird generiert …', 'Generating …') : has ? t('↻ Neu generieren', '↻ Regenerate') : t('✨ Generieren', '✨ Generate')}
                      </button>
                      <button onClick={() => { setEditMode(false); setEditDraft(null); setView(gen.view) }} disabled={!has || busy} className="secondary" style={{ fontSize:13, padding:'8px 14px' }}>
                        {t('👁 Ansehen/Bearbeiten', '👁 View/Edit')}
                      </button>
                      <button onClick={() => requestDownload(key)} disabled={!has || busy || !!dlBusy} className="secondary" style={{ fontSize:13, padding:'8px 14px' }}>
                        {dlBusy === `${key}:docx` ? t('⏳ Wird erstellt …', '⏳ Creating …') : t('⬇ Download .docx', '⬇ Download .docx')}
                      </button>
                      {gen.kind === 'book' ? (
                        pdfOk ? (
                          <>
                          <button onClick={() => downloadGeneratedPdf(key, !!storePdf[key])} disabled={!has || busy || !!dlBusy} className="secondary" style={{ fontSize:13, padding:'8px 14px' }}>
                            {dlBusy === `${key}:pdf-store` ? t('⏳ Wird abgelegt …', '⏳ Storing …') : dlBusy === `${key}:pdf` ? t('⏳ Wird erstellt …', '⏳ Creating …') : t('🖨 Druck-PDF', '🖨 Print PDF')}
                          </button>
                          <label title={t('Zusätzlich eine Kopie auf dem Server ablegen und hier einen Download-Link anzeigen. Wird beim Löschen des Buchs mitgelöscht.', 'Also store a copy on the server and show a download link here. It is deleted together with the book.')}
                                 style={{ display:'inline-flex', alignItems:'center', gap:6, fontSize:12, color:'#78716c', cursor: has ? 'pointer' : 'default', opacity: has ? 1 : 0.5 }}>
                            <input type="checkbox" disabled={!has || busy} checked={!!storePdf[key]} onChange={e => setStorePdf(s => ({ ...s, [key]: e.target.checked }))} style={{ width:15, height:15, cursor:'pointer', accentColor:'#1c1917' }} />
                            {t('auf Server ablegen', 'store on server')}
                          </label>
                          </>
                        ) : null
                      ) : (
                        <button onClick={() => requestDownload(key, 'pdf')} disabled={!has || busy || !!dlBusy} className="secondary" style={{ fontSize:13, padding:'8px 14px' }}>
                          {dlBusy === `${key}:pdf` ? t('⏳ Wird erstellt …', '⏳ Creating …') : t('⬇ Download .pdf', '⬇ Download .pdf')}
                        </button>
                      )}
                      {gen.kind === 'book' && (
                        <button
                          onClick={() => downloadCover(key)}
                          disabled={!has || busy || !!dlBusy || !selected[gen.field]?.print_pages}
                          className="secondary"
                          title={selected[gen.field]?.print_pages
                            ? t(`Rückenstärke aus ${selected[gen.field].print_pages} Seiten`, `Spine width from ${selected[gen.field].print_pages} pages`)
                            : t('Erst das Druck-PDF erzeugen — daraus ergibt sich die Rückenstärke.', 'First create the print PDF — the spine width follows from it.')}
                          style={{ fontSize:13, padding:'8px 14px' }}
                        >
                          {dlBusy === `${key}:cover-img` ? t('⏳ Hintergrund wird erzeugt …', '⏳ Creating background …')
                            : dlBusy === `${key}:cover` ? t('⏳ Wird erstellt …', '⏳ Creating …')
                            : t('📕 Druck-Cover', '📕 Print cover')}
                        </button>
                      )}
                      {gen.kind === 'book' && (
                        <button onClick={() => openImgEdit(key)} disabled={!has || busy || !bookHasImages(selected[gen.field])} className="secondary" style={{ fontSize:13, padding:'8px 14px' }}>
                          {t('🖼 Bilder überarbeiten', '🖼 Rework images')}
                        </button>
                      )}
                      <button onClick={() => recheck(key)} disabled={!has || busy || reviewingKey === key} className="secondary" style={{ fontSize:13, padding:'8px 14px' }}>
                        {reviewingKey === key ? t('Prüft …', 'Checking …') : t('🛡 Prüfung wiederholen', '🛡 Repeat check')}
                      </button>
                    </div>
                    {selected.stored_pdf_urls?.[key]?.url && (
                      <div style={{ marginTop:10, fontSize:13, background:'#f0fdf4', border:'1px solid #bbf7d0', borderRadius:8, padding:'8px 12px', display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                        <span aria-hidden="true">📄</span>
                        <a href={selected.stored_pdf_urls[key].url} target="_blank" rel="noopener noreferrer" style={{ color:'#166534', fontWeight:600, textDecoration:'underline' }}>
                          {t('Auf dem Server abgelegtes Druck-PDF öffnen', 'Open print PDF stored on the server')}
                        </a>
                        {selected.stored_pdf_urls[key].at && (
                          <span style={{ color:'#3f6212', fontSize:12 }}>· {new Date(selected.stored_pdf_urls[key].at).toLocaleString('de-DE')}</span>
                        )}
                      </div>
                    )}
                    {busy && (
                      <div style={{ marginTop:10 }}>
                        {genPct[key] != null && (
                          <div style={{ height:6, background:'#e7e5e4', borderRadius:999, overflow:'hidden', marginBottom:6 }}>
                            <div style={{ width:`${genPct[key]}%`, height:'100%', background:'#1c1917', transition:'width .3s' }} />
                          </div>
                        )}
                        <p style={{ fontSize:12, color:'#78716c', margin:0 }}>
                          {genPct[key] != null ? `${genPct[key]} % · ` : ''}{genProgress[key] || t('Wird generiert …', 'Generating …')}
                        </p>
                        <button onClick={() => cancelGenerate(key)} disabled={!!cancelGenRef.current[key]} className="secondary" style={{ fontSize:12, padding:'5px 10px', marginTop:8, color:'#b91c1c', borderColor:'#fecaca' }}>
                          {t('✕ Abbrechen', '✕ Cancel')}
                        </button>
                      </div>
                    )}
                    {!busy && genErr[key] && genOwner[key] === selected.id && (
                      <div style={{ marginTop:10 }}><Err msg={genErr[key]} /></div>
                    )}
                    {reviewingKey === key && (
                      <div style={{ marginTop:10 }}>
                        <div style={{ height:6, background:'#e7e5e4', borderRadius:999, overflow:'hidden', marginBottom:6 }}>
                          <div style={{ width:`${reviewPct}%`, height:'100%', background:'#1c1917', transition:'width .3s' }} />
                        </div>
                        <p style={{ fontSize:12, color:'#78716c', margin:0 }}>{t('🛡 Inhaltsprüfung läuft …', '🛡 Content check running …')} {reviewPct} %</p>
                      </div>
                    )}
                    {gen.kind === 'book' && (
                      <label style={{ display:'inline-flex', alignItems:'center', gap:8, marginTop:10, fontSize:12, color:'#78716c', cursor:'pointer' }}>
                        <input type="checkbox" checked={skipImages} onChange={e => setSkipImages(e.target.checked)} style={{ width:16, height:16, flexShrink:0, margin:0, cursor:'pointer' }} />
                        {t('🐞 Bilder überspringen (schneller – für Tests)', '🐞 Skip images (faster – for tests)')}
                      </label>
                    )}
                    {has && !busy && report && (
                      <div style={{ marginTop:10, paddingTop:10, borderTop:'1px solid #f5f5f4' }}>
                        {report.error ? (
                          <span style={{ fontSize:12, color:'#b45309' }}>{t('⚠ Inhaltsprüfung fehlgeschlagen.', '⚠ Content check failed.')}{' '}
                            <button className="ghost" onClick={() => setReportModal({ title, field: gen.field, report })} style={{ fontSize:12, padding:0, textDecoration:'underline' }}>{t('Details', 'Details')}</button>
                          </span>
                        ) : openFindings > 0 ? (
                          <button onClick={() => setReportModal({ title, field: gen.field, report })} style={{ fontSize:13, padding:'7px 12px', background:'#b91c1c' }}>
                            {t('🛡 Prüfbericht ansehen', '🛡 View check report')} ({openFindings} {t('offen', 'open')}{totalFindings > openFindings ? `, ${totalFindings - openFindings} ${t('erledigt', 'done')}` : ''})
                          </button>
                        ) : totalFindings > 0 ? (
                          <button onClick={() => setReportModal({ title, field: gen.field, report })} className="secondary" style={{ fontSize:13, padding:'7px 12px', color:'#15803d', borderColor:'#bbf7d0' }}>
                            {t(`✓ Alle ${totalFindings} Befunde bearbeitet – Bericht ansehen`, `✓ All ${totalFindings} findings handled – view report`)}
                          </button>
                        ) : (
                          <span style={{ fontSize:12, color:'#15803d' }}>{t('🛡 Inhaltsprüfung durchgeführt – keine kritischen Aussagen gefunden.', '🛡 Content check done – no critical statements found.')}</span>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}

              {/* Grafische Nebenprodukte des Lebenswerks. Beide entstehen aus dem
                  Interview als strukturierte Daten und werden daraus gezeichnet —
                  erneutes Laden kostet deshalb keine KI. */}
              {isLifework && [
                { kind:'tree',   field:'family_tree', icon:'🌳', title:t('Stammbaum', 'Family tree'),
                  sub:t('KI liest die Familie aus dem Interview; daraus entsteht ein Stammbaum (PDF, A3 hoch).', 'The AI reads the family from the interview; a family tree is created from it (PDF, A3 portrait).') },
                { kind:'poster', field:'life_poster', icon:'🖼', title:t('Lebensposter', 'Life poster'),
                  sub:t('Ein illustriertes Blatt (A2 quer): Die Bild-KI malt den Lebensweg mit allen Szenen in einem Zug, die Beschriftung kommt als scharfer Vektortext darüber. Die Stile wählst du vor der Erzeugung.', 'An illustrated sheet (A2 landscape): the image AI paints the life path with all scenes in one go, the labels are added as crisp vector text on top. You choose the styles before generating.') },
              ].map(({ kind, field, icon, title, sub }) => {
                const has  = !!selected[field]
                // Läuft serverseitig als Job — Fortschritt und Abbrechen wie beim Buch.
                const busy = !!generating[kind] && genOwner[kind] === selected.id
                const hasVariants = kind === 'poster' && Array.isArray(selected.life_poster?.variants) && selected.life_poster.variants.length > 0
                return (
                  <div key={kind} style={{ ...S.card }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12, marginBottom:12 }}>
                      <div>
                        <div style={{ fontWeight:600, marginBottom:4 }}>{icon} {title}</div>
                        <p style={{ ...S.muted, fontSize:13, margin:0 }}>{sub}</p>
                      </div>
                      {has && !busy && <span style={{ fontSize:11, color:'#16a34a', background:'#dcfce7', padding:'3px 8px', borderRadius:6, whiteSpace:'nowrap' }}>{t('✓ Erzeugt', '✓ Created')}</span>}
                    </div>
                    <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                      <button onClick={() => kind === 'poster' ? requestPoster() : generateExtra(kind)} disabled={busy || contributions.length === 0} style={{ fontSize:13, padding:'8px 14px' }}>
                        {busy ? t('Wird erzeugt …', 'Creating …') : has ? t('↻ Neu erzeugen', '↻ Recreate') : t('✨ Erzeugen', '✨ Create')}
                      </button>
                      {/* Beim Poster hängt der Download an der einzelnen Stil-Vorschau unten. */}
                      {!hasVariants && (
                        <button onClick={() => downloadExtra(kind)} disabled={!has || busy || !!extraDl} className="secondary" style={{ fontSize:13, padding:'8px 14px' }}>
                          {extraDl === kind ? t('⏳ PDF wird erstellt …', '⏳ Creating PDF …') : t('⬇ Download PDF', '⬇ Download PDF')}
                        </button>
                      )}
                    </div>
                    {hasVariants && !busy && (
                      <PosterGallery
                        poster={selected.life_poster}
                        onZoom={setPosterZoom}
                        onDownload={styleKey => downloadExtra('poster', selected, styleKey)}
                        extraDl={extraDl}
                      />
                    )}
                    {busy && (
                      <div style={{ marginTop:10 }}>
                        {genPct[kind] != null && (
                          <div style={{ height:6, background:'#e7e5e4', borderRadius:999, overflow:'hidden', marginBottom:6 }}>
                            <div style={{ width:`${genPct[kind]}%`, height:'100%', background:'#1c1917', transition:'width .3s' }} />
                          </div>
                        )}
                        <p style={{ fontSize:12, color:'#78716c', margin:0 }}>
                          {genPct[kind] != null ? `${genPct[kind]} % · ` : ''}{genProgress[kind] || t('Wird erzeugt …', 'Creating …')}
                        </p>
                        <button onClick={() => cancelGenerate(kind)} disabled={!!cancelGenRef.current[kind]} className="secondary" style={{ fontSize:12, padding:'5px 10px', marginTop:8, color:'#b91c1c', borderColor:'#fecaca' }}>
                          {t('✕ Abbrechen', '✕ Cancel')}
                        </button>
                      </div>
                    )}
                    {!busy && genErr[kind] && genOwner[kind] === selected.id && (
                      <div style={{ marginTop:10 }}><Err msg={genErr[kind]} /></div>
                    )}
                  </div>
                )
              })}
            </div>
          </>)}

          <div style={S.divider} />

          {/* ── Auftragsdaten (Stammdaten) — selten gebraucht, daher unten ── */}
          <div style={{ ...S.card, marginBottom:'1.5rem' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, marginBottom: orderEdit ? 16 : 4 }}>
              <h3 style={{ fontSize:16, fontWeight:600, margin:0 }}>{t('Auftragsdaten', 'Order data')}</h3>
              {!orderEdit && (
                <button className="secondary" onClick={startOrderEdit} style={{ fontSize:13, padding:'8px 14px' }}>{t('✎ Bearbeiten', '✎ Edit')}</button>
              )}
            </div>

            {!orderEdit ? (
              <div style={{ display:'grid', gridTemplateColumns:'auto 1fr', columnGap:18, rowGap:8, fontSize:14 }}>
                {[
                  [oci.subjectLabel || 'Name', selected.name || dash],
                  ['Organisator', selected.organizer || dash],
                  ...(oci.useGender ? [['Geschlecht', selected.gender || dash]] : []),
                  ...((oci.extra || []).map(f => [f.label, selected.intake?.[f.key] || dash])),
                  ...(oci.useDate ? [[oci.dateLabel, selected.funeral_date ? new Date(selected.funeral_date).toLocaleDateString('de-DE') : dash]] : []),
                  ...(oci.useCutoff ? [['Erfassung bis', selected.funeral_date ? `${cutoffString(selected.funeral_date, cutoffDays(selected))} (${cutoffDays(selected)} Tage vorher)` : `${cutoffDays(selected)} Tage vorher`]] : []),
                  ['Sprachen', orderLangLabels],
                  ['Buch-Variante', orderVariant.title],
                  ...(selected.product_category === 'memorial' ? [['Einführungsvideo', selected.show_intro_video !== false ? 'Ja' : 'Nein']] : []),
                  ['Transkript-Anzeige', selected.show_transcript !== false ? 'Ja' : 'Nein'],
                  ['Namensliste im Buch', selected.show_contributors !== false ? 'Ja' : 'Nein'],
                  ['Foto-Upload als Tab', selected.photo_upload_tab === true ? 'Ja' : 'Nein'],
                  ['Bemerkung', selected.note || dash],
                  ['Sammelbestellungs-Adresse', selected.pickup_address
                    ? [selected.pickup_address.name, selected.pickup_address.addon, selected.pickup_address.street,
                       [selected.pickup_address.zip, selected.pickup_address.city].filter(Boolean).join(' '),
                       selected.pickup_address.country].filter(Boolean).join(', ')
                    : dash],
                ].map(([label, val], i) => (
                  <Fragment key={i}>
                    <div style={{ color:'#78716c', whiteSpace:'nowrap' }}>{label}</div>
                    <div style={{ color:'#44403c', whiteSpace:'pre-wrap' }}>{val}</div>
                  </Fragment>
                ))}
              </div>
            ) : od && (
              <div>
                <div style={{ marginBottom:14 }}>
                  <Lbl>{oci.subjectLabel || 'Name'} *</Lbl>
                  <input value={od.name} onChange={e => setOd({ name: e.target.value })} />
                </div>
                <div style={{ marginBottom:14 }}>
                  <Lbl>Organisator *</Lbl>
                  <input value={od.organizer} onChange={e => setOd({ organizer: e.target.value })} />
                </div>
                {oci.useGender && (
                  <div style={{ marginBottom:14 }}>
                    <Lbl>{oci.genderLabel}</Lbl>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8 }}>
                      {GENDERS.map(g => (
                        <div key={g.value} onClick={() => setOd({ gender: g.value })}
                          style={{ ...S.card, cursor:'pointer', textAlign:'center', padding:'12px 8px',
                            borderColor: od.gender === g.value ? '#1c1917' : '#e7e5e4', borderWidth: od.gender === g.value ? 2 : 1,
                            fontSize:14, fontWeight: od.gender === g.value ? 600 : 400 }}>
                          {g.label}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {(oci.extra || []).map(f => (
                  <div key={f.key} style={{ marginBottom:14 }}>
                    <Lbl>{f.label}</Lbl>
                    <input value={od.intake?.[f.key] || ''} onChange={e => setOd({ intake: { ...od.intake, [f.key]: e.target.value } })} placeholder={f.placeholder || ''} />
                  </div>
                ))}
                {oci.useDate && (
                  <div style={{ marginBottom:14 }}>
                    <Lbl>{oci.dateLabel}</Lbl>
                    <input type="date" value={od.funeralDate} onChange={e => setOd({ funeralDate: e.target.value })} />
                  </div>
                )}
                {oci.useCutoff && (
                  <div style={{ marginBottom:14 }}>
                    <Lbl>{oci.cutoffLabel}</Lbl>
                    <input type="number" min={0} max={90} step={1} value={od.cutoffDays}
                      onChange={e => { const v = e.target.value; setOd({ cutoffDays: v === '' ? '' : Math.max(0, parseInt(v, 10) || 0) }) }} />
                    <p style={{ fontSize:12, color:'#78716c', marginTop:6 }}>
                      {od.funeralDate && Number.isFinite(parseInt(od.cutoffDays, 10))
                        ? <>Beiträge fließen bis zum <strong>{cutoffString(od.funeralDate, parseInt(od.cutoffDays, 10))}</strong> ein.</>
                        : <>Standard sind 7 Tage.</>}
                    </p>
                  </div>
                )}
                <div style={{ marginBottom:14 }}>
                  <Lbl>Buch-Variante *</Lbl>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr', gap:8 }}>
                    {BOOK_VARIANTS.map(v => (
                      <div key={v.value} onClick={() => setOd({ bookVariant: v.value })}
                        style={{ ...S.card, cursor:'pointer', padding:'14px 14px',
                          borderColor: od.bookVariant === v.value ? '#1c1917' : '#e7e5e4', borderWidth: od.bookVariant === v.value ? 2 : 1 }}>
                        <div style={{ fontWeight:600, fontSize:14, marginBottom:4 }}>{v.title}</div>
                        <div style={{ fontSize:13, color:'#78716c', lineHeight:1.5 }}>{v.sub}</div>
                      </div>
                    ))}
                  </div>
                </div>
                <button type="button" onClick={() => setOdExpert(v => !v)} className="secondary" style={{ fontSize:13, padding:'8px 14px', margin:'4px 0 16px' }}>
                  {odExpert ? '⚙ Expertenmodus ausblenden' : '⚙ Expertenmodus (weitere Optionen)'}
                </button>
                {odExpert && (<>
                <div style={{ marginBottom:14 }}>
                  <Lbl>Sprachen *</Lbl>
                  <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
                    {LANGUAGES.map(l => {
                      const on = od.languages.includes(l.code)
                      return (
                        <label key={l.code} style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', ...S.card, padding:'10px 14px',
                          borderColor: on ? '#1c1917' : '#e7e5e4', borderWidth: on ? 2 : 1 }}>
                          <input type="checkbox" checked={on}
                            onChange={() => setOrderDraft(o => {
                              const next = on ? o.languages.filter(c => c !== l.code) : [...o.languages, l.code]
                              return { ...o, languages: next.length ? next : o.languages }
                            })}
                            style={{ width:16, height:16, accentColor:'#1c1917', cursor:'pointer' }} />
                          <span style={{ fontSize:14, fontWeight: on ? 600 : 400 }}>{l.label}</span>
                        </label>
                      )
                    })}
                  </div>
                </div>
                <div style={{ marginBottom:14 }}>
                  <Lbl>Textstil des Buchs</Lbl>
                  <p style={{ ...S.muted, fontSize:12, margin:'0 0 8px' }}>Wie die KI schreibt. Wirkt auf die nächste Buch-Generierung.</p>
                  <TextStylePicker category={selected.product_category} value={od.textStyle} onChange={k => setOd({ textStyle: k })} />
                </div>
                <div style={{ marginBottom:14 }}>
                  <Lbl>Grafikstil der Bilder</Lbl>
                  <p style={{ ...S.muted, fontSize:12, margin:'0 0 8px' }}>Gilt für künftig erzeugte Bilder. Bereits generierte Bilder bleiben, bis sie neu erzeugt werden (im Buch über „🖼 Bilder überarbeiten").</p>
                  <ImageStylePicker value={od.imageStyle} onChange={k => setOd({ imageStyle: k })} />
                </div>
                <div style={{ marginBottom:14 }}>
                  <Lbl>Buchlayout (Schrift &amp; Design)</Lbl>
                  <p style={{ ...S.muted, fontSize:12, margin:'0 0 8px' }}>Wirkt sofort auf Leseansicht und die nächsten Exporte (DOCX/Druck-PDF); der Buchinhalt bleibt gleich.</p>
                  <BookLayoutPicker value={od.bookLayout} onChange={k => setOd({ bookLayout: k })} />
                </div>
                {selected.product_category === 'memorial' && (
                <div style={{ marginBottom:14 }}>
                  <Lbl>Einführungsvideo</Lbl>
                  <label style={{ display:'flex', alignItems:'center', gap:10, cursor:'pointer', marginTop:8 }}>
                    <input type="checkbox" checked={od.showIntroVideo} onChange={e => setOd({ showIntroVideo: e.target.checked })}
                      style={{ width:18, height:18, cursor:'pointer', accentColor:'#1c1917', flexShrink:0 }} />
                    <span style={{ fontSize:14 }}>Einführungsvideo vor dem Sprach-Interview anzeigen</span>
                  </label>
                </div>
                )}
                <div style={{ marginBottom:14 }}>
                  <Lbl>Transkript-Schalter im Sprach-Interview</Lbl>
                  <label style={{ display:'flex', alignItems:'center', gap:10, cursor:'pointer', marginTop:8 }}>
                    <input type="checkbox" checked={od.showTranscript !== false} onChange={e => setOd({ showTranscript: e.target.checked })}
                      style={{ width:18, height:18, cursor:'pointer', accentColor:'#1c1917', flexShrink:0 }} />
                    <span style={{ fontSize:14 }}>Schalter anbieten, mit dem das Transkript eingeblendet werden kann</span>
                  </label>
                  <p style={{ fontSize:12, color:'#78716c', marginTop:6, marginLeft:28 }}>
                    Das Interview startet immer ohne Transkript.
                  </p>
                </div>
                {/* Beim Lebenswerk erzählt nur eine Person — eine Namensliste der
                    Beitragenden ergibt dort keinen Sinn. */}
                {!isLifework && (
                <div style={{ marginBottom:14 }}>
                  <Lbl>Namensliste der Beitragenden im Buch</Lbl>
                  <label style={{ display:'flex', alignItems:'center', gap:10, cursor:'pointer', marginTop:8 }}>
                    <input type="checkbox" checked={od.showContributors !== false} onChange={e => setOd({ showContributors: e.target.checked })}
                      style={{ width:18, height:18, cursor:'pointer', accentColor:'#1c1917', flexShrink:0 }} />
                    <span style={{ fontSize:14 }}>Namen der Beitragenden am Ende des Buches drucken („Mitwirkende")</span>
                  </label>
                  <p style={{ fontSize:12, color:'#78716c', marginTop:6, marginLeft:28 }}>
                    Wirkt sofort auf jeden neuen DOCX- und Druck-PDF-Export — das Buch muss dafür nicht neu erzeugt werden.
                  </p>
                </div>
                )}
                <div style={{ marginBottom:14 }}>
                  <Lbl>Foto-Upload als Tab im Interview</Lbl>
                  <label style={{ display:'flex', alignItems:'center', gap:10, cursor:'pointer', marginTop:8 }}>
                    <input type="checkbox" checked={od.photoUploadTab === true} onChange={e => setOd({ photoUploadTab: e.target.checked })}
                      style={{ width:18, height:18, cursor:'pointer', accentColor:'#1c1917', flexShrink:0 }} />
                    <span style={{ fontSize:14 }}>Foto-Upload als Tab im Interview (ohne diese Option kein Foto-Upload)</span>
                  </label>
                </div>
                <div style={{ marginBottom:14 }}>
                  <Lbl>Bemerkung</Lbl>
                  <textarea value={od.note} onChange={e => setOd({ note: e.target.value })} rows={3}
                    placeholder="Interne Notiz zu diesem Buch (optional)."
                    style={{ width:'100%', resize:'vertical', fontFamily:'inherit', fontSize:14 }} />
                </div>
                <div style={{ marginBottom:20 }}>
                  <Lbl>Sammelbestellungs-Adresse (optional)</Lbl>
                  <input value={od.pickupAddress.name} onChange={e => setOdPa({ name: e.target.value })} placeholder="Name / Empfänger" style={{ marginBottom:8 }} />
                  <input value={od.pickupAddress.addon} onChange={e => setOdPa({ addon: e.target.value })} placeholder="Adresszusatz (z. B. c/o, Firma)" style={{ marginBottom:8 }} />
                  <input value={od.pickupAddress.street} onChange={e => setOdPa({ street: e.target.value })} placeholder="Straße und Hausnummer" style={{ marginBottom:8 }} />
                  <div style={{ display:'flex', gap:8, marginBottom:8 }}>
                    <input value={od.pickupAddress.zip} onChange={e => setOdPa({ zip: e.target.value })} placeholder="PLZ" style={{ flex:'0 0 120px' }} />
                    <input value={od.pickupAddress.city} onChange={e => setOdPa({ city: e.target.value })} placeholder="Ort" style={{ flex:1 }} />
                  </div>
                  <input value={od.pickupAddress.country} onChange={e => setOdPa({ country: e.target.value })} placeholder="Land" />
                </div>
                </>)}
                <div style={{ display:'flex', gap:10 }}>
                  <button onClick={saveOrderData} disabled={orderSaving} style={{ fontSize:14, padding:'10px 20px' }}>
                    {orderSaving ? 'Wird gespeichert …' : 'Speichern'}
                  </button>
                  <button className="secondary" onClick={cancelOrderEdit} disabled={orderSaving} style={{ fontSize:14, padding:'10px 20px' }}>Abbrechen</button>
                </div>
              </div>
            )}
          </div>

          <div style={S.divider} />
          <button
            onClick={async () => { if (await handleDelete(selected)) setView('list') }}
            disabled={deletingId === selected.id}
            className="secondary"
            style={{ fontSize:13, padding:'10px 18px', color:'#dc2626', borderColor:'#fecaca' }}
          >
            {deletingId === selected.id ? 'Wird gelöscht …' : '🗑 Dieses Buch löschen'}
          </button>
        </div>
        {eulogyStyleOverlay}
        {genLangOverlay}
        {dlLangOverlay}
        {posterZoomOverlay}{posterStyleOverlay}
        {imgEditOverlay}
        {coverOverlay}
        {imgZoomOverlay}
        {reportOverlay}
        {transcriptReportOverlay}
      </div>
    )
}

// Qualitätsmanagement: Beitragenden-Bewertungen (Smiley 1..5 + Kommentar) aller
// zugänglichen Bücher, neueste zuerst. Daten aus GET /api/admin/feedback.
export function QMView({ qmData, loading, err, setView, logout, toggleFeedbackDone, deleteFeedback }) {
  const t = useAdminT()
  const faces = ['😞', '😕', '😐', '🙂', '😍']
  const rows = Array.isArray(qmData) ? qmData : []
  const avg = rows.length ? rows.reduce((s, r) => s + (r.rating || 0), 0) / rows.length : 0
  const fmt = ts => { try { return new Date(ts).toLocaleString('de-DE') } catch { return ts } }
  return (
    <div style={{ minHeight:'100vh', background:'#fafaf9' }}>
      <div style={{ background: '#fff', borderBottom: '1px solid #e7e5e4', padding: '14px 24px', position: 'sticky', top: 0, zIndex: 50, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display:'flex', alignItems:'center', gap:16 }}>
          <button className="ghost" onClick={() => setView('list')} style={{ fontSize:14, color:'#78716c' }}>{t('← Zurück', '← Back')}</button>
          <span style={{ fontWeight:700, fontSize:16 }}>{t('Qualitätsmanagement', 'Quality management')}</span>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <AdminLangToggle />
          <button className="secondary" onClick={logout} style={{ fontSize:13, padding:'7px 14px' }}>{t('Abmelden', 'Log out')}</button>
        </div>
      </div>
      <div style={{ maxWidth:1000, margin:'2rem auto', padding:'0 1.5rem' }}>
        <h2 style={{ fontSize:22, fontWeight:700, marginBottom:4 }}>{t('Feedback der Beitragenden', 'Contributor feedback')}</h2>
        <p style={{ ...S.muted, marginBottom:'1.5rem' }}>
          {t('Bewertungen direkt nach dem Interview (Smiley-Skala + optionaler Kommentar), neueste zuerst.', 'Ratings right after the interview (smiley scale + optional comment), newest first.')}
          {rows.length > 0 && <> · {rows.length} {rows.length === 1 ? t('Bewertung', 'rating') : t('Bewertungen', 'ratings')} · ⌀ {avg.toFixed(1)} / 5</>}
        </p>
        <Err msg={err} />
        {loading ? (
          <p style={S.muted}>{t('Wird geladen …', 'Loading …')}</p>
        ) : rows.length === 0 ? (
          <div style={{ ...S.card, textAlign:'center', padding:'1.5rem' }}>
            <p style={S.muted}>{t('Noch keine Bewertungen. Beitragende geben ihr Feedback nach dem Interview ab.', 'No ratings yet. Contributors leave their feedback after the interview.')}</p>
          </div>
        ) : (
          <div style={{ ...S.card, padding:0, overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead>
                <tr>
                  <th style={{ ...th, textAlign:'center' }}>{t('Erledigt', 'Done')}</th>
                  <th style={th}>{t('Zeitpunkt', 'Time')}</th>
                  <th style={th}>{t('Bewertung', 'Rating')}</th>
                  <th style={th}>{t('Beitragende:r', 'Contributor')}</th>
                  <th style={th}>{t('Buchprojekt', 'Book project')}</th>
                  <th style={th}>{t('Manager', 'Manager')}</th>
                  <th style={th}>{t('Kommentar', 'Comment')}</th>
                  <th style={{ ...th, textAlign:'right' }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} style={{ opacity: r.done ? 0.5 : 1 }}>
                    <td style={{ ...col, textAlign:'center' }}>
                      <input type="checkbox" checked={!!r.done} onChange={e => toggleFeedbackDone?.(r.id, e.target.checked)}
                        title={t('Als erledigt markieren', 'Mark as done')} style={{ width:17, height:17, cursor:'pointer', accentColor:'#1c1917' }} />
                    </td>
                    <td style={{ ...col, whiteSpace:'nowrap', color:'#78716c', fontSize:13 }}>{fmt(r.at)}</td>
                    <td style={{ ...col, whiteSpace:'nowrap' }}>
                      <span style={{ fontSize:20 }} title={`${r.rating} / 5`}>{faces[Math.min(4, Math.max(0, (r.rating || 1) - 1))]}</span>
                      <span style={{ color:'#a8a29e', fontSize:12, marginLeft:6 }}>{r.rating}/5</span>
                    </td>
                    <td style={{ ...col }}>{r.contributor_name || '—'}{r.relationship ? <span style={{ color:'#a8a29e', fontSize:12 }}> · {r.relationship}</span> : null}</td>
                    <td style={{ ...col, color:'#78716c' }}>{r.memorial_name}</td>
                    <td style={{ ...col, color:'#78716c', fontSize:13 }}>{r.owner_username || '—'}</td>
                    <td style={{ ...col, maxWidth:360, whiteSpace:'pre-wrap', color:'#44403c' }}>{r.text || '—'}</td>
                    <td style={{ ...col, textAlign:'right', whiteSpace:'nowrap' }}>
                      <button className="secondary" onClick={() => deleteFeedback?.(r.id)}
                        style={{ fontSize:12, padding:'5px 10px', color:'#dc2626', borderColor:'#fecaca' }}>{t('Löschen', 'Delete')}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
