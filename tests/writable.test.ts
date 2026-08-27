import { chmod, mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { ensureWritableDir } from '../src/store/writable.js';

const isRoot = (process.getuid?.() ?? -1) === 0;
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'trending-writable-'));
});

describe('ensureWritableDir', () => {
  it('creates the directory when it does not exist yet', async () => {
    const nested = join(dir, 'data', 'reports');
    await expect(ensureWritableDir(nested)).resolves.toBeUndefined();
  });

  it('leaves no probe file behind', async () => {
    await ensureWritableDir(dir);
    expect(await readdir(dir)).toEqual([]);
  });

  it('passes on a directory that is already writable', async () => {
    await ensureWritableDir(dir);
    await expect(ensureWritableDir(dir)).resolves.toBeUndefined();
  });

  // Skipped as root, which bypasses the permission bits entirely.
  it.skipIf(isRoot)('explains how to fix a directory it cannot write to', async () => {
    const locked = join(dir, 'locked');
    await ensureWritableDir(locked);
    await chmod(locked, 0o500);

    await expect(ensureWritableDir(locked)).rejects.toThrow(/is not writable by uid/);
    await expect(ensureWritableDir(locked)).rejects.toThrow(/chown -R/);
    await chmod(locked, 0o700); // let the temp dir be cleaned up
  });
});
