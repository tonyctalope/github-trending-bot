import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { pino } from 'pino';
import { afterEach, describe, expect, it } from 'vitest';
import { startHealthServer, type HealthStatus } from '../src/health.js';

const logger = pino({ level: 'silent' });
let close: (() => void) | undefined;

afterEach(() => {
  close?.();
  close = undefined;
});

/** HEALTH_PORT=0 means "disabled", so tests need a concrete free port. */
async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

async function start(status: () => HealthStatus): Promise<string> {
  const port = await freePort();
  const server = startHealthServer(port, status, logger);
  if (!server) throw new Error('health server did not start');
  close = () => server.close();
  await new Promise<void>((resolve) => server.once('listening', resolve));
  return `http://127.0.0.1:${String(port)}`;
}

describe('startHealthServer', () => {
  it('is disabled when the port is 0', () => {
    expect(startHealthServer(0, () => ({ status: 'ok' }), logger)).toBeNull();
  });

  it('answers 200 with the status payload once ready', async () => {
    const base = await start(() => ({ status: 'ok', jobs: 2 }));
    const response = await fetch(`${base}/health`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(await response.json()).toEqual({ status: 'ok', jobs: 2 });
  });

  it('answers 503 while the bot is still starting', async () => {
    const base = await start(() => ({ status: 'starting' }));
    expect((await fetch(`${base}/healthz`)).status).toBe(503);
  });

  it('answers on the root path too', async () => {
    const base = await start(() => ({ status: 'ok' }));
    expect((await fetch(base)).status).toBe(200);
  });

  it('answers 404 on any other path', async () => {
    const base = await start(() => ({ status: 'ok' }));
    expect((await fetch(`${base}/metrics`)).status).toBe(404);
  });
});
