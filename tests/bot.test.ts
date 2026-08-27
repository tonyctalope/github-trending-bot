import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pino } from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Bot } from '../src/bot.js';
import { loadEnv } from '../src/config/env.js';
import { subscriptionSchema } from '../src/config/schema.js';
import { SubscriptionStore } from '../src/store/subscriptions.js';

const channelId = '123456789012345678';
let bot: Bot;

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'trending-bot-'));
  const store = SubscriptionStore.fromDataDir(dir);
  await store.load();
  await store.add({ channelId, periods: ['daily'] });

  bot = new Bot({
    env: loadEnv({}),
    store,
    managed: [
      subscriptionSchema.parse({
        id: 'file-1',
        channelId,
        periods: ['weekly'],
        managed: true,
      }),
    ],
    logger: pino({ level: 'silent' }),
  });
});

afterEach(async () => {
  await bot.stop();
});

describe('Bot', () => {
  it('merges config-file and stored subscriptions, config first', () => {
    const subscriptions = bot.subscriptions();
    expect(subscriptions).toHaveLength(2);
    expect(subscriptions[0]?.managed).toBe(true);
    expect(subscriptions[1]?.managed).toBe(false);
  });

  it('reports "starting" until Discord says ready', () => {
    expect(bot.healthStatus()).toMatchObject({
      status: 'starting',
      user: null,
      guilds: 0,
      subscriptions: 2,
      jobs: [],
    });
  });

  it('exposes the scheduled jobs in the health payload', () => {
    bot.scheduler.sync(bot.subscriptions());
    const status = bot.healthStatus();
    expect(status.jobs).toHaveLength(2);
    expect(status.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });
});
