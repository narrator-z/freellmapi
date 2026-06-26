# Docker Guide

Docker Compose is the recommended way to run FreeLLMAPI for personal use. The container serves the Express API and the built React dashboard from one process on port 3001, with SQLite persisted in a local bind mount.

## Prerequisites

- Docker
- Docker Compose
- OpenSSL for generating `ENCRYPTION_KEY`

## Quick Start

```bash
# Generate encryption key
ENCRYPTION_KEY="$(openssl rand -hex 32)"
printf "ENCRYPTION_KEY=%s\nPORT=3001\n" "$ENCRYPTION_KEY" > ../.env

# Create data directory
mkdir -p ../.freellmapi-data

# Start the app
docker compose up -d
```

Open http://localhost:3001, add provider keys on the **Keys** page, then use the generated `freellmapi-...` key with any OpenAI-compatible client.

## Example API Call

```bash
curl http://localhost:3001/v1/chat/completions \
  -H "Authorization: Bearer freellmapi-your-unified-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "auto",
    "messages": [{"role": "user", "content": "Say hello from FreeLLMAPI."}]
  }'
```

## Operations

All commands run from the `docker/` directory:

```bash
cd docker

# Check status
docker compose ps

# Tail logs
docker compose logs -f freellmapi

# Stop
docker compose down

# Update to latest image
docker compose pull
docker compose up -d
```

## Configuration

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `ENCRYPTION_KEY` | Yes | None | 64-character hex key used to encrypt provider API keys at rest. Generate it once and keep it stable. |
| `PORT` | No | `3001` | Host port exposed by Docker Compose. The container listens on port 3001. |

Data is stored in `.freellmapi-data/` (next to the project root). Keep the same data directory and `ENCRYPTION_KEY` when upgrading, otherwise existing encrypted provider keys cannot be decrypted.

## Published Image

Images are published to GitHub Container Registry:

```bash
docker pull ghcr.io/narrator-z/freellmapi:latest
```

The Docker workflow in `.github/workflows/docker.yml` publishes images to GHCR on pushes to `main` and version tags. PRs only build (no push).
