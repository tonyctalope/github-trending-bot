import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pino } from 'pino';
import type { Client, Message } from 'discord.js';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { Deliverer } from '../src/delivery.js';
import { ReportStore } from '../src/store/reports.js';
import { subscriptionSchema, type Subscription } from '../src/config/schema.js';
import { sliceKey, type TrendingReport } from '../src/trending/report.js';
import type { Period, TrendingRepo } from '../src/trending/types.js';

const channelId = '123456789012345678';
const client = {} as unknown as Client;
const logger = pino({ level: 'silent' });

function repo(name: string): TrendingRepo {
  return {
    fullName: `owner/${name}`,
    owner: 'owner',
    name,
    url: `https://github.com/owner/${name}`,
    description: null,
    language: null,
    languageColor: null,
    stars: 42,
    forks: 1,
    periodStars: 7,
    builtBy: [],
  };
}

function report(overrides: Partial<TrendingReport> = {}): TrendingReport {
  return {
    period: 'daily',
    key: '2026-08-27',
    capturedAt: '2026-08-27T23:45:00.000Z',
    url: 'https://github.com/trending?since=daily',
    language: null,
    spokenLanguage: null,
    partial: false,
    repos: [repo('a')],
    ...overrides,
  };
}

function subscription(overrides: Partial<Subscription> = {}): Subscription {
  return subscriptionSchema.parse({ id: 'sub', channelId, periods: ['daily'], ...overrides });
}

const message = { url: 'https://discord.com/channels/1/2/3' } as unknown as Message;

type PublishReportFn = (
  client: Client,
  subscription: Subscription,
  report: TrendingReport,
  previous?: TrendingReport | null,
) => Promise<Message>;
type PublishLiveFn = (
  client: Client,
  subscription: Subscription,
  period: Period,
) => Promise<Message>;

let store: ReportStore;
let publishReport: Mock<PublishReportFn>;
let publishLive: Mock<PublishLiveFn>;

beforeEach(async () => {
  store = ReportStore.fromDataDir(await mkdtemp(join(tmpdir(), 'trending-delivery-')));
  publishReport = vi.fn(() => Promise.resolve(message));
  publishLive = vi.fn(() => Promise.resolve(message));
});

function deliverer(extra: Record<string, unknown> = {}): Deliverer {
  return new Deliverer(store, logger, { publishReport, publishLive, ...extra });
}

describe('Deliverer — report mode', () => {
  it('posts the frozen capture of the closed period', async () => {
    await store.save(report());

    const result = await deliverer().deliver(client, subscription(), 'daily');

    expect(result.posted).toBe(true);
    expect(result.report?.key).toBe('2026-08-27');
    expect(publishLive).not.toHaveBeenCalled();
    const [, , posted] = publishReport.mock.calls[0] as [unknown, unknown, TrendingReport];
    expect(posted.key).toBe('2026-08-27');
  });

  it('passes the previous capture so ranks can be compared', async () => {
    await store.save(report({ key: '2026-08-26' }));
    await store.save(report({ key: '2026-08-27' }));

    await deliverer().deliver(client, subscription(), 'daily');

    const [, , current, previous] = publishReport.mock.calls[0] as [
      unknown,
      unknown,
      TrendingReport,
      TrendingReport | null,
    ];
    expect(current.key).toBe('2026-08-27');
    expect(previous?.key).toBe('2026-08-26');
  });

  it('reads the capture of the matching filter, not the plain one', async () => {
    await store.save(report({ key: '2026-08-27' }));
    await store.save(report({ key: '2026-08-27', language: 'rust', repos: [repo('rusty')] }));

    await deliverer().deliver(client, subscription({ language: 'rust' }), 'daily');

    const [, , posted] = publishReport.mock.calls[0] as [unknown, unknown, TrendingReport];
    expect(posted.language).toBe('rust');
    expect(posted.repos[0]?.fullName).toBe('owner/rusty');
  });

  it('takes a partial capture when nothing is stored yet, and says so', async () => {
    const capture = vi.fn(() => Promise.resolve(report({ key: '2026-08-28' })));

    const result = await deliverer({ capture }).deliver(client, subscription(), 'daily');

    expect(capture).toHaveBeenCalled();
    expect(result.posted).toBe(true);
    expect(result.report?.partial).toBe(true);
    // and it is persisted, so the next delivery has a previous capture
    expect((await store.latest('daily'))?.partial).toBe(true);
  });

  it('stays silent instead of posting an approximation when asked to', async () => {
    const capture = vi.fn(() => Promise.resolve(report()));

    const result = await deliverer({ capture }).deliver(
      client,
      subscription({ onMissingReport: 'skip' }),
      'daily',
    );

    expect(result.posted).toBe(false);
    expect(result.reason).toMatch(/no daily capture stored yet/);
    expect(capture).not.toHaveBeenCalled();
    expect(publishReport).not.toHaveBeenCalled();
  });

  it('does not mix periods: a weekly job never posts the daily capture', async () => {
    await store.save(report({ period: 'daily', key: '2026-08-27' }));

    const result = await deliverer().deliver(
      client,
      subscription({ periods: ['weekly'], onMissingReport: 'skip' }),
      'weekly',
    );

    expect(result.posted).toBe(false);
  });
});

describe('Deliverer — live mode', () => {
  it('posts GitHub current snapshot and touches no capture', async () => {
    const result = await deliverer().deliver(client, subscription({ mode: 'live' }), 'daily');

    expect(result.posted).toBe(true);
    expect(publishLive).toHaveBeenCalled();
    expect(publishReport).not.toHaveBeenCalled();
    expect(result.report).toBeUndefined();
    expect(await store.keys('daily')).toEqual([]);
  });

  it('propagates a publishing failure to the caller', async () => {
    publishLive.mockImplementation(() => Promise.reject(new Error('missing permission')));
    await expect(
      deliverer().deliver(client, subscription({ mode: 'live' }), 'daily'),
    ).rejects.toThrow(/missing permission/);
  });
});

describe('Deliverer — slice keys', () => {
  it('sanitises filters that are not filesystem-safe', () => {
    expect(sliceKey('rust')).toBe('__lang-rust');
    expect(sliceKey(null, 'FR')).toBe('__spoken-fr');
    expect(sliceKey(null, null)).toBe('');
    expect(sliceKey('Jupyter Notebook')).toBe('__lang-jupyter_20notebook');
    expect(sliceKey('rust', 'fr')).toBe('__lang-rust__spoken-fr');
  });

  it('never files two different filters under the same name', () => {
    const keys = ['c++', 'c#', 'c', 'f#', 'f*', 'objective-c++', 'jupyter notebook'].map(
      (language) => sliceKey(language),
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('keeps the file name usable on disk', () => {
    for (const language of ['c++', 'c#', 'jupyter notebook', 'vim script']) {
      expect(sliceKey(language)).toMatch(/^__lang-[a-z0-9._-]+$/);
    }
  });
});
