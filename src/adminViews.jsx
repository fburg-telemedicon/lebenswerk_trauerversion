// src/adminViews.jsx — aus Dashboard() ausgelagerte Admin-Views.
// Jede View bekommt State + Handler als GLEICHNAMIGE Props -> Body verbatim,
// verhaltensneutral. Modul-Helfer (S/Back/Err) werden importiert.

import { S, Back, Err, Lbl, col, th, PartnerBanner } from './ui.jsx'
import { formatEur, costKindLabel, PASSWORD_RULES_TEXT, qrCodeUrl } from './shared.js'
import { CATEGORIES, CATEGORY_ORDER } from './categories.js'

export function AuditView({ auditData, auditLoading, err, logout, loadAudit, setView }) {
    const fmtTime = ts => { try { return new Date(ts).toLocaleString('de-DE') } catch { return ts } }
    const th = { textAlign:'left', padding:'8px 10px', fontSize:12, color:'#78716c', fontWeight:600, borderBottom:'1px solid #e7e5e4', whiteSpace:'nowrap' }
    const td = { padding:'8px 10px', fontSize:12, borderBottom:'1px solid #f5f5f4', verticalAlign:'top' }
    const actionColor = a => a === 'login.failure' ? '#b91c1c'
      : a?.endsWith('.delete') ? '#c2410c'
      : a === 'login.success' ? '#15803d' : '#1c1917'
    return (
      <div style={{ minHeight:'100vh', background:'#fafaf9' }}>
        <div style={{ background:'#fff', borderBottom:'1px solid #e7e5e4', padding:'14px 24px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <span style={{ fontWeight:700, fontSize:16 }}>Lebenswerk Admin</span>
          <button className="secondary" onClick={logout} style={{ fontSize:13, padding:'7px 14px' }}>Abmelden</button>
        </div>
        <div style={{ maxWidth:1000, margin:'2rem auto', padding:'0 1.5rem' }}>
          <Back onClick={() => setView('list')} />
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
      <div style={{ background: '#fff', borderBottom: '1px solid #e7e5e4', padding: '14px 24px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <span style={{ fontWeight: 700, fontSize: 16 }}>Lebenswerk Admin</span>
        <button className="secondary" onClick={logout} style={{ fontSize: 13, padding: '7px 14px' }}>Abmelden</button>
      </div>
      <div style={{ maxWidth: 720, margin: '2rem auto', padding: '0 1.5rem' }}>
        <Back onClick={() => setView('list')} />
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
        <div style={{ background: '#fff', borderBottom: '1px solid #e7e5e4', padding: '14px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
      <div style={{ background: '#fff', borderBottom: '1px solid #e7e5e4', padding: '14px 24px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <span style={{ fontWeight: 700, fontSize: 16 }}>Lebenswerk Admin</span>
        <button className="secondary" onClick={logout} style={{ fontSize: 13, padding: '7px 14px' }}>Abmelden</button>
      </div>
      <div style={{ maxWidth: 540, margin: '2rem auto', padding: '0 1.5rem' }}>
        <Back onClick={() => setView('list')} />
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
        <div style={{ background:'#fff', borderBottom:'1px solid #e7e5e4', padding:'14px 24px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
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
      <div style={{ background: '#fff', borderBottom: '1px solid #e7e5e4', padding: '14px 24px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <span style={{ fontWeight: 700, fontSize: 16 }}>Lebenswerk Admin</span>
        <button className="secondary" onClick={logout} style={{ fontSize: 13, padding: '7px 14px' }}>Abmelden</button>
      </div>
      <div style={{ maxWidth: 720, margin: '2rem auto', padding: '0 1.5rem' }}>
        <Back onClick={() => setView('list')} />
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
                      <button className="secondary" onClick={() => regenerateInvite(u)} style={{ fontSize:12, padding:'5px 10px' }}>Neuer Link</button>
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
            <Lbl>Einladungslink für „{createdInvite.username}"</Lbl>
            <p style={{ fontSize:13, color:'#3f6212', margin:'4px 0 10px' }}>
              Schicken Sie diesen Link an den Benutzer. Beim ersten Aufruf vergibt er sich selbst ein Passwort. (Der Link ist 14 Tage gültig und wurde in die Zwischenablage kopiert.)
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
          <Lbl>Neuer Benutzer</Lbl>
          <input value={userForm.username} onChange={e => setUserForm({ ...userForm, username: e.target.value })} placeholder="Benutzername" style={{ marginBottom:6 }} />
          <p style={{ ...S.muted, fontSize:12, margin:'0 0 12px' }}>
            Kein Passwort nötig: Nach dem Anlegen erhalten Sie einen Einladungslink, über den der Benutzer sich selbst ein Passwort vergibt.
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
      <div style={{ background: '#fff', borderBottom: '1px solid #e7e5e4', padding: '14px 24px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <span style={{ fontWeight: 700, fontSize: 16 }}>Lebenswerk Admin</span>
        <button className="secondary" onClick={logout} style={{ fontSize: 13, padding: '7px 14px' }}>Abmelden</button>
      </div>
      <div style={{ maxWidth: 760, margin: '2rem auto', padding: '0 1.5rem' }}>
        <Back onClick={() => { setCatalogForm(null); setView('list') }} />
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
