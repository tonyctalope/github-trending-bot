import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { captureSlicesFor, runCapture } from '../src/capture.js';
import { ReportStore } from '../src/store/reports.js';
import { subscriptionSchema, type Subscription } from '../src/config/schema.js';
import { sliceKey } from '../src/trending/report.js';
import type { TrendingRepo } from '../src/trending/types.js';

const channelId = '123456789012345678';

function subscription(overrides: Partial<Subscription> = {}): Subscription {
  return subscriptionSchema.parse({ id: 'sub', channelId, periods: ['daily'], ...overrides });
}

const repos: TrendingRepo[] = [
  {
    fullName: 'owner/repo',
    owner: 'owner',
    name: 'repo',
    url: 'https://github.com/owner/repo',
    description: null,
    language: null,
    languageColor: null,
    stars: 100,
    forks: 2,
    periodStars: 30,
    builtBy: [],
  },
];

describe('captureSlicesFor', () => {
  it('always includes the unfiltered page', () => {
    expect(captureSlicesFor([], 'daily')).toEqual([{ language: null, spokenLanguage: null }]);
  });

  it('adds one slice per distinct filter, deduplicated', () => {
    const slices = captureSlicesFor(
      [
        subscription({ id: 'a', language: 'rust' }),
        subscription({ id: 'b', language: 'rust' }),
        subscription({ id: 'c', language: 'go' }),
        subscription({ id: 'd', spokenLanguage: 'fr' }),
      ],
      'daily',
    );
    expect(slices).toHaveLength(4); // plain + rust + go + fr
    expect(slices).toEqual(
      expect.arrayContaining([
        { language: 'rust', spokenLanguage: null },
        { language: 'go', spokenLanguage: null },
        { language: null, spokenLanguage: 'fr' },
      ]) as unknown[],
    );
  });

  it('ignores subscriptions of another period', () => {
    const slices = captureSlicesFor(
      [subscription({ periods: ['weekly'], language: 'zig' })],
      'daily',
    );
    expect(slices).toEqual([{ language: null, spokenLanguage: null }]);
  });

  it('ignores live subscriptions: nothing is frozen for them', () => {
    const slices = captureSlicesFor([subscription({ mode: 'live', language: 'zig' })], 'daily');
    expect(slices).toEqual([{ language: null, spokenLanguage: null }]);
  });
});

describe('runCapture', () => {
  let store: ReportStore;

  beforeEach(async () => {
    store = ReportStore.fromDataDir(await mkdtemp(join(tmpdir(), 'trending-capture-')));
  });

  const slices = [{ language: null, spokenLanguage: null }];
  const capture = () => vi.fn(() => Promise.resolve(repos));

  it('freezes the day and files it under the UTC date', async () => {
    const fetchRepos = capture();
    const result = await runCapture(store, 'daily', slices, {
      now: () => new Date('2026-08-27T23:45:00Z'),
      capture: async (query, deps) => ({
        period: query.period,
        key: '2026-08-27',
        capturedAt: deps?.now?.().toISOString() ?? '',
        url: 'https://github.com/trending?since=daily',
        language: null,
        spokenLanguage: null,
        partial: false,
        repos: await fetchRepos(),
      }),
    });

    expect(result.skipped).toBe(false);
    expect(result.saved).toHaveLength(1);
    expect((await store.latest('daily'))?.key).toBe('2026-08-27');
    expect((await store.latest('daily'))?.capturedAt).toBe('2026-08-27T23:45:00.000Z');
  });

  it('skips a weekly capture on a Thursday and runs it on Sunday', async () => {
    const thursday = await runCapture(store, 'weekly', slices, {
      now: () => new Date('2026-08-27T23:50:00Z'),
    });
    expect(thursday.skipped).toBe(true);
    expect(await store.latest('weekly')).toBeNull();

    const sunday = await runCapture(store, 'weekly', slices, {
      now: () => new Date('2026-08-30T23:50:00Z'),
      capture: (query, deps) =>
        Promise.resolve({
          period: query.period,
          key: '2026-W35',
          capturedAt: deps?.now?.().toISOString() ?? '',
          url: 'x',
          language: null,
          spokenLanguage: null,
          partial: false,
          repos,
        }),
    });
    expect(sunday.skipped).toBe(false);
    expect((await store.latest('weekly'))?.key).toBe('2026-W35');
  });

  it('only captures a month on its last day', async () => {
    const notYet = await runCapture(store, 'monthly', slices, {
      now: () => new Date('2026-08-30T23:55:00Z'),
    });
    expect(notYet.skipped).toBe(true);

    const lastDay = await runCapture(store, 'monthly', slices, {
      now: () => new Date('2026-08-31T23:55:00Z'),
      capture: (query) =>
        Promise.resolve({
          period: query.period,
          key: '2026-08',
          capturedAt: '2026-08-31T23:55:00.000Z',
          url: 'x',
          language: null,
          spokenLanguage: null,
          partial: false,
          repos,
        }),
    });
    expect(lastDay.skipped).toBe(false);
  });

  it('force captures outside the boundary, for a manual run', async () => {
    const result = await runCapture(store, 'weekly', slices, {
      force: true,
      now: () => new Date('2026-08-27T12:00:00Z'),
      capture: (query) =>
        Promise.resolve({
          period: query.period,
          key: '2026-W35',
          capturedAt: '2026-08-27T12:00:00.000Z',
          url: 'x',
          language: null,
          spokenLanguage: null,
          partial: false,
          repos,
        }),
    });
    expect(result.skipped).toBe(false);
    expect(result.saved).toHaveLength(1);
  });

  it('marks a forced capture partial, and a scheduled one complete', async () => {
    const stub = (query: { period: 'daily' | 'weekly' | 'monthly' }) =>
      Promise.resolve({
        period: query.period,
        key: '2026-08-27',
        capturedAt: '2026-08-27T15:00:00.000Z',
        url: 'x',
        language: null,
        spokenLanguage: null,
        partial: false,
        repos,
      });

    const forced = await runCapture(store, 'daily', slices, {
      force: true,
      now: () => new Date('2026-08-27T15:00:00Z'),
      capture: stub,
    });
    expect(forced.saved[0]?.partial).toBe(true);
    expect((await store.latest('daily'))?.partial).toBe(true);

    // the nightly job then overwrites the same key with a complete capture
    const scheduled = await runCapture(store, 'daily', slices, {
      now: () => new Date('2026-08-27T23:45:00Z'),
      capture: stub,
    });
    expect(scheduled.saved[0]?.partial).toBe(false);
    expect((await store.latest('daily'))?.partial).toBe(false);
  });

  it('captures every slice and keeps them in separate files', async () => {
    const result = await runCapture(
      store,
      'daily',
      [
        { language: null, spokenLanguage: null },
        { language: 'rust', spokenLanguage: null },
      ],
      {
        now: () => new Date('2026-08-27T23:45:00Z'),
        capture: (query) =>
          Promise.resolve({
            period: query.period,
            key: '2026-08-27',
            capturedAt: '2026-08-27T23:45:00.000Z',
            url: 'x',
            language: query.language ?? null,
            spokenLanguage: null,
            partial: false,
            repos,
          }),
      },
    );

    expect(result.saved).toHaveLength(2);
    expect((await store.latest('daily'))?.language).toBeNull();
    expect((await store.latest('daily', sliceKey('rust')))?.language).toBe('rust');
  });

  it('records a failing slice without losing the others', async () => {
    const result = await runCapture(
      store,
      'daily',
      [
        { language: null, spokenLanguage: null },
        { language: 'unknown-lang', spokenLanguage: null },
      ],
      {
        now: () => new Date('2026-08-27T23:45:00Z'),
        capture: (query) =>
          query.language
            ? Promise.reject(new Error('no repository parsed'))
            : Promise.resolve({
                period: query.period,
                key: '2026-08-27',
                capturedAt: '2026-08-27T23:45:00.000Z',
                url: 'x',
                language: null,
                spokenLanguage: null,
                partial: false,
                repos,
              }),
      },
    );

    expect(result.saved).toHaveLength(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.message).toMatch(/no repository parsed/);
  });
});
