# github-trending-bot

[![CI](https://github.com/tonyctalope/github-trending-bot/actions/workflows/ci.yml/badge.svg)](https://github.com/tonyctalope/github-trending-bot/actions/workflows/ci.yml)
[![image](https://img.shields.io/badge/ghcr.io-github--trending--bot-2496ed?logo=docker&logoColor=white)](https://github.com/tonyctalope/github-trending-bot/pkgs/container/github-trending-bot)
[![licence](https://img.shields.io/badge/licence-MIT-green.svg)](LICENSE)

A Discord bot that posts [GitHub trending](https://github.com/trending) digests for **closed
calendar periods** — the day, week or month that just ended — in **one or several channels**, each
with its own filters and cadence.

Everything is configurable from Discord with slash commands, or declaratively through a YAML file.
Run it with `docker run` and you are done.

```
📅 GitHub Trending · Thursday 27 August 2026
🥇 tt-a1i/archify · ⭐ 22,692 · +4,260 today · JavaScript · (↑3)
> Agent skill for beautiful, verifiable architecture diagrams
🥈 freestylefly/awesome-gpt-image-2 · ⭐ 22,904 · +2,093 today · JavaScript · (new)
> Prompt as Code | GPT-Image2 prompt engine
🥉 …
─ github.com/trending · captured 27 Aug, 23:45 UTC · 12 repositories
```

## Features

- **Closed periods, not a partial snapshot**: the trending page is frozen at the end of each period
  and delivered afterwards, so a morning digest describes yesterday, complete. See
  [What "daily" actually means](#what-daily-actually-means).
- **Rank movements** against the previous capture: `(new)`, `(↑3)`, `(↓2)`.
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

# the image runs as uid 1000; see "Volume permissions" if your user is not 1000
docker run -d --name github-trending-bot --restart unless-stopped \
  --env-file .env -e TZ=Europe/Paris \
  -v "$PWD/data:/data" \
  ghcr.io/tonyctalope/github-trending-bot:latest
```

### Volume permissions

The container runs as the unprivileged `node` user, **uid 1000**. A bind mount keeps
the ownership it has on the host, so when your host account is not uid 1000 the bot can
read `/data` but not write to it. Pick one:

```bash
sudo chown -R 1000:1000 ./data          # give the mount to the image user
# ... or run the container as yourself instead
docker run --user "$(id -u):$(id -g)" …  # `user: "$(id -u):$(id -g)"` in compose
```

The bot checks this at boot and refuses to start with the exact command to run, rather
than looking healthy and failing later at the first capture. `selfcheck` reports it too.

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
| `/trending subscribe period:<daily\|weekly\|monthly\|all>` | Schedule a digest. Options: `channel`, `language`, `spoken_language`, `limit`, `cron`, `timezone`, `style`, `mode`. Defaults to the current channel. |
| `/trending list` | Show the digests configured in this server. Config-file entries are marked 🔒. |
| `/trending unsubscribe id:<id>` | Remove a digest (autocompleted). |
| `/trending now period:<daily\|weekly\|monthly>` | Post one digest immediately, without scheduling it. `source:live` for the current snapshot instead of the last closed period. |
| `/trending status` | Show every scheduled job — digests and boundary captures — with its next run. |

All commands answer ephemerally and require **Manage Server**.

## What "daily" actually means

GitHub publishes no trending API, and the `stars today` figure on the trending page is **not** a
live counter for the calendar day: it is recomputed in batch, only a few times a day, over a rolling
window GitHub does not document. Measured on 27 August 2026, between 17:05 and 19:45 UTC:

| | moved in 2 h 40 |
| --- | --- |
| total star counts | **18 / 18** |
| `stars today` counters | **1 / 18** |

So reading the page at 09:00 shows a partial day, and reading it at 23:59 still shows a figure that
may be hours old. The public report sites work around this the same way: they capture the page and
archive it under a date — `stars today` values on `reporadar.spreix.com/reports` match GitHub's to
the digit.

This bot does that, on your side:

1. **A boundary capture freezes the page** at the end of every period (23:45 UTC daily, Sunday
   23:50 UTC weekly, the last day of the month 23:55 UTC), storing it in `${DATA_DIR}/reports/`.
2. **Your subscription delivers that frozen capture** on your own schedule — 09:00 the next morning
   by default — titled with the period it describes, plus rank movements against the previous one.

Set `mode: live` on a subscription to get the old behaviour instead: GitHub's current rolling
snapshot, titled `🔥 GitHub Trending · Daily`.

## Schedules

Each `(subscription, period)` pair becomes one cron job. Without an explicit `cron`:

| Period | Default delivery | Boundary capture (UTC) |
| --- | --- | --- |
| `daily` | `0 9 * * *` — every day at 09:00 | `45 23 * * *` |
| `weekly` | `0 9 * * 1` — every Monday at 09:00 | `50 23 * * 0` (Sunday) |
| `monthly` | `0 9 1 * *` — the 1st at 09:00 | `55 23 28-31 * *` (acts on the last day only) |

Delivery times are interpreted in the subscription's `timezone` (defaults to `DEFAULT_TIMEZONE`,
itself defaulting to `UTC`); captures always run in `CAPTURE_TIMEZONE` (`UTC`) so the calendar keys
(`2026-08-27`, `2026-W35`, `2026-08`) mean the same thing for everyone. Setting `cron` overrides the
delivery schedule of **every** period of that subscription; 5-field and 6-field (with seconds)
expressions are both accepted.

If a period has no capture yet — first run, or the bot was down at the boundary — the digest is
still posted from a capture taken on the spot and flagged `⚠ partial capture` in the footer. Set
`onMissingReport: skip` to stay silent until a real boundary capture exists.

## Configuration

### Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `DISCORD_TOKEN` | — | **Required.** Bot token. |
| `DATA_DIR` | `/data` | Where `subscriptions.json` and `reports/` are persisted. Mount it as a volume. |
| `CONFIG_PATH` | `/config/config.yaml` | Optional declarative config; ignored if absent. |
| `HEALTH_PORT` | `8080` | HTTP health endpoint; `0` disables it. |
| `LOG_LEVEL` | `info` | `trace` … `fatal`. |
| `LOG_PRETTY` | auto | `true` for human-readable logs (development). |
| `TZ` / `DEFAULT_TIMEZONE` | `UTC` | Time zone used by subscriptions that do not set one. |
| `DEFAULT_LIMIT` | `5` | Default repository count. |
| `DEFAULT_STYLE` | `embed` | `embed` or `compact`. |
| `DEFAULT_MODE` | `report` | `report` (closed period) or `live` (current snapshot). |
| `CAPTURE_ENABLED` | `true` | Set to `false` to stop freezing periods (only useful with `mode: live`). |
| `CAPTURE_TIMEZONE` | `UTC` | Time zone of the boundary captures. |
| `CAPTURE_CRON_DAILY` | `45 23 * * *` | When the day is frozen. |
| `CAPTURE_CRON_WEEKLY` | `50 23 * * 0` | When the week is frozen. |
| `CAPTURE_CRON_MONTHLY` | `55 23 28-31 * *` | Fires every late-month night; acts on the last day. |
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
  - channelId: '333333333333333333'
    periods: [daily]
    mode: live # what is hot right now, instead of yesterday closed
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
docker run --rm --env-file .env -v "$PWD/data:/data" \
  ghcr.io/tonyctalope/github-trending-bot \
  post --period daily --channel 111111111111111111 --limit 5
# ... the current snapshot instead of the last closed period
docker run --rm --env-file .env ghcr.io/tonyctalope/github-trending-bot \
  post --period daily --channel 111111111111111111 --source live

# freeze a period by hand (--force captures outside the boundary)
docker run --rm -v "$PWD/data:/data" ghcr.io/tonyctalope/github-trending-bot \
  capture --period daily --force
```

### Data layout

```
/data/subscriptions.json                            created with /trending subscribe
/data/reports/daily/2026-08-27.json                 frozen captures, one per period …
/data/reports/daily/2026-08-27__lang-rust.json      … and per filter
/data/reports/weekly/2026-W35.json
/data/reports/monthly/2026-08.json
```

Captures are pruned automatically (120 daily, 78 weekly, 60 monthly per filter).

## Development

```bash
npm ci
npm run dev            # tsx watch, pretty logs
npm run verify         # exactly what CI runs: format:check + lint + typecheck + test
npm test               # vitest (199 tests, offline: HTML fixtures)
npm run test:coverage
npm run lint
npm run format
npm run build && npm start
npm run canary         # scrape github.com/trending for real
```

### Layout

```
src/trending/    fetch + parse github.com/trending, period keys, period captures
src/config/      env, YAML file and zod schemas
src/store/       JSON persistence: subscriptions + frozen period captures
src/discord/     client, slash commands, rendering, publishing
src/scheduler/   one croner job per (subscription, period), plus boundary captures
src/capture.ts   what to freeze, and when
src/delivery.ts  turns a due job into a post: frozen capture or live snapshot
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
