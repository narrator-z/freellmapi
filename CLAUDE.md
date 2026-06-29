# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

```bash
# Install all workspace dependencies
npm install

# Development servers
npm run dev              # Server (:3001) + client Vite dev (:5173) with HMR
npm run dev:lan          # Same as dev, but Vite binds to 0.0.0.0 (LAN-accessible)

# Production builds
npm run build            # Compile server (tsc) + client (tsc -b && vite build)
npm run build:server     # Compile server only

# Testing
npm test                 # Run server tests (vitest --pool=forks --fileParallelism=false)
npx vitest run --pool=forks --fileParallelism=false -w server path/to/test.test.ts  # Run specific test

# Desktop app
npm run desktop:dev      # Build client, then Electron dev mode
npm run desktop:dist     # macOS .dmg
npm run desktop:dist:win # Windows installer

# Docker
docker compose up -d     # Start with Docker Compose
HOST_BIND=0.0.0.0 docker compose up -d  # Expose on LAN (trusted networks only)
```

## Environment Setup

1. Copy `.env.example` to `.env`
2. Generate encryption key (required for startup):
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
3. Add to `.env`:
   ```
   ENCRYPTION_KEY=your-generated-key
   PORT=3001
   ```
4. Optional environment variables:
   - `DEV_MODE=true` - Enables development mode (falls back to database-stored dev key)
   - `FREELLMAPI_CONTEXT_HANDOFF=on_model_switch` - Enables context handoff on model switch
   - `PROXY_RATE_LIMIT_RPM=60` - Configures per-IP rate limit (requests per minute)
   - `REQUEST_ANALYTICS_RETENTION_DAYS=0` - Disable request analytics retention by days
   - `REQUEST_ANALYTICS_MAX_ROWS=0` - Disable request analytics retention by row count
   - `CATALOG_SYNC_DISABLED=1` - Disable automatic catalog synchronization

## Architecture Overview

This is an npm workspaces monorepo with four packages:

| Package | Purpose |
|---------|---------|
| `shared/` | Shared TypeScript types (`Platform`, `Model`, `ChatMessage`, etc.) - just `types.ts`, no build step |
| `server/` | Express 5 API server - proxy, router, providers, dashboard auth, SQLite storage |
| `client/` | React 19 + Vite + Tailwind v4 + shadcn/ui dashboard SPA |
| `desktop/` | Electron app that embeds server + client as a menu-bar tray app |

### Server (`server/src/`)

The server is a single-process Express 5 app serving:
- `/v1/*` - OpenAI-compatible proxy endpoints
- `/api/*` - Admin dashboard API
- Static files - Built React SPA

**Request Flow for `/v1/chat/completions`:**
1. Rate limiter middleware (per-IP, configurable via `PROXY_RATE_LIMIT_RPM`)
2. `routes/proxy.ts` - Validates unified API key (`freellmapi-…`), parses OpenAI-format request
3. `services/router.ts` - Selects best available model using multi-armed bandit scoring
4. Provider adapter (`providers/*.ts`) - Translates request to provider's API format
5. On failure (429, 5xx, timeout): Router puts key on cooldown and retries next model (up to 20 attempts)

**Key Directories:**
- `providers/` - Provider adapters (`base.ts` defines `BaseProvider`; `openai-compat.ts` handles OpenAI-compatible providers; `google.ts`, `cohere.ts`, `cloudflare.ts` handle non-OpenAI-wire formats)
- `services/` - Core logic: `router.ts` (model selection), `ratelimit.ts` (rate tracking), `health.ts` (key probing), `catalog-sync.ts` (model catalog sync), `scoring.ts` (Thompson sampling bandit), `context-handoff.ts` (handoff messages), `embeddings.ts` (family-based routing), `quirks.ts` (model-specific behaviors), plus newer services: `media.ts` (image/audio processing), `fusion.ts` (multi-model synthesis), `model-groups.ts` (model categorization), `model-listing.ts` (model discovery), `provider-quota.ts` (quota tracking), `anthropic-map.ts` (Anthropic API mapping)
- `routes/` - Express handlers for proxy (`proxy.ts`, `responses.ts`, `embeddings.ts`) and admin API (`keys.ts`, `models.ts`, `fallback.ts`, `analytics.ts`, `auth.ts`, `settings.ts`, `premium.ts`, `health.ts`), plus newer routes: `anthropic.ts` (Claude API), `media.ts` (media endpoints), `profiles.ts` (user profiles)
- `middleware/` - `requireAuth.ts` (session-token auth for `/api/*`), `rateLimit.ts` (per-IP proxy rate limiter), `errorHandler.ts`
- `db/index.ts` - Drizzle ORM + better-sqlite3 schema, migrations, and seed data
- `lib/` - Utilities: `crypto.ts` (AES-256-GCM encrypt/decrypt), `proxy.ts` (SOCKS proxy), `content.ts` (multimodal content), `tool-args.ts`, `tool-call-rescue.ts`, `password.ts` (scrypt), `budget.ts`, `error-redaction.ts`, plus newer utilities: `error-classify.ts` (error classification), `process-safety-net.ts` (process safety), `request-log.ts` (request logging)

### Authentication Model

Two independent auth layers:
- **Dashboard (`/api/*`)**: Email + password account (scrypt-hashed), initialized via `/api/auth/setup`. Subsequent requests use session token (Bearer).
- **Proxy (`/v1/*`)**: Unified API key (`freellmapi-…`) for client apps - completely separate from dashboard auth.

### Provider Pattern

All providers extend `BaseProvider` and implement:
- `chatCompletion()` - Non-streaming completion
- `streamChatCompletion()` - Returns `AsyncGenerator<ChatCompletionChunk>`
- `validateKey()` - Health-check probe

To add a new OpenAI-compatible provider:
1. Register in `providers/index.ts` with a `baseUrl`
2. Seed models in `db/index.ts` migrations
3. Add tests in `server/src/__tests__/providers/`

Non-OpenAI-wire formats (like Google Gemini) require a full custom adapter.

### Database

SQLite via `better-sqlite3` + Drizzle ORM. Schema in `db/index.ts`. Stores:
- Encrypted API keys
- Model catalog
- Fallback chain ordering
- Request analytics
- Settings
- Sessions
Data directory: `server/data/`

### Client (`client/src/`)

React 19 SPA with:
- react-router-dom v7
- shadcn/ui
- Tailwind v4
- Recharts
- TanStack Query

Pages: Playground, Keys, Fallback Chain, Models (chat + embeddings tabs), Analytics, Premium, Settings, Audio, Image, Embedding Detail, Media Detail, Model Detail, Fusion
Auth gate via `auth-gate.tsx` - redirects to login/setup if no session.

### Internationalization (i18n)

The dashboard supports 6 languages:
- English (en)
- Simplified Chinese (zh-CN)
- French (fr)
- Spanish (es)
- Portuguese (Brazil) (pt-BR)
- Italian (it)

Locale preference is persisted in `localStorage` and falls back to browser language. The i18n system uses a lightweight, dependency-free approach with JSON locale files.

### Key Features Added in Recent Updates

1. **Multilingual Support**: Full i18n with 6 languages
2. **Media Processing**: Image generation and audio/TTS endpoints
3. **Fusion Capability**: Multi-model synthesis for enhanced responses
4. **Anthropic API Support**: Full Claude API compatibility
5. **Enhanced Quota Tracking**: Per-provider quota monitoring and observability
6. **Improved Model Management**: Better model grouping, search, and filtering
7. **User Profiles**: Personalized settings and preferences
8. **Advanced Error Handling**: Improved error classification and resilience
9. **Enhanced Dashboard**: New pages for media, fusion, and detailed model views

## Development Workflow

1. Start development servers: `npm run dev`
2. Access dashboard at http://localhost:5173
3. Add provider API keys on the **Keys** page
4. Configure fallback chain order on the **Fallback Chain** page
5. Retrieve your unified API key from the **Keys** page header
6. Point your OpenAI SDK to `http://localhost:3001/v1` with key `freellmapi-your-unified-key`

## Testing Guidelines

- Server tests use Vitest with forked pools and no file parallelism
- Run all server tests: `npm test`
- Run specific test file: `npx vitest run --pool=forks --fileParallelism=false -w server path/to/test.test.ts`
- Watch mode for active development: `npm run test:watch`
- Client tests (if any) are run via workspace configuration

## Docker Deployment

The Docker image contains both Express server and built React dashboard:
- Pull: `docker pull ghcr.io/narrator-z/freellmapi:latest`
- Default binds to `127.0.0.1:3001` (localhost only)
- For LAN access (trusted networks only): `HOST_BIND=0.0.0.0 docker compose up -d`
- SQLite data persisted in `freellmapi-data` volume at `/app/server/data`
- Preserve `.env` and volume when upgrading to retain encrypted keys

## Desktop App

Build native menu-bar app:
- macOS: `npm run desktop:dist` → `desktop/dist-electron/FreeLLMAPI-…-arm64.dmg`
- Windows: `npm run desktop:dist:win` → Installer
- Development: `npm run desktop:dev`

## Important Notes

- `ENCRYPTION_KEY` is required for startup. Server only falls back to dev key when `DEV_MODE=true` AND `NODE_ENV` is not `production`
- Request analytics retained for 90 days or 100,000 rows (whichever comes first)
- Context handoff improves continuity during model switches but cannot recover provider-internal hidden state
- Free tier limitations apply: intelligence degrades as daily quotas are exhausted, resets at UTC midnight
- This is for personal experimentation and learning - swap to paid APIs before shipping production software
- Model catalog syncs from the freellmapi-augmented repository (merged v1 + yangmao.ai data), updated every 12 hours for all installs.