import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { ReportStore } from '../src/store/reports.js';
import { sliceKey, type TrendingReport } from '../src/trending/report.js';
import type { TrendingRepo } from '../src/trending/types.js';

let dir: string;
let store: ReportStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'trending-reports-'));
  store = ReportStore.fromDataDir(dir);
});

function repo(name: string): TrendingRepo {
  return {
    fullName: `owner/${name}`,
    owner: 'owner',
    name,
    url: `https://github.com/owner/${name}`,
    description: null,
    language: null,
    languageColor: null,
    stars: 10,
    forks: 1,
    periodStars: 5,
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

describe('ReportStore', () => {
  it('writes one file per period, key and slice', async () => {
    const path = await store.save(report());
    expect(path).toBe(join(dir, 'reports', 'daily', '2026-08-27.json'));

    const filtered = await store.save(report({ language: 'typescript' }));
    expect(filtered).toBe(join(dir, 'reports', 'daily', '2026-08-27__lang-typescript.json'));
  });

  it('reads back exactly what was written', async () => {
    await store.save(report({ repos: [repo('a'), repo('b')] }));
    const loaded = await store.get('daily', '2026-08-27');
    expect(loaded?.repos.map((r) => r.fullName)).toEqual(['owner/a', 'owner/b']);
    expect(loaded?.capturedAt).toBe('2026-08-27T23:45:00.000Z');
  });

  it('returns null for a key that was never captured', async () => {
    expect(await store.get('daily', '1999-01-01')).toBeNull();
    expect(await store.latest('weekly')).toBeNull();
  });

  it('keeps slices apart: the plain report never returns a filtered one', async () => {
    await store.save(report({ key: '2026-08-26' }));
    await store.save(report({ key: '2026-08-27', language: 'rust' }));

    expect(await store.keys('daily')).toEqual(['2026-08-26']);
    expect(await store.keys('daily', sliceKey('rust'))).toEqual(['2026-08-27']);
    expect((await store.latest('daily'))?.key).toBe('2026-08-26');
    expect((await store.latest('daily', sliceKey('rust')))?.language).toBe('rust');
  });

  it('latest is the newest key, whatever the write order', async () => {
    await store.save(report({ key: '2026-08-27' }));
    await store.save(report({ key: '2026-08-25' }));
    await store.save(report({ key: '2026-08-26' }));
    expect((await store.latest('daily'))?.key).toBe('2026-08-27');
  });

  it('previous is the capture just before a key', async () => {
    for (const key of ['2026-08-25', '2026-08-26', '2026-08-27']) {
      await store.save(report({ key }));
    }
    expect((await store.previous('daily', '2026-08-27'))?.key).toBe('2026-08-26');
    expect(await store.previous('daily', '2026-08-25')).toBeNull();
  });

  it('orders ISO weeks and months chronologically too', async () => {
    for (const key of ['2026-W08', '2026-W09', '2026-W10']) {
      await store.save(report({ period: 'weekly', key }));
    }
    expect((await store.latest('weekly'))?.key).toBe('2026-W10');
    expect((await store.previous('weekly', '2026-W10'))?.key).toBe('2026-W09');

    for (const key of ['2026-07', '2026-08']) {
      await store.save(report({ period: 'monthly', key }));
    }
    expect((await store.latest('monthly'))?.key).toBe('2026-08');
  });

  it('prunes the oldest captures, per slice', async () => {
    for (const day of ['25', '26', '27', '28']) {
      await store.save(report({ key: `2026-08-${day}` }));
      await store.save(report({ key: `2026-08-${day}`, language: 'go' }));
    }
    const removed = await store.prune({ daily: 2, weekly: 10, monthly: 10 });

    expect(removed).toBe(4);
    expect(await store.keys('daily')).toEqual(['2026-08-27', '2026-08-28']);
    expect(await store.keys('daily', sliceKey('go'))).toEqual(['2026-08-27', '2026-08-28']);
  });

  it('ignores a corrupted capture instead of crashing the digest', async () => {
    await mkdir(join(dir, 'reports', 'daily'), { recursive: true });
    await writeFile(join(dir, 'reports', 'daily', '2026-08-27.json'), '{"period":"daily"}', 'utf8');
    expect(await store.get('daily', '2026-08-27')).toBeNull();
  });

  it('writes valid JSON with a trailing newline', async () => {
    const path = await store.save(report());
    const raw = await readFile(path, 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
    expect(() => JSON.parse(raw) as unknown).not.toThrow();
  });
});
