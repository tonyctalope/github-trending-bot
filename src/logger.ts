import { pino, type Logger } from 'pino';

const level = process.env.LOG_LEVEL ?? 'info';
const wantsPretty =
  process.env.LOG_PRETTY === 'true' ||
  (process.env.LOG_PRETTY !== 'false' &&
    process.env.NODE_ENV !== 'production' &&
    process.stdout.isTTY === true);

function createLogger(): Logger {
  if (wantsPretty) {
    try {
      return pino({
        level,
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        },
      });
    } catch {
      // pino-pretty is a dev dependency and absent from the production image.
    }
  }
  return pino({ level });
}

export const logger = createLogger();
export type { Logger };
