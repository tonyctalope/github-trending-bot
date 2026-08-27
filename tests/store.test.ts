import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { SubscriptionStore } from '../src/store/subscriptions.js';

const channelId = '123456789012345678';
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'trending-store-'));
});

async function freshStore(): Promise<SubscriptionStore> {
  const store = SubscriptionStore.fromDataDir(dir);
  await store.load();
  return store;
}

describe('SubscriptionStore', () => {
  it('starts empty when no state file exists', async () => {
    const store = await freshStore();
    expect(store.list()).toEqual([]);
  });

  it('creates a subscription with a short unique id', async () => {
    const store = await freshStore();
    const first = await store.add({ channelId, periods: ['daily'] }, '42');
    const second = await store.add({ channelId, periods: ['weekly'] }, '42');

    expect(first.id).toMatch(/^[0-9a-f]{6}$/);
    expect(second.id).not.toBe(first.id);
    expect(first.createdBy).toBe('42');
    expect(store.list()).toHaveLength(2);
  });

  it('survives a restart', async () => {
    const store = await freshStore();
    const created = await store.add({ channelId, periods: ['daily', 'monthly'], limit: 9 });

    const reloaded = await freshStore();
    expect(reloaded.get(created.id)).toMatchObject({
      channelId,
      periods: ['daily', 'monthly'],
      limit: 9,
    });
  });

  it('writes indented JSON with a schema version', async () => {
    const store = await freshStore();
    await store.add({ channelId, periods: ['daily'] });
    const raw = JSON.parse(await readFile(store.file, 'utf8')) as { version: number };
    expect(raw.version).toBe(1);
  });

  it('rejects an invalid subscription without touching the state', async () => {
    const store = await freshStore();
    await expect(store.add({ channelId: 'oops', periods: ['daily'] })).rejects.toThrow(
      /Discord id/,
    );
    expect(store.list()).toEqual([]);
  });

  it('removes by id and reports what was removed', async () => {
    const store = await freshStore();
    const created = await store.add({ channelId, periods: ['daily'] });

    expect(await store.remove('unknown')).toBeUndefined();
    expect(await store.remove(created.id)).toMatchObject({ id: created.id });
    expect((await freshStore()).list()).toEqual([]);
  });

  it('removes every subscription of a deleted channel', async () => {
    const store = await freshStore();
    await store.add({ channelId, periods: ['daily'] });
    await store.add({ channelId, periods: ['weekly'] });
    await store.add({ channelId: '999999999999999999', periods: ['daily'] });

    expect(await store.removeByChannel(channelId)).toHaveLength(2);
    expect(store.list()).toHaveLength(1);
  });

  it('quarantines a corrupted state file instead of crashing', async () => {
    const file = join(dir, 'subscriptions.json');
    await writeFile(file, '{ this is not json', 'utf8');

    const store = new SubscriptionStore(file);
    await store.load();

    expect(store.list()).toEqual([]);
    expect(await readFile(`${file}.invalid`, 'utf8')).toBe('{ this is not json');
  });

  it('quarantines state that no longer matches the schema', async () => {
    const file = join(dir, 'subscriptions.json');
    await writeFile(file, JSON.stringify({ version: 1, subscriptions: [{ id: 'x' }] }), 'utf8');

    const store = new SubscriptionStore(file);
    await store.load();
    expect(store.list()).toEqual([]);
  });

  it('never marks stored subscriptions as managed', async () => {
    const file = join(dir, 'subscriptions.json');
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        subscriptions: [
          {
            id: 'aaa111',
            channelId,
            periods: ['daily'],
            managed: true,
            createdAt: new Date().toISOString(),
          },
        ],
      }),
      'utf8',
    );

    const store = new SubscriptionStore(file);
    await store.load();
    expect(store.list()[0]?.managed).toBe(false);
  });
});
