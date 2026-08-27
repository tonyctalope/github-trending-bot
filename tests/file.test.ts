import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadConfigFile } from '../src/config/file.js';
import { loadEnv, type Env } from '../src/config/env.js';

let dir: string;
let env: Env;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'trending-config-'));
  env = loadEnv({});
});

async function write(content: string): Promise<string> {
  const path = join(dir, 'config.yaml');
  await writeFile(path, content, 'utf8');
  return path;
}

describe('loadConfigFile', () => {
  it('reports a missing file without failing', async () => {
    const result = await loadConfigFile(join(dir, 'absent.yaml'), env);
    expect(result).toMatchObject({ found: false, subscriptions: [] });
  });

  it('resolves defaults into every subscription and marks them managed', async () => {
    const path = await write(`
defaults:
  limit: 8
  timezone: Europe/Paris
  style: compact
subscriptions:
  - channelId: "111111111111111111"
    periods: [daily, weekly]
  - channelId: "222222222222222222"
    periods: [monthly]
    limit: 3
    language: rust
`);
    const { subscriptions } = await loadConfigFile(path, env);

    expect(subscriptions).toHaveLength(2);
    expect(subscriptions[0]).toMatchObject({
      id: 'file-1',
      managed: true,
      channelId: '111111111111111111',
      periods: ['daily', 'weekly'],
      limit: 8,
      timezone: 'Europe/Paris',
      style: 'compact',
    });
    expect(subscriptions[1]).toMatchObject({ id: 'file-2', limit: 3, language: 'rust' });
  });

  it('defaults to the daily period when none is given', async () => {
    const path = await write('subscriptions:\n  - channelId: "111111111111111111"\n');
    const { subscriptions } = await loadConfigFile(path, env);
    expect(subscriptions[0]?.periods).toEqual(['daily']);
  });

  it('points at the offending entry when validation fails', async () => {
    const path = await write('subscriptions:\n  - channelId: "nope"\n    periods: [daily]\n');
    await expect(loadConfigFile(path, env)).rejects.toThrow(/subscriptions\.0\.channelId/);
  });

  it('rejects a typo instead of silently ignoring it', async () => {
    const path = await write('subscriptions:\n  - chanelId: "111111111111111111"\n');
    await expect(loadConfigFile(path, env)).rejects.toThrow(/invalid config file/);
  });

  it('accepts an empty document', async () => {
    const path = await write('# nothing configured yet\n');
    const result = await loadConfigFile(path, env);
    expect(result).toMatchObject({ found: true, subscriptions: [] });
  });
});
