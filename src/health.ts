import { createServer, type Server } from 'node:http';
import type { Logger } from './logger.js';

export type HealthStatus = Record<string, unknown> & { status: 'ok' | 'starting' | 'degraded' };

/**
 * Minimal `/health` endpoint so `docker healthcheck` (and any uptime monitor)
 * can tell a live bot from a crash-looping one. Disabled when `port` is 0.
 */
export function startHealthServer(
  port: number,
  getStatus: () => HealthStatus,
  logger: Logger,
): Server | null {
  if (port === 0) {
    logger.debug('health server disabled (HEALTH_PORT=0)');
    return null;
  }

  const server = createServer((request, response) => {
    if (request.url === '/health' || request.url === '/healthz' || request.url === '/') {
      const status = getStatus();
      const body = JSON.stringify(status);
      response.writeHead(status.status === 'ok' ? 200 : 503, {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body).toString(),
      });
      response.end(body);
      return;
    }
    response.writeHead(404, { 'content-type': 'text/plain' }).end('not found\n');
  });

  server.listen(port, '0.0.0.0', () => {
    logger.info({ port }, 'health endpoint listening');
  });
  server.on('error', (error) => {
    logger.error({ err: error, port }, 'health server error');
  });
  return server;
}
