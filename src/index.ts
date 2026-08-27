import { parseArgs } from 'node:util';
import { createRequire } from 'node:module';
import { Events } from 'discord.js';
import { Bot } from './bot.js';
import { loadEnv, type Env } from './config/env.js';
import { loadConfigFile } from './config/file.js';
import { subscriptionSchema, type Subscription } from './config/schema.js';
import { createClient } from './discord/client.js';
import { publishTrending } from './discord/publish.js';
import { startHealthServer } from './health.js';
import { logger } from './logger.js';
import { selfcheck } from './selfcheck.js';
import { SubscriptionStore } from './store/subscriptions.js';
import { isPeriod } from './trending/types.js';

function version(): string {
  try {
    const require = createRequire(import.meta.url);
    return (require('../package.json') as { version?: string }).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

const HELP = `github-trending-bot ${version()}

Usage:
  github-trending-bot                 start the bot (scheduler + slash commands)
  github-trending-bot post            post one digest immediately, then exit
  github-trending-bot selfcheck       verify config, store and renderer without Discord

Options:
  --period <daily|weekly|monthly>     period to post          (post)
  --channel <id>                      target channel id       (post)
  --limit <n>                         repositories to include (post, default 5)
  --language <slug>                   language filter         (post)
  --style <embed|compact>             message style           (post, default embed)
  --network                           also scrape GitHub      (selfcheck)
  -h, --help                          show this help
  -v, --version                       show the version

Environment: DISCORD_TOKEN (required), CONFIG_PATH, DATA_DIR, HEALTH_PORT,
LOG_LEVEL, LOG_PRETTY, TZ, DEV_GUILD_ID, REGISTER_COMMANDS.
`;

function requireToken(env: Env): string {
  if (!env.DISCORD_TOKEN) {
    throw new Error('DISCORD_TOKEN is required — see README.md for how to create the bot');
  }
  return env.DISCORD_TOKEN;
}

async function runPost(
  env: Env,
  values: Record<string, string | boolean | undefined>,
): Promise<number> {
  const period = typeof values.period === 'string' ? values.period : '';
  const channelId = typeof values.channel === 'string' ? values.channel : '';
  if (!isPeriod(period)) throw new Error('--period must be daily, weekly or monthly');
  if (!/^\d{17,20}$/.test(channelId)) throw new Error('--channel must be a Discord channel id');

  const draft: Subscription = subscriptionSchema.parse({
    id: 'cli',
    channelId,
    periods: [period],
    limit: typeof values.limit === 'string' ? Number.parseInt(values.limit, 10) : undefined,
    language: typeof values.language === 'string' ? values.language : null,
    style: typeof values.style === 'string' ? values.style : undefined,
  });

  const client = createClient();
  const token = requireToken(env);
  await new Promise<void>((resolve, reject) => {
    client.once(Events.ClientReady, () => {
      resolve();
    });
    client.once(Events.Error, reject);
    client.login(token).catch(reject);
  });

  try {
    const message = await publishTrending(client, draft, period);
    logger.info({ url: message.url, channelId, period }, 'digest posted');
    return 0;
  } finally {
    await client.destroy();
  }
}

async function runBot(env: Env): Promise<void> {
  const token = requireToken(env);
  const store = SubscriptionStore.fromDataDir(env.DATA_DIR, logger);
  await store.load();
  const config = await loadConfigFile(env.CONFIG_PATH, env);
  logger.info(
    {
      configFile: config.found ? config.path : null,
      managed: config.subscriptions.length,
      stored: store.list().length,
    },
    'configuration loaded',
  );

  const bot = new Bot({ env, store, managed: config.subscriptions, logger });
  const health = startHealthServer(env.HEALTH_PORT, () => bot.healthStatus(), logger);

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    health?.close();
    void bot.stop().finally(() => {
      process.exit(0);
    });
  };
  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });

  await bot.start(token);
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
      period: { type: 'string' },
      channel: { type: 'string' },
      limit: { type: 'string' },
      language: { type: 'string' },
      style: { type: 'string' },
      network: { type: 'boolean' },
    },
  });

  if (values.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (values.version) {
    process.stdout.write(`${version()}\n`);
    return 0;
  }

  const command = positionals[0] ?? 'run';
  if (command === 'selfcheck') {
    return selfcheck({ network: values.network === true });
  }

  const env = loadEnv();
  if (command === 'post') return runPost(env, values);
  if (command !== 'run') throw new Error(`unknown command "${command}" — try --help`);

  await runBot(env);
  return -1; // the bot keeps running until a signal arrives
}

main()
  .then((code) => {
    if (code >= 0) process.exit(code);
  })
  .catch((error: unknown) => {
    logger.error({ err: error }, 'fatal error');
    process.exit(1);
  });
