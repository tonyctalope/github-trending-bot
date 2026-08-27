import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { selfcheck } from '../src/selfcheck.js';
import { logger } from '../src/logger.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function run(): Promise<{ code: number; output: string }> {
  const lines: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  });
  const code = await selfcheck({ network: false });
  return { code, output: lines.join('') };
}

describe('selfcheck', () => {
  it('passes on a bare install, without network or token', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'trending-selfcheck-'));
    vi.stubEnv('DATA_DIR', dir);
    vi.stubEnv('CONFIG_PATH', join(dir, 'config.yaml'));

    const { code, output } = await run();

    expect(code).toBe(0);
    expect(output).toContain('selfcheck: OK');
    expect(output).toContain('environment parsed');
    expect(output).toContain('embed rendered');
    expect(output).toContain('DISCORD_TOKEN absent');
    expect(output).toContain('network check skipped');
  });

  it('counts the subscriptions it found in the config file and the store', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'trending-selfcheck-'));
    const config = join(dir, 'config.yaml');
    await writeFile(
      config,
      'subscriptions:\n  - channelId: "111111111111111111"\n    periods: [daily, weekly]\n',
      'utf8',
    );
    vi.stubEnv('DATA_DIR', dir);
    vi.stubEnv('CONFIG_PATH', config);
    vi.stubEnv('DISCORD_TOKEN', 'not-a-real-token');

    const { code, output } = await run();

    expect(code).toBe(0);
    expect(output).toContain('1 managed subscription(s)');
    expect(output).toContain('DISCORD_TOKEN present');
  });

  it('fails loudly on an unusable configuration', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'trending-selfcheck-'));
    const config = join(dir, 'config.yaml');
    await writeFile(config, 'subscriptions:\n  - channelId: "nope"\n', 'utf8');
    vi.stubEnv('DATA_DIR', dir);
    vi.stubEnv('CONFIG_PATH', config);

    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await expect(selfcheck({ network: false })).rejects.toThrow(/invalid config file/);
  });
});

describe('logger', () => {
  it('exposes a usable pino instance', () => {
    expect(typeof logger.info).toBe('function');
    expect(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).toContain(logger.level);
  });
});
