// api/_lib/invitemail.js
// Versendet Einladungs- und Passwort-Reset-Mails über den Graph-Mailer
// (noreply@, Reply-To support@) und setzt eine Blindkopie an die Betreiber-Adresse.
//
// Beides nutzt denselben Link `?invite=TOKEN`: Das Einlösen setzt ein (neues)
// Passwort – für die Erst-Einladung wie für den Reset identisch.
//
// kind:
//   'invite'  – Manager-Zugang zum Dashboard (Standard)
//   'reset'   – Passwort zurücksetzen
//   'enduser' – Einladung eines ENDNUTZERS zu seinem eigenen Lebenswerk. Kein
//               Dashboard, sondern das persönliche Interview; die Mail ist in der
//               Sprache, die der Admin für ihn gewählt hat (de/pl/en).

const { sendMail } = require('./graphmail')

// Blindkopie-Empfänger (Betreiber). Per Env überschreibbar.
const BCC = process.env.INVITE_BCC || 'florian.burg@lebensgeschichten.ai'
const REPLY_TO = process.env.INVITE_REPLY_TO || 'support@lebensgeschichten.ai'

// Basis-URL für Links aus dem Request ableiten (bzw. PUBLIC_BASE_URL).
function baseUrl(req) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/+$/, '')
  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0]
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'lebensgeschichten.ai'
  return `${proto}://${host}`
}
function inviteLink(req, tok) { return `${baseUrl(req)}/?invite=${encodeURIComponent(tok)}` }

function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
}

// Texte je Mail-Art und Sprache. Nur die Endnutzer-Einladung ist mehrsprachig —
// Manager arbeiten im deutschen Dashboard.
const TEXTS = {
  invite: {
    de: {
      subject: 'Ihr Zugang zu Lebensgeschichten',
      heading: 'Willkommen bei Lebensgeschichten',
      intro: 'Für Sie wurde ein Zugang zum Lebensgeschichten-Dashboard angelegt. Über den folgenden Link vergeben Sie Ihr Passwort und schließen die Einrichtung ab:',
      button: 'Passwort festlegen',
      fallback: 'Falls der Button nicht funktioniert, kopieren Sie diesen Link in Ihren Browser:',
      footer: 'Der Link ist zeitlich begrenzt gültig. Falls Sie dies nicht angefordert haben, können Sie diese E-Mail ignorieren.',
    },
  },
  reset: {
    de: {
      subject: 'Passwort zurücksetzen – Lebensgeschichten',
      heading: 'Passwort zurücksetzen',
      intro: 'Sie haben angefordert, Ihr Passwort zurückzusetzen. Über den folgenden Link vergeben Sie ein neues Passwort:',
      button: 'Passwort festlegen',
      fallback: 'Falls der Button nicht funktioniert, kopieren Sie diesen Link in Ihren Browser:',
      footer: 'Der Link ist zeitlich begrenzt gültig. Falls Sie dies nicht angefordert haben, können Sie diese E-Mail ignorieren.',
    },
  },
  enduser: {
    de: {
      subject: 'Ihr Lebenswerk – Ihr persönlicher Zugang',
      heading: 'Willkommen zu Ihrem Lebenswerk',
      intro: 'Für Sie wurde ein persönlicher Zugang angelegt, über den Sie Ihre eigene Lebensgeschichte erzählen. Ein KI-Interviewer begleitet Sie in Ruhe durch Ihre Erinnerungen – Sie bestimmen selbst, wann und wie lange Sie erzählen; Ihre Antworten werden automatisch gespeichert. Am Ende entsteht daraus Ihre Autobiographie. Über den folgenden Link vergeben Sie zunächst Ihr Passwort:',
      button: 'Passwort festlegen und beginnen',
      fallback: 'Falls der Button nicht funktioniert, kopieren Sie diesen Link in Ihren Browser:',
      footer: 'Der Link ist zeitlich begrenzt gültig. Falls Sie dies nicht erwarten, können Sie diese E-Mail ignorieren.',
    },
    pl: {
      subject: 'Twoje dzieło życia – Twój osobisty dostęp',
      heading: 'Witamy w Twoim dziele życia',
      intro: 'Utworzyliśmy dla Ciebie osobisty dostęp, dzięki któremu opowiesz historię swojego życia. Prowadzący rozmowę asystent AI spokojnie przeprowadzi Cię przez Twoje wspomnienia – sam(a) decydujesz, kiedy i jak długo opowiadasz; Twoje odpowiedzi zapisują się automatycznie. Na koniec powstanie z nich Twoja autobiografia. Pod poniższym linkiem ustawisz najpierw swoje hasło:',
      button: 'Ustaw hasło i zacznij',
      fallback: 'Jeśli przycisk nie działa, skopiuj ten link do przeglądarki:',
      footer: 'Link jest ważny przez ograniczony czas. Jeśli się tego nie spodziewasz, zignoruj tę wiadomość.',
    },
    en: {
      subject: 'Your life’s work – your personal access',
      heading: 'Welcome to your life’s work',
      intro: 'A personal account has been created for you, through which you can tell the story of your own life. An AI interviewer will guide you gently through your memories – you decide when and for how long you talk, and your answers are saved automatically. In the end, your autobiography emerges from them. Use the link below to set your password first:',
      button: 'Set password and begin',
      fallback: 'If the button does not work, copy this link into your browser:',
      footer: 'The link is valid for a limited time. If you were not expecting this, you can ignore this email.',
    },
    // Schweizer Hochdeutsch: wie Deutsch, nur ohne ß (unten programmatisch abgeleitet).
    es: {
      subject: 'Su obra de vida: su acceso personal',
      heading: 'Bienvenido a su obra de vida',
      intro: 'Se ha creado para usted un acceso personal con el que podrá contar la historia de su propia vida. Un entrevistador con IA le acompañará con calma por sus recuerdos: usted decide cuándo y durante cuánto tiempo habla, y sus respuestas se guardan automáticamente. Al final surgirá de ellas su autobiografía. A través del siguiente enlace, establezca primero su contraseña:',
      button: 'Establecer contraseña y empezar',
      fallback: 'Si el botón no funciona, copie este enlace en su navegador:',
      footer: 'El enlace tiene una validez limitada. Si no esperaba este mensaje, puede ignorarlo.',
    },
    it: {
      subject: 'La sua opera di una vita – il suo accesso personale',
      heading: 'Benvenuto nella sua opera di una vita',
      intro: 'È stato creato per lei un accesso personale con cui raccontare la storia della sua vita. Un intervistatore con IA la accompagnerà con calma tra i suoi ricordi: decide lei quando e per quanto tempo parlare, e le sue risposte vengono salvate automaticamente. Alla fine ne nascerà la sua autobiografia. Con il link seguente imposti prima la sua password:',
      button: 'Imposta la password e inizia',
      fallback: 'Se il pulsante non funziona, copi questo link nel suo browser:',
      footer: 'Il link ha una validità limitata. Se non se lo aspettava, può ignorare questa e-mail.',
    },
    eu: {
      subject: 'Zure bizitza-lana – zure sarbide pertsonala',
      heading: 'Ongi etorri zure bizitza-lanera',
      intro: 'Sarbide pertsonal bat sortu dizugu, zure bizitzaren istorioa kontatzeko. IA elkarrizketatzaile batek lasai lagunduko dizu zure oroitzapenetan zehar: zuk erabakitzen duzu noiz eta zenbat denboraz hitz egin, eta zure erantzunak automatikoki gordetzen dira. Amaieran zure autobiografia sortuko da. Hurrengo estekaren bidez, ezarri lehenik zure pasahitza:',
      button: 'Ezarri pasahitza eta hasi',
      fallback: 'Botoiak ez badu funtzionatzen, kopiatu esteka hau zure nabigatzailean:',
      footer: 'Estekak iraupen mugatua du. Ez bazenuen espero, mezu hau ez ikusi egin dezakezu.',
    },
    he: {
      subject: 'מפעל חייך – הגישה האישית שלך',
      heading: 'ברוך הבא למפעל חייך',
      intro: 'נוצרה עבורך גישה אישית שדרכה תוכל לספר את סיפור חייך. מראיין מבוסס בינה מלאכותית ילווה אותך בנחת בין זיכרונותיך – אתה מחליט מתי וכמה זמן לספר, והתשובות נשמרות אוטומטית. בסופו של דבר תיווצר מהן האוטוביוגרפיה שלך. בקישור הבא קבע תחילה את הסיסמה שלך:',
      button: 'הגדרת סיסמה והתחלה',
      fallback: 'אם הכפתור אינו פועל, העתק קישור זה לדפדפן:',
      footer: 'תוקף הקישור מוגבל בזמן. אם לא ציפית לכך, אפשר להתעלם מהודעה זו.',
    },
    ar: {
      subject: 'عمل حياتك – وصولك الشخصي',
      heading: 'مرحباً بك في عمل حياتك',
      intro: 'أُنشئ لك حساب شخصي تروي من خلاله قصة حياتك. سيرافقك محاور بالذكاء الاصطناعي بهدوء عبر ذكرياتك — أنت من يقرر متى وكم من الوقت تتحدث، وتُحفظ إجاباتك تلقائياً. وفي النهاية تنشأ منها سيرتك الذاتية. عبر الرابط التالي، عيّن كلمة المرور أولاً:',
      button: 'تعيين كلمة المرور والبدء',
      fallback: 'إذا لم يعمل الزر، فانسخ هذا الرابط إلى متصفحك:',
      footer: 'الرابط صالح لفترة محدودة. إذا لم تكن تتوقع ذلك، يمكنك تجاهل هذه الرسالة.',
    },
  },
}

// Schweizer Hochdeutsch = Deutsch ohne ß. Wird für die Endnutzer-Mail abgeleitet,
// damit kein zweites Wörterbuch gepflegt werden muss.
TEXTS.enduser['de-CH'] = Object.fromEntries(
  Object.entries(TEXTS.enduser.de).map(([k, v]) => [k, String(v).replace(/ß/g, 'ss')])
)

// Rechts-nach-links (Hebräisch, Arabisch): Mail-Body braucht dir="rtl".
const RTL_MAIL_LANGS = new Set(['he', 'ar'])

function pickText(kind, lang) {
  const byLang = TEXTS[kind] || TEXTS.invite
  return byLang[lang] || byLang.de
}

function buildHtml({ heading, intro, url, button, fallback, footer, lang }) {
  const safeUrl = esc(url)
  const dir = RTL_MAIL_LANGS.has(lang) ? 'rtl' : 'ltr'
  return `<!doctype html><html lang="${esc(lang)}" dir="${dir}"><body style="margin:0;background:#fafaf9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1c1917;" dir="${dir}">
  <div style="max-width:520px;margin:0 auto;padding:28px 24px;">
    <h1 style="font-size:20px;font-weight:700;margin:0 0 14px;">${esc(heading)}</h1>
    <p style="font-size:15px;line-height:1.6;margin:0 0 20px;color:#44403c;">${esc(intro)}</p>
    <p style="margin:0 0 24px;"><a href="${safeUrl}" style="display:inline-block;background:#1c1917;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-size:15px;">${esc(button)}</a></p>
    <p style="font-size:12px;line-height:1.6;color:#78716c;margin:0 0 6px;">${esc(fallback)}</p>
    <p style="font-size:12px;line-height:1.6;word-break:break-all;margin:0 0 24px;"><a href="${safeUrl}" style="color:#57534e;">${safeUrl}</a></p>
    <p style="font-size:12px;line-height:1.6;color:#a8a29e;margin:0;border-top:1px solid #e7e5e4;padding-top:16px;">${esc(footer)}<br>— Lebensgeschichten</p>
  </div></body></html>`
}

// kind: 'invite' | 'reset' | 'enduser';  lang: 'de' | 'pl' | 'en' (nur enduser)
async function sendAccessMail({ to, url, kind = 'invite', lang = 'de' }) {
  const t = pickText(kind, lang)
  const text = `${t.heading}\n\n${t.intro}\n\n${url}\n\n${t.footer}\n\n— Lebensgeschichten`
  const html = buildHtml({ ...t, url, lang })
  return sendMail({ to, subject: t.subject, text, html, replyTo: REPLY_TO, bcc: BCC })
}

module.exports = { sendAccessMail, baseUrl, inviteLink }
