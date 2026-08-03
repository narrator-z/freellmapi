<div align="center">

# FreeLLMAPI

**4 billion tokens per month.  29 free LLM providers. 358 free model endpoints. One OpenAI-compatible endpoint.**

Aggregate free tiers from dozens of providers, plus custom OpenAI-compatible chat, embedding, image, and audio endpoints, behind a single `/v1` API. Keys are stored encrypted. A router picks the best available model for each request, falls over to the next provider when one is rate-limited, and tracks per-key usage so you stay under every free-tier cap.

[![CI](https://github.com/tashfeenahmed/freellmapi/actions/workflows/ci.yml/badge.svg)](https://github.com/tashfeenahmed/freellmapi/actions/workflows/ci.yml)
[![GitHub stars](https://img.shields.io/github/stars/tashfeenahmed/freellmapi?style=flat&logo=github&color=yellow)](https://github.com/tashfeenahmed/freellmapi/stargazers)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#contributing)
[![Docker image](https://img.shields.io/badge/ghcr.io-freellmapi-2496ED?logo=docker&logoColor=white)](https://github.com/tashfeenahmed/freellmapi/pkgs/container/freellmapi)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/tashfeenahmed/freellmapi)

**[freellmapi.co](https://freellmapi.co/?utm_source=github&utm_medium=readme&utm_campaign=repository&utm_content=readme_top)** · browse the full catalog: 251 model families, 358 free endpoints

**English** · [简体中文](docs/i18n/zh-CN/README.md)

![FreeLLMAPI dashboard — Models page with the monthly token budget](repo-assets/github-hero.png)


Your router updates its own model catalog from the augmented catalog maintained and hosted by narratorz — new free models, quota changes, and compatibility fixes sync automatically every 12 hours, no `git pull` required.

</div>

---

## Contents

- [Why this exists](#why-this-exists)
- [Supported providers](#supported-providers)
- [Compatible CLIs & coding agents](#compatible-clis--coding-agents)
- [How it compares](#how-it-compares)
- [Features](#features)
- [Quick start](#quick-start)
- [Desktop app](#desktop-app)
- [Works with OpenAI-compatible clients](#works-with-openai-compatible-clients)
- [Languages](#languages)

- [Using the API](#using-the-api)
- [Screenshots](#screenshots)
- [How it works](#how-it-works)
- [Limitations](#limitations)
- [Contributing](#contributing)
- [Disclaimer](#disclaimer)

**Guides:** [Install & deploy](docs/install.md) · [API reference](docs/api.md) · [Clients & coding agents](docs/clients.md) · [Prompt compression](docs/compression.md) · [Architecture & internals](docs/architecture.md) · [Documentation index](docs/README.md) · [Contributor guide](CONTRIBUTING.md)

## Why this exists

Every serious AI lab now offers a free tier, a few million tokens a month, a few thousand requests a day. On its own each tier is a toy. Stacked together, they add up to roughly **4 billion tokens per month** of working inference capacity, across **251 model families / 358 provider endpoints** from small-and-fast to reasonably capable.

The problem is that stacking them by hand is painful: twenty-nine different SDKs, twenty-nine different rate limits, twenty-nine places a request can fail. FreeLLMAPI collapses that into one OpenAI-compatible endpoint. Point any OpenAI client library at your local server, and it routes transparently across whichever providers you've added keys for.

And the free-tier landscape shifts weekly: providers launch models, retire them, and change quotas without notice. FreeLLMAPI tracks all of that for you. The router pulls a signed model catalog from [freellmapi.co](https://freellmapi.co) on its own, so your install keeps up without a `git pull`. The catalog syncs automatically every 12 hours.

![The free tier, stacked — ~4B tokens of free inference per month across 28 providers](repo-assets/free-tier.png)

## Supported providers

<div align="center">
<table>
<tr>
<td align="center" width="150"><img src="repo-assets/providers/google.png" width="44" alt="Google"><br/><b>Google</b></td>
<td align="center" width="150"><picture><source media="(prefers-color-scheme: dark)" srcset="repo-assets/providers/groq-dark.png"><img src="repo-assets/providers/groq.png" width="44" alt="Groq"></picture><br/><b>Groq</b></td>
<td align="center" width="150"><img src="repo-assets/providers/cerebras.png" width="44" alt="Cerebras"><br/><b>Cerebras</b></td>
<td align="center" width="150"><picture><source media="(prefers-color-scheme: dark)" srcset="repo-assets/providers/opencode-dark.png"><img src="repo-assets/providers/opencode.png" width="44" alt="OpenCode Zen"></picture><br/><b>OpenCode Zen</b></td>
</tr>
<tr>
<td align="center"><img src="repo-assets/providers/mistral.png" width="44" alt="Mistral"><br/><b>Mistral</b></td>
<td align="center"><img src="repo-assets/providers/openrouter.png" width="44" alt="OpenRouter"><br/><b>OpenRouter</b></td>
<td align="center"><img src="repo-assets/providers/cloudflare.png" width="44" alt="Cloudflare"><br/><b>Cloudflare</b></td>
<td align="center"><img src="repo-assets/providers/cohere.png" width="44" alt="Cohere"><br/><b>Cohere</b></td>
</tr>
<tr>
<td align="center"><img src="repo-assets/providers/zhipu.png" width="44" alt="Z.ai (Zhipu)"><br/><b>Z.ai (Zhipu)</b></td>
<td align="center"><img src="repo-assets/providers/nvidia.png" width="44" alt="NVIDIA"><br/><b>NVIDIA</b></td>
<td align="center"><img src="repo-assets/providers/huggingface.png" width="44" alt="HuggingFace"><br/><b>HuggingFace</b></td>
</tr>
<tr>
<td align="center"><a href="https://modelscope.cn"><b>ModelScope</b><br/>Qwen3 · DeepSeek V4 · GLM-5 (needs Aliyun cn binding)</a></td>
</tr>
</table>

<i>… and 17 more free providers</i>

</div>

Plus a **custom** provider — point chat, embedding, image, or audio models at any OpenAI-compatible endpoint (llama.cpp, LM Studio, vLLM, a local Ollama, or a remote gateway) from the Keys page.

The full, always-current list lives at **[freellmapi.co/models](https://freellmapi.co/models.html)** with per-model rate limits, context windows, and free-token budgets.

## Compatible CLIs & coding agents

<div align="center">
<table>
<tr>
<td align="center" width="150"><img src="repo-assets/agents/claude-code.png" width="44" alt="Claude Code"><br/><b>Claude Code</b></td>
<td align="center" width="150"><img src="repo-assets/agents/codex.png" width="44" alt="Codex CLI"><br/><b>Codex CLI</b></td>
<td align="center" width="150"><img src="repo-assets/agents/gemini-cli.png" width="44" alt="Gemini CLI"><br/><b>Gemini CLI</b></td>
<td align="center" width="150"><img src="repo-assets/agents/aider.png" width="44" alt="Aider"><br/><b>Aider</b></td>
</tr>
<tr>
<td align="center"><img src="repo-assets/agents/cline.png" width="44" alt="Cline"><br/><b>Cline</b></td>
<td align="center"><img src="repo-assets/agents/roo-code.png" width="44" alt="Roo Code"><br/><b>Roo Code</b></td>
<td align="center"><img src="repo-assets/agents/continue.png" width="44" alt="Continue"><br/><b>Continue</b></td>
<td align="center"><img src="repo-assets/agents/opencode.png" width="44" alt="OpenCode"><br/><b>OpenCode</b></td>
</tr>
<tr>
<td align="center"><img src="repo-assets/agents/goose.png" width="44" alt="Goose"><br/><b>Goose</b></td>
<td align="center"><img src="repo-assets/agents/qwen-code.png" width="44" alt="Qwen Code"><br/><b>Qwen Code</b></td>
<td align="center"><img src="repo-assets/agents/kilo-code.png" width="44" alt="Kilo Code"><br/><b>Kilo Code</b></td>
<td align="center"><img src="repo-assets/agents/crush.png" width="44" alt="Crush"><br/><b>Crush</b></td>
</tr>
<tr>
<td align="center"><img src="repo-assets/agents/cursor.png" width="44" alt="Cursor"><br/><b>Cursor</b></td>
<td align="center"><img src="repo-assets/agents/zed.png" width="44" alt="Zed"><br/><b>Zed</b></td>
<td align="center"><img src="repo-assets/agents/jetbrains.png" width="44" alt="JetBrains AI"><br/><b>JetBrains AI</b></td>
</tr>
</table>

<i>… plus any OpenAI-compatible client, Anthropic SDK, Gemini SDK, or Ollama-capable app</i>

</div>

Most of these configure themselves with one command — `npx freellmapi setup-claude`, `setup-codex`, `setup-aider`, and ten more generators that fetch your live catalog, back up existing config, and never clobber what's already there. Claude Code and Codex also get zero-persistence launchers (`freellmapi launch`, `freellmapi launch-codex`) that inject credentials into the child process only. Zed and JetBrains AI connect through the opt-in [Ollama emulation](docs/clients.md#ollama-clients); Gemini CLI speaks its native wire on `/v1beta`.

Per-tool recipes, the setup CLI reference, revocable URL tokens for headerless clients, and the MCP server all live in **[Clients & coding agents →](docs/clients.md)**

## How it compares

![Feature comparison against OpenRouter, LiteLLM, and Portkey](repo-assets/comparison.png)

Based on public documentation, July 2026 — corrections welcome.

## Features

- **OpenAI-compatible** — `POST /v1/chat/completions` and `GET /v1/models` work with the official OpenAI SDKs and any OpenAI-compatible client (LangChain, LlamaIndex, Continue, Hermes, etc.). Just change `base_url`.
- **Responses API** — `POST /v1/responses` (the wire format current Codex CLI versions require) is implemented as a translating shim over the same router, with full streaming events and tool calls.
- **Editor autocomplete** — `POST /v1/completions` translates legacy prompt/suffix requests into the same router, so VS Code ghost-text clients such as Continue can use FreeLLMAPI for inline suggestions.
- **Anthropic Messages API** — `POST /v1/messages` (plus `/v1/messages/count_tokens`) speaks Anthropic's wire format over the same router, so **Claude Code** and the official Anthropic SDKs run against your free pool. `GET /v1/models` is content-negotiated (Anthropic shape when the client sends `anthropic-version`, OpenAI shape otherwise), and Claude families (`opus` / `sonnet` / `haiku` / `default`) map to `auto` or a pinned model on the Keys page. See [Anthropic / Claude clients](#anthropic--claude-clients).
- **Fusion (multi-model synthesis)** — request the virtual `fusion` model and the router fans your prompt out to a panel of diverse free models in parallel, then a judge model synthesizes one answer from the drafts. Panel, judge, and strategy are configurable on the dashboard's **Fusion** page or per request via the `fusion` field; each sub-call goes through normal routing, quotas, and analytics.
- **Image generation & text-to-speech** — `POST /v1/images/generations` and `POST /v1/audio/speech` route across the providers that serve media models, including custom OpenAI-compatible media endpoints. Browse and toggle them on the dashboard's **Models → Image / Audio** tabs.
- **Self-updating model catalog** — the router syncs a signed catalog from freellmapi.co twice a day: new models, quota changes, and provider quirk fixes land in your install automatically. The catalog syncs automatically twice a day.
- **Streaming and non-streaming** — Server-Sent Events for `stream: true`, JSON response otherwise. Every provider adapter implements both.
- **Tool calling** — OpenAI-style `tools` / `tool_choice` requests are passed through, and assistant `tool_calls` + `tool` role follow-up messages round-trip across providers. Models that emit tool calls as plain text instead of structured JSON are rescued into real `tool_calls` automatically, and tool requests only route to models that actually support them.
- **Structured outputs & full sampling passthrough** — `response_format` (`json_object` / `json_schema`, translated to Gemini's native `responseSchema`), plus `seed`, `top_k`, `min_p`, presence/frequency/repetition penalties, `logit_bias`, `logprobs`, and the `max_completion_tokens` alias. Params a provider is known to reject are dropped per platform (Mistral's strict API, Groq's logprobs family…), and every model advertises its honest list in `/v1/models` `supported_parameters`.
- **Embeddings** — `/v1/embeddings` with family-based routing, including custom OpenAI-compatible embedding endpoints: failover only ever happens between providers serving the *same* model (vectors from different models are incompatible), never across models. See [Embeddings](#embeddings).
- **Automatic fallover** — If the chosen provider returns a 429, 5xx, or times out, the router skips it, puts the key on a short cooldown, and retries on the next model in your fallback chain (up to 20 attempts, bounded by a wall-clock retry budget). A dead key rotates to its siblings instead of failing the request, and exhaustion errors carry the full attempt trail so you can see exactly what was tried.
- **Smart routing, six strategies** — the chain is ranked by a selectable strategy: `priority` (your manual order), `balanced`, `smartest`, `fastest`, `reliable`, or `custom` with your own weight mix. Scores come from live per-model measurements (speed, capability, rate-limit headroom, recent errors) with a Thompson-sampling bandit under the hood; one-click sort presets reorder the chain from the dashboard.
- **Unified models** — the same logical model served by several providers (say, GLM-4.7 on Cloudflare and Z.ai) collapses into one entry: one name in `/v1/models`, strict in-group failover between its providers, and merge/split overrides when the grouping guesses wrong.
- **Model profiles** — save named fallback-chain configurations (a coding chain, a long-context chain, a vision chain) and switch the active one from the dashboard.
- **Per-key rate tracking** — RPM, RPD, TPM, and TPD counters per `(platform, model, key)` so the router always picks a key that's under its caps. The ledger also learns: ceilings a provider reports in error bodies or quota headers (a Groq 413 naming its TPM limit) tighten the router's own limits automatically.
- **Sticky sessions** — Multi-turn conversations keep talking to the same model for 30 minutes to avoid the hallucination spike that comes from mid-conversation model switches.
- **Response cache (opt-in)** — an exact-match in-memory LRU for identical non-streaming requests: canonical SHA-256 keys over the full request, TTL and temperature gates, per-request `X-FreeLLM-Cache: on|off` override, and saved-token stats on the dashboard. Off by default; cache hits consume zero provider quota.
- **Encrypted key storage** — API keys are encrypted with AES-256-GCM before hitting SQLite; decryption happens in-memory just before a request.
- **Key import & export** — bulk-import keys by pasting a `.env` file (with preview and per-key selection), export back out as JSON, `.env`, or CSV.
- **Unified API key** — Clients authenticate to your proxy with a single `freellmapi-…` bearer token. You never expose upstream provider keys to your apps.
- **Dashboard login** — The admin UI and all `/api/*` routes are gated behind an email + password account (scrypt-hashed, session-token auth), set on first run. The `/v1` proxy keeps its own unified-key auth for apps.
- **Health checks** — Periodic probes mark keys as `healthy`, `rate_limited`, `invalid`, or `error` so the router skips dead ones automatically.
- **Admin dashboard** — React + Vite UI to manage keys, reorder the fallback chain, inspect analytics, and run prompts in a playground. Dark/light/system theme and [60 languages](#languages) included.
- **Analytics** — Per-request logging with latency (p50 / p95 and time-to-first-token for streams), token counts, success rate, estimated cost savings, and per-provider / per-model / per-key breakdowns over 24h to 90d windows.
- **Interactive API docs** — `GET /v1/docs` serves a dependency-free OpenAPI viewer covering every proxy endpoint; the spec itself lives at `GET /v1/openapi.json`.
- **MCP server** — `POST /mcp` speaks the Model Context Protocol (Streamable HTTP), so MCP-capable agents can ask the router which free models are usable right now (with per-model `supported_parameters`), check provider/key health and cooldowns, read usage and cache stats, and switch the routing strategy mid-session. See [Coding agents](#coding-agents).
- **Encrypted DB backups** — optional periodic encrypted snapshots of the SQLite database to a local path or HTTP target, restored automatically on a fresh boot (`FREEAPI_DB_BACKUP_*` env vars).
- **Context handoff on model switch** — Optional. When a session falls over to a different model, injects one compact system message so the new model knows it is continuing an existing task. Disabled by default; enable with `FREELLMAPI_CONTEXT_HANDOFF=on_model_switch`. See [Context Handoff](#context-handoff).
- **Runs anywhere Node 20+ runs** — Windows, macOS, Linux servers, or a small ARM SBC (Raspberry Pi included). ~40 MB RSS at idle behind PM2 / systemd / whatever supervisor you prefer.

The scope is deliberately narrow — see [what's not supported yet](docs/architecture.md#not-yet-supported).

## Quick start

**One-liner** (Docker required — sets up `~/freellmapi`, generates an encryption key, pulls the image, and starts the container):

```bash
curl -fsSL https://freellmapi.co/install.sh | bash
```

Prefer to read before you pipe to bash? [The script is here](https://freellmapi.co/install.sh). Re-running it is safe: your `.env` (and encryption key) is preserved and the container updates to `:latest`.

Open http://localhost:3001, add your provider keys on the **Keys** page, reorder the **Fallback Chain** to taste, and grab your unified API key from the **Keys** page header. That unified key is what you point your OpenAI SDK at.

On Windows, the easiest path is the desktop **[`.exe` installer from Releases](https://github.com/tashfeenahmed/freellmapi/releases/latest)** (below). On Android, see the experimental [Termux guide](docs/install/android-termux.md).

Everything else — Docker Compose, local development, declarative startup config, production builds, LAN access, and backups — is in **[docs/install.md](docs/install.md)**.

## Desktop app

A native menu-bar app lives in [`desktop/`](./desktop): the entire router + dashboard running locally from your tray, with a glass popover showing live request stats.

![FreeLLMAPI desktop app](repo-assets/desktop.png)

**[Download from Releases](https://github.com/tashfeenahmed/freellmapi/releases/latest)** — the macOS `.dmg` and the Windows `.exe` installer are attached to every release. No account or password to set up: the only credential you need is the unified API key from the tray popover. Build-from-source steps and where your data lives: [docs/install.md](docs/install.md#desktop-app).

## Works with OpenAI-compatible clients

Anything that can target an OpenAI-compatible base URL works: set it to `http://localhost:3001/v1` with the unified key from the dashboard. **Claude Code**, **Codex CLI**, **Cline / Roo Code**, **Continue** (including inline autocomplete), **Aider**, **opencode**, and **Cursor** each have a short recipe in **[docs/clients.md](docs/clients.md)** — and the router doubles as an MCP server your agents can introspect mid-session.

The fastest setup is generated from the models available on your live server:

```bash
npx freellmapi setup-claude --url http://localhost:3001 --api-key <unified-key>
```

Every generator supports `--dry-run`, creates a timestamped backup before changing an existing file, and merges into the user's configuration. Launchers keep credentials out of config files entirely: `npx freellmapi launch` for Claude Code and `npx freellmapi launch-codex` for Codex.

| Agent | Automated setup | Base URL |
| --- | --- | --- |
| Claude Code | `setup-claude` | root |
| Codex CLI | `setup-codex` | `/v1` |
| Cline | `setup-cline` | `/v1` |
| Continue | `setup-continue` | `/v1` |
| Aider | `setup-aider` | `/v1` |
| OpenCode | `setup-opencode` | `/v1` |
| Goose | `setup-goose` | `/v1` |
| Qwen Code | `setup-qwen` | `/v1` (or native `/v1beta`) |
| Roo / Kilo / Crush | `setup-roo` / `setup-kilo` / `setup-crush` | `/v1` |
| Cursor | `setup-cursor` guide | public `/v1` URL |

FreeLLMAPI is local-first and single-user by design. Your provider keys stay in your SQLite database, encrypted at rest, and requests go from your machine to the upstream providers you enabled.

## Languages

The dashboard ships in **60 languages** (the desktop tray menu in 6). The UI
auto-detects your browser/system language on first load and you can switch any
time from **⋯ → Settings**; the choice is remembered. Right-to-left languages
(العربية, עברית, فارسی, اردو) flip the whole layout automatically, and only the
active language's dictionary is loaded — the rest never touch your bandwidth.

<img src="https://flagcdn.com/24x18/us.png" srcset="https://flagcdn.com/48x36/us.png 2x" width="24" height="18" alt="United States" title="United States"> <img src="https://flagcdn.com/24x18/cn.png" srcset="https://flagcdn.com/48x36/cn.png 2x" width="24" height="18" alt="China" title="China"> <img src="https://flagcdn.com/24x18/es.png" srcset="https://flagcdn.com/48x36/es.png 2x" width="24" height="18" alt="Spain" title="Spain"> <img src="https://flagcdn.com/24x18/fr.png" srcset="https://flagcdn.com/48x36/fr.png 2x" width="24" height="18" alt="France" title="France"> <img src="https://flagcdn.com/24x18/br.png" srcset="https://flagcdn.com/48x36/br.png 2x" width="24" height="18" alt="Brazil" title="Brazil"> <img src="https://flagcdn.com/24x18/it.png" srcset="https://flagcdn.com/48x36/it.png 2x" width="24" height="18" alt="Italy" title="Italy"> <img src="https://flagcdn.com/24x18/in.png" srcset="https://flagcdn.com/48x36/in.png 2x" width="24" height="18" alt="India" title="India"> <img src="https://flagcdn.com/24x18/sa.png" srcset="https://flagcdn.com/48x36/sa.png 2x" width="24" height="18" alt="Saudi Arabia" title="Saudi Arabia"> <img src="https://flagcdn.com/24x18/bd.png" srcset="https://flagcdn.com/48x36/bd.png 2x" width="24" height="18" alt="Bangladesh" title="Bangladesh"> <img src="https://flagcdn.com/24x18/ru.png" srcset="https://flagcdn.com/48x36/ru.png 2x" width="24" height="18" alt="Russia" title="Russia"> <img src="https://flagcdn.com/24x18/pk.png" srcset="https://flagcdn.com/48x36/pk.png 2x" width="24" height="18" alt="Pakistan" title="Pakistan"> <img src="https://flagcdn.com/24x18/id.png" srcset="https://flagcdn.com/48x36/id.png 2x" width="24" height="18" alt="Indonesia" title="Indonesia"> <img src="https://flagcdn.com/24x18/de.png" srcset="https://flagcdn.com/48x36/de.png 2x" width="24" height="18" alt="Germany" title="Germany"> <img src="https://flagcdn.com/24x18/jp.png" srcset="https://flagcdn.com/48x36/jp.png 2x" width="24" height="18" alt="Japan" title="Japan"> <img src="https://flagcdn.com/24x18/ke.png" srcset="https://flagcdn.com/48x36/ke.png 2x" width="24" height="18" alt="Kenya" title="Kenya"> <img src="https://flagcdn.com/24x18/tr.png" srcset="https://flagcdn.com/48x36/tr.png 2x" width="24" height="18" alt="Türkiye" title="Türkiye"> <img src="https://flagcdn.com/24x18/vn.png" srcset="https://flagcdn.com/48x36/vn.png 2x" width="24" height="18" alt="Vietnam" title="Vietnam"> <img src="https://flagcdn.com/24x18/kr.png" srcset="https://flagcdn.com/48x36/kr.png 2x" width="24" height="18" alt="South Korea" title="South Korea"> <img src="https://flagcdn.com/24x18/ir.png" srcset="https://flagcdn.com/48x36/ir.png 2x" width="24" height="18" alt="Iran" title="Iran"> <img src="https://flagcdn.com/24x18/th.png" srcset="https://flagcdn.com/48x36/th.png 2x" width="24" height="18" alt="Thailand" title="Thailand"> <img src="https://flagcdn.com/24x18/pl.png" srcset="https://flagcdn.com/48x36/pl.png 2x" width="24" height="18" alt="Poland" title="Poland"> <img src="https://flagcdn.com/24x18/ua.png" srcset="https://flagcdn.com/48x36/ua.png 2x" width="24" height="18" alt="Ukraine" title="Ukraine"> <img src="https://flagcdn.com/24x18/mm.png" srcset="https://flagcdn.com/48x36/mm.png 2x" width="24" height="18" alt="Myanmar" title="Myanmar"> <img src="https://flagcdn.com/24x18/ro.png" srcset="https://flagcdn.com/48x36/ro.png 2x" width="24" height="18" alt="Romania" title="Romania"> <img src="https://flagcdn.com/24x18/nl.png" srcset="https://flagcdn.com/48x36/nl.png 2x" width="24" height="18" alt="Netherlands" title="Netherlands"> <img src="https://flagcdn.com/24x18/my.png" srcset="https://flagcdn.com/48x36/my.png 2x" width="24" height="18" alt="Malaysia" title="Malaysia"> <img src="https://flagcdn.com/24x18/ph.png" srcset="https://flagcdn.com/48x36/ph.png 2x" width="24" height="18" alt="Philippines" title="Philippines"> <img src="https://flagcdn.com/24x18/ng.png" srcset="https://flagcdn.com/48x36/ng.png 2x" width="24" height="18" alt="Nigeria" title="Nigeria"> <img src="https://flagcdn.com/24x18/et.png" srcset="https://flagcdn.com/48x36/et.png 2x" width="24" height="18" alt="Ethiopia" title="Ethiopia"> <img src="https://flagcdn.com/24x18/uz.png" srcset="https://flagcdn.com/48x36/uz.png 2x" width="24" height="18" alt="Uzbekistan" title="Uzbekistan"> <img src="https://flagcdn.com/24x18/az.png" srcset="https://flagcdn.com/48x36/az.png 2x" width="24" height="18" alt="Azerbaijan" title="Azerbaijan"> <img src="https://flagcdn.com/24x18/lk.png" srcset="https://flagcdn.com/48x36/lk.png 2x" width="24" height="18" alt="Sri Lanka" title="Sri Lanka"> <img src="https://flagcdn.com/24x18/np.png" srcset="https://flagcdn.com/48x36/np.png 2x" width="24" height="18" alt="Nepal" title="Nepal"> <img src="https://flagcdn.com/24x18/kh.png" srcset="https://flagcdn.com/48x36/kh.png 2x" width="24" height="18" alt="Cambodia" title="Cambodia"> <img src="https://flagcdn.com/24x18/gr.png" srcset="https://flagcdn.com/48x36/gr.png 2x" width="24" height="18" alt="Greece" title="Greece"> <img src="https://flagcdn.com/24x18/cz.png" srcset="https://flagcdn.com/48x36/cz.png 2x" width="24" height="18" alt="Czechia" title="Czechia"> <img src="https://flagcdn.com/24x18/hu.png" srcset="https://flagcdn.com/48x36/hu.png 2x" width="24" height="18" alt="Hungary" title="Hungary"> <img src="https://flagcdn.com/24x18/se.png" srcset="https://flagcdn.com/48x36/se.png 2x" width="24" height="18" alt="Sweden" title="Sweden"> <img src="https://flagcdn.com/24x18/il.png" srcset="https://flagcdn.com/48x36/il.png 2x" width="24" height="18" alt="Israel" title="Israel"> <img src="https://flagcdn.com/24x18/dk.png" srcset="https://flagcdn.com/48x36/dk.png 2x" width="24" height="18" alt="Denmark" title="Denmark"> <img src="https://flagcdn.com/24x18/fi.png" srcset="https://flagcdn.com/48x36/fi.png 2x" width="24" height="18" alt="Finland" title="Finland"> <img src="https://flagcdn.com/24x18/no.png" srcset="https://flagcdn.com/48x36/no.png 2x" width="24" height="18" alt="Norway" title="Norway"> <img src="https://flagcdn.com/24x18/sk.png" srcset="https://flagcdn.com/48x36/sk.png 2x" width="24" height="18" alt="Slovakia" title="Slovakia"> <img src="https://flagcdn.com/24x18/bg.png" srcset="https://flagcdn.com/48x36/bg.png 2x" width="24" height="18" alt="Bulgaria" title="Bulgaria"> <img src="https://flagcdn.com/24x18/hr.png" srcset="https://flagcdn.com/48x36/hr.png 2x" width="24" height="18" alt="Croatia" title="Croatia"> <img src="https://flagcdn.com/24x18/rs.png" srcset="https://flagcdn.com/48x36/rs.png 2x" width="24" height="18" alt="Serbia" title="Serbia"> <img src="https://flagcdn.com/24x18/lt.png" srcset="https://flagcdn.com/48x36/lt.png 2x" width="24" height="18" alt="Lithuania" title="Lithuania"> <img src="https://flagcdn.com/24x18/tw.png" srcset="https://flagcdn.com/48x36/tw.png 2x" width="24" height="18" alt="Taiwan" title="Taiwan"> <img src="https://flagcdn.com/24x18/pt.png" srcset="https://flagcdn.com/48x36/pt.png 2x" width="24" height="18" alt="Portugal" title="Portugal"> <img src="https://flagcdn.com/24x18/ge.png" srcset="https://flagcdn.com/48x36/ge.png 2x" width="24" height="18" alt="Georgia" title="Georgia">

The full list of locales lives in
[`client/src/i18n/locale-config.ts`](./client/src/i18n/locale-config.ts).

The original six locales are human-reviewed; the newer ones are machine-
translated and improve as native speakers send corrections — a one-string PR is
a great first contribution.

Translations live in [`client/src/i18n/locales/`](./client/src/i18n/locales) as
flat JSON files. To fix a string, edit the value in the locale's JSON file. To
add a language, copy `en.json`, translate the values, and register the locale in
`client/src/i18n/locale-config.ts` (and `desktop/src/i18n.ts` for the tray
strings); `npm test` checks every locale for key/placeholder parity — PRs
welcome.

## Works with OpenAI-compatible clients

Any client that can target an OpenAI-compatible base URL can use FreeLLMAPI:

- **LangChain, LlamaIndex, official OpenAI SDKs**: set `base_url` to
  `http://localhost:3001/v1` and use the unified key from the dashboard.
- **Local GPU boxes**: add custom OpenAI-compatible endpoints for Ollama,
  llama.cpp, LM Studio, vLLM, or an internal gateway.

### Coding agents

Every recipe below is the same three facts in a different config file: base URL
`http://localhost:3001/v1`, the unified key from the dashboard's Keys page, and
a model (`auto` lets the router pick).

| Agent | Setup |
| --- | --- |
| **Claude Code** | `ANTHROPIC_BASE_URL=http://localhost:3001` + `ANTHROPIC_AUTH_TOKEN=<unified key>` — full walkthrough in [Anthropic / Claude clients](#anthropic--claude-clients) |
| **Codex CLI** | add a provider in `~/.codex/config.toml` with `base_url = "http://localhost:3001/v1"` and its `env_key` pointing at the unified key — the `/v1/responses` surface it needs is implemented |
| **Cline / Roo Code** | provider type "OpenAI Compatible", base URL `http://localhost:3001/v1`, unified key, model `auto` (or any id from `/v1/models`) |
| **Continue** | `apiBase: http://localhost:3001/v1` in its config; inline autocomplete works too via the legacy `/v1/completions` surface |
| **Aider** | `OPENAI_API_BASE=http://localhost:3001/v1` + `OPENAI_API_KEY=<unified key>`, then `aider --model openai/auto` |
| **opencode** | OpenAI-compatible provider with the same base URL and key |
| **Cursor** | paste the unified key under a custom OpenAI base URL — but note Cursor verifies and calls the API **from its servers**, so your router must be reachable from the internet (a tunnel or a host with a public address), not just `localhost` |

On top of inference, the router is an **MCP server**: agents can introspect it mid-session
(usable models and the params each one honors, provider health, usage and cache stats,
routing strategy). For Claude Code:

```bash
claude mcp add --transport http freellmapi http://localhost:3001/mcp \
  --header "Authorization: Bearer freellmapi-your-unified-key"
```

Any MCP client that speaks Streamable HTTP works the same way: point it at `/mcp` with the
unified key as a Bearer token.

FreeLLMAPI is local-first and single-user by design. Your provider keys stay in
your SQLite database, encrypted at rest, and requests go from your machine to the
upstream providers you enabled.

## Using the API

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3001/v1",
    api_key="freellmapi-your-unified-key",
)

resp = client.chat.completions.create(
    model="auto",  # let the router pick; or "auto:fast", "auto:smart", a profile, or a model id
    messages=[{"role": "user", "content": "Summarise the fall of Rome in one sentence."}],
)
print(resp.choices[0].message.content)
print("Routed via:", resp.headers.get("x-routed-via"))
```

Streaming, the `auto:*` routing strategies, tool calling, vision input, Gemini Google Search grounding, embeddings, and the Anthropic Messages surface — with curl and Python examples for each — are all in **[docs/api.md](docs/api.md)**. Every response carries an `X-Routed-Via: <platform>/<model>` header so you can see which provider actually served it.

## Screenshots

### Models

Pick a routing strategy and watch the monthly token budget fill across the whole provider fleet. Every model shows live reliability, speed, and intelligence scores — the order below is how requests route right now.

![Models page](repo-assets/models.png)

### Keys

Manage provider credentials and grab the unified API key your apps connect with. Each key shows a status dot and when it was last health-checked.

![Keys page](repo-assets/keys.png)

### Playground

Send a chat completion through the router and see which provider served it, with the model ID and latency printed right on the message. Attach files by button, drag-and-drop, or paste: images (PNG/JPEG/WebP/GIF) are downscaled in the browser and sent as image content parts to a vision-capable model, and text files (TXT/MD/CSV/JSON/LOG) are inlined into the prompt as fenced blocks.

![Playground page](repo-assets/playground.png)

### Analytics

Request volume, success rate, tokens in and out, average latency, and per-provider breakdowns over 24h / 7d / 30d / 90d windows.

![Analytics page](repo-assets/analytics.png)

## How it works

![One request in, the best free model out — the fallback chain with live scores, cooldowns, and quota tracking](repo-assets/router-flow.png)

One request in, the best free model out: the router picks the highest-priority model with a healthy key that's under all its rate limits, decrypts the key in memory, and calls the provider — on a 429/5xx it cools that key down and retries the next model in your chain. The component walkthrough, routing internals, and operational details live in **[docs/architecture.md](docs/architecture.md)**.

## Limitations

Stacking free tiers has real trade-offs: no frontier models, variable latency, no SLA — and the effective intelligence of the endpoint dips late in the day as top models hit their daily caps, then resets at UTC midnight. Read the honest list in **[docs/architecture.md#limitations](docs/architecture.md#limitations)** before building anything real on this.

## Contributing

Contributors very welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for the dev loop, PR expectations, and the policy on AI/LLM-assisted contributions (short version: welcome, same quality bar as any other PR). Good first PRs:

- **Add a provider** — copy `server/src/providers/openai-compat.ts` as a template, wire it into `server/src/providers/index.ts`, seed its models in `server/src/db/index.ts`, add a test in `server/src/__tests__/providers/`.
- **Add an endpoint** — moderations and other OpenAI-compatible surfaces. The provider base class can grow new methods; adapters declare which they support.
- **Improve the router** — cost-aware routing (cheapest-healthy-fastest tradeoffs), better latency-weighted priority, regional pinning.
- **Dashboard polish** — charts on the Analytics page, key rotation UX, batch import of keys from `.env`.
- **Docs** — more examples, client library snippets for Go/Rust/etc., a deployment recipe for Docker or Fly.

`npm install && npm run dev` gets you the server on :3001 and the dashboard on :5173, both with HMR. PRs should include a test, keep the existing suite green (`npm test`), and match the `.editorconfig` / tsconfig defaults already in the repo. Database migration workflow and the full contributor loop are in [CONTRIBUTING.md](./CONTRIBUTING.md).

### Contributors

<a href="https://github.com/moaaz12-web"><img src="https://images.weserv.nl/?url=github.com/moaaz12-web.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@moaaz12-web" /></a>
<a href="https://github.com/lukasulc"><img src="https://images.weserv.nl/?url=github.com/lukasulc.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@lukasulc" /></a>
<a href="https://github.com/VinhPhamAI"><img src="https://images.weserv.nl/?url=github.com/VinhPhamAI.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@VinhPhamAI" /></a>
<a href="https://github.com/deadc"><img src="https://images.weserv.nl/?url=github.com/deadc.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@deadc" /></a>
<a href="https://github.com/zhangyu1324"><img src="https://images.weserv.nl/?url=github.com/zhangyu1324.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@zhangyu1324" /></a>
<a href="https://github.com/chongjiazhen"><img src="https://images.weserv.nl/?url=github.com/chongjiazhen.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@chongjiazhen" /></a>
<a href="https://github.com/vjsai"><img src="https://images.weserv.nl/?url=github.com/vjsai.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@vjsai" /></a>
<a href="https://github.com/long2ice"><img src="https://images.weserv.nl/?url=github.com/long2ice.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@long2ice" /></a>
<a href="https://github.com/sadesguy"><img src="https://images.weserv.nl/?url=github.com/sadesguy.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@sadesguy" /></a>
<a href="https://github.com/hodlmybeer69-bit"><img src="https://images.weserv.nl/?url=github.com/hodlmybeer69-bit.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@hodlmybeer69-bit" /></a>
<a href="https://github.com/phoenixikkifullstack"><img src="https://images.weserv.nl/?url=github.com/phoenixikkifullstack.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@phoenixikkifullstack" /></a>
<a href="https://github.com/jtbrennan-git"><img src="https://images.weserv.nl/?url=github.com/jtbrennan-git.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@jtbrennan-git" /></a>
<a href="https://github.com/praveenkumarpranjal"><img src="https://images.weserv.nl/?url=github.com/praveenkumarpranjal.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@praveenkumarpranjal" /></a>
<a href="https://github.com/nordbyte"><img src="https://images.weserv.nl/?url=github.com/nordbyte.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@nordbyte" /></a>
<a href="https://github.com/mybropro"><img src="https://images.weserv.nl/?url=github.com/mybropro.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@mybropro" /></a>
<a href="https://github.com/danscMax"><img src="https://images.weserv.nl/?url=github.com/danscMax.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@danscMax" /></a>
<a href="https://github.com/jhash"><img src="https://images.weserv.nl/?url=github.com/jhash.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@jhash" /></a>
<a href="https://github.com/JammyJames1234"><img src="https://images.weserv.nl/?url=github.com/JammyJames1234.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@JammyJames1234" /></a>
<a href="https://github.com/coffcoe"><img src="https://images.weserv.nl/?url=github.com/coffcoe.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@coffcoe" /></a>
<a href="https://github.com/Sumit4codes"><img src="https://images.weserv.nl/?url=github.com/Sumit4codes.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@Sumit4codes" /></a>
<a href="https://github.com/meliani"><img src="https://images.weserv.nl/?url=github.com/meliani.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@meliani" /></a>
<a href="https://github.com/thedavidweng"><img src="https://images.weserv.nl/?url=github.com/thedavidweng.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@thedavidweng" /></a>
<a href="https://github.com/bharvey42"><img src="https://images.weserv.nl/?url=github.com/bharvey42.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@bharvey42" /></a>
<a href="https://github.com/yuvrxj-afk"><img src="https://images.weserv.nl/?url=github.com/yuvrxj-afk.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@yuvrxj-afk" /></a>
<a href="https://github.com/Tushar49"><img src="https://images.weserv.nl/?url=github.com/Tushar49.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@Tushar49" /></a>
<a href="https://github.com/nicyoong"><img src="https://images.weserv.nl/?url=github.com/nicyoong.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@nicyoong" /></a>
<a href="https://github.com/Aldo-f"><img src="https://images.weserv.nl/?url=github.com/Aldo-f.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@Aldo-f" /></a>
<a href="https://github.com/Tazrif-Raim"><img src="https://images.weserv.nl/?url=github.com/Tazrif-Raim.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@Tazrif-Raim" /></a>
<a href="https://github.com/m1nuzz"><img src="https://images.weserv.nl/?url=github.com/m1nuzz.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@m1nuzz" /></a>
<a href="https://github.com/LoneRifle"><img src="https://images.weserv.nl/?url=github.com/LoneRifle.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@LoneRifle" /></a>
<a href="https://github.com/ita333"><img src="https://images.weserv.nl/?url=github.com/ita333.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@ita333" /></a>
<a href="https://github.com/barbotkonv"><img src="https://images.weserv.nl/?url=github.com/barbotkonv.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@barbotkonv" /></a>
<a href="https://github.com/Naster17"><img src="https://images.weserv.nl/?url=github.com/Naster17.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@Naster17" /></a>
<a href="https://github.com/StealthTensor"><img src="https://images.weserv.nl/?url=github.com/StealthTensor.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@StealthTensor" /></a>
<a href="https://github.com/EmranAhmed"><img src="https://images.weserv.nl/?url=github.com/EmranAhmed.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@EmranAhmed" /></a>
<a href="https://github.com/itsfuad"><img src="https://images.weserv.nl/?url=github.com/itsfuad.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@itsfuad" /></a>
<a href="https://github.com/RobinHoodO"><img src="https://images.weserv.nl/?url=github.com/RobinHoodO.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@RobinHoodO" /></a>
<a href="https://github.com/hmm183"><img src="https://images.weserv.nl/?url=github.com/hmm183.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@hmm183" /></a>
<a href="https://github.com/duemilionidieuro-bot"><img src="https://images.weserv.nl/?url=github.com/duemilionidieuro-bot.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@duemilionidieuro-bot" /></a>
<a href="https://github.com/cagedbird043"><img src="https://images.weserv.nl/?url=github.com/cagedbird043.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@cagedbird043" /></a>
<a href="https://github.com/jasnoorgill"><img src="https://images.weserv.nl/?url=github.com/jasnoorgill.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@jasnoorgill" /></a>
<a href="https://github.com/Joey9024"><img src="https://images.weserv.nl/?url=github.com/Joey9024.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@Joey9024" /></a>
<a href="https://github.com/AskingConical"><img src="https://images.weserv.nl/?url=github.com/AskingConical.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@AskingConical" /></a>
<a href="https://github.com/ProAlit"><img src="https://images.weserv.nl/?url=github.com/ProAlit.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@ProAlit" /></a>
<a href="https://github.com/hjhhoni"><img src="https://images.weserv.nl/?url=github.com/hjhhoni.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@hjhhoni" /></a>
<a href="https://github.com/immanuelsavio"><img src="https://images.weserv.nl/?url=github.com/immanuelsavio.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@immanuelsavio" /></a>
<a href="https://github.com/Slyker"><img src="https://images.weserv.nl/?url=github.com/Slyker.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@Slyker" /></a>
<a href="https://github.com/wells1013"><img src="https://images.weserv.nl/?url=github.com/wells1013.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@wells1013" /></a>
<a href="https://github.com/evgkrsk"><img src="https://images.weserv.nl/?url=github.com/evgkrsk.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@evgkrsk" /></a>
<a href="https://github.com/aaronjmars"><img src="https://images.weserv.nl/?url=github.com/aaronjmars.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@aaronjmars" /></a>
<a href="https://github.com/Robs87"><img src="https://images.weserv.nl/?url=github.com/Robs87.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@Robs87" /></a>
<a href="https://github.com/dashitongzhi"><img src="https://images.weserv.nl/?url=github.com/dashitongzhi.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@dashitongzhi" /></a>
<a href="https://github.com/QingJ01"><img src="https://images.weserv.nl/?url=github.com/QingJ01.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@QingJ01" /></a>
<a href="https://github.com/3215"><img src="https://images.weserv.nl/?url=github.com/3215.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@3215" /></a>
<a href="https://github.com/saifulaiub123"><img src="https://images.weserv.nl/?url=github.com/saifulaiub123.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@saifulaiub123" /></a>
<a href="https://github.com/PietFourie"><img src="https://images.weserv.nl/?url=github.com/PietFourie.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@PietFourie" /></a>
<a href="https://github.com/mhmdkrmabd"><img src="https://images.weserv.nl/?url=github.com/mhmdkrmabd.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@mhmdkrmabd" /></a>
<a href="https://github.com/DemeulemeesterxMaxime"><img src="https://images.weserv.nl/?url=github.com/DemeulemeesterxMaxime.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@DemeulemeesterxMaxime" /></a>
<a href="https://github.com/HoodBlah"><img src="https://images.weserv.nl/?url=github.com/HoodBlah.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@HoodBlah" /></a>
<a href="https://github.com/SeanPedersen"><img src="https://images.weserv.nl/?url=github.com/SeanPedersen.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@SeanPedersen" /></a>
<a href="https://github.com/andersmmg"><img src="https://images.weserv.nl/?url=github.com/andersmmg.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@andersmmg" /></a>
<a href="https://github.com/chirag127"><img src="https://images.weserv.nl/?url=github.com/chirag127.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@chirag127" /></a>
<a href="https://github.com/allababbot"><img src="https://images.weserv.nl/?url=github.com/allababbot.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@allababbot" /></a>
<a href="https://github.com/johan-droid"><img src="https://images.weserv.nl/?url=github.com/johan-droid.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@johan-droid" /></a>
<a href="https://github.com/redenfire"><img src="https://images.weserv.nl/?url=github.com/redenfire.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@redenfire" /></a>
<a href="https://github.com/itzpingcat"><img src="https://images.weserv.nl/?url=github.com/itzpingcat.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@itzpingcat" /></a>
<a href="https://github.com/kairwang01"><img src="https://images.weserv.nl/?url=github.com/kairwang01.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@kairwang01" /></a>
<a href="https://github.com/gongjurenzhangwei"><img src="https://images.weserv.nl/?url=github.com/gongjurenzhangwei.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@gongjurenzhangwei" /></a>
<a href="https://github.com/jsonring"><img src="https://images.weserv.nl/?url=github.com/jsonring.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@jsonring" /></a>
<a href="https://github.com/1029734570"><img src="https://images.weserv.nl/?url=github.com/1029734570.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@1029734570" /></a>
<a href="https://github.com/86TheCactus"><img src="https://images.weserv.nl/?url=github.com/86TheCactus.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@86TheCactus" /></a>
<a href="https://github.com/AmiroKD"><img src="https://images.weserv.nl/?url=github.com/AmiroKD.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@AmiroKD" /></a>
<a href="https://github.com/ecryptomillionaire-dev"><img src="https://images.weserv.nl/?url=github.com/ecryptomillionaire-dev.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@ecryptomillionaire-dev" /></a>
<a href="https://github.com/4riful"><img src="https://images.weserv.nl/?url=github.com/4riful.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@4riful" /></a>
<a href="https://github.com/fix2015"><img src="https://images.weserv.nl/?url=github.com/fix2015.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@fix2015" /></a>
<a href="https://github.com/iisyw"><img src="https://images.weserv.nl/?url=github.com/iisyw.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@iisyw" /></a>
<a href="https://github.com/xsfhacg"><img src="https://images.weserv.nl/?url=github.com/xsfhacg.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@xsfhacg" /></a>
<a href="https://github.com/noobix"><img src="https://images.weserv.nl/?url=github.com/noobix.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@noobix" /></a>
<a href="https://github.com/nandukmelath"><img src="https://images.weserv.nl/?url=github.com/nandukmelath.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@nandukmelath" /></a>
<a href="https://github.com/NirvanaCh7"><img src="https://images.weserv.nl/?url=github.com/NirvanaCh7.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@NirvanaCh7" /></a>
<a href="https://github.com/Mohamed3nan"><img src="https://images.weserv.nl/?url=github.com/Mohamed3nan.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@Mohamed3nan" /></a>
<a href="https://github.com/Arman-Espiar"><img src="https://images.weserv.nl/?url=github.com/Arman-Espiar.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@Arman-Espiar" /></a>
<a href="https://github.com/MetaMysteries8"><img src="https://images.weserv.nl/?url=github.com/MetaMysteries8.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@MetaMysteries8" /></a>
<a href="https://github.com/lujun880726"><img src="https://images.weserv.nl/?url=github.com/lujun880726.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@lujun880726" /></a>
<a href="https://github.com/qq97693453"><img src="https://images.weserv.nl/?url=github.com/qq97693453.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@qq97693453" /></a>
<a href="https://github.com/emv33"><img src="https://images.weserv.nl/?url=github.com/emv33.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@emv33" /></a>
<a href="https://github.com/ousamabenyounes"><img src="https://images.weserv.nl/?url=github.com/ousamabenyounes.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@ousamabenyounes" /></a>
<a href="https://github.com/yfdyh000"><img src="https://images.weserv.nl/?url=github.com/yfdyh000.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@yfdyh000" /></a>
<a href="https://github.com/s-uryansh"><img src="https://images.weserv.nl/?url=github.com/s-uryansh.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@s-uryansh" /></a>
<a href="https://github.com/arsalanyavari"><img src="https://images.weserv.nl/?url=github.com/arsalanyavari.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@arsalanyavari" /></a>
<a href="https://github.com/suantea"><img src="https://images.weserv.nl/?url=github.com/suantea.png&w=60&h=60&fit=cover&mask=circle" width="60" alt="@suantea" /></a>

## Disclaimer

**This project is for personal experimentation and learning, not production.** Free tiers exist so developers can prototype against them; they aren't a stable, supported inference substrate and shouldn't be treated as one. If you build something real on top of FreeLLMAPI, swap in a paid API before you ship. Your relationship with each upstream provider is governed by the terms you accepted when you created your account — those terms still apply when the traffic is proxied through this project, and you're responsible for complying with them.

How each provider's ToS views a personal, single-user proxy — reviewed provider by provider in May 2026 — is in [docs/architecture.md#terms-of-service-review](docs/architecture.md#terms-of-service-review).

## License

[MIT](./LICENSE)
