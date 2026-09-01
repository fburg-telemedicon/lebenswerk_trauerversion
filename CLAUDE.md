# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Production runs on Azure** (cutover 2026-07-13). Backend = **Azure Container Apps** (`lebenswerk-web`, Express `server.js` serves the `/api` handlers + the built SPA), DB = **Azure Database for PostgreSQL Flexible Server** (`lebenswerk-pg`, North Europe) via `api/_lib/store.js`, Storage = **Azure Blob** (`lebenswerkstore0713`, SAS-signed reads), Crons = **Container Apps Jobs** (`scripts/cron-run.js`), LLM/TTS/STT/Image = Azure OpenAI, Azure AI Speech, Azure FLUX. Domain `lebensgeschichten.ai` → Azure (managed certificate). RG `lebenswerk-rg`, Azure Sponsorship subscription. **Runbook: `infra/MIGRATION.md`.**
>
> Supabase and Vercel are **gone from production**. `vercel.json` and `supabase/*.sql` still exist as historical/rollback artifacts — see "Legacy artifacts" below. Do not treat them as live configuration.

## Commands

- `npm run build` — Vite production build to `dist/`.
- `node server.js` — Express server (API + static `dist/`), port `8080` (or `$PORT`). Needs the env vars below (above all `DATABASE_URL`, `AZURE_STORAGE_*`).
- `node scripts/cron-run.js <purge|report|transcript-check|generate>` — runs one cron job locally or in the container.
- `psql "$DATABASE_URL" -f db/schema.sql` — idempotent schema apply (see Database).
- Deploy: **push to `main`** — `.github/workflows/deploy.yml` builds the image in ACR (`lebenswerkacr0713`) via OIDC and updates the Container App *and* all cron jobs to the same image. Manual/first-time provisioning: `infra/provision.sh`, then `infra/deploy.sh` (that script also owns the env vars/secrets — the GitHub Action deliberately does not touch them).

**Working agreement on commits (standing, since the start of the project):** finished work is committed and pushed to `main` **immediately** — no feature branches, no waiting to be asked. `main` is the deploy branch, so every push goes live; that is intended. Do not ask for permission per change. Commit messages are German with transliterated umlauts (`Hoerbuch`, `Groessenschaetzung`).

There are **no tests, no linter, and no typechecker configured**. Do not invent commands like `npm test` — they will fail. `npm run dev` is still wired to `vercel dev` in `package.json` but is vestigial and not the way this project runs; use `node server.js`.

All user-facing text is German; keep new strings German unless asked otherwise.

## Required environment variables

Set on the Container App (via `infra/deploy.sh`) and in a local `.env` for `node server.js`:

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection to Azure Flexible Server, `…?sslmode=require`. Used by the pg pool in `api/_lib/store.js`. Optional: `PGSSL=disable` (local only), `PG_POOL_MAX` (default 8). |
| `AZURE_STORAGE_ACCOUNT` / `AZURE_STORAGE_KEY` | Blob storage account + key. `store.js` writes book/upload images to the **private** container `memorial-images` and signs read URLs via **SAS**. Public containers: `demo-books`, `memorial-videos`. |
| `AZURE_OPENAI_ENDPOINT` / `AZURE_OPENAI_KEY` / `AZURE_OPENAI_DEPLOYMENT` | **Required — sole interview + book/eulogy LLM (EU), no fallback.** Azure OpenAI `gpt-4.1`. The deployment lives on a **Microsoft Foundry** resource, so `api/_lib/llm.js` uses the **v1 API**: `POST {endpoint}/openai/v1/chat/completions?api-version=preview` with `model`=deployment in the body. Endpoint = `https://<resource>.services.ai.azure.com` (NOT the classic `…openai.azure.com`). `AZURE_OPENAI_API_VERSION` optional, **must be `preview`** (date versions like `2024-10-21` → "DeploymentNotFound"). The deployment name is also the pricing key in `cost.js`. |
| `AZURE_SPEECH_KEY` / `AZURE_SPEECH_REGION` | **Required — sole TTS + STT (EU), no fallback.** Azure AI Speech (Neural TTS in `speak.js`, Fast Transcription in `transcribe.js`); region e.g. `westeurope`. Optional: `AZURE_SPEECH_TTS_VOICE` (default `de-DE-KatjaNeural`), `AZURE_SPEECH_TTS_RATE` (default `+6%`), `AZURE_SPEECH_ENDPOINT`. |
| `AZURE_FLUX_ENDPOINT` / `AZURE_FLUX_KEY` | **Required for image generation** — FLUX.2 [pro] via Microsoft Foundry is the **only** image module. Foundry resource endpoint + key. Optional: `AZURE_FLUX_MODEL` (default `FLUX.2-pro`), `AZURE_FLUX_MODEL_PATH` (default `flux-2-pro`), `AZURE_FLUX_API_VERSION` (default `preview`). |
| `AZURE_FLUX_IMG2IMG` | **Optional feature flag — image-to-image (person likeness).** If truthy, `generate-image.js` attaches an uploaded reference photo (base64) so generated people resemble the real photo, placed in the chapter's era. On error it automatically retries text-to-image. `AZURE_FLUX_IMG2IMG_FIELD` (default `input_image`) names the request body field. Only reference photos whose upload consent covers AI processing are ever passed (gated client-side). |
| `AZURE_VOICELIVE_ENDPOINT` / `AZURE_VOICELIVE_KEY` | **Optional — live voice conversation (Azure AI Speech „Voice Live"), the 4th microphone mode.** Needs its **own resource in Sweden Central** — the only Voice Live region in the EU (`westeurope` is *not* supported). Unset ⇒ the relay is not attached and the mode never appears (contributors keep the existing mic modes). Optional: `AZURE_VOICELIVE_CHAT_MODEL` (default `gpt-4.1` — **must be a DataZone-EU or regional deployment, never `Global`**, otherwise Azure processes worldwide), `AZURE_VOICELIVE_API_VERSION` (default `2026-04-10`). |
| `DEMO_BOOK_URL` | Full blob URL of the demo book PDF; `server.js` redirects `/demobuch` there. |
| `VITE_PUBLIC_ASSET_BASE` | **Build time.** Blob storage base URL (`https://<acct>.blob.core.windows.net`), baked into the SPA by Vite (intro video). Passed as a Docker `--build-arg` by the deploy workflow. |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` / `ADMIN_TOKEN_SECRET` | Admin login. **No defaults** — if any is unset, every login is refused (503). `ADMIN_TOKEN_SECRET` is a long random string used to HMAC-sign session tokens. |
| `CRON_SECRET` | Authorises the cron endpoints; `scripts/cron-run.js` sends it. The endpoints refuse everything if unset. |
| `CRON_SELF_BASE_URL` | Base URL the cron/worker uses to call back into its own HTTP API. |
| `USD_TO_EUR` | EUR conversion factor for cost tracking (default `0.92`). |
| `RETENTION_DAYS` | Days after the **end of the usage period** before a memorial's input data is auto-deleted (default `90`). Usage period ends at `funeral_date`, else `created_at + LICENSE_MONTHS`. See `api/_lib/retention.js` — it is the single source, do not recompute the deadline anywhere else. |
| `LICENSE_MONTHS` | Contractual licence term in months (default `6`), used as the retention anchor when no `funeral_date` is set. Anamnesis categories ignore it (14 days from `created_at`, full deletion). |
| `JSON_LIMIT` | Body size limit for the Express JSON parser (default `50mb`; base64 audio/images). |
| `PDF_LIMIT` / `PDF_MAX_MB` | Only for `/api/admin/store-pdf`, which takes the **raw** PDF blob (not base64 JSON) so big print PDFs fit. Raw body limit (default `200mb`) and the handler's own check (default `200`). Keep the two in sync. |

## Architecture

### Frontend — SPA, no router

A `view` string state machine drives everything; there is no router. The UI is split across several files in `src/` (App.jsx alone is ~3700 lines — do not expect one file to hold it all):

- `src/App.jsx` — boot, admin state machine, generation orchestration (`GENERATORS`, `generate()`, `pollGeneration`), auth/token handling.
- `src/contributor.jsx` — `ContributorFlow`, the whole end-user/contributor experience (interview, voice, uploads, proof, end-user settings).
- `src/adminViews.jsx` — the admin views (list, create, detail, users, costs…) as ~17 exported components.
- `src/categories.js` — single source for everything category-specific (labels, contributor wording, **all KI prompt builders**).
- `src/api.js` — thin fetch client. Keeps a module-level `currentAudio` so `stopSpeaking()` always cancels previous TTS playback.
- `src/bookExport.js`, `src/coverExport.js`, `src/bookLayouts.js`, `src/lifeworkExtras.js`, `src/provisionFolder.js` — PDF/DOCX/e-book/cover rendering and the three lifework side products (family tree, life poster, **Vorsorgemappe**) via `jspdf` / `docx` in the browser. All three follow the same shape: an LLM prompt builder returning structured JSON (stored on the memorial row) plus a deterministic renderer that draws the PDF from it. The Vorsorgemappe is one PDF with separately signable parts, built from `src/legalForms.js` (shared form toolkit) and `src/powerOfAttorney.js` (part 1 + its prompt, stored in `power_of_attorney`): power of attorney incl. the *Betreuungsverfügung* as clause 7, a page that flags the missing *Patientenverfügung*, and a non-binding *Werteerklärung*. It is a German legal form — it leaves every name blank (§ 1816 Abs. 2 BGB binds the court to a guardian proposal), excludes treatment decisions (§ 1827 BGB requires concrete situations, which a life story cannot supply), and uses `selfOnly()` sources only. `src/careDirective.js` is **legacy**: the standalone *Betreuungsverfügung* is no longer generated, the file only still renders `care_directive` data created before 2026-08-07.
- `src/i18n.js`, `src/i18nLangs.js`, `src/adminI18n.jsx`, `src/proofI18n.js` — contributor-flow UI strings and language directives.

Two top-level flows are selected at boot:

- **ContributorFlow** — active when the URL has `?code=XXXXXXXXXX` (the memorial code). `genCode()` in `api/_lib/codes.js` produces **10 characters** from a 32-char confusion-free alphabet (`DEFAULT_LEN = 10`, 32^10 ≈ 10^15); the code columns are `varchar(16)`. **Older 6-character codes remain valid** — never assume a fixed length when parsing. Voice mode: `MediaRecorder` → base64 → `/api/transcribe` (Azure STT) → `askLLM()` → `/api/speak` (Azure TTS) → autoplay. Sessions persist to `localStorage` (`lw_session_<code>`, 60-day TTL) **and** to the database, so a contributor can resume via `?code=…&session=…` on another device.
- **Admin panel** — no URL flag; login via `/api/admin/login`, bearer token in `sessionStorage` as `lw_admin_token` (plus `lw_admin_auth` = `{ admin, cats }`). Views: `list` → `create-category` → `create` → `created`; `detail` → `contribution`, `book-v1`, `book-v2`, `eulogy`, `costs`; `users` (admin only).

### Product categories & customer groups (multi-tenant)

There are **eleven product categories**; `CATEGORY_ORDER` in `src/categories.js` is the authoritative list: `lifework`, `anamnesis`, `anamnesis_kvsw`, `memorial`, `birthday`, `anniversary`, `farewell`, `service`, `company`, `newborn`, `encouragement`. Each memorial row carries `product_category`. Slugs also exist backend-side in `api/_lib/categories.js`, which additionally exports the predicates `isEnduserCategory` / `isAnamnesisCategory`.

Two shapes of category:

- **Contributor categories** (`memorial`, `birthday`, …) — many people contribute via one shared `?code=` link.
- **End-user categories** (`lifework`, `anamnesis`, `anamnesis_kvsw`, see `isEnduserCategory`) — **one** person speaks about themselves. `isSelf` in `contributor.jsx` is derived from the category, and for `lifework` **the book code alone is the end user's only credential** (`api/memorial.js` allows PATCH of own name/gender/image style/layout with the code, no login). Keep that in mind before handing a code to anyone else.

**Languages.** Each memorial has `languages` (text[], default `{de}`). `src/i18n.js` holds contributor-flow UI strings, per-category contributor overlays, and `langDirective(lang)`, prepended to the interview prompt. With >1 language the contributor picks one first (`needLang` gate); for book/eulogy generation the admin is asked the target language. The admin UI itself stays German.

**Auth is multi-user.** `api/admin/login.js` accepts either the env superadmin (`ADMIN_USERNAME`) → claims `{ admin:true, cats:'*' }`, or a row in `app_users` (scrypt-hashed password) → claims `{ uid, admin:false, cats: user.allowed_categories }`. Allowed categories are set per user. `checkAuth` (`api/_lib/auth.js`) verifies the signed token and attaches `req.auth`; `canAccessCategory` gates creation. **`api/_lib/access.js` is the IDOR guard** — `loadAccessibleMemorial` / `loadAccessibleContribution` return 404 (never 403) for foreign books so codes cannot be enumerated; use them in every new admin endpoint that takes a code or id. Memorial creation goes **only** through the authenticated `POST /api/admin/memorials`. `api/memorial.js` is GET + a narrow end-user PATCH, not a create endpoint.

### Backend — Express on Container Apps

`server.js` walks the `api/` tree and registers **every file as a route** at `/api/<path>` (directories starting with `_` are skipped), handing `(req, res)` to the existing `module.exports = async (req,res) => …` handlers. It parses JSON centrally, redirects `/demobuch` to `DEMO_BOOK_URL`, then serves `dist/` statically with an SPA fallback to `index.html`.

Consequences worth remembering:

- **There are no per-function timeouts and no per-function memory settings any more.** The `functions` block in `vercel.json` is dead configuration. Long-running work must budget its own time (see the generation worker).
- Adding an endpoint = adding a file under `api/`. No route table to update.

Two namespaces:

- **Public** (`/api/ask`, `/api/contributions`, `/api/memorial`, `/api/speak`, `/api/transcribe`, `/api/upload`, `/api/feedback`, `/api/pdf`, …) — no auth, called from the contributor flow, rate-limited, and gated on a valid existing `code` so they cannot be abused as an anonymous AI proxy (`api/_lib/access.js`).
- **Admin** (`/api/admin/*`) — `checkAuth(req, res)` verifies an `Authorization: Bearer <token>` (HMAC-SHA256-signed payload with a 12 h expiry). The frontend treats 401 as an expired session and logs out.

### Websites — two domains, one container (`public-site/`)

The marketing sites live in `public-site/` and are served by `server.js` on `/`; the SPA stays on the **same origin** under `/app` (and on `/` with an app parameter such as `?code=`, `?zugang` — that rule must never be dropped, printed QR codes depend on it).

`server.js` picks the site by **Host** (`X-Forwarded-Host`, else `Host`): `lebenswerk.ai`/`www.lebenswerk.ai` → `public-site/lebenswerk/index.html`, everything else → `public-site/index.html`. The switch is inert until the domain points here; `/lebenswerk` previews it on any host.

Anything that may exist only **once** is shared, not copied: Impressum/Datenschutz from `src/LegalPages.jsx`, AGB/Widerruf from `AGB.md` (both served by the SPA at `/app#impressum|#datenschutz|#agb|#widerruf`, and the old lebenswerk.ai paths `/impressum` … 302 there), the shop (**one** Ecwid store `126140019` in `public-site/_shared/kaufen.html`, route `/kaufen` on both domains), `kontakt.html`, and `_shared/site.css`. Link legal pages as `/app#…` — a bare `/#…` now hits the marketing page.

Details: `public-site/README.md`. Domain/DNS/mail inventory and the cutover checklist: `infra/DOMAIN-LEBENSWERK-AI.md`. The old Netlify build is archived in `website-archiv/` (not shipped in the image).

### Live voice conversation (Voice Live) — the only WebSocket route

`server.js` creates an `http.Server` and attaches a **WebSocket relay** at `/api/voicelive-relay` (`api/_lib/voicelive-relay.js`) — the one endpoint that is *not* a file under `api/`, because it is an upgrade handler, not an HTTP handler. It is only attached when `AZURE_VOICELIVE_*` and `ADMIN_TOKEN_SECRET` are set.

Never let the browser talk to Azure Voice Live directly: a browser WebSocket cannot send an `Authorization` header (Microsoft's samples put the resource key in the query string), and the browser-recommended **WebRTC path routes globally** — both break the EU-only requirement. The relay keeps the key server-side, pins the session to Sweden Central, builds the whole `session.update` itself (the client may only supply the interview prompt, exactly like `system` on `/api/ask`) and filters client→upstream messages against an allowlist. Flow: `POST /api/voicelive-token` (checks code, `realtime_enabled`, budget, language) → signed short-lived ticket → `wss://…/api/voicelive-relay?ticket=…`. Usage from each `response.done` is billed via `costRealtime` (`kind='realtime'`).

The mode is **opt-in twice**: `memorials.realtime_enabled` (manager, default off) *and* the contributor picking it in the ☰ microphone-mode chooser. Any failure falls back silently to the existing mic modes — `src/voicelive.js` calls `onFallback` and `contributor.jsx` keeps going. It produces the same `contributions.messages` structure, so nothing downstream changes.

### Crons

Four **Container Apps Jobs**, all running the same image, each `node scripts/cron-run.js <sub>` (created in `infra/deploy.sh`):

| Job | Schedule | Sub |
|---|---|---|
| `lebenswerk-web-cron-purge` | `0 3 * * *` | `purge` — retention deletion |
| `lebenswerk-web-cron-transcript` | `0 22 * * *` | `transcript-check` |
| `lebenswerk-web-cron-report` | `0 23 * * *` | `report` — daily email report |
| `lebenswerk-web-cron-generate` | `*/10 * * * *` | `generate` — backstop for the generation worker |

The `crons` block in `vercel.json` is dead configuration.

### Generation runs server-side

Book, image and eulogy generation is **not** a browser loop any more. The browser enqueues a job (`enqueueGeneration` → `api/admin/generate-job.js`) and polls it (`pollGeneration`); the worker `api/cron/generate.js` executes it in phases (chapters → images → save) with a time budget and self-continuation, backed by `api/_lib/genjobs.js`. Single-shot prompts are still **built in the browser** from `src/categories.js` and passed as `steps:[{system,user,label}]`, so most prompt builders never had to be ported; `api/_lib/genprompts.js` holds the ones the worker needs itself (book_v2 chapters, image assignment, face refs, `tryParseJSON`). Closing the tab no longer kills a generation.

**Hörbuch** (`resultType:'audiobook'`) follows the same split, but with **no LLM at all**: `src/audiobook.js` turns the stored book JSON into read-aloud blocks (`[{kind,track,speaker,text}]`) — the browser owns them because i18n and the contributor list live there — and the worker speaks them via `api/_lib/tts.js` (the shared Azure TTS layer that `api/speak.js` also uses). One MP3 per chapter under `<CODE>/audio/<variant>-NN.mp3`, stored in `memorials.audiobooks` (jsonb, per book variant) and signed like images. Two facts the design rests on, both measured: MAI voices ignore `<break>` (paragraph pauses must be `<p>`), and Azure MP3s are bare MPEG frames without ID3, so chunks and chapters can simply be concatenated — which is why the single-file download is assembled in the browser instead of stored a second time. Voice choice is female / male / mixed (chapters alternate, guest voice boxes take the other voice; in book V1 the chapter follows the contributor's gender). Optionally the chapters are also concatenated **server-side** into one file at `<CODE>/audio/full-<variant>.mp3` (`api/_lib/audiobook.js`, used by the worker via `params.storeFull` and by `api/admin/store-audiobook.js` so a link can be added later without paying for TTS again); it is shared through `GET /api/audio?code=…&v=…&s=<slug>` — the audio counterpart of `api/pdf.js`, but a **302 to a fresh SAS URL** rather than a proxied stream, because a ~90 MB file must not be buffered per request and players need Azure's range support for seeking.

The LLM is required to return raw JSON; `tryParseJSON` strips stray markdown fences and isolates the outermost `{…}`. Books are stored as jsonb on the memorial row via `PATCH /api/admin/memorials?code=…` with `field` ∈ `{book_v1, book_v2, eulogy_text}` (allowlist enforced server-side). Eulogy/final-text style presets live per category in `src/categories.js` (`finalText.styles`), not in App.jsx.

### Data layer — `api/_lib/store.js`

`store.js` is an **in-house replacement for `@supabase/supabase-js`**. It exposes the same call surface the codebase already used — `supabase.from('t').select/insert/update/delete/upsert`, `supabase.rpc`, `supabase.storage.from('container').upload/download/remove/list/createSignedUrls` — and returns supabase-shaped `{ data, error, count }`, but talks to **Postgres (pg pool)** and **Azure Blob** underneath. `createClient(url, key)` **ignores both arguments**; the connection comes from `DATABASE_URL`.

That is why handlers still read like Supabase code and still say `createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)` — those env vars are unused leftovers, not a live dependency. When touching a handler, feel free to drop them; do not conclude the project talks to Supabase. `store.js` also carries a **column-type registry** (`JSONB_COLS` etc.) that decides how JS values are encoded on write — **add new `jsonb` / `text[]` columns there**, or an empty array will be written as the wrong type. `pool` is exported for the few places the query builder cannot express (e.g. `create table if not exists`).

### Database

Azure Database for PostgreSQL Flexible Server (PG 16).

- **`db/schema.sql` is the canonical, idempotent schema** — it consolidates all the earlier incremental migrations and can be re-run safely. Additional `db/*.sql` files cover later increments.
- **No Row Level Security.** Azure Postgres is not exposed through a public PostgREST-style API; only the backend connects, with a dedicated DB user. The old "RLS as a firewall" layer was dropped deliberately, not forgotten — do not re-add RLS expecting it to matter.
- `gen_random_uuid()` comes from PG core; `pgcrypto` is deliberately avoided (would need the `azure.extensions` allowlist).

Main tables: `memorials`, `contributions`, `app_users`, `cost_events`, `generation_jobs`, plus catalogs/feedback/reports tables. `memorials` carries the per-book configuration (`product_category`, `owner_user`, `intake`, `languages`, `book_v1`/`book_v2` jsonb, `eulogy_text`, `uploaded_images`, `family_tree`, `life_poster`, `care_directive`, `image_style`, `book_layout`, `text_style`, `companion_mode`, `proof_enabled`/`proof_max`/`proof_used`, `interview_closed`, `book_finalized`, …). `SELECT_COLS` in `api/admin/memorials.js` is a practical inventory of the current column set.

**Adding a memorial column** follows a well-worn pattern, copy it: column in `db/schema.sql` → `SELECT_COLS` + insert/update mapping in `api/admin/memorials.js` (including its defensive "column does not exist" fallback) → draft field in `App.jsx` → control in `adminViews.jsx`. `companion_mode` and `proof_enabled` are the cleanest examples.

### Storage

Azure Blob, account `lebenswerkstore0713`. Container `memorial-images` is **private**; book images live at `<MEMORIAL_CODE>/<uuid>.png`, contributor uploads flat alongside as `<CODE>/up-<uuid>.jpg` (+ `_thumb.jpg`) so folder-wide Art. 17 deletion catches everything. Read URLs are minted as **SAS links** (1 h) by `signMemorialImages` and attached as `image_url` per chapter; `image_path` is the canonical reference stored in the book JSON, `image_url` is regenerated on every load. `demo-books` and `memorial-videos` are public containers.

The codebase still calls these "buckets" in places (`IMAGE_BUCKET = 'memorial-images'`) — that is naming inherited from the Supabase era, not a second storage system.

### Cost tracking

`api/_lib/cost.js` is the single source of truth for pricing and is required by every paid endpoint (`ask`, `speak`, `transcribe`, `admin/generate-image`). The pattern is always:

1. Call the provider.
2. Compute USD cost via `costLLM` / `costTTS` / `costSTT` / `costImage`.
3. `await recordCost({ memorial_id, kind, provider, model, cost_usd, ...usage })` — inserts a row into `cost_events`; EUR is computed at insert time via `USD_TO_EUR`.

Pricing constants are keyed by exact model string (`gpt-4.1`, `flux-2-pro-1536x1024`). When adding a model, add its pricing **first** or costs silently record as 0. `api/admin/memorials.js` aggregates `cost_events` per memorial on every GET (`cost_total_eur`); `api/admin/costs.js` returns the full breakdown for one memorial.

### Model defaults

- Interview & generation: **Azure OpenAI `gpt-4.1`** (EU) via `api/_lib/llm.js`. Sole LLM, no fallback.
- TTS: **Azure AI Speech** Neural (`api/speak.js`), default `de-DE-KatjaNeural`. Sole TTS, no fallback.
- STT: **Azure AI Speech** Fast Transcription (`api/transcribe.js`). Sole STT, no fallback.
- Image: **FLUX.2 [pro]** via Microsoft Foundry (`api/admin/generate-image.js`), 1536×1024 PNG. Sole image module, no fallback — a 502 if Azure FLUX is down.
- **User-uploaded photos in books**: uploads are assigned to chapters (deterministically by `contribution_id` for v1, via an LLM assignment call for the rest). A chapter with assigned uploads gets **one composed landscape spread** from `api/admin/compose-image.js` (sharp: 1..4 photos into fold/bleed-safe templates, captions baked in) instead of a FLUX image. Composed spreads are stored exactly like generated images, so signing/DOCX/print-PDF/deletion are unchanged. Raw uploads are purged with contributions at retention; composed spreads stay (they are part of the book).

When swapping models, update both the call site **and** `PRICING` in `api/_lib/cost.js`.

## Legacy artifacts — present in the repo, NOT live

| Artifact | Status |
|---|---|
| `vercel.json` | Kept from the migration as a rollback reference. Its `functions` (maxDuration) and `crons` blocks have **no effect**; the `/demobuch` rewrite still points at an old Supabase URL. Superseded by `server.js` + Container Apps Jobs + `DEMO_BOOK_URL`. |
| `supabase/*.sql` | The historical incremental migrations. Superseded by `db/schema.sql`. Useful as history; do not run against production. |
| `supabase/rls.sql` | RLS no longer applies (see Database). |
| `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` | Unused. Still passed to `createClient()` in most handlers, where both arguments are ignored. |
| `npm run dev` (`vercel dev`) | Vestigial. Use `node server.js`. |
| `@supabase/supabase-js` | Not a dependency — `api/_lib/store.js` replaces it. |
