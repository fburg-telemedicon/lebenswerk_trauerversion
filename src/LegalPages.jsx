// src/LegalPages.jsx
// Statische Rechtsseiten (Impressum/Datenschutz) + Footer. Aus App.jsx ausgelagert.

import { useState, useEffect } from 'react'
import { CONSENT_VERSION } from './constants.js'
import { BOOK_DISCLAIMER } from './bookExport.js'

// Footer-Beschriftungen je Sprache. Die ZIELDOKUMENTE bleiben deutsch (nur die
// Link-Texte werden übersetzt) — so entschieden, weil Rechtstexte maßgeblich
// deutsch sind.
const FOOTER_LABELS = {
  de:      { privacy: 'Datenschutzerklärung', imprint: 'Impressum' },
  'de-CH': { privacy: 'Datenschutzerklärung', imprint: 'Impressum' },
  en:      { privacy: 'Privacy policy', imprint: 'Legal notice' },
  pl:      { privacy: 'Polityka prywatności', imprint: 'Nota prawna' },
  es:      { privacy: 'Política de privacidad', imprint: 'Aviso legal' },
  it:      { privacy: 'Informativa sulla privacy', imprint: 'Note legali' },
  eu:      { privacy: 'Pribatutasun-politika', imprint: 'Lege-oharra' },
  he:      { privacy: 'מדיניות פרטיות', imprint: 'הצהרה משפטית' },
  ar:      { privacy: 'سياسة الخصوصية', imprint: 'الإشعار القانوني' },
}

function LegalLayout({ title, children }) {
  const back = () => { if (window.history.length > 1) window.history.back(); else window.location.href = '/' }
  return (
    <div style={{ minHeight:'100vh', background:'#fafaf9' }}>
      <div style={{ maxWidth:760, margin:'0 auto', padding:'2.5rem 1.5rem 4rem' }}>
        <button className="ghost" onClick={back} style={{ fontSize:14, color:'#78716c', marginBottom:'1rem' }}>← Zurück</button>
        <h1 style={{ fontSize:26, fontWeight:800, margin:'0 0 1.5rem' }}>{title}</h1>
        <div style={{ fontSize:15, lineHeight:1.7, color:'#44403c' }}>{children}</div>
      </div>
    </div>
  )
}

const LH = { fontSize:18, fontWeight:700, margin:'1.8rem 0 .6rem', color:'#1c1917' }

export function Impressum() {
  return (
    <LegalLayout title="Impressum">
      <p><strong>Angaben gemäß § 5 DDG</strong></p>
      <p>Lebenswerk.AI GmbH<br/>Walter-Schneider-Straße 10<br/>06317 Seegebiet Mansfelder Land<br/>Deutschland</p>
      <h2 style={LH}>Vertreten durch</h2>
      <p>Geschäftsführer Prof. Dr. med. Tobias D. Gantner</p>
      <h2 style={LH}>Kontakt</h2>
      <p>E-Mail: <a href="mailto:support@lebensgeschichten.ai">support@lebensgeschichten.ai</a><br/>Kontaktformular: <a href="/kontakt">lebensgeschichten.ai/kontakt</a></p>
      <p style={{ fontSize:14, color:'#78716c' }}>Wir verzichten bewusst auf eine Telefonnummer und antworten stattdessen schriftlich — in der Regel innerhalb eines Werktages.</p>
      <h2 style={LH}>Registereintrag</h2>
      <p>Eintragung im Handelsregister ist beantragt.<br/>Registergericht: folgt<br/>Registernummer: folgt</p>
      <h2 style={LH}>Umsatzsteuer-Identifikationsnummer</h2>
      <p>USt-IdNr. gemäß § 27a UStG: folgt</p>
      <h2 style={LH}>Verantwortlich für den Inhalt</h2>
      <p>gemäß § 18 Abs. 2 MStV: Prof. Dr. med. Tobias D. Gantner, Anschrift wie oben.</p>
      <h2 style={LH}>Haftung für die erstellten Bücher und Inhalte</h2>
      <p>{BOOK_DISCLAIMER}</p>
      <p>
        Die mit dieser Anwendung erstellten Bücher und Reden beruhen ausschließlich auf den Angaben
        der Beitragenden. Für Aktualität, Vollständigkeit und Richtigkeit dieser Inhalte übernehmen
        wir keine Gewähr. Eine Haftung für Schäden, die aus der Nutzung oder Weitergabe der erstellten
        Inhalte entstehen, ist – soweit gesetzlich zulässig – ausgeschlossen.
      </p>
    </LegalLayout>
  )
}

export function Datenschutz() {
  return (
    <LegalLayout title="Datenschutzerklärung">
      <p style={{ color:'#78716c' }}>Stand: 1. August 2026 · Fassung {CONSENT_VERSION}</p>

      <h2 style={LH}>1. Verantwortlicher</h2>
      <p>
        Verantwortlich für die Datenverarbeitung im Sinne der DSGVO ist:<br/>
        Lebenswerk.AI GmbH, Walter-Schneider-Straße 10, 06317 Seegebiet Mansfelder Land, Deutschland<br/>
        Geschäftsführer: Prof. Dr. med. Tobias D. Gantner<br/>
        E-Mail: support@lebensgeschichten.ai · Kontaktformular: lebensgeschichten.ai/kontakt
      </p>

      <h2 style={LH}>2. Worum es geht</h2>
      <p>
        Mit dieser Anwendung erstellen wir ein persönliches Buch oder eine Rede zu einem besonderen
        Anlass – etwa zum Gedenken an eine verstorbene Person, zu einem Geburtstag, Jubiläum,
        Abschied oder zur Geburt eines Kindes. Dazu führen nahestehende Personen ein sprach- oder
        textbasiertes Interview, aus dessen Inhalten ein persönlicher Text entsteht. Die erstellten
        Bücher und Reden geben die persönlichen Schilderungen der Beitragenden wieder; ihre
        inhaltliche Richtigkeit können wir nicht überprüfen (siehe Haftungsausschluss im Impressum).
      </p>

      <h2 style={LH}>3. Welche Daten wir verarbeiten</h2>
      <p>
        Von Ihnen als beitragender Person: Name, Beziehung zu der Person, um die es geht, Geschlecht,
        gewünschte Anrede, Ihre Stimmaufnahmen während des Interviews sowie deren Verschriftlichung
        und sämtliche Interview-Inhalte. Diese Inhalte können <strong>besondere Kategorien
        personenbezogener Daten</strong> enthalten (Art. 9 DSGVO), insbesondere Angaben zu Gesundheit,
        ggf. religiöse oder weltanschauliche Angaben und – je nach Anlass – Angaben zu den Umständen
        (etwa eines Todesfalls). Technisch fallen zudem Zeitstempel und die Protokollierung Ihrer
        Einwilligung an.
      </p>

      <h2 style={LH}>4. Rechtsgrundlage</h2>
      <p>
        Wir verarbeiten diese Daten ausschließlich auf Grundlage Ihrer <strong>ausdrücklichen
        Einwilligung</strong> (Art. 6 Abs. 1 lit. a und Art. 9 Abs. 2 lit. a DSGVO). Die Einwilligung
        ist freiwillig; ohne sie können wir das gewünschte Buch bzw. die Rede nicht erstellen. Sie können Ihre
        Einwilligung jederzeit mit Wirkung für die Zukunft widerrufen, ohne dass die Rechtmäßigkeit
        der bis dahin erfolgten Verarbeitung berührt wird (siehe Abschnitt 8).
      </p>

      <h2 style={LH}>5. KI-Verarbeitung und Empfänger</h2>
      <p>
        Zur Verarbeitung setzen wir Dienstleister als Auftragsverarbeiter ein:
      </p>
      <ul style={{ margin:'0 0 1rem', paddingLeft:'1.2rem' }}>
        <li><strong>Microsoft Azure</strong> (Azure OpenAI, Azure AI Speech) – KI-gestützte Interviewführung, Texterstellung, Sprachausgabe (Text-to-Speech) und Spracherkennung (Transkription); Verarbeitung in der EU.</li>
        <li><strong>Black Forest Labs</strong> (FLUX) über Microsoft Azure – KI-gestützte Bilderzeugung; Verarbeitung in der EU.</li>
        <li><strong>Supabase</strong> – Speicherung von Datenbank- und Bildinhalten; EU (Frankfurt).</li>
        <li><strong>Vercel</strong> – Betrieb und Auslieferung der Anwendung; Funktionsregion Frankfurt (EU).</li>
      </ul>
      <p>
        Sämtliche KI-Verarbeitung (Interviewführung, Texterstellung, Sprachausgabe,
        Spracherkennung und Bilderzeugung) sowie die Datenspeicherung erfolgen
        <strong> ausschließlich in der EU</strong>. Eine Übermittlung in ein Drittland
        außerhalb der EU bzw. des EWR findet nicht statt. Mit den eingesetzten
        Auftragsverarbeitern bestehen Verträge zur Auftragsverarbeitung nach
        <strong> Art. 28 DSGVO</strong>; die übermittelten Inhalte werden nicht zum Training
        der KI-Modelle verwendet. Eine automatisierte Entscheidung mit rechtlicher Wirkung
        Ihnen gegenüber findet nicht statt.
      </p>

      <h2 style={LH}>6. Speicherdauer</h2>
      <p>
        Wir löschen die zu einem Buch gehörenden personenbezogenen Daten automatisch
        <strong> 90 Tage nach dem hinterlegten Anlass-Termin</strong> (z. B. Bestattung, Feier oder
        Verabschiedung; ist kein Termin hinterlegt, 90 Tage nach Anlage des Buchs). Auf Ihren Wunsch
        löschen wir Ihre Daten auch früher.
      </p>

      <h2 style={LH}>7. Ihre Rechte</h2>
      <p>Ihnen stehen gegenüber uns folgende Rechte zu:</p>
      <ul style={{ margin:'0 0 1rem', paddingLeft:'1.2rem' }}>
        <li>Auskunft (Art. 15), Berichtigung (Art. 16), Löschung (Art. 17), Einschränkung der Verarbeitung (Art. 18),</li>
        <li>Datenübertragbarkeit (Art. 20) – wir stellen Ihre Daten auf Anfrage als maschinenlesbare Datei bereit,</li>
        <li>Widerspruch (Art. 21) sowie Widerruf einer erteilten Einwilligung (Art. 7 Abs. 3).</li>
      </ul>
      <p>Zur Ausübung genügt eine Nachricht an support@lebensgeschichten.ai.</p>

      <h2 style={LH}>8. Widerruf der Einwilligung</h2>
      <p>
        Sie können Ihre Einwilligung jederzeit widerrufen – formlos per E-Mail an
        support@lebensgeschichten.ai. Nach einem Widerruf stellen wir die weitere Verarbeitung ein
        und löschen Ihre Daten, soweit keine gesetzliche Aufbewahrungspflicht entgegensteht.
      </p>

      <h2 style={LH}>9. Beschwerderecht</h2>
      <p>
        Sie haben das Recht, sich bei einer Datenschutz-Aufsichtsbehörde zu beschweren. Für uns
        zuständig ist die Landesbeauftragte für Datenschutz und Informationsfreiheit
        Nordrhein-Westfalen (LDI NRW), Postfach 20 04 44, 40102 Düsseldorf.
      </p>
    </LegalLayout>
  )
}

// Der Footer wird global gerendert und kennt die Interview-Sprache nicht direkt.
// Der Beitragenden-Flow schreibt sie nach `document.documentElement.lang` und löst
// ein `lw-lang`-Event aus; darauf liest der Footer die Sprache neu und übersetzt
// seine beiden Link-Texte (die Zielseiten bleiben deutsch).
export function LegalFooter() {
  const [lang, setLang] = useState(() => document.documentElement.lang || 'de')
  useEffect(() => {
    const read = () => setLang(document.documentElement.lang || 'de')
    read()
    window.addEventListener('lw-lang', read)
    return () => window.removeEventListener('lw-lang', read)
  }, [])
  const L = FOOTER_LABELS[lang] || FOOTER_LABELS.de
  const a = { color:'#57534e', margin:'0 10px', textDecoration:'none' }
  return (
    <footer dir={lang === 'he' || lang === 'ar' ? 'rtl' : 'ltr'} style={{ borderTop:'1px solid #e7e5e4', padding:'18px 1.5rem', textAlign:'center', fontSize:13, color:'#78716c', background:'#fafaf9' }}>
      <a href="/#datenschutz" target="_blank" rel="noopener noreferrer" style={a}>{L.privacy}</a>
      <span style={{ color:'#d6d3d1' }}>·</span>
      <a href="/#impressum" target="_blank" rel="noopener noreferrer" style={a}>{L.imprint}</a>
    </footer>
  )
}
