import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pino } from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Bot } from '../src/bot.js';
import { loadEnv } from '../src/config/env.js';
import { subscriptionSchema } from '../src/config/schema.js';
import { ReportStore } from '../src/store/reports.js';
import { SubscriptionStore } from '../src/store/subscriptions.js';

const channelId = '123456789012345678';
let bot: Bot;
let reports: ReportStore;

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'trending-bot-'));
  const store = SubscriptionStore.fromDataDir(dir);
  await store.load();
  await store.add({ channelId, periods: ['daily'] });
  reports = ReportStore.fromDataDir(dir);

  bot = new Bot({
    env: loadEnv({}),
    store,
    reports,
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
      latestCaptures: { daily: null, weekly: null, monthly: null },
    });
  });

  it('schedules one boundary capture per period, in UTC', () => {
    const plans = bot.capturePlans();
    expect(plans.map((plan) => plan.period)).toEqual(['daily', 'weekly', 'monthly']);
    expect(plans.map((plan) => plan.cron)).toEqual([
      '45 23 * * *',
      '50 23 * * 0',
      '55 23 28-31 * *',
    ]);
    expect(new Set(plans.map((plan) => plan.timezone))).toEqual(new Set(['UTC']));
  });

  it('drops the captures when they are disabled', async () => {
    const store = SubscriptionStore.fromDataDir(await mkdtemp(join(tmpdir(), 'trending-bot-')));
    await store.load();
    const disabled = new Bot({
      env: loadEnv({ CAPTURE_ENABLED: 'false' }),
      store,
      reports,
      managed: [],
      logger: pino({ level: 'silent' }),
    });
    expect(disabled.capturePlans()).toEqual([]);
    await disabled.stop();
  });

  it('shows the captures already on disk right after a restart', async () => {
    await reports.save({
      period: 'daily',
      key: '2026-08-27',
      capturedAt: '2026-08-27T23:45:00.000Z',
      url: 'https://github.com/trending?since=daily',
      language: null,
      spokenLanguage: null,
      partial: false,
      repos: [],
    });

    await bot.primeCaptureCache();
    expect(bot.healthStatus().latestCaptures).toMatchObject({ daily: '2026-08-27', weekly: null });
  });

  it('exposes the scheduled jobs in the health payload', () => {
    bot.scheduler.sync(bot.subscriptions());
    bot.scheduler.syncCaptures(bot.capturePlans());
    const status = bot.healthStatus();
    expect(status.jobs).toHaveLength(5); // 2 subscriptions + 3 boundary captures
    expect(status.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });
});
