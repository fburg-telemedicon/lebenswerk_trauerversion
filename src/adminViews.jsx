// src/adminViews.jsx — aus Dashboard() ausgelagerte Admin-Views.
// Jede View bekommt State + Handler als GLEICHNAMIGE Props -> Body verbatim,
// verhaltensneutral. Modul-Helfer (S/Back/Err) werden importiert.

import { Fragment, useState } from 'react'
import { S, Back, Err, Lbl, col, th, PartnerBanner, Dots } from './ui.jsx'
import { formatEur, costKindLabel, PASSWORD_RULES_TEXT, qrCodeUrl, cutoffDate, cutoffDays, cutoffString, imageErrorDe } from './shared.js'
import { CATEGORIES, CATEGORY_ORDER, getCategory, categoryColor } from './categories.js'
import CategoryIcon from './CategoryIcon.jsx'
import { GENDERS, EMPTY_PICKUP, BOOK_VARIANTS } from './constants.js'
import { LANGUAGES, uiText } from './i18n.js'
import { ImageStylePicker, BookLayoutPicker } from './pickers.jsx'
import { getBookLayout } from './bookLayouts.js'
import { dedupeContributors } from './bookExport.js'

export function AuditView({ auditData, auditLoading, err, logout, loadAudit, setView }) {
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
            <button className="ghost" onClick={() => setView('list')} style={{ fontSize:14, color:'#78716c' }}>← Zurück</button>
            <span style={{ fontWeight:700, fontSize:16 }}>Lebenswerk Admin</span>
          </div>
          <button className="secondary" onClick={logout} style={{ fontSize:13, padding:'7px 14px' }}>Abmelden</button>
        </div>
        <div style={{ maxWidth:1000, margin:'2rem auto', padding:'0 1.5rem' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:8 }}>
            <h2 style={{ fontSize:22, fontWeight:700, marginBottom:4 }}>Audit-Log</h2>
            <button className="secondary" onClick={loadAudit} disabled={auditLoading} style={{ fontSize:12, padding:'6px 12px' }}>{auditLoading ? 'Lädt…' : 'Aktualisieren'}</button>
          </div>
          <p style={{ ...S.muted, marginBottom:'1.5rem' }}>Sicherheitsrelevante Aktionen (neueste zuerst, max. 200). Aufbewahrung 365 Tage.</p>
          <Err msg={err} />
          <div style={{ ...S.card, padding:0, overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>Zeit</th><th style={th}>Aktion</th><th style={th}>Akteur</th>
                  <th style={th}>Ziel</th><th style={th}>IP</th><th style={th}>Detail</th>
                </tr>
              </thead>
              <tbody>
                {auditData.entries.map(e => (
                  <tr key={e.id}>
                    <td style={{ ...td, whiteSpace:'nowrap', color:'#78716c' }}>{fmtTime(e.created_at)}</td>
                    <td style={{ ...td, fontWeight:600, color:actionColor(e.action) }}>{e.action}</td>
                    <td style={td}>{e.actor_name || (e.actor_uid ? e.actor_uid.slice(0,8) : '—')}{e.is_admin ? ' (Admin)' : ''}</td>
                    <td style={{ ...td, fontFamily:'monospace' }}>{e.target || '—'}</td>
                    <td style={{ ...td, fontFamily:'monospace', color:'#78716c' }}>{e.ip || '—'}</td>
                    <td style={{ ...td, fontFamily:'monospace', color:'#78716c', maxWidth:220, wordBreak:'break-all' }}>{e.detail ? JSON.stringify(e.detail) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {auditData.entries.length === 0 && <p style={{ ...S.muted, padding:'16px' }}>{auditLoading ? 'Lädt…' : 'Noch keine Einträge.'}</p>}
          </div>
        </div>
      </div>
    )
}

export function ReportsView({ err, reportMsg, recipients, recipientForm, busy, logout, setView, toggleRecipient, removeRecipient, submitRecipient, sendReportNow, setRecipientForm }) {
  return (
    <div style={{ minHeight:'100vh', background:'#fafaf9' }}>
      <div style={{ background: '#fff', borderBottom: '1px solid #e7e5e4', padding: '14px 24px', position: 'sticky', top: 0, zIndex: 50, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div style={{ display:'flex', alignItems:'center', gap:16 }}><button className="ghost" onClick={() => setView('list')} style={{ fontSize:14, color:'#78716c' }}>← Zurück</button><span style={{ fontWeight: 700, fontSize: 16 }}>Lebenswerk Admin</span></div>
        <button className="secondary" onClick={logout} style={{ fontSize: 13, padding: '7px 14px' }}>Abmelden</button>
      </div>
      <div style={{ maxWidth: 720, margin: '2rem auto', padding: '0 1.5rem' }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Tagesreport</h2>
        <p style={{ ...S.muted, marginBottom: '1.5rem' }}>
          Jede Nacht (gegen 1:00 Uhr) geht ein Report mit den wichtigsten Kennzahlen des Vortags an die aktiven Empfänger – kompakte Zahlen im Text, ausführlicher Bericht mit Diagrammen als PDF-Anhang. Es werden ausschließlich aggregierte Zahlen versendet (keine personenbezogenen Daten).
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
                {!r.active && <span style={{ fontSize:11, marginLeft:8, color:'#b45309' }}>pausiert</span>}
              </div>
              <div style={{ display:'flex', gap:8 }}>
                <button className="secondary" onClick={() => toggleRecipient(r)} style={{ fontSize:12, padding:'5px 10px' }}>{r.active ? 'Pausieren' : 'Aktivieren'}</button>
                <button className="secondary" onClick={() => removeRecipient(r)} style={{ fontSize:12, padding:'5px 10px', color:'#dc2626', borderColor:'#fecaca' }}>Löschen</button>
              </div>
            </div>
          ))}
          {recipients.length === 0 && <p style={S.muted}>Noch keine Empfänger. Fügen Sie unten die erste Adresse hinzu.</p>}
        </div>

        {/* Neuer Empfänger */}
        <div style={{ ...S.card, marginBottom:24 }}>
          <Lbl>Empfänger hinzufügen</Lbl>
          <input value={recipientForm.email} onChange={e => setRecipientForm({ ...recipientForm, email: e.target.value })} placeholder="E-Mail-Adresse" type="email" style={{ marginBottom:8 }} />
          <input value={recipientForm.name} onChange={e => setRecipientForm({ ...recipientForm, name: e.target.value })} placeholder="Name (optional)" style={{ marginBottom:12 }} />
          <button onClick={submitRecipient} disabled={busy || !recipientForm.email.trim()} style={{ fontSize:14, padding:'9px 16px' }}>{busy ? 'Wird gespeichert …' : 'Hinzufügen'}</button>
        </div>

        {/* Test-Versand */}
        <div style={{ ...S.card }}>
          <Lbl>Report jetzt testen</Lbl>
          <p style={{ ...S.muted, fontSize:12, margin:'0 0 12px' }}>
            Erzeugt den Report sofort mit den aktuellen Zahlen (Vortag) und verschickt ihn – praktisch zur Kontrolle, ohne bis 1:00 Uhr zu warten.
          </p>
          <input value={recipientForm.test || ''} onChange={e => setRecipientForm({ ...recipientForm, test: e.target.value })} placeholder="Test-Adresse (leer = alle aktiven Empfänger)" type="email" style={{ marginBottom:12 }} />
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            <button onClick={() => sendReportNow((recipientForm.test || '').trim() || undefined)} disabled={busy} style={{ fontSize:14, padding:'9px 16px' }}>{busy ? 'Wird gesendet …' : 'Report senden'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function CostsView({ selected, costData, costsLoading, err, setView, logout }) {
    const kinds = costData?.byKind ? Object.entries(costData.byKind).sort((a, b) => b[1].cost_eur - a[1].cost_eur) : []
    return (
      <div style={{ minHeight: '100vh', background: '#fafaf9' }}>
        <div style={{ background: '#fff', borderBottom: '1px solid #e7e5e4', padding: '14px 24px', position: 'sticky', top: 0, zIndex: 50, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display:'flex', alignItems:'center', gap:16 }}>
            <button className="ghost" onClick={() => setView('list')} style={{ fontSize:14, color:'#78716c' }}>← Zurück</button>
            <div>
              <span style={{ fontWeight: 700, fontSize: 16 }}>Kosten</span>
              <span style={{ fontSize:13, color:'#78716c', marginLeft:10 }}>· {selected.name}</span>
            </div>
          </div>
          <button className="secondary" onClick={logout} style={{ fontSize: 13, padding: '7px 14px' }}>Abmelden</button>
        </div>

        <div style={{ maxWidth: 920, margin: '2rem auto', padding: '0 1.5rem' }}>
          <Err msg={err} />
          {costsLoading && <p style={S.muted}>Wird geladen …</p>}
          {!costsLoading && costData && (
            <>
              <div style={{ ...S.card, marginBottom:'1.5rem', textAlign:'center' }}>
                <Lbl>Gesamtkosten dieses Buchs</Lbl>
                <div style={{ fontSize:32, fontWeight:700, fontFamily:'Georgia,serif', marginTop:6 }}>{formatEur(costData.total_eur)}</div>
                <div style={{ fontSize:13, color:'#78716c', marginTop:4 }}>≈ {Number(costData.total_usd || 0).toFixed(4)} USD</div>
              </div>

              <h3 style={{ fontSize:16, fontWeight:600, marginBottom:'.75rem' }}>Aufschlüsselung nach Kategorie</h3>
              {kinds.length === 0 ? (
                <p style={S.muted}>Noch keine Kosten erfasst.</p>
              ) : (
                <div style={{ background:'#fff', border:'1px solid #e7e5e4', borderRadius:12, overflow:'hidden', marginBottom:'1.5rem' }}>
                  <table style={{ width:'100%', borderCollapse:'collapse' }}>
                    <thead>
                      <tr>
                        {['Kategorie', 'Calls', 'Mengen', 'EUR'].map(h => <th key={h} style={th}>{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {kinds.map(([k, agg]) => {
                        const units = []
                        if (agg.input_tokens || agg.output_tokens) units.push(`${agg.input_tokens.toLocaleString('de-DE')} in / ${agg.output_tokens.toLocaleString('de-DE')} out Tokens`)
                        if (agg.characters)    units.push(`${agg.characters.toLocaleString('de-DE')} Zeichen`)
                        if (agg.audio_seconds) units.push(`${Math.round(agg.audio_seconds)} Sek. Audio`)
                        if (agg.images)        units.push(`${agg.images} Bild${agg.images > 1 ? 'er' : ''}`)
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

              <h3 style={{ fontSize:16, fontWeight:600, marginBottom:'.75rem' }}>Alle Vorgänge ({costData.events.length})</h3>
              {costData.events.length === 0 ? (
                <p style={S.muted}>Keine Einträge.</p>
              ) : (
                <div style={{ background:'#fff', border:'1px solid #e7e5e4', borderRadius:12, overflow:'hidden' }}>
                  <table style={{ width:'100%', borderCollapse:'collapse' }}>
                    <thead>
                      <tr>
                        {['Zeit', 'Kategorie', 'Modell', 'Detail', 'EUR'].map(h => <th key={h} style={th}>{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {costData.events.map(e => {
                        const parts = []
                        if (e.input_tokens || e.output_tokens) parts.push(`${e.input_tokens || 0} in / ${e.output_tokens || 0} out`)
                        if (e.characters)    parts.push(`${e.characters} Zeichen`)
                        if (e.audio_seconds) parts.push(`${Math.round(e.audio_seconds)} s`)
                        if (e.images) {
                          // Variante/Kapitel aus den Metadaten (sofern vorhanden)
                          const md = e.metadata || {}
                          const vlabel = md.variant === 'book_v1' ? 'V1' : md.variant === 'book_v2' ? 'V2' : null
                          const chPart = md.chapter != null
                            ? `Kapitel ${md.chapter}${md.chapter_heading ? ` – „${md.chapter_heading}"` : ''}`
                            : null
                          const seg = [vlabel, chPart].filter(Boolean).join(' · ')
                          parts.push(`${e.images} Bild${seg ? ` (${seg})` : ''}`)
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
  return (
    <div style={{ minHeight:'100vh', background:'#fafaf9' }}>
      <div style={{ background: '#fff', borderBottom: '1px solid #e7e5e4', padding: '14px 24px', position: 'sticky', top: 0, zIndex: 50, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div style={{ display:'flex', alignItems:'center', gap:16 }}><button className="ghost" onClick={() => setView('list')} style={{ fontSize:14, color:'#78716c' }}>← Zurück</button><span style={{ fontWeight: 700, fontSize: 16 }}>Lebenswerk Admin</span></div>
        <button className="secondary" onClick={logout} style={{ fontSize: 13, padding: '7px 14px' }}>Abmelden</button>
      </div>
      <div style={{ maxWidth: 540, margin: '2rem auto', padding: '0 1.5rem' }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Einstellungen</h2>
        <p style={{ ...S.muted, marginBottom: '1.5rem' }}>
          Hinterlegen Sie Ihr Firmenlogo. Es wird den Beitragenden Ihrer Bücher oben angezeigt –
          anstelle des Standard-Logos.
        </p>
        <Err msg={err} />

        <div style={{ ...S.card }}>
          <Lbl>Firmenlogo</Lbl>
          {logoLoading ? (
            <p style={S.muted}>Wird geladen …</p>
          ) : (
            <>
              <div style={{
                marginTop:8, marginBottom:14, padding:'18px',
                border:'1px dashed #d6d3d1', borderRadius:10, background:'#fff',
                display:'flex', alignItems:'center', justifyContent:'center', minHeight:90,
              }}>
                {logo
                  ? <img src={logo} alt="Logo-Vorschau" style={{ maxHeight:80, maxWidth:'100%', objectFit:'contain' }} />
                  : <span style={{ fontSize:13, color:'#a8a29e' }}>Noch kein Logo hinterlegt</span>}
              </div>

              <div style={{ background:'#f5f5f4', border:'1px solid #e7e5e4', borderRadius:8, padding:'10px 14px', marginBottom:14 }}>
                <div style={{ fontSize:12, color:'#78716c', marginBottom:6 }}>So sehen es die Beitragenden:</div>
                <PartnerBanner logoUrl={logo} />
              </div>

              <p style={{ fontSize:12, color:'#78716c', margin:'0 0 12px' }}>
                PNG, JPG, SVG, WebP oder GIF · max. 1 MB. Querformat mit transparentem Hintergrund wirkt am besten.
              </p>

              <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                <label className="secondary" style={{ fontSize:13, padding:'9px 16px', cursor:'pointer', display:'inline-block', borderRadius:8, border:'1px solid #d6d3d1' }}>
                  📁 Logo auswählen
                  <input type="file" accept="image/*" onChange={onLogoFile} style={{ display:'none' }} />
                </label>
                <button onClick={() => saveLogo(logo)} disabled={busy || !logo} style={{ fontSize:13, padding:'9px 16px' }}>
                  {busy ? 'Wird gespeichert …' : 'Speichern'}
                </button>
                <button onClick={() => saveLogo(null)} disabled={busy || !logo} className="secondary" style={{ fontSize:13, padding:'9px 16px', color:'#dc2626', borderColor:'#fecaca' }}>
                  Logo entfernen
                </button>
              </div>
              {logoSaved && <p style={{ fontSize:13, color:'#16a34a', marginTop:12, marginBottom:0 }}>✓ Gespeichert.</p>}
            </>
          )}
        </div>

        <form onSubmit={saveOwnPassword} style={{ ...S.card, marginTop:'1.25rem' }}>
          <Lbl>Passwort ändern</Lbl>
          <p style={{ fontSize:12, color:'#78716c', margin:'4px 0 14px' }}>{PASSWORD_RULES_TEXT}</p>
          <Err msg={pwErr} />
          <div style={{ marginBottom:12 }}>
            <Lbl>Aktuelles Passwort</Lbl>
            <input type="password" autoComplete="current-password" value={pwForm.current}
              onChange={e => setPwForm(f => ({ ...f, current: e.target.value }))} placeholder="••••" />
          </div>
          <div style={{ marginBottom:12 }}>
            <Lbl>Neues Passwort</Lbl>
            <input type="password" autoComplete="new-password" value={pwForm.next}
              onChange={e => setPwForm(f => ({ ...f, next: e.target.value }))} placeholder="••••" />
          </div>
          <div style={{ marginBottom:14 }}>
            <Lbl>Neues Passwort wiederholen</Lbl>
            <input type="password" autoComplete="new-password" value={pwForm.next2}
              onChange={e => setPwForm(f => ({ ...f, next2: e.target.value }))} placeholder="••••" />
          </div>
          <button type="submit" disabled={busy || !pwForm.current || !pwForm.next || !pwForm.next2} style={{ fontSize:13, padding:'9px 16px' }}>
            {busy ? 'Wird geändert …' : 'Passwort ändern'}
          </button>
          {pwSaved && <p style={{ fontSize:13, color:'#16a34a', marginTop:12, marginBottom:0 }}>✓ Passwort geändert.</p>}
        </form>
      </div>
    </div>
  )
}

export function CreatedView({ createdCode, copied, token, logout, copyInvite, copyQR, loadMemorials }) {
    const inviteUrl = `${window.location.origin}/?code=${createdCode}`
    return (
      <div style={{ minHeight:'100vh', background:'#fafaf9' }}>
        <div style={{ background:'#fff', borderBottom:'1px solid #e7e5e4', padding:'14px 24px', position: 'sticky', top: 0, zIndex: 50, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <span style={{ fontWeight: 700, fontSize: 16 }}>Lebenswerk Admin</span>
          <button className="secondary" onClick={logout} style={{ fontSize:13, padding:'7px 14px' }}>Abmelden</button>
        </div>
        <div style={{ maxWidth: 540, margin: '2rem auto', padding: '0 1.5rem', textAlign:'center' }}>
          <div style={{ fontSize: 40, marginBottom: '1rem' }}>✅</div>
          <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>Buch erstellt</h2>
          <p style={{ ...S.muted, marginBottom: '1.5rem' }}>Teilen Sie diesen Link oder den QR-Code mit Familie und Freunden:</p>
          <div style={{ ...S.card, marginBottom: '1.5rem' }}>
            <Lbl>Einladungslink</Lbl>
            <a
              href={inviteUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display:'block', fontFamily:'monospace', fontSize:13, wordBreak:'break-all', color:'#1d4ed8', margin:'6px 0 10px', textDecoration:'underline' }}
            >{inviteUrl}</a>
            <button className="secondary" onClick={() => copyInvite(createdCode)} style={{ fontSize: 13 }}>
              {copied === createdCode ? '✓ Kopiert' : '📋 Link kopieren'}
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
                {copied === `qr-${createdCode}` ? '✓ QR kopiert' : '📋 QR-Code kopieren'}
              </button>
            </div>
          </div>
          <button onClick={() => loadMemorials(token)} style={{ padding: '11px 28px' }}>Zur Übersicht</button>
        </div>
      </div>
    )
}

export function UsersView({ err, usersData, createdInvite, userForm, busy, logout, setView, resetUserPassword, copyInviteLink, regenerateInvite, removeUser, saveUserCats, setCreatedInvite, setUserForm, toggleUserFormCat, submitUser }) {
  return (
    <div style={{ minHeight:'100vh', background:'#fafaf9' }}>
      <div style={{ background: '#fff', borderBottom: '1px solid #e7e5e4', padding: '14px 24px', position: 'sticky', top: 0, zIndex: 50, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div style={{ display:'flex', alignItems:'center', gap:16 }}><button className="ghost" onClick={() => setView('list')} style={{ fontSize:14, color:'#78716c' }}>← Zurück</button><span style={{ fontWeight: 700, fontSize: 16 }}>Lebenswerk Admin</span></div>
        <button className="secondary" onClick={logout} style={{ fontSize: 13, padding: '7px 14px' }}>Abmelden</button>
      </div>
      <div style={{ maxWidth: 720, margin: '2rem auto', padding: '0 1.5rem' }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Benutzer</h2>
        <p style={{ ...S.muted, marginBottom: '1.5rem' }}>Pro Benutzer legen Sie fest, welche Produktkategorien er anlegen darf.</p>
        <Err msg={err} />

        {/* Bestehende Benutzer */}
        <div style={{ display:'flex', flexDirection:'column', gap:10, marginBottom:24 }}>
          {usersData.users.map(u => (
            <div key={u.id} style={{ ...S.card }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10, gap:12, flexWrap:'wrap' }}>
                <div>
                  <strong style={{ fontSize:15 }}>{u.username}</strong>
                  {u.is_admin && <span style={{ fontSize:11, marginLeft:8, color:'#1d4ed8' }}>Admin</span>}
                  {!u.has_password && <span style={{ fontSize:11, marginLeft:8, color:'#b45309' }}>Einladung offen</span>}
                </div>
                <div style={{ display:'flex', gap:8 }}>
                  {u.has_password ? (
                    <button className="secondary" onClick={() => resetUserPassword(u)} style={{ fontSize:12, padding:'5px 10px' }}>Passwort</button>
                  ) : (
                    <>
                      <button className="secondary" onClick={() => copyInviteLink(u)} style={{ fontSize:12, padding:'5px 10px' }}>Link kopieren</button>
                      <button className="secondary" onClick={() => regenerateInvite(u)} style={{ fontSize:12, padding:'5px 10px' }}>Neu senden</button>
                    </>
                  )}
                  <button className="secondary" onClick={() => removeUser(u)} style={{ fontSize:12, padding:'5px 10px', color:'#dc2626', borderColor:'#fecaca' }}>Löschen</button>
                </div>
              </div>
              {u.is_admin ? (
                <p style={{ ...S.muted, fontSize:12, margin:0 }}>Administrator – sieht alle Produktkategorien.</p>
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
          {usersData.users.length === 0 && <p style={S.muted}>Noch keine Benutzer.</p>}
        </div>

        {/* Einladungslink des zuletzt angelegten / neu erzeugten Benutzers */}
        {createdInvite && (
          <div style={{ ...S.card, marginBottom:24, borderColor:'#bbf7d0', background:'#f0fdf4' }}>
            <Lbl>Einladung für „{createdInvite.username}"</Lbl>
            {createdInvite.emailSent === true && (
              <p style={{ fontSize:13, color:'#3f6212', margin:'4px 0 6px', fontWeight:600 }}>✓ Einladungs-E-Mail an {createdInvite.username} gesendet (BCC an den Betreiber).</p>
            )}
            {createdInvite.emailSent === false && (
              <p style={{ fontSize:13, color:'#b45309', margin:'4px 0 6px' }}>⚠ Die E-Mail konnte nicht gesendet werden{createdInvite.emailError ? ` (${createdInvite.emailError})` : ''}. Bitte den Link unten manuell senden.</p>
            )}
            <p style={{ fontSize:13, color:'#3f6212', margin:'4px 0 10px' }}>
              Alternativ diesen Link an den Benutzer schicken. Beim ersten Aufruf vergibt er sich selbst ein Passwort. (14 Tage gültig, wurde in die Zwischenablage kopiert.)
            </p>
            {createdInvite.demo && (
              <p style={{ fontSize:12, color:'#3f6212', margin:'0 0 10px' }}>✓ {createdInvite.demo.memorials} Demo-Bücher mit {createdInvite.demo.contributions} Beiträgen angelegt.</p>
            )}
            {createdInvite.demoError && (
              <p style={{ fontSize:12, color:'#b45309', margin:'0 0 10px' }}>Hinweis: Demo-Daten konnten nicht angelegt werden ({createdInvite.demoError}).</p>
            )}
            <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
              <a href={createdInvite.url} style={{ fontSize:13, wordBreak:'break-all', flex:'1 1 220px' }}>{createdInvite.url}</a>
              <button className="secondary" onClick={() => { navigator.clipboard?.writeText(createdInvite.url) }} style={{ fontSize:12, padding:'5px 10px' }}>Kopieren</button>
              <button className="secondary" onClick={() => setCreatedInvite(null)} style={{ fontSize:12, padding:'5px 10px' }}>Schließen</button>
            </div>
          </div>
        )}

        {/* Neuer Benutzer */}
        <div style={{ ...S.card }}>
          <Lbl>Neuer Benutzer – E-Mail-Adresse</Lbl>
          <input type="email" value={userForm.username} onChange={e => setUserForm({ ...userForm, username: e.target.value })} placeholder="name@beispiel.de" style={{ marginBottom:6 }} />
          <p style={{ ...S.muted, fontSize:12, margin:'0 0 12px' }}>
            Die E-Mail-Adresse ist zugleich der Login. Nach dem Anlegen wird automatisch eine Einladungs-E-Mail versendet, über die sich der Benutzer selbst ein Passwort vergibt (kein Passwort nötig). Den Link können Sie zusätzlich kopieren.
          </p>
          <Lbl>Erlaubte Produktkategorien</Lbl>
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
              <strong>Demo-Daten anreichern</strong>
              <span style={{ ...S.muted, display:'block', fontSize:12 }}>Legt dem Benutzer 3 Beispiel-Trauerbücher mit je 10 Beitragenden an; das erste Buch ist bereits in beiden Varianten produziert.</span>
            </span>
          </label>
          <button onClick={submitUser} disabled={busy || !userForm.username.trim()} style={{ fontSize:14, padding:'9px 16px' }}>{busy ? 'Wird angelegt …' : 'Benutzer anlegen'}</button>
        </div>
      </div>
    </div>
  )
}

export function CatalogsView({ err, catalogForm, catalogs, busy, logout, setView, setCatalogForm, saveCatalog, setErr, newCatalog, editCatalog, removeCatalog }) {
  return (
    <div style={{ minHeight:'100vh', background:'#fafaf9' }}>
      <div style={{ background: '#fff', borderBottom: '1px solid #e7e5e4', padding: '14px 24px', position: 'sticky', top: 0, zIndex: 50, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div style={{ display:'flex', alignItems:'center', gap:16 }}><button className="ghost" onClick={() => { setCatalogForm(null); setView('list') }} style={{ fontSize:14, color:'#78716c' }}>← Zurück</button><span style={{ fontWeight: 700, fontSize: 16 }}>Lebenswerk Admin</span></div>
        <button className="secondary" onClick={logout} style={{ fontSize: 13, padding: '7px 14px' }}>Abmelden</button>
      </div>
      <div style={{ maxWidth: 760, margin: '2rem auto', padding: '0 1.5rem' }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Fragenkataloge</h2>
        <p style={{ ...S.muted, marginBottom: '1.5rem' }}>
          Vordefinierte Kataloge aus Kapiteln und Fragen. Manager wählen sie beim Anlegen eines Buchs (nur für passende Produktkategorien); die KI führt das Interview dann daran entlang.
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
              <Lbl>{cf.id ? 'Katalog bearbeiten' : 'Neuer Katalog'}</Lbl>
              <input value={cf.name} onChange={e=>setCf({ name:e.target.value })} placeholder="Name des Katalogs" style={{ marginBottom:14 }} />
              <Lbl>Produktkategorien</Lbl>
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
                    <span style={{ fontSize:12, color:'#78716c', fontWeight:600, whiteSpace:'nowrap' }}>Kapitel {ci+1}</span>
                    <input value={ch.title} onChange={e=>setChapter(ci,{ title:e.target.value })} placeholder="Kapitel-Titel" style={{ flex:1 }} />
                    <button className="secondary" onClick={()=>removeChapter(ci)} title="Kapitel entfernen" style={{ fontSize:12, padding:'5px 10px', color:'#dc2626', borderColor:'#fecaca' }}>✕</button>
                  </div>
                  {ch.questions.map((q, qi) => (
                    <div key={qi} style={{ display:'flex', gap:8, alignItems:'center', marginBottom:6, marginLeft:12 }}>
                      <span style={{ fontSize:12, color:'#a8a29e', whiteSpace:'nowrap' }}>{qi+1}.</span>
                      <input value={q} onChange={e=>setQuestion(ci,qi,e.target.value)} placeholder="Frage" style={{ flex:1 }} />
                      <button className="secondary" onClick={()=>removeQuestion(ci,qi)} title="Frage entfernen" style={{ fontSize:12, padding:'4px 9px' }}>✕</button>
                    </div>
                  ))}
                  <button className="secondary" onClick={()=>addQuestion(ci)} style={{ fontSize:12, padding:'5px 10px', marginLeft:12, marginTop:4 }}>+ Frage</button>
                </div>
              ))}
              <button className="secondary" onClick={addChapter} style={{ fontSize:13, padding:'7px 14px', marginBottom:16 }}>+ Kapitel</button>
              <div style={{ display:'flex', gap:8 }}>
                <button onClick={saveCatalog} disabled={busy || !cf.name.trim()} style={{ fontSize:14, padding:'9px 16px' }}>{busy?'Speichert …':'Speichern'}</button>
                <button className="secondary" onClick={()=>{ setCatalogForm(null); setErr('') }} style={{ fontSize:14, padding:'9px 16px' }}>Abbrechen</button>
              </div>
            </div>
          )
        })() : (
          <button onClick={newCatalog} style={{ fontSize:14, padding:'9px 16px', marginBottom:20 }}>+ Neuer Katalog</button>
        )}

        {!catalogForm && (
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            {catalogs.map(c => (
              <div key={c.id} style={{ ...S.card }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12, flexWrap:'wrap' }}>
                  <div>
                    <strong style={{ fontSize:15 }}>{c.name}</strong>
                    <span style={{ fontSize:12, color:'#78716c', marginLeft:8 }}>
                      {(c.chapters||[]).length} Kapitel · {(c.chapters||[]).reduce((n,ch)=>n+((ch.questions||[]).length),0)} Fragen
                    </span>
                    <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginTop:6 }}>
                      {(c.product_categories||[]).map(slug => CATEGORIES[slug] && (
                        <span key={slug} style={{ fontSize:11, padding:'3px 8px', borderRadius:999, background:'#f5f5f4', color:'#57534e' }}>{CATEGORIES[slug].label}</span>
                      ))}
                      {(c.product_categories||[]).length===0 && <span style={{ fontSize:11, color:'#b45309' }}>keiner Kategorie zugeordnet – für Manager nicht wählbar</span>}
                    </div>
                  </div>
                  <div style={{ display:'flex', gap:8 }}>
                    <button className="secondary" onClick={()=>editCatalog(c)} style={{ fontSize:12, padding:'5px 10px' }}>Bearbeiten</button>
                    <button className="secondary" onClick={()=>removeCatalog(c)} style={{ fontSize:12, padding:'5px 10px', color:'#dc2626', borderColor:'#fecaca' }}>Löschen</button>
                  </div>
                </div>
              </div>
            ))}
            {catalogs.length===0 && <p style={S.muted}>Noch keine Kataloge. Legen Sie einen an.</p>}
          </div>
        )}
      </div>
    </div>
  )
}

export function ListView({ showCategoryColumn, auth, memorials, filters, sort, myName, myUid, loading, filterCol, hoveredRow, err, deletingId, setSort, setFilters, setFilterCol, setHoveredRow, loadUsers, setErr, setView, loadAudit, loadCatalogs, setCatalogForm, loadRecipients, setReportMsg, loadFeedback, openSettings, logout, startCreate, openMemorial, openCosts, handleDelete }) {
    // Sortierbare + filterbare Spalten (Reihenfolge = Spaltenreihenfolge).
    //  val  = Sortierwert,  disp = angezeigter/filterbarer Wert (String)
    const sortCols = [
      { key: 'name',      label: 'Name',          val: m => (m.name || '').toLowerCase(), disp: m => m.name || '—' },
      ...(showCategoryColumn ? [{ key: 'category', label: 'Kategorie', val: m => getCategory(m.product_category).label.toLowerCase(), disp: m => getCategory(m.product_category).label }] : []),
      ...(auth.admin ? [{ key: 'owner', label: 'Inhaber', val: m => (m.owner_username || '').toLowerCase(), disp: m => m.owner_username || '—' }] : []),
      { key: 'organizer', label: 'Organisator',   val: m => (m.organizer || '').toLowerCase(), disp: m => m.organizer || '—' },
      { key: 'variant',   label: 'Variante',      val: m => m.book_variant || 0, disp: m => m.book_variant ? `Variante ${m.book_variant}` : '—' },
      { key: 'cutoff',    label: 'Erfassung bis', val: m => { const d = cutoffDate(m.funeral_date, cutoffDays(m)); return d ? d.getTime() : Infinity }, disp: m => cutoffString(m.funeral_date, cutoffDays(m)) },
      { key: 'answers',   label: 'Antworten',     val: m => m.answer_count || 0, disp: m => `${m.answer_count || 0} Antworten` },
      ...(auth.admin ? [{ key: 'cost', label: 'Kosten', val: m => m.cost_total_eur || 0, disp: m => formatEur(m.cost_total_eur) }] : []),
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
            {visibleMemorials.length < memorials.length ? `${visibleMemorials.length} / ${memorials.length}` : memorials.length} {memorials.length === 1 ? 'Buch' : 'Bücher'}
          </span>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <span style={{ fontSize: 13, color: '#78716c', marginRight: 4 }}>
            Angemeldet als <strong style={{ color:'#1c1917', fontWeight:600 }}>{myName}</strong>
          </span>
          {auth.admin && (
            <button className="secondary" onClick={() => { loadUsers(); setErr(''); setView('users') }} style={{ fontSize: 13, padding: '7px 14px' }}>Benutzer</button>
          )}
          {auth.admin && (
            <button className="secondary" onClick={() => { loadAudit(); setErr(''); setView('audit') }} style={{ fontSize: 13, padding: '7px 14px' }}>Audit-Log</button>
          )}
          {auth.admin && (
            <button className="secondary" onClick={() => { loadCatalogs(); setCatalogForm(null); setErr(''); setView('catalogs') }} style={{ fontSize: 13, padding: '7px 14px' }}>Fragenkataloge</button>
          )}
          {auth.admin && (
            <button className="secondary" onClick={() => { loadRecipients(); setReportMsg(''); setErr(''); setView('reports') }} style={{ fontSize: 13, padding: '7px 14px' }}>Report</button>
          )}
          {auth.admin && (
            <button className="secondary" onClick={() => { loadFeedback(); setErr(''); setView('quality') }} style={{ fontSize: 13, padding: '7px 14px' }}>Qualität</button>
          )}
          {myUid && (
            <button className="secondary" onClick={openSettings} style={{ fontSize: 13, padding: '7px 14px' }}>Einstellungen</button>
          )}
          <button className="secondary" onClick={logout} style={{ fontSize: 13, padding: '7px 14px' }}>Abmelden</button>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: '2rem auto', padding: '0 1.5rem' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1.25rem', gap:12 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700 }}>Alle Bücher</h2>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            {Object.keys(filters).length > 0 && (
              <button className="secondary" onClick={() => setFilters({})} style={{ fontSize:13, padding:'8px 12px' }}>Filter zurücksetzen</button>
            )}
            <button onClick={startCreate} style={{ fontSize:14, padding:'9px 16px' }}>
              + Neues Buch
            </button>
          </div>
        </div>
        <Err msg={err} />
        {loading ? (
          <p style={{ color: '#78716c', fontSize: 14 }}>Wird geladen …</p>
        ) : memorials.length === 0 ? (
          <div style={{ ...S.card, textAlign:'center', padding:'2rem' }}>
            <p style={S.muted}>Noch keine Bücher angelegt. Beginnen Sie mit „+ Neues Buch".</p>
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
                      <span onClick={() => toggleSort(c.key)} title="Spalte sortieren" style={{ cursor: 'pointer', userSelect: 'none' }}>
                        {c.label}{sort.key === c.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ' ⇅'}
                      </span>
                      <span onClick={(e) => { e.stopPropagation(); setFilterCol(k => k === c.key ? null : c.key) }}
                            title="Spalte filtern"
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
                            <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>Alle</span>
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
                      <td style={{ ...mainCell, fontWeight: 600 }}                       onMouseEnter={enterMain} onMouseLeave={leaveRow} onClick={() => openMemorial(m)}>{m.name}</td>
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
                      <td style={{ ...mainCell, color:'#78716c' }}                       onMouseEnter={enterMain} onMouseLeave={leaveRow} onClick={() => openMemorial(m)}>{m.book_variant ? `Variante ${m.book_variant}` : '—'}</td>
                      <td style={{ ...mainCell, color:'#78716c' }}                       onMouseEnter={enterMain} onMouseLeave={leaveRow} onClick={() => openMemorial(m)}>{cutoffString(m.funeral_date, cutoffDays(m))}</td>
                      <td style={{ ...mainCell, color:'#78716c', whiteSpace:'nowrap' }}     onMouseEnter={enterMain} onMouseLeave={leaveRow} onClick={() => openMemorial(m)}>
                        {(m.contribution_count || 0)} {(m.contribution_count === 1) ? 'Beitrag' : 'Beiträge'} · {(m.answer_count || 0)} {(m.answer_count === 1) ? 'Antwort' : 'Antworten'}
                      </td>
                      {auth.admin && (
                      <td
                        style={{ ...col, textAlign:'right', whiteSpace:'nowrap', padding:'6px 14px', background: costHover ? COST_BG : '', transition:'background .1s' }}
                        onMouseEnter={() => setHoveredRow({ id: m.id, zone: 'cost' })}
                        onMouseLeave={leaveRow}
                      >
                        <button
                          onClick={(e) => { e.stopPropagation(); openCosts(m) }}
                          title="Aufschlüsselung anzeigen"
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
                          <span style={{ textDecoration:'underline', textUnderlineOffset:2 }}>{formatEur(m.cost_total_eur)}</span>
                        </button>
                      </td>
                      )}
                      <td style={{ ...col, textAlign:'right' }}>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(m) }}
                          disabled={deletingId === m.id}
                          className="secondary"
                          style={{ fontSize:12, padding:'6px 12px', color:'#dc2626', borderColor:'#fecaca' }}
                          title={`${getCategory(m.product_category).nounBook} löschen`}
                        >
                          {deletingId === m.id ? '…' : '🗑 Löschen'}
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
  return (
    <div style={{ minHeight:'100vh', background:'#fafaf9' }}>
      <div style={{ background: '#fff', borderBottom: '1px solid #e7e5e4', padding: '14px 24px', position: 'sticky', top: 0, zIndex: 50, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div style={{ display:'flex', alignItems:'center', gap:16 }}><button className="ghost" onClick={() => setView('list')} style={{ fontSize:14, color:'#78716c' }}>← Zurück</button><span style={{ fontWeight: 700, fontSize: 16 }}>Lebenswerk Admin</span></div>
        <button className="secondary" onClick={logout} style={{ fontSize: 13, padding: '7px 14px' }}>Abmelden</button>
      </div>
      <div style={{ maxWidth: 540, margin: '2rem auto', padding: '0 1.5rem' }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Produktkategorie wählen</h2>
        <p style={{ ...S.muted, marginBottom: '1.5rem' }}>Für welchen Anlass soll das Buch entstehen?</p>
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
    const canSubmit = createForm.name && createForm.organizer && (!ci.useGender || createForm.gender) && !busy
    const pa = createForm.pickupAddress || EMPTY_PICKUP
    const setPa = patch => setCreateForm(f => ({ ...f, pickupAddress: { ...f.pickupAddress, ...patch } }))
    const [expertMode, setExpertMode] = useState(false)
    return (
    <div style={{ minHeight:'100vh', background:'#fafaf9' }}>
      <div style={{ background: '#fff', borderBottom: '1px solid #e7e5e4', padding: '14px 24px', position: 'sticky', top: 0, zIndex: 50, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div style={{ display:'flex', alignItems:'center', gap:16 }}><button className="ghost" onClick={() => setView(allowedSlugs.length > 1 ? 'create-category' : 'list')} style={{ fontSize:14, color:'#78716c' }}>← Zurück</button><span style={{ fontWeight: 700, fontSize: 16 }}>Lebenswerk Admin</span></div>
        <button className="secondary" onClick={logout} style={{ fontSize: 13, padding: '7px 14px' }}>Abmelden</button>
      </div>
      <div style={{ maxWidth: 540, margin: '2rem auto', padding: '0 1.5rem' }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>{ci.createHeading}</h2>
        <p style={{ ...S.muted, marginBottom: '1.5rem' }}>{ci.createIntro}</p>
        <Err msg={err} />
        <div style={{ marginBottom: 14 }}>
          <Lbl>{ci.subjectLabel}</Lbl>
          <input value={createForm.name} onChange={e => setCreateForm({ ...createForm, name: e.target.value })} placeholder={ci.subjectPlaceholder} />
        </div>
        {ci.useGender && (
          <div style={{ marginBottom: 14 }}>
            <Lbl>{ci.genderLabel}</Lbl>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8 }}>
              {GENDERS.map(g => (
                <div
                  key={g.value}
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
        <div style={{ marginBottom: 14 }}>
          <Lbl>Ihr Name (Organisator) *</Lbl>
          <input value={createForm.organizer} onChange={e => setCreateForm({ ...createForm, organizer: e.target.value })} placeholder="Ihr Name" />
        </div>
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
        <div style={{ marginBottom: 24 }}>
          <Lbl>Buch-Variante *</Lbl>
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
        <button type="button" onClick={() => setExpertMode(v => !v)} className="secondary" style={{ fontSize:13, padding:'8px 14px', margin:'4px 0 16px' }}>
          {expertMode ? '⚙ Expertenmodus ausblenden' : '⚙ Expertenmodus (weitere Optionen)'}
        </button>
        {expertMode && (<>
        <div style={{ marginBottom: 24 }}>
          <Lbl>Transkript-Anzeige im Sprach-Interview</Lbl>
          <label style={{ display:'flex', alignItems:'center', gap:10, cursor:'pointer', marginTop:8 }}>
            <input type="checkbox" checked={createForm.showTranscript !== false} onChange={e => setCreateForm({ ...createForm, showTranscript: e.target.checked })} style={{ width:18, height:18, cursor:'pointer', accentColor:'#1c1917', flexShrink:0 }} />
            <span style={{ fontSize:14 }}>Beitragenden das Transkript ihrer Antworten anzeigen</span>
          </label>
          <p style={{ fontSize:12, color:'#78716c', marginTop:6, marginLeft:28 }}>
            Standard: aktiv. Die transkribierte Antwort wird angezeigt; Beitragende können sie vor dem Senden prüfen und bei Bedarf neu einsprechen. Deaktiviert: reines Sprach-Interview (Antwort wird direkt gesendet).
          </p>
        </div>
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
                Standard: die KI überlegt sich die Interviewfragen selbst. Alternativ führt sie das Interview entlang eines vordefinierten Katalogs.
              </p>
              <select
                value={createForm.catalogId}
                onChange={e => setCreateForm({ ...createForm, catalogId: e.target.value })}
                style={{ width:'100%', padding:'10px 12px', fontSize:14, fontFamily:'inherit' }}
              >
                <option value="">KI überlegt selbst (Standard)</option>
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
        </>)}
        <button
          disabled={!canSubmit}
          onClick={handleCreate}
          style={{ width: '100%', padding: 13, fontSize: 15 }}
        >
          {busy ? 'Wird erstellt …' : ci.createButton}
        </button>
      </div>
    </div>
    )
}

export function ContributionView({ selectedContrib, selected, setView, dlOne, exportContribution, deleteContribution, logout, deleteMessages, saveContribMeta, saveAnswerText }) {
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
            <button className="ghost" onClick={() => setView('detail')} style={{ fontSize:14, color:'#78716c' }}>← Zurück</button>
            <div>
              <span style={{ fontWeight: 700, fontSize: 16 }}>{c.contributor_name}</span>
              <span style={{ fontSize:13, color:'#78716c', marginLeft:10 }}>· {selected.name}</span>
            </div>
          </div>
          <div style={{ display:'flex', gap:10 }}>
            <button onClick={() => dlOne(c)} style={{ fontSize:13, padding:'8px 16px' }}>⬇ Herunterladen</button>
            <button className="secondary" onClick={() => exportContribution(c)} title="Daten dieses Beitragenden als .zip (lesbares PDF + JSON) exportieren – DSGVO Art. 15/20" style={{ fontSize:13, padding:'8px 16px' }}>⬇ DSGVO-Export</button>
            <button className="secondary" onClick={() => deleteContribution(c)} title="Beitrag löschen" style={{ fontSize:15, padding:'7px 12px', color:'#dc2626' }}>🗑</button>
            <button className="secondary" onClick={logout} style={{ fontSize: 13, padding: '7px 14px' }}>Abmelden</button>
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
                  <input value={nameDraft} onChange={e => setNameDraft(e.target.value)} placeholder="Name" style={{ fontSize:15, padding:'6px 9px' }} />
                  <input value={relDraft} onChange={e => setRelDraft(e.target.value)} placeholder="Beziehung zur Hauptperson (z. B. Tochter)" style={{ fontSize:13, padding:'6px 9px' }} />
                  <div style={{ display:'flex', gap:8, marginTop:2 }}>
                    <button onClick={submitMeta} disabled={savingMeta || !nameDraft.trim()} style={{ fontSize:12, padding:'6px 12px' }}>{savingMeta ? 'Speichert …' : 'Speichern'}</button>
                    <button className="secondary" onClick={() => setEditMeta(false)} disabled={savingMeta} style={{ fontSize:12, padding:'6px 12px' }}>Abbrechen</button>
                  </div>
                </div>
              ) : (
                <div>
                  <div style={{ fontWeight:700, fontSize:18, display:'flex', alignItems:'center', gap:8 }}>
                    {c.contributor_name}
                    <button className="secondary" onClick={startEditMeta} title="Name & Beziehung ändern" style={{ fontSize:11, padding:'3px 8px' }}>✏ ändern</button>
                  </div>
                  <div style={{ fontSize:13, color:'#78716c' }}>{c.relationship}</div>
                </div>
              )}
            </div>
            <div style={{ fontSize:13, color:'#57534e', lineHeight:1.8 }}>
              {c.contributor_gender && <div><span style={{ color:'#a8a29e' }}>Geschlecht:</span> {c.contributor_gender}</div>}
              {c.contributor_address && <div><span style={{ color:'#a8a29e' }}>Anrede:</span> {c.contributor_address}</div>}
              <div><span style={{ color:'#a8a29e' }}>Erstellt:</span> {new Date(c.created_at).toLocaleString('de-DE')}</div>
              <div><span style={{ color:'#a8a29e' }}>Antworten:</span> {c.messages.filter(m => m.role === 'user').length}</div>
            </div>
          </div>

          {pairs.length === 0 ? (
            <p style={S.muted}>Dieser Beitrag enthält noch keine Inhalte.</p>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:18 }}>
              {pairs.map((p, j) => (
                <div key={j} style={{ ...S.card, position:'relative' }}>
                  <button
                    onClick={() => deleteMessages(c, p.indices)}
                    title="Frage & Antwort löschen"
                    className="ghost"
                    style={{ position:'absolute', top:10, right:10, fontSize:14, color:'#dc2626', padding:'4px 8px', lineHeight:1 }}
                  >
                    🗑
                  </button>
                  {p.q && (
                    <div style={{ marginBottom: p.a ? 12 : 0 }}>
                      <Lbl>Frage</Lbl>
                      <p style={{ fontSize:15, lineHeight:1.65, fontStyle:'italic', color:'#44403c', margin:'4px 0 0' }}>{p.q}</p>
                    </div>
                  )}
                  {p.a && (() => {
                    const ansIdx = p.indices[p.indices.length - 1]
                    return ansEdit === ansIdx ? (
                      <div>
                        <Lbl>Antwort</Lbl>
                        <textarea value={ansDraft} onChange={e => setAnsDraft(e.target.value)} rows={4}
                          style={{ width:'100%', fontSize:15, lineHeight:1.6, padding:'8px 10px', fontFamily:'inherit', resize:'vertical', boxSizing:'border-box' }} />
                        <div style={{ display:'flex', gap:8, marginTop:8 }}>
                          <button onClick={() => submitAns(ansIdx)} disabled={ansSaving} style={{ fontSize:12, padding:'6px 12px' }}>{ansSaving ? 'Speichert …' : 'Speichern'}</button>
                          <button className="secondary" onClick={() => setAnsEdit(null)} disabled={ansSaving} style={{ fontSize:12, padding:'6px 12px' }}>Abbrechen</button>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                          <Lbl>Antwort</Lbl>
                          <button className="ghost" onClick={() => startAnsEdit(ansIdx, p.a)} title="Antwort bearbeiten" style={{ fontSize:11, color:'#78716c', padding:'2px 6px' }}>✏ bearbeiten</button>
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

export function BookView({ view, selected, generating, genOwner, contributions, editMode, editDraft, savingEdit, err, genErr, genPct, genProgress, GENERATORS, cancelGenRef, setEditMode, setEditDraft, setView, cancelGenerate, saveEdit, setReportModal, downloadGenerated, downloadGeneratedPdf, downloadCover, setEulogyStyleModal, requestGenerate, eulogyStyleOverlay, genLangOverlay, imgEditOverlay, coverOverlay, imgZoomOverlay, reportOverlay, transcriptReportOverlay, highlightParagraph, renderRichText, dlBusy }) {
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
          <p style={{ fontSize:11, letterSpacing:'.12em', textTransform:'uppercase', color:'#a8a29e', marginBottom:10 }}>{subtitle}{editMode ? ' · Bearbeiten' : ''}</p>
          <h1 style={{ fontSize:24, fontWeight:600, ...headFont, color:'#78716c' }}>{selected.name}</h1>
        </div>

        {!busy && data && !editMode && (
          <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:'1.25rem' }}>
            <button onClick={() => { setEditDraft(structuredClone(data)); setEditMode(true) }} style={{ fontSize:13, padding:'8px 16px' }}>✏ Bearbeiten</button>
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
            <p style={{ ...S.muted, marginTop:16 }}>{genProgress[key] || 'Die KI arbeitet …'}</p>
            <div style={{ marginTop:16 }}>
              <button onClick={() => cancelGenerate(key)} disabled={!!cancelGenRef.current[key]} className="secondary" style={{ fontSize:13, padding:'7px 14px', color:'#b91c1c', borderColor:'#fecaca' }}>✕ Abbrechen</button>
            </div>
          </div>
        ) : !data ? (
          <p style={{ ...S.muted, textAlign:'center', padding:'3rem 0' }}>Noch nichts generiert. Geh zurück und klicke „Generieren".</p>
        ) : editMode ? (
          <div style={{ borderTop:'1px solid #e7e5e4', paddingTop:'1.5rem' }}>
            <p style={{ ...S.muted, fontSize:13, marginBottom:16 }}>
              Direkt im Text korrigieren (z. B. falsch verstandene Eigennamen). Änderungen werden beim Speichern übernommen. Bilder bleiben unverändert.
            </p>
            {gen.kind === 'book' && editDraft && typeof editDraft === 'object' ? (
              <>
                <Lbl>Titel</Lbl>
                <input value={editDraft.title || ''} onChange={e => setEditDraft(d => ({ ...d, title: e.target.value }))} style={{ marginBottom:12 }} />
                <Lbl>Untertitel</Lbl>
                <input value={editDraft.subtitle || ''} onChange={e => setEditDraft(d => ({ ...d, subtitle: e.target.value }))} style={{ marginBottom:20 }} />
                {(editDraft.chapters || []).map((ch, i) => (
                  <div key={i} style={{ marginBottom:20, paddingTop:16, borderTop:'1px solid #f5f5f4' }}>
                    <Lbl>{bt.chapterLabel} {ch.number ?? i + 1} – Überschrift</Lbl>
                    <input value={ch.heading || ''} onChange={e => setEditDraft(d => ({ ...d, chapters: d.chapters.map((c, idx) => idx === i ? { ...c, heading: e.target.value } : c) }))} style={{ marginBottom:8 }} />
                    <Lbl>Text</Lbl>
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
              <button onClick={() => saveEdit(gen.field, editDraft)} disabled={savingEdit} style={{ fontSize:14, padding:'9px 18px' }}>{savingEdit ? 'Speichert …' : '✓ Speichern'}</button>
              <button onClick={() => { setEditMode(false); setEditDraft(null) }} disabled={savingEdit} className="ghost" style={{ fontSize:14 }}>Abbrechen</button>
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
                <span>🛡 {reviewMarks.length} {reviewMarks.length === 1 ? 'Stelle' : 'Stellen'} aus der Inhaltsprüfung sind im Text farbig markiert.</span>
                <button className="secondary" onClick={() => setReportModal({ title: gen.label, field: gen.field, report: reviewReport })} style={{ fontSize:12, padding:'5px 10px' }}>Prüfbericht</button>
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
            <button onClick={() => downloadGenerated(key)} disabled={!!dlBusy} style={{ fontSize:13, padding:'8px 16px' }}>{dlBusy === `${key}:docx` ? '⏳ Wird erstellt …' : '⬇ Download .docx'}</button>
            {gen.kind === 'book' && (
              <button className="secondary" onClick={() => downloadGeneratedPdf(key)} disabled={!!dlBusy} style={{ fontSize:13, padding:'8px 16px' }}>{dlBusy === `${key}:pdf` ? '⏳ Wird erstellt …' : '🖨 Druck-PDF'}</button>
            )}
            {gen.kind === 'book' && (
              <button
                className="secondary"
                onClick={() => downloadCover(key)}
                disabled={!!dlBusy || !data?.print_pages}
                title={data?.print_pages
                  ? `Rückenstärke aus ${data.print_pages} Seiten`
                  : 'Erst das Druck-PDF erzeugen — daraus ergibt sich die Rückenstärke.'}
                style={{ fontSize:13, padding:'8px 16px' }}
              >
                {dlBusy === `${key}:cover-img` ? '⏳ Hintergrund wird erzeugt …'
                  : dlBusy === `${key}:cover` ? '⏳ Wird erstellt …'
                  : '📕 Druck-Cover'}
              </button>
            )}
            <button className="secondary" onClick={() => key === 'eulogy' ? setEulogyStyleModal(true) : requestGenerate(key)} style={{ fontSize:13, padding:'8px 16px' }}>↻ Neu generieren</button>
          </div>
        )}
        {eulogyStyleOverlay}
        {genLangOverlay}
        {imgEditOverlay}
        {coverOverlay}
        {imgZoomOverlay}
        {reportOverlay}
        {transcriptReportOverlay}
      </div>
    )
}

export function DetailView({ selected, orderDraft, setOrderDraft, setView, reloadContributions, loading, contributions, dlAll, logout, err, copyInvite, copied, copyQR, setTranscriptReport, setSelectedContrib, dlOne, deleteContribution, token, setSelected, GENERATORS, generating, genOwner, setEulogyStyleModal, requestGenerate, setEditMode, setEditDraft, downloadGenerated, downloadGeneratedPdf, downloadCover, openImgEdit, recheck, reviewingKey, genPct, genProgress, cancelGenerate, cancelGenRef, genErr, reviewPct, skipImages, setSkipImages, setReportModal, orderEdit, startOrderEdit, saveOrderData, orderSaving, cancelOrderEdit, handleDelete, deletingId, eulogyStyleOverlay, genLangOverlay, imgEditOverlay, coverOverlay, imgZoomOverlay, reportOverlay, transcriptReportOverlay, ManagerPhotos, bookHasImages, dlBusy }) {
    const inviteUrl = `${window.location.origin}/?code=${selected.id}`
    // Experten-Einstellungen im Auftragsdaten-Formular: zunächst eingeklappt.
    const [odExpert, setOdExpert] = useState(false)
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
            <button className="ghost" onClick={() => setView('list')} style={{ fontSize: 14, color: '#78716c' }}>← Zurück</button>
            <div>
              <span style={{ fontWeight: 700, fontSize: 16 }}>{selected.name}</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="secondary" onClick={reloadContributions} disabled={loading} style={{ fontSize: 13, padding: '8px 14px' }}>
              {loading ? '…' : '↻ Aktualisieren'}
            </button>
            {contributions.length > 0 && (
              <button onClick={dlAll} style={{ fontSize: 13, padding: '8px 16px' }}>
                ⬇ Alle herunterladen ({contributions.length})
              </button>
            )}
            <button className="secondary" onClick={logout} style={{ fontSize: 13, padding: '7px 14px' }}>Abmelden</button>
          </div>
        </div>

        <div style={{ maxWidth: 900, margin: '2rem auto', padding: '0 1.5rem' }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Beiträge</h2>
          <p style={{ fontSize: 14, color: '#78716c', marginBottom: '1rem' }}>
            Organisator: {selected.organizer}
            {selected.gender ? ` · ${selected.gender}` : ''}
            {selected.book_variant ? ` · Buch-Variante ${selected.book_variant}` : ''}
            {selected.funeral_date ? ` · ${getCategory(selected.product_category).intake.dateLabel}: ${new Date(selected.funeral_date).toLocaleDateString('de-DE')}` : ''}
            {selected.funeral_date ? ` · Erfassung bis: ${cutoffString(selected.funeral_date, cutoffDays(selected))} (${cutoffDays(selected)} Tage vorher)` : ''}
          </p>

          <div style={{ ...S.card, marginBottom: '1.5rem' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:12 }}>
              <div style={{ minWidth:0 }}>
                <Lbl>Einladungslink (für Beitragende)</Lbl>
                <a
                  href={inviteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display:'block', fontFamily:'monospace', fontSize:13, wordBreak:'break-all', color:'#1d4ed8', marginTop:6, textDecoration:'underline' }}
                >{inviteUrl}</a>
              </div>
              <button className="secondary" onClick={() => copyInvite(selected.id)} style={{ fontSize:13, flexShrink:0 }}>
                {copied === selected.id ? '✓ Kopiert' : '📋 Kopieren'}
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
                {copied === `qr-${selected.id}` ? '✓ QR kopiert' : '📋 QR-Code kopieren'}
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
                { key:'book_v1', icon:'📄', title:GENERATORS.book_v1.label, sub:'Jede Person als eigenes Kapitel (Ich-Form, fließender Text).' },
                { key:'book_v2', icon:'✨', title:GENERATORS.book_v2.label, sub:'KI webt alle Beiträge zu einem stimmigen, literarischen Text.' },
                { key:'eulogy',  icon:'🕯', title:GENERATORS.eulogy.label,  sub:`KI verfasst einen persönlichen Text (${GENERATORS.eulogy.noun}) zum Vorlesen.` },
              ].map(({ key, icon, title, sub }) => {
                const gen   = GENERATORS[key]
                const has   = !!selected[gen.field]
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
                      {has && !busy && <span style={{ fontSize:11, color:'#16a34a', background:'#dcfce7', padding:'3px 8px', borderRadius:6, whiteSpace:'nowrap' }}>✓ Generiert</span>}
                    </div>
                    <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                      <button onClick={() => key === 'eulogy' ? setEulogyStyleModal(true) : requestGenerate(key)} disabled={busy || contributions.length === 0} style={{ fontSize:13, padding:'8px 14px' }}>
                        {busy ? 'Wird generiert …' : has ? '↻ Neu generieren' : '✨ Generieren'}
                      </button>
                      <button onClick={() => { setEditMode(false); setEditDraft(null); setView(gen.view) }} disabled={!has || busy} className="secondary" style={{ fontSize:13, padding:'8px 14px' }}>
                        👁 Ansehen/Bearbeiten
                      </button>
                      <button onClick={() => downloadGenerated(key)} disabled={!has || busy || !!dlBusy} className="secondary" style={{ fontSize:13, padding:'8px 14px' }}>
                        {dlBusy === `${key}:docx` ? '⏳ Wird erstellt …' : '⬇ Download .docx'}
                      </button>
                      {gen.kind === 'book' && (
                        <button onClick={() => downloadGeneratedPdf(key)} disabled={!has || busy || !!dlBusy} className="secondary" style={{ fontSize:13, padding:'8px 14px' }}>
                          {dlBusy === `${key}:pdf` ? '⏳ Wird erstellt …' : '🖨 Druck-PDF'}
                        </button>
                      )}
                      {gen.kind === 'book' && (
                        <button
                          onClick={() => downloadCover(key)}
                          disabled={!has || busy || !!dlBusy || !selected[gen.field]?.print_pages}
                          className="secondary"
                          title={selected[gen.field]?.print_pages
                            ? `Rückenstärke aus ${selected[gen.field].print_pages} Seiten`
                            : 'Erst das Druck-PDF erzeugen — daraus ergibt sich die Rückenstärke.'}
                          style={{ fontSize:13, padding:'8px 14px' }}
                        >
                          {dlBusy === `${key}:cover-img` ? '⏳ Hintergrund wird erzeugt …'
                            : dlBusy === `${key}:cover` ? '⏳ Wird erstellt …'
                            : '📕 Druck-Cover'}
                        </button>
                      )}
                      {gen.kind === 'book' && (
                        <button onClick={() => openImgEdit(key)} disabled={!has || busy || !bookHasImages(selected[gen.field])} className="secondary" style={{ fontSize:13, padding:'8px 14px' }}>
                          🖼 Bilder überarbeiten
                        </button>
                      )}
                      <button onClick={() => recheck(key)} disabled={!has || busy || reviewingKey === key} className="secondary" style={{ fontSize:13, padding:'8px 14px' }}>
                        {reviewingKey === key ? 'Prüft …' : '🛡 Prüfung wiederholen'}
                      </button>
                    </div>
                    {busy && (
                      <div style={{ marginTop:10 }}>
                        {genPct[key] != null && (
                          <div style={{ height:6, background:'#e7e5e4', borderRadius:999, overflow:'hidden', marginBottom:6 }}>
                            <div style={{ width:`${genPct[key]}%`, height:'100%', background:'#1c1917', transition:'width .3s' }} />
                          </div>
                        )}
                        <p style={{ fontSize:12, color:'#78716c', margin:0 }}>
                          {genPct[key] != null ? `${genPct[key]} % · ` : ''}{genProgress[key] || 'Wird generiert …'}
                        </p>
                        <button onClick={() => cancelGenerate(key)} disabled={!!cancelGenRef.current[key]} className="secondary" style={{ fontSize:12, padding:'5px 10px', marginTop:8, color:'#b91c1c', borderColor:'#fecaca' }}>
                          ✕ Abbrechen
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
                        <p style={{ fontSize:12, color:'#78716c', margin:0 }}>🛡 Inhaltsprüfung läuft … {reviewPct} %</p>
                      </div>
                    )}
                    {gen.kind === 'book' && (
                      <label style={{ display:'inline-flex', alignItems:'center', gap:8, marginTop:10, fontSize:12, color:'#78716c', cursor:'pointer' }}>
                        <input type="checkbox" checked={skipImages} onChange={e => setSkipImages(e.target.checked)} style={{ width:16, height:16, flexShrink:0, margin:0, cursor:'pointer' }} />
                        🐞 Bilder überspringen (schneller – für Tests)
                      </label>
                    )}
                    {has && !busy && report && (
                      <div style={{ marginTop:10, paddingTop:10, borderTop:'1px solid #f5f5f4' }}>
                        {report.error ? (
                          <span style={{ fontSize:12, color:'#b45309' }}>⚠ Inhaltsprüfung fehlgeschlagen.{' '}
                            <button className="ghost" onClick={() => setReportModal({ title, field: gen.field, report })} style={{ fontSize:12, padding:0, textDecoration:'underline' }}>Details</button>
                          </span>
                        ) : openFindings > 0 ? (
                          <button onClick={() => setReportModal({ title, field: gen.field, report })} style={{ fontSize:13, padding:'7px 12px', background:'#b91c1c' }}>
                            🛡 Prüfbericht ansehen ({openFindings} offen{totalFindings > openFindings ? `, ${totalFindings - openFindings} erledigt` : ''})
                          </button>
                        ) : totalFindings > 0 ? (
                          <button onClick={() => setReportModal({ title, field: gen.field, report })} className="secondary" style={{ fontSize:13, padding:'7px 12px', color:'#15803d', borderColor:'#bbf7d0' }}>
                            ✓ Alle {totalFindings} Befunde bearbeitet – Bericht ansehen
                          </button>
                        ) : (
                          <span style={{ fontSize:12, color:'#15803d' }}>🛡 Inhaltsprüfung durchgeführt – keine kritischen Aussagen gefunden.</span>
                        )}
                      </div>
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
              <h3 style={{ fontSize:16, fontWeight:600, margin:0 }}>Auftragsdaten</h3>
              {!orderEdit && (
                <button className="secondary" onClick={startOrderEdit} style={{ fontSize:13, padding:'8px 14px' }}>✎ Bearbeiten</button>
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
                  <Lbl>Transkript-Anzeige im Sprach-Interview</Lbl>
                  <label style={{ display:'flex', alignItems:'center', gap:10, cursor:'pointer', marginTop:8 }}>
                    <input type="checkbox" checked={od.showTranscript !== false} onChange={e => setOd({ showTranscript: e.target.checked })}
                      style={{ width:18, height:18, cursor:'pointer', accentColor:'#1c1917', flexShrink:0 }} />
                    <span style={{ fontSize:14 }}>Transkript anzeigen (Beitragende können Antworten prüfen & neu einsprechen)</span>
                  </label>
                </div>
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
  const faces = ['😞', '😕', '😐', '🙂', '😍']
  const rows = Array.isArray(qmData) ? qmData : []
  const avg = rows.length ? rows.reduce((s, r) => s + (r.rating || 0), 0) / rows.length : 0
  const fmt = ts => { try { return new Date(ts).toLocaleString('de-DE') } catch { return ts } }
  return (
    <div style={{ minHeight:'100vh', background:'#fafaf9' }}>
      <div style={{ background: '#fff', borderBottom: '1px solid #e7e5e4', padding: '14px 24px', position: 'sticky', top: 0, zIndex: 50, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display:'flex', alignItems:'center', gap:16 }}>
          <button className="ghost" onClick={() => setView('list')} style={{ fontSize:14, color:'#78716c' }}>← Zurück</button>
          <span style={{ fontWeight:700, fontSize:16 }}>Qualitätsmanagement</span>
        </div>
        <button className="secondary" onClick={logout} style={{ fontSize:13, padding:'7px 14px' }}>Abmelden</button>
      </div>
      <div style={{ maxWidth:1000, margin:'2rem auto', padding:'0 1.5rem' }}>
        <h2 style={{ fontSize:22, fontWeight:700, marginBottom:4 }}>Feedback der Beitragenden</h2>
        <p style={{ ...S.muted, marginBottom:'1.5rem' }}>
          Bewertungen direkt nach dem Interview (Smiley-Skala + optionaler Kommentar), neueste zuerst.
          {rows.length > 0 && <> · {rows.length} {rows.length === 1 ? 'Bewertung' : 'Bewertungen'} · ⌀ {avg.toFixed(1)} / 5</>}
        </p>
        <Err msg={err} />
        {loading ? (
          <p style={S.muted}>Wird geladen …</p>
        ) : rows.length === 0 ? (
          <div style={{ ...S.card, textAlign:'center', padding:'1.5rem' }}>
            <p style={S.muted}>Noch keine Bewertungen. Beitragende geben ihr Feedback nach dem Interview ab.</p>
          </div>
        ) : (
          <div style={{ ...S.card, padding:0, overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead>
                <tr>
                  <th style={{ ...th, textAlign:'center' }}>Erledigt</th>
                  <th style={th}>Zeitpunkt</th>
                  <th style={th}>Bewertung</th>
                  <th style={th}>Beitragende:r</th>
                  <th style={th}>Buchprojekt</th>
                  <th style={th}>Manager</th>
                  <th style={th}>Kommentar</th>
                  <th style={{ ...th, textAlign:'right' }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} style={{ opacity: r.done ? 0.5 : 1 }}>
                    <td style={{ ...col, textAlign:'center' }}>
                      <input type="checkbox" checked={!!r.done} onChange={e => toggleFeedbackDone?.(r.id, e.target.checked)}
                        title="Als erledigt markieren" style={{ width:17, height:17, cursor:'pointer', accentColor:'#1c1917' }} />
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
                        style={{ fontSize:12, padding:'5px 10px', color:'#dc2626', borderColor:'#fecaca' }}>Löschen</button>
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
