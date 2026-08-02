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
      <p>USt-IdNr. gemäß § 27a UStG: DE291805257</p>
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
      <h2 style={LH}>Keine medizinische oder therapeutische Leistung</h2>
      <p>
        Diese Anwendung dient der Biografiearbeit und der Erinnerung. Sie erbringt <strong>keine
        medizinische, psychotherapeutische oder traumatherapeutische Leistung</strong>, stellt keine
        Diagnosen und ersetzt keine Behandlung. Auch dort, wo aus einem Interview ein Bogen oder ein
        Exzerpt für Pflegende entsteht, handelt es sich um eine Zusammenfassung des Erzählten und
        nicht um eine fachliche Beurteilung.
      </p>
      <h2 style={LH}>Erinnerungen können belasten</h2>
      <p>
        Über das eigene Leben zu sprechen, berührt auch Verluste, Krankheit, Krieg oder Flucht. Das
        kann bewegen, und es kann belasten. Sie bestimmen selbst, worüber Sie sprechen, können jede
        Frage überspringen und das Gespräch jederzeit beenden. Für psychische Belastungen oder deren
        Folgen übernehmen wir – soweit gesetzlich zulässig – keine Haftung; ausgenommen bleibt die
        Haftung bei Vorsatz und grober Fahrlässigkeit sowie bei Verletzung von Leben, Körper oder
        Gesundheit. Wenn Sie merken, dass Ihnen ein Thema zu nahe geht, brechen Sie ab und wenden Sie
        sich an eine Person Ihres Vertrauens oder an fachliche Unterstützung.
      </p>
    </LegalLayout>
  )
}

export function Datenschutz() {
  return (
    <LegalLayout title="Datenschutzerklärung">
      <p style={{ color:'#78716c' }}>Stand: 2. August 2026 · Fassung {CONSENT_VERSION}</p>

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
      <p>
        <strong>Beim Aufruf der Anwendung</strong> verarbeiten wir außerdem technische Zugriffsdaten:
        IP-Adresse, Zeitpunkt, aufgerufene Adresse und Fehlermeldungen. Sie dienen ausschließlich dem
        sicheren Betrieb – der Abwehr von Überlastung und Missbrauch sowie der Fehlersuche – und
        werden in einem Zugriffsprotokoll gespeichert, das nach spätestens einem Jahr gelöscht wird.
        Rechtsgrundlage ist unser berechtigtes Interesse an einem sicheren Betrieb (Art. 6 Abs. 1
        lit. f DSGVO).
      </p>

      <h2 style={LH}>4. Speicherung auf Ihrem Gerät</h2>
      <p>
        Wir setzen <strong>keine Cookies</strong> und kein Tracking ein, weder eigenes noch fremdes.
        Die Anwendung legt jedoch einige Angaben im Speicher Ihres Browsers ab: Ihren Zugangscode und
        den Stand Ihres Interviews, damit Sie später weitererzählen können, sowie Einstellungen wie
        den gewählten Mikrofon-Modus. Diese Speicherung ist für den von Ihnen gewünschten Dienst
        <strong> unbedingt erforderlich</strong> und daher nach § 25 Abs. 2 Nr. 2 TDDDG
        einwilligungsfrei. Sie können die Daten jederzeit löschen, indem Sie die Websitedaten in
        Ihrem Browser entfernen – dann geht allerdings ein noch nicht abgeschlossenes Interview
        verloren.
      </p>

      <h2 style={LH}>5. Müssen Sie diese Daten bereitstellen?</h2>
      <p>
        Nein. Es gibt keine gesetzliche oder vertragliche Pflicht, uns etwas zu erzählen, und Sie
        müssen auch keine bestimmte Frage beantworten. Die Bereitstellung ist allein deshalb
        erforderlich, weil ohne Ihre Erzählung kein Buch entstehen kann – das ist der Zweck der
        Sache. Wenn Sie nicht teilnehmen oder abbrechen, entsteht Ihnen dadurch kein Nachteil
        (Art. 13 Abs. 2 lit. e DSGVO).
      </p>

      <h2 style={LH}>6. Rechtsgrundlage</h2>
      <p>
        Wir verarbeiten diese Daten ausschließlich auf Grundlage Ihrer <strong>ausdrücklichen
        Einwilligung</strong> (Art. 6 Abs. 1 lit. a und Art. 9 Abs. 2 lit. a DSGVO). Die Einwilligung
        ist freiwillig; ohne sie können wir das gewünschte Buch bzw. die Rede nicht erstellen. Sie können Ihre
        Einwilligung jederzeit mit Wirkung für die Zukunft widerrufen, ohne dass die Rechtmäßigkeit
        der bis dahin erfolgten Verarbeitung berührt wird (siehe Abschnitt 11).
      </p>

      <h2 style={LH}>7. KI-Verarbeitung und Empfänger</h2>
      <p>
        Zur Verarbeitung setzen wir Dienstleister als Auftragsverarbeiter ein:
      </p>
      <ul style={{ margin:'0 0 1rem', paddingLeft:'1.2rem' }}>
        <li><strong>Microsoft Azure</strong> (Azure OpenAI) – KI-gestützte Interviewführung und Erstellung der Buch- und Redetexte; Verarbeitung in der EU.</li>
        <li><strong>Microsoft Azure</strong> (Azure AI Speech) – Sprachausgabe (Text-to-Speech) und Spracherkennung (Transkription); Verarbeitung in der EU (Region Westeuropa). Für das optionale Live-Sprachgespräch, das nur nach ausdrücklicher Freischaltung zur Verfügung steht, in der Region Schweden.</li>
        <li><strong>Black Forest Labs</strong> (FLUX) über Microsoft Azure – KI-gestützte Bilderzeugung; Verarbeitung in der EU. Der Modellanbieter selbst erhält keine Daten.</li>
        <li><strong>Microsoft Azure</strong> (Datenbank und Blob-Speicher) – Speicherung der Beiträge, Bücher, Bilder und hochgeladenen Fotos; EU (Nordeuropa).</li>
        <li><strong>Microsoft Azure</strong> (Container Apps) – Betrieb und Auslieferung der Anwendung; Verarbeitung in der EU.</li>
        <li><strong>Microsoft 365</strong> (Graph) – Versand der E-Mails (Zugangs- und Wiederaufnahme-Links, Antworten auf Anfragen); Verarbeitung in der EU.</li>
      </ul>
      <p>
        Sämtliche KI-Verarbeitung (Interviewführung, Texterstellung, Sprachausgabe,
        Spracherkennung und Bilderzeugung) sowie die Speicherung Ihrer Beiträge, Bücher und
        Bilder erfolgen <strong>ausschließlich in der EU</strong>. Für diese Daten findet
        keine Übermittlung in ein Drittland statt (zum Online-Shop siehe Abschnitt 8; er
        verarbeitet ausschließlich Bestelldaten und keine Interview-Inhalte). Mit den
        eingesetzten Auftragsverarbeitern bestehen Verträge zur Auftragsverarbeitung nach
        <strong> Art. 28 DSGVO</strong>; die übermittelten Inhalte werden nicht zum Training
        der KI-Modelle verwendet. Eine automatisierte Entscheidung mit rechtlicher Wirkung
        Ihnen gegenüber findet nicht statt.
      </p>

      <h2 style={LH}>8. Online-Shop</h2>
      <p>
        Für den Verkauf von Lizenzen setzen wir den Shop-Dienst <strong>Ecwid</strong> ein
        (Ecwid, Inc., 687 S Coast Hwy 101, Ste. 239, Encinitas, CA 92024, USA – ein
        Unternehmen der Lightspeed-Gruppe). Dabei werden die für den Kauf nötigen Angaben
        verarbeitet: Name, Rechnungs- und ggf. Lieferanschrift, E-Mail-Adresse, Bestell- und
        Zahlungsdaten. Rechtsgrundlage ist die Erfüllung des Kaufvertrags
        (Art. 6 Abs. 1 lit. b DSGVO), für die steuerlichen Aufzeichnungen die gesetzliche
        Pflicht (Art. 6 Abs. 1 lit. c DSGVO i. V. m. § 147 AO, § 257 HGB – zehn Jahre).
      </p>
      <p>
        Die Bestelldaten werden dabei auch <strong>in den USA</strong> verarbeitet. Grundlage
        sind ein Vertrag zur Auftragsverarbeitung mit Standardvertragsklauseln der
        Europäischen Kommission (Art. 46 Abs. 2 lit. c DSGVO) sowie die Zertifizierung von
        Ecwid, Inc. unter dem <strong>EU-US Data Privacy Framework</strong>
        (Angemessenheitsbeschluss vom 10. Juli 2023, Art. 45 DSGVO). <strong>Interview-Inhalte,
        Stimmaufnahmen, Bücher und Reden gelangen nicht in den Shop</strong> – dieser kennt
        nur den Kaufvorgang.
      </p>

      <h2 style={LH}>9. Speicherdauer</h2>
      <p>
        Die zu einem Buch gehörenden Eingangsdaten – Interviewbeiträge und hochgeladene
        Original-Fotos – löschen wir automatisch <strong>90 Tage nach Ende der Nutzungsdauer</strong>.
        Die Nutzungsdauer endet mit dem hinterlegten Anlass-Termin (z. B. Bestattung, Feier oder
        Verabschiedung); ist kein Termin hinterlegt, sechs Monate nach Anlage des Buchs. Auf Wunsch
        löschen wir früher – dafür genügt eine Nachricht.
      </p>
      <p>
        Das fertige Werk – Buch, Rede bzw. Exzerpt und die weiteren Ausgaben – bleibt erhalten; es ist
        der Zweck der Sache. Für die Kategorie <strong>Anamnese</strong> gilt eine kürzere Frist: Dort
        wird der gesamte Datensatz einschließlich des Bogens 14 Tage nach der Aufnahme vollständig
        gelöscht. Zugriffsprotokolle laufen nach einem Jahr aus (Abschnitt 3), Rechnungen und
        Buchungsbelege unterliegen der gesetzlichen Aufbewahrung von zehn Jahren (Abschnitt 8).
      </p>

      <h2 style={LH}>10. Ihre Rechte</h2>
      <p>Ihnen stehen gegenüber uns folgende Rechte zu:</p>
      <ul style={{ margin:'0 0 1rem', paddingLeft:'1.2rem' }}>
        <li>Auskunft (Art. 15), Berichtigung (Art. 16), Löschung (Art. 17), Einschränkung der Verarbeitung (Art. 18),</li>
        <li>Datenübertragbarkeit (Art. 20) – wir stellen Ihre Daten auf Anfrage als maschinenlesbare Datei bereit,</li>
        <li>Widerspruch (Art. 21) sowie Widerruf einer erteilten Einwilligung (Art. 7 Abs. 3).</li>
      </ul>
      <p>Zur Ausübung genügt eine Nachricht an support@lebensgeschichten.ai.</p>

      <h2 style={LH}>11. Widerruf der Einwilligung</h2>
      <p>
        Sie können Ihre Einwilligung jederzeit widerrufen – formlos per E-Mail an
        support@lebensgeschichten.ai. Nach einem Widerruf stellen wir die weitere Verarbeitung ein
        und löschen Ihre Daten, soweit keine gesetzliche Aufbewahrungspflicht entgegensteht.
      </p>

      <h2 style={LH}>12. Beschwerderecht</h2>
      <p>
        Sie haben das Recht, sich bei einer Datenschutz-Aufsichtsbehörde zu beschweren. Nach dem Sitz
        unseres Unternehmens ist das der Landesbeauftragte für den Datenschutz Sachsen-Anhalt,
        Leiterstraße 9, 39104 Magdeburg.
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
