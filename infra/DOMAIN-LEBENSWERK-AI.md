# Domain lebenswerk.ai — Bestand und Umzug

Erhoben am **2026-09-01** (öffentliche DNS-/RDAP-Abfragen, keine Zugangsdaten).
Diese Datei sagt, **wo man das neue Ziel einträgt**, und was dabei nicht
kaputtgehen darf — vor allem die E-Mail.

## Wer die Domain hält

| | |
|---|---|
| Registrar | **InterNetX** (RDAP-Handle 800087, `rdap.registrar.internetx.com`) |
| Registry | Identity Digital (.ai) |
| Registriert | 2024-12-07 |
| **Läuft ab** | **2026-12-07** — also in gut drei Monaten. Vor der Übernahme klären, wer verlängert; ein Transfer verlängert in der Regel um ein Jahr. |
| Inhaberdaten | verdeckt durch Whois-Privacy (*PrivateName Services Inc.*, info@privatename.com) |
| Status | `active` (kein `clientTransferProhibited` gesetzt — ein Transfer ist grundsätzlich möglich, Auth-Code vom bisherigen Verwalter nötig) |

## Wo die DNS-Einträge gepflegt werden  ← **hier trägt man das neue Ziel ein**

Die Nameserver sind

    dns1.p01.nsone.net   dns2.p01.nsone.net
    dns3.p01.nsone.net   dns4.p01.nsone.net

Das ist **NS1 — das DNS-Backend von Netlify**; der SOA-Kontakt der Zone lautet
`domains+netlify.netlify.com`. Die Zone wird also **im Netlify-Konto** verwaltet
(*Domains → lebenswerk.ai → DNS panel*), **nicht** bei InterNetX. Bei InterNetX
stehen nur die vier Nameserver-Einträge.

Daraus folgen zwei mögliche Wege:

* **Weg A (schnell):** Zugang zum Netlify-Konto besorgen und dort die A-Records
  auf Azure umbiegen. Alles andere (MX, SPF, autodiscover) bleibt unberührt —
  das ist der risikoärmste Weg.
* **Weg B (sauber):** Bei InterNetX die Nameserver auf einen eigenen DNS-Anbieter
  umstellen (z. B. Azure DNS). Dann **muss die komplette Zone vorher
  nachgebaut werden** — sonst steht die E-Mail still, sobald die neuen
  Nameserver greifen. Die vollständige Liste steht unten.

## Aktueller Zoneninhalt

### Website (das ist der Teil, der auf Azure zeigen soll)

| Name | Typ | Wert |
|---|---|---|
| `lebenswerk.ai` | A | `63.176.8.218`, `35.157.26.135` (Netlify-Loadbalancer, eu-central) |
| `www.lebenswerk.ai` | A | dieselben beiden Adressen |

Ausgeliefert wird von **Netlify** (Antwortkopf `Server: Netlify`,
`Cache-Status: "Netlify Edge"`). Inhalt ist eine kompilierte React-SPA
(Lovable-Build); eine Kopie liegt in `website-archiv/lebenswerk.ai-2026-09-01/`.

### E-Mail — **nicht anfassen, vollständig mitnehmen**

| Name | Typ | Wert |
|---|---|---|
| `lebenswerk.ai` | MX 10/20/30/40 | `mx01.` bis `mx04.hornetsecurity.com` |
| `lebenswerk.ai` | TXT (SPF) | `v=spf1  include:spf.protection.outlook.com  include:spf.hornetsecurity.com -all` |
| `lebenswerk.ai` | TXT | `MS=ms82341597` (Domain-Verifizierung Microsoft 365) |
| `lebenswerk.ai` | TXT | `google-site-verification=OWf7_eEikMZI43AGwMQXa9m05OfgHneyt8QZZAqYcn8` |
| `lebenswerk.ai` | TXT | `google-site-verification=y0AZqEQK0wZHxpwEtiQEu6f1ajkT-v9DCVIPsYR5-6g` |
| `autodiscover` | CNAME | `autodiscover.outlook.com` |

Die Post läuft also über **Hornetsecurity als vorgelagerten Filter, dahinter
Microsoft 365**. Wer die Postfächer betreibt, steht nicht im DNS — das ist beim
Übernehmen zu klären (M365-Tenant, Hornetsecurity-Vertrag).

Auffällig fehlen:

* **kein DMARC** (`_dmarc.lebenswerk.ai` existiert nicht),
* **keine DKIM-Selektoren** (`selector1`/`selector2._domainkey` existieren nicht).

Beides beim Umzug gleich mit einrichten — ohne DKIM/DMARC landen ausgehende
Mails häufiger im Spam.
Bestaetigt am 2026-09-01: lebenswerk.ai liegt in einem **anderen** Tenant als
lebensgeschichten.ai. Der Umzug der Postfaecher ist damit eine echte
Tenant-zu-Tenant-Migration — siehe den Abschnitt weiter unten.


## Wo man den E-Mail-Zielserver umstellt

Die Post laeuft in **zwei Etappen**, und der eigentliche Zielserver steht
nicht im DNS:

    Internet --MX--> Hornetsecurity (Filter) --Zustellung--> Microsoft 365
                ^                                  ^
          DNS-Zone bei Netlify              Hornetsecurity-Panel

1. **MX-Record** — wer die Post aus dem Internet annimmt. Steht in der
   **Netlify-DNS-Zone** (dieselbe Oberflaeche wie die Website-Eintraege).
2. **Zustellziel hinter dem Filter** — wohin Hornetsecurity nach dem Pruefen
   ausliefert. Steht **im Hornetsecurity Control Panel**, nicht im DNS. Wer nur
   den MX aendert und den Filter weiterlaufen laesst, aendert an der Zustellung
   nichts — und umgekehrt.

| Ziel | Wo umstellen |
|---|---|
| Postfaecher bleiben in M365, Filter raus | Netlify DNS: MX auf `lebenswerk-ai.mail.protection.outlook.com` (Prio 0), SPF kuerzen auf `v=spf1 include:spf.protection.outlook.com -all`; Hornetsecurity kuendigen |
| Filter bleibt, Postfaecher ziehen um | nur Hornetsecurity-Panel (Zustellziel); DNS unveraendert |
| Beides neu | MX in Netlify DNS direkt auf den neuen Anbieter, Hornetsecurity kuendigen |

Der Microsoft-365-Endpunkt **`lebenswerk-ai.mail.protection.outlook.com`**
existiert bereits (loest auf 52.101.170.0–2 und 52.101.168.0 auf) — die Domain
ist also in einem M365-Tenant angelegt und verifiziert (TXT `MS=ms82341597`).
**In welchem Tenant, ist beim Uebernehmen zu klaeren**: ohne Adminzugang dort
kommt man an die Postfaecher nicht heran, egal was im DNS steht.

Zum Vergleich unsere eigene Domain **lebensgeschichten.ai**: Nameserver bei
**Porkbun**, MX **direkt** auf `lebensgeschichten-ai.mail.protection.outlook.com`,
kein vorgelagerter Filter, SPF `v=spf1 include:spf.protection.outlook.com -all`,
TXT `MS=ms49713711`. Die aufgeraeumteste Endfassung waere, lebenswerk.ai in
denselben Tenant zu holen und genauso direkt zuzustellen.

Bei **jedem** dieser Wege gehoeren dazu: **DKIM einschalten** und einen
**DMARC-Eintrag** setzen. Beides fehlt bei lebenswerk.ai vollstaendig — bei
lebensgeschichten.ai ebenfalls.

Ein `mail.lebenswerk.ai` gibt es nicht; ausser `autodiscover` existieren keine
weiteren Mail-Unterdomaenen.

## Bestehende Postfaecher in unseren Tenant umziehen

Ausgangslage (Stand 2026-09-01): lebenswerk.ai haengt in einem **fremden**
Microsoft-365-Tenant. Im eigenen Tenant — dem von lebensgeschichten.ai — sollen
neue Postfaecher entstehen, und die bisherige Post soll mit.

### Was sich umsortieren laesst — und was nicht

Die naheliegende Reihenfolge ist: neue Infrastruktur bauen, Domain umziehen,
alten Tenant abbauen. Die **stimmt weitgehend** — mit genau einer Ausnahme.

**Umsortierbar (und so herum auch besser):**

* Die neue Infrastruktur entsteht **zuerst**, vollstaendig und getestet.
* Der alte Tenant wird **nicht** abgebaut. Postfach und Inhalte bleiben dort
  bestehen, nur eben unter `…onmicrosoft.com`.
* Die **Inhalte** duerfen auch **nach** dem Domainwechsel geholt werden. Es gibt
  dafuer keinen technischen Zwang — nur einen Risiko-Grund: Sobald die Lizenz im
  alten Tenant faellt, ist das Postfach nach kurzer Frist weg. Solange der
  Zugang gesichert ist, kann der Inhalt in Ruhe folgen. Eine **PST-Sicherung vor
  dem Umschalten** nimmt diesem Risiko trotzdem die Spitze und kostet eine
  halbe Stunde.

**Nicht umsortierbar:**

> Die Domain muss aus dem alten Tenant **freigegeben** sein, bevor sie im neuen
> verifiziert werden kann. Microsoft laesst dieselbe Domain nicht in zwei
> Tenants zu.

Freigeben heisst aber **nicht abbauen**, sondern nur: kein Objekt im alten
Tenant traegt mehr eine lebenswerk.ai-Adresse. Also **umbenennen statt
loeschen** — Postfach, Aliase, Verteiler und die Anmeldenamen (UPN) auf
`…onmicrosoft.com` umstellen. Danach laesst sich die Domain entfernen; das
Postfach existiert unveraendert weiter und bleibt zugaenglich.

### Wo das Zeitfenster wirklich liegt

Zwischen *Freigabe im alten Tenant* und *Verifizierung im neuen* gehoert die
Domain kurz **keinem** Tenant. In dieser Zeit weist Microsoft Post an
lebenswerk.ai ab.

Wichtig fuer die Einschaetzung: Das ist eine **Ablehnung mit Fehlermeldung an
den Absender**, kein stilles Verschlucken. Wer in diesem Fenster schreibt,
bekommt eine Unzustellbarkeitsnachricht und weiss Bescheid. Und im Postfach
liegende Post ist zu keinem Zeitpunkt in Gefahr.

Das Fenster laesst sich klein halten — Groessenordnung Minuten, nicht Stunden:

1. **TTL der MX- und TXT-Eintraege vorher senken** (in der Netlify-Zone, z. B.
   auf 300 Sekunden), einen Tag vor dem Umschalten.
2. Im neuen Tenant alles **vorbereiten**, was ohne die Domain geht: Postfach,
   Verteiler, Mitglieder, Berechtigungen.
3. Freigabe, Verifizierung, Adressvergabe und MX-Umstellung **in einem Zug**
   erledigen, nicht ueber Tage verteilt.
4. In eine **Randzeit** legen (Abend, Wochenende).
5. Ob Hornetsecurity waehrend des Fensters Post zwischenspeichern kann, vorher
   dort erfragen — Spooling greift ueblicherweise bei *Nichterreichbarkeit*,
   nicht bei einer Ablehnung. Nicht darauf verlassen.

### Adminrechte: wofuer sie noetig sind — und wofuer nicht

Zwei Dinge werden hier leicht verwechselt:

| | braucht Adminrechte im alten Tenant? |
|---|---|
| **Inhalt des Postfachs** holen | **Nein.** Eine PST reicht, und die zieht man mit der normalen Postfach-Anmeldung aus Outlook. |
| **Domain freigeben**, damit sie in unseren Tenant kann | **Ja.** Ohne Freigabe keine Verifizierung bei uns — und keine lebenswerk.ai-Adressen. |

Die Freigabe muss aber nicht *durch uns* geschehen: Es genuegt, dass **irgend
jemand** mit Adminrechten im alten Tenant die lebenswerk.ai-Adressen von
Postfach, Aliasen, Verteilern und Anmeldenamen loest und die Domain dann
entfernt. Uebernimmt das der bisherige Verwalter im Zuge der Uebergabe, reicht
uns die PST vollstaendig aus.

Passiert das nicht, bleibt der **Microsoft-Support**: Eine Domain laesst sich
aus einem fremden Tenant loesen, wenn man die Verfuegungsgewalt per DNS-Eintrag
nachweist. Das dauert laenger — und an die Postfachinhalte kommt man auf diesem
Weg nicht mehr heran. Genau deshalb wird die **PST gezogen, solange die
Anmeldung noch funktioniert**, und nicht erst, wenn es klemmt.

Ein zweiter Punkt, der ohne Adminrechte auffaellt: **Verteiler lassen sich nicht
auslesen.** Sie haben keinen Inhalt und brauchen keine PST, aber ihre Adressen
und Mitgliederlisten muessen bekannt sein, um sie im neuen Tenant nachzubauen.
Diese Liste also fruehzeitig zusammentragen — notfalls aus dem Gedaechtnis und
aus alten Nachrichten.

### Reihenfolge

0. **Inventar** im alten Tenant: Postfach, Aliase, Verteiler samt Mitgliedern,
   Weiterleitungen, serverseitige Regeln.
1. **PST-Sicherung** des Postfachs, solange der Zugang sicher ist.
2. **Neuen Tenant vollstaendig aufbauen** — Postfach und Verteiler unter
   vorlaeufigen Adressen (`…onmicrosoft.com`), Mitglieder und Berechtigungen
   gesetzt, durchgetestet.
3. **TTL senken**, einen Tag vorher.
4. **Umschaltfenster**, in einem Zug: alte Adressen im alten Tenant auf
   `…onmicrosoft.com` umbenennen → Domain dort entfernen → im neuen Tenant
   hinzufuegen und per TXT verifizieren → lebenswerk.ai-Adressen als primaere
   SMTP setzen → MX, SPF, `autodiscover` umstellen.
5. **DKIM und DMARC** einrichten (fehlen bisher komplett).
6. **Inhalte holen** — jetzt in Ruhe, aus dem weiterhin bestehenden alten
   Postfach.
7. **Nachlauf**: alte Adressen eine Weile als Alias mitfuehren, Hornetsecurity
   kuendigen oder umkonfigurieren, alten Tenant erst ganz zum Schluss abbauen.

### Wege, die Inhalte zu bewegen

Fuer diesen Fall ist die Wahl getroffen: **ein Postfach, also PST** — per
Outlook exportieren und im neuen Postfach wieder einlesen, oder beide Konten
kurz in einem Outlook-Profil und die Ordner hinueberziehen. Kein Werkzeug,
keine Adminrechte, kein Migrationsprojekt. Die **Verteiler** haben keinen
Inhalt und werden im neuen Tenant einfach neu angelegt.

Die uebrigen Wege stehen hier nur als Bemessungsgrundlage, falls spaeter
mehr Postfaecher dazukommen:

| Weg | Aufwand | Was mitkommt | Voraussetzung |
|---|---|---|---|
| **Outlook-Profil**: beide Konten in einem Profil, Ordner hinueberziehen | klein, gut bei 1–5 Postfaechern | Mail, Kalender, Kontakte — **keine** serverseitigen Regeln, keine Berechtigungen | je Postfach eine funktionierende Anmeldung |
| **PST-Export + Import-Dienst** (Purview Network Upload, kostenfrei) | mittel, laeuft unbeaufsichtigt, auch fuer grosse Postfaecher | wie oben | Admin im **Quell**-Tenant fuer den eDiscovery-Export |
| **IMAP-Migration** (Exchange Admin Center) | mittel | **nur E-Mail** — kein Kalender, keine Kontakte, keine Regeln | Zugangsdaten je Postfach |
| **Native Tenant-zu-Tenant-Migration** oder Werkzeug (MigrationWiz, CodeTwo, Quest) | gross bzw. kostenpflichtig (~10–15 € je Postfach) | alles, inkl. Kalender, Kontakte, Berechtigungen, Ordnerstruktur | Adminrechte in **beiden** Tenants |

Bei einer Handvoll Postfaecher sind die ersten beiden Wege das Richtige; die
native Tenant-zu-Tenant-Migration verlangt Anwendungsregistrierungen und eine
Vertrauensstellung auf beiden Seiten und lohnt erst bei vielen Postfaechern
oder wenn Berechtigungen und Regeln zwingend mit muessen.

### Zwei Bestaende, die leicht vergessen werden

* **Hornetsecurity** kann ein eigenes **Archiv und eine Quarantaene** halten.
  Wird dort archiviert, ist das ein *zweiter* Datenbestand, der vor der
  Kuendigung exportiert werden muss — er steckt nicht in den Postfaechern.
* **Geteilte Postfaecher und Verteiler** haben keine eigene Anmeldung und
  fallen bei der Postfach-fuer-Postfach-Methode durchs Raster. Sie brauchen
  Adminzugang im alten Tenant oder muessen neu aufgebaut werden.

## Checkliste Website-Umzug auf die Container App

1. Custom Domain auf der Container App anlegen (`lebenswerk-web`, RG
   `lebenswerk-rg`) und die **Domain-Verifizierungs-ID** abholen.
2. In der DNS-Zone eintragen:
   * `TXT  asuid.lebenswerk.ai` = Verifizierungs-ID
   * `TXT  asuid.www` = Verifizierungs-ID
   * `A    lebenswerk.ai` → statische Ingress-IP der Container App
     (die beiden Netlify-A-Records ersetzen)
   * `CNAME www` → `<app>.<region>.azurecontainerapps.io`
     (den bisherigen A-Record für `www` ersetzen)
3. Managed Certificate für beide Namen erzeugen lassen.
4. `noindex` aus `public-site/lebenswerk/index.html` und
   `public-site/_shared/kaufen.html` entfernen.
5. Prüfen: `/`, `/kaufen`, `/kontakt`, `/impressum`, `/datenschutz`, `/agb`,
   `/widerruf` — die vier letzten müssen auf `/app#…` weiterleiten.
6. Netlify-Site erst danach abschalten.

Der Shop (Ecwid-Filiale **126140019**) hängt nicht am Hosting und läuft
unverändert weiter; nur die Seite, die ihn einbettet, wechselt den Server.
