# Lebenswerk – Gemeinsames Gedenkbuch

Eine Web-App, mit der Familie, Freunde und Wegbegleiter gemeinsam ein Gedenkbuch erstellen. Der KI-Biograph führt jeden Beitragenden durch ein einfühlsames Interview; am Ende entsteht entweder ein Buch mit einzelnen Beiträgen oder ein literarischer Text „in einem Guss".

---

## Technischer Stack

| Schicht    | Technologie                              |
|------------|------------------------------------------|
| Frontend   | React + Vite                             |
| Backend    | Vercel Serverless Functions (Node.js)    |
| Datenbank  | Supabase (PostgreSQL)                    |
| KI         | Azure OpenAI gpt-4.1 (Interviews + Synthese, EU) – Standard; Anthropic Claude Fallback |
| Stimme     | Azure AI Speech (Neural, EU) – Standard; OpenAI Fallback |
| Bilder     | FLUX.2 [pro] via Microsoft Azure (Foundry, EU) |

---

## Schritt 1 – Supabase einrichten

1. Kostenloses Konto anlegen: [supabase.com](https://supabase.com)
2. Neues Projekt erstellen (Region: **EU West** für DSGVO)
3. Im Dashboard → **SQL Editor** → **New query** den Inhalt von `supabase/schema.sql` einfügen und ausführen
4. Im Dashboard → **Project Settings** → **API** folgende Werte notieren:
   - **Project URL** → `SUPABASE_URL`
   - **service_role** Secret → `SUPABASE_SERVICE_KEY` ⚠️ nicht der `anon` key!

---

## Schritt 2 – API-Keys besorgen

Produktion läuft auf Microsoft Azure (EU). Die Keys stammen aus dem Azure-Portal
(Ressource → „Schlüssel und Endpunkt" bzw. Foundry-Deployment-Detailseite):

| Key                  | Wo / Zweck                                            |
|----------------------|-------------------------------------------------------|
| `AZURE_OPENAI_ENDPOINT` / `AZURE_OPENAI_KEY` / `AZURE_OPENAI_DEPLOYMENT` | Azure OpenAI (LLM, EU). Endpoint = `https://<resource>.services.ai.azure.com`, Deployment z. B. `gpt-4.1`. Dazu `LLM_PROVIDER=azure` und `AZURE_OPENAI_API_VERSION=preview`. |
| `AZURE_SPEECH_KEY` / `AZURE_SPEECH_REGION` | Azure AI Speech (TTS/STT, EU). Dazu `SPEECH_PROVIDER=azure`. |
| `AZURE_FLUX_ENDPOINT` / `AZURE_FLUX_KEY` | Azure Foundry FLUX.2 [pro] (Bilder, EU). |
| `ANTHROPIC_API_KEY` *(optional)* | [console.anthropic.com](https://console.anthropic.com/settings/keys) – nur als USA-Fallback (`LLM_PROVIDER=anthropic`). |
| `OPENAI_API_KEY` *(optional)* | [platform.openai.com](https://platform.openai.com/api-keys) – nur als USA-Fallback für STT/TTS (`SPEECH_PROVIDER=openai`). |

---

## Schritt 3 – Auf Vercel deployen

### Option A – Direkt über GitHub (empfohlen)

1. Diesen Ordner in ein GitHub-Repository pushen
2. [vercel.com](https://vercel.com) → **New Project** → Repository auswählen
3. Framework: **Vite** (wird automatisch erkannt)
4. **Environment Variables** hinzufügen:
   ```
   ANTHROPIC_API_KEY   = sk-ant-...
   OPENAI_API_KEY      = sk-...
   SUPABASE_URL        = https://xxx.supabase.co
   SUPABASE_SERVICE_KEY = eyJ...
   ```
5. **Deploy** klicken → fertig ✅

### Option B – Vercel CLI

```bash
# Vercel CLI installieren (einmalig)
npm install -g vercel

# Im Projektordner
npm install
vercel

# Umgebungsvariablen setzen
vercel env add ANTHROPIC_API_KEY
vercel env add OPENAI_API_KEY
vercel env add SUPABASE_URL
vercel env add SUPABASE_SERVICE_KEY

# Neu deployen
vercel --prod
```

---

## Lokale Entwicklung

```bash
# Abhängigkeiten installieren
npm install

# .env anlegen
cp .env.example .env
# .env mit echten Keys befüllen

# Entwicklungsserver starten (Frontend + API)
npm run dev
# → http://localhost:3000
```

> `npm run dev` startet `vercel dev`, das sowohl den Vite-Dev-Server als auch
> die Serverless Functions lokal emuliert.

---

## Eigene Domain einrichten

In Vercel → Project → **Domains** → Domain hinzufügen.
DNS beim Anbieter auf Vercels Nameserver zeigen lassen.

---

## DSGVO-Hinweise

- Supabase-Projekt auf **EU West** (Frankfurt) hosten
- KI-Verarbeitung läuft in Produktion **vollständig in der EU**: LLM (Azure OpenAI gpt-4.1), Sprache (Azure AI Speech) und Bild (FLUX via Azure) – kein Drittland-Transfer → AVV nach Art. 28 mit allen Anbietern abschließen. (Die Anthropic-/OpenAI-USA-Pfade sind nur inaktive Fallbacks.)
- Datenschutzerklärung und Impressum ergänzen, bevor die App öffentlich zugänglich ist
- Keine Nutzerkonten / Authentifizierung implementiert – jeder mit dem Code kann beitragen

---

## Projektstruktur

```
lebenswerk/
├── api/                    ← Vercel Serverless Functions (Backend)
│   ├── ask.js              ← LLM-Proxy (Azure OpenAI | Anthropic)
│   ├── speak.js            ← TTS-Proxy (Azure AI Speech | OpenAI)
│   ├── memorial.js         ← Gedenkbuch anlegen / abrufen
│   └── contributions.js   ← Beiträge speichern / abrufen
├── src/                    ← React Frontend
│   ├── main.jsx
│   ├── App.jsx             ← gesamte UI
│   └── api.js              ← API-Client-Funktionen
├── supabase/
│   └── schema.sql          ← Datenbank-Schema
├── index.html
├── vite.config.js
├── vercel.json
├── package.json
└── .env.example
```
