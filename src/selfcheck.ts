import type { APIEmbed } from 'discord.js';
import { loadEnv } from './config/env.js';
import { loadConfigFile } from './config/file.js';
import { DEFAULT_CRON, isValidCron } from './config/schema.js';
import { SubscriptionStore } from './store/subscriptions.js';
import { renderTrending, EMBED_DESCRIPTION_LIMIT } from './discord/render.js';
import { fetchTrending } from './trending/client.js';
import { PERIODS, type TrendingRepo } from './trending/types.js';

const SAMPLE_REPOS: TrendingRepo[] = [
  {
    fullName: 'tonyctalope/github-trending-bot',
    owner: 'tonyctalope',
    name: 'github-trending-bot',
    url: 'https://github.com/tonyctalope/github-trending-bot',
    description: 'Discord bot posting GitHub trending repositories',
    language: 'TypeScript',
    languageColor: '#3178c6',
    stars: 1234,
    forks: 56,
    periodStars: 78,
    builtBy: ['tonyctalope'],
  },
  {
    fullName: 'sample/no-description',
    owner: 'sample',
    name: 'no-description',
    url: 'https://github.com/sample/no-description',
    description: null,
    language: null,
    languageColor: null,
    stars: 9,
    forks: 0,
    periodStars: null,
    builtBy: [],
  },
];

function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

/**
 * Boot-time verification that does not need Discord credentials: every stage
 * except the gateway connection is exercised, so a built image can prove itself
 * in CI and right after a deploy.
 */
export async function selfcheck(options: { network: boolean }): Promise<number> {
  let failures = 0;
  const fail = (message: string): void => {
    failures += 1;
    out(`✖ ${message}`);
  };

  const env = loadEnv();
  out(
    `✔ environment parsed (data=${env.DATA_DIR} config=${env.CONFIG_PATH} health=${String(env.HEALTH_PORT)})`,
  );
  out(
    `${env.DISCORD_TOKEN ? '✔' : '·'} DISCORD_TOKEN ${env.DISCORD_TOKEN ? 'present' : 'absent (fine for selfcheck, required to run)'}`,
  );

  const config = await loadConfigFile(env.CONFIG_PATH, env);
  out(
    config.found
      ? `✔ config file ${config.path}: ${String(config.subscriptions.length)} managed subscription(s)`
      : `· no config file at ${config.path} (slash commands only)`,
  );

  const store = SubscriptionStore.fromDataDir(env.DATA_DIR);
  await store.load();
  out(`✔ store ${store.file}: ${String(store.list().length)} subscription(s)`);

  for (const period of PERIODS) {
    if (!isValidCron(DEFAULT_CRON[period])) fail(`default cron for ${period} is invalid`);
  }
  out(`✔ default schedules valid (${PERIODS.map((p) => `${p}="${DEFAULT_CRON[p]}"`).join(' ')})`);

  const rendered = renderTrending({
    period: 'daily',
    repos: SAMPLE_REPOS,
    limit: 10,
    style: 'embed',
  });
  const embed = rendered.embeds?.[0];
  const data: APIEmbed | undefined =
    embed && typeof embed === 'object' && 'toJSON' in embed ? embed.toJSON() : embed;
  const description = data?.description ?? '';
  if (description.length === 0) fail('embed renderer produced an empty description');
  if (description.length > EMBED_DESCRIPTION_LIMIT) fail('embed description exceeds Discord limit');
  if (!description.includes('github.com/tonyctalope/github-trending-bot')) {
    fail('embed description does not link the repositories');
  }
  out(
    `✔ embed rendered (${String(description.length)} chars, ${String(SAMPLE_REPOS.length)} repos)`,
  );

  if (options.network) {
    try {
      const repos = await fetchTrending({ period: 'daily' });
      out(
        `✔ github.com/trending reachable: ${String(repos.length)} repos, top = ${repos[0]?.fullName ?? '?'}`,
      );
    } catch (cause) {
      fail(`scraping github.com/trending failed: ${(cause as Error).message}`);
    }
  } else {
    out('· network check skipped (pass --network to scrape github.com/trending)');
  }

  out(failures === 0 ? 'selfcheck: OK' : `selfcheck: ${String(failures)} failure(s)`);
  return failures === 0 ? 0 : 1;
}
