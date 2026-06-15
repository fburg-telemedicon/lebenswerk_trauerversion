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
| `ANTHROPIC_API_KEY` | Claude (interview + book/eulogy generation) |
| `OPENAI_API_KEY` | TTS (`tts-1-hd`), Whisper STT, `gpt-image-1` |
| `SUPABASE_URL` | Project URL |
| `SUPABASE_SERVICE_KEY` | **service_role** key — never the anon key. The whole backend uses service_role (which bypasses RLS). |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` / `ADMIN_TOKEN_SECRET` | Admin login. **No defaults** — if any is unset, every login is refused (503). `ADMIN_TOKEN_SECRET` is a long random string used to HMAC-sign session tokens. (The old static `ADMIN_TOKEN` is no longer used.) |
| `USD_TO_EUR` | EUR conversion factor for cost tracking (default `0.92`) |

## Architecture

### Frontend — single-file SPA

`src/App.jsx` is ~1900 lines and contains the **entire** UI as one component driven by a `view` string state machine. There is no router. Two top-level flows are selected at boot:

- **ContributorFlow** — active when the URL has `?code=XXXXXX` (the 6-char memorial code from `genCode()` in `api/memorial.js`). The contributor goes through an info form → voice or text interview → done screen. Voice mode uses `MediaRecorder` → base64 → `/api/transcribe` (Whisper) → `askClaude()` → `/api/speak` (TTS) → autoplay. Interview sessions persist **both** to `localStorage` (`lw_session_<code>`, 60-day TTL) **and** to Supabase, so a contributor can resume via `?code=XXX&session=YYY` even on another device.
- **Admin panel** — no URL flag; the user logs in via `/api/admin/login`, the bearer token is stored in `sessionStorage` as `lw_admin_token`. Views: `list` → `detail` (one memorial) → `contribution`, `book-v1`, `book-v2`, `eulogy`, `costs`. The detail view also embeds a cost-breakdown table fetched in parallel with contributions.

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
2. Compute USD cost via `costClaude` / `costTTS` / `costSTT` / `costImage`.
3. `await recordCost({ memorial_id, kind, provider, model, cost_usd, ...usage })` — this inserts a row into the `cost_events` Supabase table. EUR is computed at insert time via `USD_TO_EUR`.

Pricing constants are keyed by exact model string. For `gpt-image-1` the key is composite: `${model}-${quality}-${size}` (e.g. `gpt-image-1-high-1536x1024`). When adding a new model, add its pricing here first or its costs will silently record as 0.

`api/admin/memorials.js` aggregates `cost_events` per memorial on every GET so the admin list shows `cost_total_eur` without a separate call. `api/admin/costs.js` returns full breakdown (events + byKind aggregation) for one memorial.

### Database

Supabase Postgres. **`supabase/schema.sql` is incomplete** — it only defines the original `memorials` and `contributions` tables. The live schema also has, added later without migration files:

- `memorials.gender`, `memorials.book_variant`, `memorials.book_v1` (jsonb), `memorials.book_v2` (jsonb), `memorials.eulogy_text`, `memorials.funeral_date`, `memorials.cutoff_days`
- `contributions.contributor_gender`, `contributions.contributor_address`
- A `cost_events` table (columns inferred from `recordCost` inserts: `memorial_id`, `contribution_id`, `kind`, `provider`, `model`, `input_tokens`, `output_tokens`, `audio_seconds`, `characters`, `images`, `cost_usd`, `cost_eur`, `metadata`, `created_at`).

Treat the running Supabase project as the source of truth; do not assume `schema.sql` reflects production.

**RLS is enabled** on `memorials`, `contributions`, and `cost_events` (see `supabase/rls.sql`) with **no policies** — so `anon`/`authenticated` get zero access via the public PostgREST API; only the backend's `service_role` (which bypasses RLS) can read/write. When adding a new table, enable RLS on it too (re-run / extend `supabase/rls.sql`) or it will be world-accessible through the public API.

Images generated for books live in the **private** Supabase Storage bucket `memorial-images` under `<MEMORIAL_CODE>/<uuid>.png`. The admin memorials endpoint mints 1-hour signed URLs (`signMemorialImages`) and attaches them as `image_url` on each chapter before returning to the frontend — `image_path` is the canonical reference stored in `book_v1` / `book_v2` JSON; `image_url` is regenerated on each load.

### Books and eulogy

Two book variants are generated by `App.jsx` (`bookV1System` / `bookV2System` build the prompt; `generate()` calls `askClaude` then loops over `chapters[]` calling `adminGenerateImage` for each). Claude is required to return raw JSON; `tryParseJSON` strips stray markdown fences and isolates the outermost `{…}` before parsing. Books are stored as jsonb on the memorial row via `PATCH /api/admin/memorials?code=…` with `field` ∈ `{book_v1, book_v2, eulogy_text}` (allowlist enforced server-side).

Eulogy has three style presets (`EULOGY_STYLES` in App.jsx) — the user picks one in a modal and the chosen `instruction` string is injected into the system prompt.

### Model defaults

- Interview & generation: `claude-sonnet-4-5` (hardcoded in `api/ask.js`).
- TTS: `tts-1-hd`, voice `shimmer`.
- STT: `whisper-1`.
- Image: `gpt-image-1` at `quality: 'high'`, `size: '1536x1024'`.

When swapping models, update both the API call site **and** `PRICING` in `api/_lib/cost.js`.
