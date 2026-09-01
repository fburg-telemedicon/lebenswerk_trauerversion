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
| Postfaecher bleiben in M365, Filter raus | Netlify DNS: MX auf  (Prio 0), SPF kuerzen auf ; Hornetsecurity kuendigen |
| Filter bleibt, Postfaecher ziehen um | nur Hornetsecurity-Panel (Zustellziel); DNS unveraendert |
| Beides neu | MX in Netlify DNS direkt auf den neuen Anbieter, Hornetsecurity kuendigen |

Der Microsoft-365-Endpunkt ****
existiert bereits (loest auf 52.101.170.0–2 und 52.101.168.0 auf) — die Domain
ist also in einem M365-Tenant angelegt und verifiziert (TXT ).
**In welchem Tenant, ist beim Uebernehmen zu klaeren**: ohne Adminzugang dort
kommt man an die Postfaecher nicht heran, egal was im DNS steht.

Zum Vergleich unsere eigene Domain **lebensgeschichten.ai**: Nameserver bei
**Porkbun**, MX **direkt** auf ,
kein vorgelagerter Filter, SPF ,
TXT . Die aufgeraeumteste Endfassung waere, lebenswerk.ai in
denselben Tenant zu holen und genauso direkt zuzustellen.

Bei **jedem** dieser Wege gehoeren dazu: **DKIM einschalten** und einen
**DMARC-Eintrag** setzen. Beides fehlt bei lebenswerk.ai vollstaendig — bei
lebensgeschichten.ai ebenfalls.

Ein  gibt es nicht; ausser  existieren keine
weiteren Mail-Unterdomaenen.

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
