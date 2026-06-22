# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — starts `vercel dev`, which runs both the Vite dev server and the `/api/*` serverless functions locally (default http://localhost:3000). Requires env vars to be present (see below). `vite` alone will not start the API.
- `npm run build` — Vite production build to `dist/`.
- `npm run preview` — preview the built bundle (static only, no API).
- Deploy: production runs on Vercel and is wired to the `main` branch (production URL: lebensgeschichten.vercel.app). `vercel --prod` from the project root deploys manually.

There are **no tests, no linter, and no typechecker configured**. Do not invent commands like `npm test` — they will fail.

All user-facing text is German; keep new strings German unless asked otherwise.

## Required environment variables

Set in Vercel (production) and in a local `.env` for `vercel dev`:

| Var | Purpose |
|---|---|
| `AZURE_OPENAI_ENDPOINT` / `AZURE_OPENAI_KEY` / `AZURE_OPENAI_DEPLOYMENT` | **Required — sole interview + book/eulogy LLM (EU), no fallback.** Azure OpenAI gpt-4.1. The deployment lives on a **Microsoft Foundry** resource, so `callAzure` uses the **v1 API**: `POST {endpoint}/openai/v1/chat/completions?api-version=preview` with `model`=deployment in the body. Endpoint = `https://<resource>.services.ai.azure.com` (NOT the classic `…openai.azure.com`). `AZURE_OPENAI_API_VERSION` optional, **must be `preview`** (date versions like `2024-10-21` → "DeploymentNotFound"). Deployment name (e.g. `gpt-4.1`) is also the pricing key in `cost.js`. If unset/unreachable, `/api/ask` errors — the Anthropic/Claude fallback was removed 2026-06-22. |
| `AZURE_SPEECH_KEY` / `AZURE_SPEECH_REGION` | **Required — sole TTS + STT (EU), no fallback.** Azure AI Speech (Neural TTS in `speak.js`, Fast Transcription in `transcribe.js`); region e.g. `westeurope`. Optional: `AZURE_SPEECH_TTS_VOICE` (default `de-DE-KatjaNeural`), `AZURE_SPEECH_TTS_RATE` (default `+6%`), `AZURE_SPEECH_ENDPOINT`. If unset/unreachable, `/api/speak` and `/api/transcribe` error — the OpenAI `tts-1-hd`/`whisper-1` fallback was removed 2026-06-22. |
| `SUPABASE_URL` | Project URL |
| `SUPABASE_SERVICE_KEY` | **service_role** key — never the anon key. The whole backend uses service_role (which bypasses RLS). |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` / `ADMIN_TOKEN_SECRET` | Admin login. **No defaults** — if any is unset, every login is refused (503). `ADMIN_TOKEN_SECRET` is a long random string used to HMAC-sign session tokens. (The old static `ADMIN_TOKEN` is no longer used.) |
| `USD_TO_EUR` | EUR conversion factor for cost tracking (default `0.92`) |
| `CRON_SECRET` | Secret for the daily retention purge cron (`/api/cron/purge`). Vercel auto-sends it as `Authorization: Bearer <CRON_SECRET>` on cron calls; the endpoint refuses everything if unset. |
| `RETENTION_DAYS` | Optional. Days after `funeral_date` (else `created_at`) before a memorial is auto-deleted (default `90`). |
| `AZURE_FLUX_ENDPOINT` / `AZURE_FLUX_KEY` | **Required for image generation** — FLUX.2 [pro] via Microsoft Foundry is the **only** image module (OpenAI/gpt-image-1 removed 2026-06-21). Foundry resource endpoint (`https://<resource>.services.ai.azure.com`) + key. Optional: `AZURE_FLUX_MODEL` (body `model`, default `FLUX.2-pro`), `AZURE_FLUX_MODEL_PATH` (endpoint path, default `flux-2-pro`), `AZURE_FLUX_API_VERSION` (default `preview`). |

## Architecture

### Frontend — single-file SPA

`src/App.jsx` is ~1900 lines and contains the **entire** UI as one component driven by a `view` string state machine. There is no router. Two top-level flows are selected at boot:

- **ContributorFlow** — active when the URL has `?code=XXXXXX` (the 6-char memorial code from `genCode()` in `api/_lib/codes.js`). The contributor goes through an info form → voice or text interview → done screen. Voice mode uses `MediaRecorder` → base64 → `/api/transcribe` (Azure STT) → `askLLM()` → `/api/speak` (Azure TTS) → autoplay. Interview sessions persist **both** to `localStorage` (`lw_session_<code>`, 60-day TTL) **and** to Supabase, so a contributor can resume via `?code=XXX&session=YYY` even on another device.
- **Admin panel** — no URL flag; the user logs in via `/api/admin/login`, the bearer token is stored in `sessionStorage` as `lw_admin_token` (plus `lw_admin_auth` = `{ admin, cats }`). Views: `list` → `create-category` → `create` → `created`; `detail` (one memorial) → `contribution`, `book-v1`, `book-v2`, `eulogy`, `costs`; `users` (admin-only user management). The detail view also embeds a cost-breakdown table fetched in parallel with contributions.

### Product categories & customer groups (multi-tenant)

There are **eight product categories** (slugs in `api/_lib/categories.js` and `src/categories.js`): `memorial` (Gedenkbuch — the original behaviour), `birthday`, `anniversary`, `farewell`, `service`, `company`, `newborn`, `encouragement`. Each memorial row carries `product_category`.

**Languages (de/pl/en).** Each memorial has `languages` (text[], offered to contributors; default `{de}`), chosen via checkboxes at creation. `src/i18n.js` holds the contributor-flow UI strings, per-category contributor text overlays (pl/en; German comes from `categories.js`), and `langDirective(lang)` — a prefix prepended to the interview prompt so the AI speaks the contributor's language. If a memorial offers >1 language the contributor picks one **first** (ContributorFlow `needLang` gate, `lang` state, `L` effective). For book/eulogy generation the admin is asked the target language when >1 is offered (`requestGenerate` → `genLangModal` → `generate(..., {lang})`, which prepends `langDirective`). The admin UI itself stays German.

`src/categories.js` is the single source for everything category-specific in the **frontend**: form labels (`intake`), contributor-flow wording (`contributor`), and the **KI prompt builders** (`interviewSystem`, `generators.book_v1/_v2.{outlineSystem,chapterSystem}`, `finalText.{styles,sections,sectionSystem}`). The `memorial` entry reproduces the original prompts verbatim; the other five share generic builders parameterised by a `PROFILES` object. `GENERATORS` in `App.jsx` and `getCategory(...).interviewSystem` read from here — there are no longer any standalone prompt functions in `App.jsx`.

Auth is now **multi-user**. Login (`api/admin/login.js`) accepts either the env superadmin (`ADMIN_USERNAME`) → token claims `{ admin:true, cats:'*' }`, or a row in `app_users` (scrypt-hashed password) → claims `{ uid, admin:false, cats: user.allowed_categories }`. **Allowed categories are set per user** (no customer-group layer); the admin picks them when creating/editing the user in the `users` view. `checkAuth` (in `api/_lib/auth.js`) verifies the signed token and attaches `req.auth`; `canAccessCategory(req.auth, cat)` gates creation. `api/admin/users.js` (admin-only) is the user CRUD. Non-admins only see memorials where `owner_user` = their uid AND `product_category` ∈ their cats (filtered in `api/admin/memorials.js` GET). Memorial creation goes **only** through the **authenticated** `POST /api/admin/memorials`, so `owner_user`/`product_category` are set server-side from the token. `api/memorial.js` is now **GET-only** (read one memorial by code for the contributor flow); there is no public create endpoint.

`src/api.js` is the thin fetch client used by App.jsx. The OpenAI TTS player keeps a module-level `currentAudio` so `stopSpeaking()` always cancels the previous playback.

DOCX export uses the `docx` npm package directly in the browser (`downloadStructuredDocx` / `downloadAsDocx` in `App.jsx`), including embedding chapter images fetched from Supabase signed URLs.

### Backend — Vercel serverless functions

Two namespaces under `/api/`:

- **Public** (`/api/ask`, `/api/contributions`, `/api/memorial`, `/api/speak`, `/api/transcribe`) — no auth, called from the contributor flow.
- **Admin** (`/api/admin/*`) — auth logic lives centrally in `api/_lib/auth.js`. Every handler calls `checkAuth(req, res)`, which verifies a `Authorization: Bearer <token>` whose token is an HMAC-SHA256-signed payload with an embedded expiry (12 h TTL). The login endpoint (`api/admin/login.js`) compares username/password with a constant-time hash compare (`verifyCredentials`) and, on success, returns a freshly signed token (`issueToken`). If `ADMIN_USERNAME`/`ADMIN_PASSWORD`/`ADMIN_TOKEN_SECRET` are not all set, every request is refused (503) — there are no fallback defaults. The frontend treats a 401 as an expired session and logs out.

Function timeouts are overridden in `vercel.json`: `ask` and `admin/generate-image` get 60 s, `transcribe` gets 30 s. The book-generation flow can sequentially call `admin/generate-image` once per chapter from the browser, so each call must stay inside its own 60 s budget.

`vercel.json` also rewrites everything except `/api/*` to `index.html` for the SPA.

### Cost tracking

`api/_lib/cost.js` is the single source of truth for pricing and is required by every paid endpoint (`ask`, `speak`, `transcribe`, `admin/generate-image`). The pattern is always:

1. Call the provider.
2. Compute USD cost via `costLLM` / `costTTS` / `costSTT` / `costImage`.
3. `await recordCost({ memorial_id, kind, provider, model, cost_usd, ...usage })` — this inserts a row into the `cost_events` Supabase table. EUR is computed at insert time via `USD_TO_EUR`.

Pricing constants are keyed by exact model string. For `gpt-image-1` the key is composite: `${model}-${quality}-${size}` (e.g. `gpt-image-1-high-1536x1024`). When adding a new model, add its pricing here first or its costs will silently record as 0.

`api/admin/memorials.js` aggregates `cost_events` per memorial on every GET so the admin list shows `cost_total_eur` without a separate call. `api/admin/costs.js` returns full breakdown (events + byKind aggregation) for one memorial.

### Database

Supabase Postgres. **`supabase/schema.sql` is incomplete** — it only defines the original `memorials` and `contributions` tables. The live schema also has, added later without migration files:

- `memorials.gender`, `memorials.book_variant`, `memorials.book_v1` (jsonb), `memorials.book_v2` (jsonb), `memorials.eulogy_text`, `memorials.funeral_date`, `memorials.cutoff_days`
- `memorials.product_category` (text, default `'memorial'`), `memorials.owner_user` (uuid → `app_users`), `memorials.intake` (jsonb, category-specific optional fields) — added by `supabase/users.sql`
- `app_users` (`id`, `username`, `pw_hash`, `pw_salt`, `allowed_categories` text[], `is_admin`, `created_at`) — defined in `supabase/users.sql` (no customer-group table; categories are per user)
- `contributions.contributor_gender`, `contributions.contributor_address`
- A `cost_events` table (columns inferred from `recordCost` inserts: `memorial_id`, `contribution_id`, `kind`, `provider`, `model`, `input_tokens`, `output_tokens`, `audio_seconds`, `characters`, `images`, `cost_usd`, `cost_eur`, `metadata`, `created_at`).

Treat the running Supabase project as the source of truth; do not assume `schema.sql` reflects production. **Run `supabase/users.sql` once in the Supabase SQL editor** to add the multi-tenant tables/columns before this build works in production.

**RLS is enabled** on `memorials`, `contributions`, `cost_events`, and `app_users` (see `supabase/rls.sql`) with **no policies** — so `anon`/`authenticated` get zero access via the public PostgREST API; only the backend's `service_role` (which bypasses RLS) can read/write. When adding a new table, enable RLS on it too (re-run / extend `supabase/rls.sql`) or it will be world-accessible through the public API.

Images generated for books live in the **private** Supabase Storage bucket `memorial-images` under `<MEMORIAL_CODE>/<uuid>.png`. The admin memorials endpoint mints 1-hour signed URLs (`signMemorialImages`) and attaches them as `image_url` on each chapter before returning to the frontend — `image_path` is the canonical reference stored in `book_v1` / `book_v2` JSON; `image_url` is regenerated on each load.

### Books and eulogy

Two book variants are generated by `App.jsx` (`bookV1System` / `bookV2System` build the prompt; `generate()` calls `askClaude` then loops over `chapters[]` calling `adminGenerateImage` for each). Claude is required to return raw JSON; `tryParseJSON` strips stray markdown fences and isolates the outermost `{…}` before parsing. Books are stored as jsonb on the memorial row via `PATCH /api/admin/memorials?code=…` with `field` ∈ `{book_v1, book_v2, eulogy_text}` (allowlist enforced server-side).

Eulogy has three style presets (`EULOGY_STYLES` in App.jsx) — the user picks one in a modal and the chosen `instruction` string is injected into the system prompt.

### Model defaults

- Interview & generation: **Azure OpenAI `gpt-4.1`** (EU) via `callAzure` in `api/ask.js` (v1 Foundry API). **Sole LLM — no fallback**; the Anthropic/Claude path was removed 2026-06-22. If Azure is down/unconfigured, `/api/ask` errors.
- TTS: **Azure AI Speech** Neural (`api/speak.js`), default voice `de-DE-KatjaNeural`. **Sole TTS — no fallback** (OpenAI `tts-1-hd` removed 2026-06-22).
- STT: **Azure AI Speech** Fast Transcription (`api/transcribe.js`). **Sole STT — no fallback** (OpenAI `whisper-1` removed 2026-06-22).
- Image: **FLUX.2 [pro]** via Microsoft Foundry (`api/admin/generate-image.js`), 1536×1024 PNG into the `memorial-images` bucket. **Sole image module** — the OpenAI/gpt-image-1 path was removed 2026-06-21. Pricing keyed `flux-2-pro-1536x1024` in `cost.js`. No fallback: if Azure FLUX is down or unconfigured, image generation returns a 502 error.

When swapping models, update both the API call site **and** `PRICING` in `api/_lib/cost.js`.
