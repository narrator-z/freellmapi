# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install              # Install all workspace dependencies
npm run dev              # Server (:3001) + client Vite dev (:5173) with HMR
npm run dev:lan          # Same as dev, but Vite binds to 0.0.0.0 (LAN-accessible)
npm run build            # Compile server (tsc) + client (tsc -b && vite build)
npm run build:server     # Compile server only
npm test                 # Run server tests (vitest --pool=forks --fileParallelism=false)
npm run lint -w client   # ESLint on the client workspace
```

### Running a single test

```bash
npx vitest run --pool=forks --fileParallelism=false -w server path/to/test.test.ts
```

### Environment

Copy `.env.example` to `.env`. `ENCRYPTION_KEY` (64-char hex) is **required** at startup — generate with:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

The server only falls back to a dev key when `DEV_MODE=true` AND `NODE_ENV` is not `production`.

### Production start (after build)

node server/dist/index.js

### Desktop app

npm run desktop:dev      # Build client, then Electron dev mode
npm run desktop:dist     # macOS .dmg
npm run desktop:dist:win # Windows installer

## Architecture

This is an **npm workspaces monorepo** with four packages:

| Package | Purpose |
|---------|---------|
| `shared/` | Shared TypeScript types (`Platform`, `Model`, `ChatMessage`, etc.) — just `types.ts`, no build step |
| `server/` | Express 5 API server — proxy, router, providers, dashboard auth, SQLite storage |
| `client/` | React 19 + Vite + Tailwind v4 + shadcn/ui dashboard SPA |
| `desktop/` | Electron app that embeds server + client as a menu-bar tray app |

### Server (`server/src/`)

The server is a single-process Express 5 app that serves both the `/v1` OpenAI-compatible proxy and the `/api/*` admin dashboard API, plus the built React SPA as static files.

**Request flow for `/v1/chat/completions`:**
1. Rate limiter middleware (per-IP, configurable via `PROXY_RATE_LIMIT_RPM`)
2. `routes/proxy.ts` — validates the unified API key (`freellmapi-…`), parses the OpenAI-format request
3. `services/router.ts` — picks the best available model from the fallback chain using multi-armed bandit scoring
4. The corresponding `providers/*.ts` adapter translates the request to the provider's API format
5. On failure (429, 5xx, timeout): the router puts the key on cooldown and retries the next model (up to 20 attempts)

**Key directories:**
- `providers/` — One adapter per platform. `base.ts` defines the `BaseProvider` abstract class; `openai-compat.ts` handles all OpenAI-compatible providers (Groq, Cerebras, Mistral, OpenRouter, GitHub, NVIDIA, Zhipu, HuggingFace, Ollama, Kilo, Pollinations, LLM7, OpenCode, OVH); `google.ts`, `cohere.ts`, `cloudflare.ts` handle non-OpenAI-wire formats
- `services/` — Core business logic: `router.ts` (model selection), `ratelimit.ts` (RPM/RPD/TPM/TPD tracking), `health.ts` (periodic key probing), `catalog-sync.ts` (pulls signed model catalog from freellmapi.co), `scoring.ts` (Thompson sampling bandit), `context-handoff.ts` (injects handoff message on model switch), `embeddings.ts` (family-based embedding routing), `quirks.ts` (per-model behavioral notes)
- `routes/` — Express route handlers for both the proxy (`proxy.ts`, `responses.ts`, `embeddings.ts`) and admin API (`keys.ts`, `models.ts`, `fallback.ts`, `analytics.ts`, `auth.ts`, `settings.ts`, `premium.ts`, `health.ts`)
- `middleware/` — `requireAuth.ts` (session-token auth for `/api/*`), `rateLimit.ts` (per-IP proxy rate limiter), `errorHandler.ts`
- `db/index.ts` — Drizzle ORM + better-sqlite3 schema, migrations, and seed data (model catalog rows)
- `lib/` — Utilities: `crypto.ts` (AES-256-GCM encrypt/decrypt for API keys), `proxy.ts` (SOCKS proxy support via undici), `content.ts` (multimodal content flattening), `tool-args.ts`, `tool-call-rescue.ts`, `password.ts` (scrypt hashing), `budget.ts`, `error-redaction.txt`

### Auth model

Two separate auth layers:
- **Dashboard (`/api/*`)**: Email + password account (scrypt-hashed), set on first run via `/api/auth/setup`. Subsequent requests use a session token (Bearer).
- **Proxy (`/v1/*`)**: Unified API key (`freellmapi-…`) that apps use — completely independent from dashboard auth.

### Provider pattern

All providers extend `BaseProvider` and implement three methods:
- `chatCompletion()` — non-streaming
- `streamChatCompletion()` — returns `AsyncGenerator<ChatCompletionChunk>`
- `validateKey()` — health-check probe

To add a new OpenAI-compatible provider, register it in `providers/index.ts` with a `baseUrl` and seed its models in `db/index.ts` migrations. Non-OpenAI-wire forms (like Google Gemini) need a full custom adapter.

### Database

SQLite via `better-sqlite3` + Drizzle ORM. Schema lives in `db/index.ts`. The DB stores: encrypted API keys, model catalog, fallback chain ordering, request analytics, settings, sessions. Data directory: `server/data/`.

### Client (`client/src/`)

React 19 SPA with react-router-dom v7, shadcn/ui, Tailwind v4, Recharts, TanStack Query. Pages: Playground, Keys, Fallback Chain, Models (chat + embeddings tabs), Analytics, Premium, Settings. Auth gate via `auth-gate.tsx` — redirects to login/setup if no session.