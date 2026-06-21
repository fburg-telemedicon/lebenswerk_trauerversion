# Lebenswerk – Gemeinsames Gedenkbuch

Eine Web-App, mit der Familie, Freunde und Wegbegleiter gemeinsam ein Gedenkbuch erstellen. Der KI-Biograph führt jeden Beitragenden durch ein einfühlsames Interview; am Ende entsteht entweder ein Buch mit einzelnen Beiträgen oder ein literarischer Text „in einem Guss".

---

## Technischer Stack

| Schicht    | Technologie                              |
|------------|------------------------------------------|
| Frontend   | React + Vite                             |
| Backend    | Vercel Serverless Functions (Node.js)    |
| Datenbank  | Supabase (PostgreSQL)                    |
| KI         | Anthropic Claude (Interviews + Synthese) |
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

| Key                  | Wo                                                    |
|----------------------|-------------------------------------------------------|
| `ANTHROPIC_API_KEY`  | [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys) |
| `OPENAI_API_KEY`     | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |

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
- Anthropic (Claude/LLM) verarbeitet Daten auf US-Servern; Sprache (Azure AI Speech) und Bild (FLUX via Azure) laufen in der EU → AVV mit allen Anbietern abschließen
- Datenschutzerklärung und Impressum ergänzen, bevor die App öffentlich zugänglich ist
- Keine Nutzerkonten / Authentifizierung implementiert – jeder mit dem Code kann beitragen

---

## Projektstruktur

```
lebenswerk/
├── api/                    ← Vercel Serverless Functions (Backend)
│   ├── ask.js              ← Claude-Proxy
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
