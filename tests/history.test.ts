import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { HistoryStore } from '../src/store/history.js';
import type { Period } from '../src/trending/types.js';

let dir: string;
let history: HistoryStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'trending-history-'));
  history = HistoryStore.fromDataDir(dir);
});

async function record(id: string, key: string, repos: string[], period: Period = 'daily') {
  await history.record(id, { period, key, postedAt: `${key}T09:00:00.000Z`, repos });
}

describe('HistoryStore', () => {
  it('remembers nothing for a subscription that never posted', async () => {
    expect(await history.recent('unknown', 'daily', 7)).toEqual(new Set());
  });

  it('returns the repositories of the last N digests', async () => {
    await record('sub', '2026-08-27', ['a/a']);
    await record('sub', '2026-08-28', ['b/b']);
    await record('sub', '2026-08-29', ['c/c']);

    expect(await history.recent('sub', 'daily', 2)).toEqual(new Set(['b/b', 'c/c']));
    expect(await history.recent('sub', 'daily', 7)).toEqual(new Set(['a/a', 'b/b', 'c/c']));
  });

  it('remembers every repository of a multi-repo digest', async () => {
    await record('sub', '2026-08-27', ['a/a', 'b/b', 'c/c']);
    expect(await history.recent('sub', 'daily', 1)).toEqual(new Set(['a/a', 'b/b', 'c/c']));
  });

  it('keeps periods apart: a weekly digest does not mute the daily one', async () => {
    await record('sub', '2026-08-27', ['a/a'], 'daily');
    await record('sub', '2026-W35', ['b/b'], 'weekly');

    expect(await history.recent('sub', 'daily', 7)).toEqual(new Set(['a/a']));
    expect(await history.recent('sub', 'weekly', 7)).toEqual(new Set(['b/b']));
  });

  it('keeps subscriptions apart', async () => {
    await record('one', '2026-08-27', ['a/a']);
    await record('two', '2026-08-27', ['b/b']);
    expect(await history.recent('one', 'daily', 7)).toEqual(new Set(['a/a']));
  });

  it('remembers nothing when the cooldown is disabled', async () => {
    await record('sub', '2026-08-27', ['a/a']);
    expect(await history.recent('sub', 'daily', 0)).toEqual(new Set());
  });

  it('survives a restart and stays valid JSON', async () => {
    await record('sub', '2026-08-27', ['a/a']);
    const raw = await readFile(join(dir, 'history', 'sub.json'), 'utf8');
    expect(JSON.parse(raw)).toMatchObject({ version: 1 });

    const reopened = HistoryStore.fromDataDir(dir);
    expect(await reopened.recent('sub', 'daily', 7)).toEqual(new Set(['a/a']));
  });

  it('files ids that are not filesystem-safe without colliding', async () => {
    await record('a/b', '2026-08-27', ['x/x']);
    await record('a_b', '2026-08-27', ['y/y']);
    expect(await history.recent('a/b', 'daily', 7)).toEqual(new Set(['x/x']));
    expect(await history.recent('a_b', 'daily', 7)).toEqual(new Set(['y/y']));
  });

  it('caps what it keeps', async () => {
    for (let index = 0; index < 260; index += 1) {
      await record('sub', `2026-08-${String(index)}`, [`r/${String(index)}`]);
    }
    const kept = await history.recent('sub', 'daily', 1000);
    expect(kept.size).toBe(200);
    expect(kept.has('r/259')).toBe(true);
    expect(kept.has('r/0')).toBe(false);
  });
});
