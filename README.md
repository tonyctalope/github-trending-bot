# github-trending-bot

[![CI](https://github.com/tonyctalope/github-trending-bot/actions/workflows/ci.yml/badge.svg)](https://github.com/tonyctalope/github-trending-bot/actions/workflows/ci.yml)
[![image](https://img.shields.io/badge/ghcr.io-github--trending--bot-2496ed?logo=docker&logoColor=white)](https://github.com/tonyctalope/github-trending-bot/pkgs/container/github-trending-bot)
[![licence](https://img.shields.io/badge/licence-MIT-green.svg)](LICENSE)

A Discord bot that posts the [GitHub trending repositories](https://github.com/trending) on a
schedule — **daily**, **weekly**, **monthly**, or any combination — in **one or several channels**,
each with its own filters and cadence.

Everything is configurable from Discord with slash commands, or declaratively through a YAML file.
Run it with `docker run` and you are done.

```
🔥 GitHub Trending · Daily
🥇 zedeus/nitter · ⭐ 13,746 · +63 today · Nim
> Alternative Twitter front-end
🥈 microsoft/vscode · ⭐ 178,231 · +58 today · TypeScript
> Visual Studio Code
🥉 …
```

## Features

- **Per-channel subscriptions**: any mix of `daily` / `weekly` / `monthly`, in as many channels as
  you want.
- **Each period keeps its natural cadence**: a `daily` digest posts every day, `weekly` every
  Monday, `monthly` on the 1st — no weekly digest spammed daily. Override with any cron expression.
- **Filters**: by language (`typescript`, `rust`, `c++`, …), by spoken language (`fr`, `en`, …),
  and by how many repositories to include (1–25).
- **Two layouts**: rich embed (default) or plain compact text.
- **Configure from Discord** (`/trending subscribe`, persisted to disk) **or from a YAML file**
  (GitOps-friendly, read-only from Discord). Both work together.
- **Per-subscription time zone**, so `0 9 * * *` means 9 AM where you are.
- Ready to operate: JSON logs, `/health` endpoint, Docker `HEALTHCHECK`, graceful shutdown,
  non-root image, multi-arch (`amd64` + `arm64`).

## Quick start

### 1. Create the Discord application

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) → **New
   application**.
2. **Bot** → **Reset Token** → copy the token. That is your `DISCORD_TOKEN`.
3. No privileged intent is needed — the bot never reads message content.

### 2. Invite it to your server

Replace `<CLIENT_ID>` with the application id (General Information page):

```
https://discord.com/oauth2/authorize?client_id=<CLIENT_ID>&scope=bot+applications.commands&permissions=19456
```

`19456` = *View Channel* + *Send Messages* + *Embed Links* — the minimum the bot needs.

### 3. Run the image

```bash
mkdir -p data && echo "DISCORD_TOKEN=your-token-here" > .env

docker run -d --name github-trending-bot --restart unless-stopped \
  --env-file .env -e TZ=Europe/Paris \
  -v "$PWD/data:/data" \
  ghcr.io/tonyctalope/github-trending-bot:latest
```

Or with the provided [`docker-compose.yml`](docker-compose.yml):

```bash
cp .env.example .env   # fill in DISCORD_TOKEN
docker compose up -d
```

### 4. Subscribe a channel

In Discord (requires the **Manage Server** permission):

```
/trending subscribe period:daily
/trending subscribe period:all channel:#veille language:rust limit:10
/trending now period:weekly
```

## Slash commands

| Command | What it does |
| --- | --- |
| `/trending subscribe period:<daily\|weekly\|monthly\|all>` | Schedule a digest. Options: `channel`, `language`, `spoken_language`, `limit`, `cron`, `timezone`, `style`. Defaults to the current channel. |
| `/trending list` | Show the digests configured in this server. Config-file entries are marked 🔒. |
| `/trending unsubscribe id:<id>` | Remove a digest (autocompleted). |
| `/trending now period:<daily\|weekly\|monthly>` | Post one digest immediately, without scheduling it. |
| `/trending status` | Show every scheduled job and its next run. |

All commands answer ephemerally and require **Manage Server**.

## Schedules

Each `(subscription, period)` pair becomes one cron job. Without an explicit `cron`:

| Period | Default schedule | Meaning |
| --- | --- | --- |
| `daily` | `0 9 * * *` | every day at 09:00 |
| `weekly` | `0 9 * * 1` | every Monday at 09:00 |
| `monthly` | `0 9 1 * *` | the 1st of the month at 09:00 |

Times are interpreted in the subscription's `timezone` (defaults to `DEFAULT_TIMEZONE`, itself
defaulting to `UTC`). Setting `cron` overrides the schedule of **every** period of that
subscription; 5-field and 6-field (with seconds) expressions are both accepted.

## Configuration

### Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `DISCORD_TOKEN` | — | **Required.** Bot token. |
| `DATA_DIR` | `/data` | Where `subscriptions.json` is persisted. Mount it as a volume. |
| `CONFIG_PATH` | `/config/config.yaml` | Optional declarative config; ignored if absent. |
| `HEALTH_PORT` | `8080` | HTTP health endpoint; `0` disables it. |
| `LOG_LEVEL` | `info` | `trace` … `fatal`. |
| `LOG_PRETTY` | auto | `true` for human-readable logs (development). |
| `TZ` / `DEFAULT_TIMEZONE` | `UTC` | Time zone used by subscriptions that do not set one. |
| `DEFAULT_LIMIT` | `5` | Default repository count. |
| `DEFAULT_STYLE` | `embed` | `embed` or `compact`. |
| `DEV_GUILD_ID` | — | Register slash commands in this guild only (instant, for development). |
| `REGISTER_COMMANDS` | `true` | Set to `false` to skip publishing commands at boot. |

### Declarative file (optional)

See [`config.example.yaml`](config.example.yaml). Mount it at `CONFIG_PATH`:

```yaml
defaults:
  limit: 5
  timezone: Europe/Paris

subscriptions:
  - channelId: '111111111111111111'
    periods: [daily, weekly]
  - channelId: '222222222222222222'
    periods: [monthly]
    language: typescript
    limit: 3
    style: compact
```

Subscriptions from the file are re-applied at every boot and cannot be deleted from Discord;
subscriptions created with `/trending subscribe` live in `${DATA_DIR}/subscriptions.json`. Both
run side by side.

## Operating it

```bash
# liveness / next runs
curl -s localhost:8080/health | jq
# {"status":"ok","uptimeSeconds":42,"user":"GithubTrending#1234","guilds":1,
#  "subscriptions":2,"jobs":[{"key":"a1b2c3:daily","nextRun":"2026-08-28T07:00:00.000Z",…}]}
```

The image also exposes two one-shot commands, useful for verifying a deployment:

```bash
# validate config, store and renderer — no Discord connection, no secrets needed
docker run --rm ghcr.io/tonyctalope/github-trending-bot selfcheck
# ... and also scrape github.com/trending for real
docker run --rm ghcr.io/tonyctalope/github-trending-bot selfcheck --network

# post one digest right now, then exit (handy for an external cron)
docker run --rm --env-file .env ghcr.io/tonyctalope/github-trending-bot \
  post --period daily --channel 111111111111111111 --limit 5
```

## Development

```bash
npm ci
npm run dev            # tsx watch, pretty logs
npm run verify         # exactly what CI runs: format:check + lint + typecheck + test
npm test               # vitest (118 tests, offline: HTML fixtures)
npm run test:coverage
npm run lint
npm run format
npm run build && npm start
npm run canary         # scrape github.com/trending for real
```

### Layout

```
src/trending/    fetch + parse github.com/trending (no API exists for it)
src/config/      env, YAML file and zod schemas
src/store/       JSON persistence of the subscriptions created from Discord
src/discord/     client, slash commands, rendering, publishing
src/scheduler/   one croner job per (subscription, period)
src/bot.ts       wiring; src/index.ts CLI entrypoint
```

### Notes

- **GitHub has no trending API**, so the page is scraped. Selectors only rely on stable anchors
  (`article.Box-row`, `href` shapes, `itemprop`), never on utility classes, which GitHub renames
  often. A [scheduled canary workflow](.github/workflows/canary.yml) scrapes the real page daily so
  drift shows up as a red build rather than empty digests; unit tests use committed HTML fixtures
  and stay offline.
- **TypeScript is pinned to 6.x**, not 7.x: the latest `typescript-eslint` still declares
  `typescript <6.1.0`, and type-aware linting is worth more here than the newest compiler.

## Licence

[MIT](LICENSE)
