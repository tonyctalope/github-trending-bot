import { z } from 'zod';
import {
  DEFAULT_CAPTURE_CRON,
  DEFAULT_LIMIT,
  DEFAULT_TIMEZONE,
  formatZodError,
  modeSchema,
  rankingSchema,
  styleSchema,
} from './schema.js';

const boolean = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined || value.trim() === '') return fallback;
      return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
    });

export const envSchema = z.object({
  /** Optional here so `selfcheck` can run without secrets; required by the bot itself. */
  DISCORD_TOKEN: z.string().trim().min(1).optional(),
  /** Only needed to register slash commands in a single guild while developing. */
  DEV_GUILD_ID: z
    .string()
    .trim()
    .regex(/^\d{17,20}$/)
    .optional(),
  CONFIG_PATH: z.string().trim().default('config.yaml'),
  DATA_DIR: z.string().trim().default('data'),
  HEALTH_PORT: z.coerce.number().int().min(0).max(65_535).default(8080),
  REGISTER_COMMANDS: boolean(true),
  DEFAULT_TIMEZONE: z.string().trim().default(DEFAULT_TIMEZONE),
  DEFAULT_LIMIT: z.coerce.number().int().min(1).max(25).default(DEFAULT_LIMIT),
  DEFAULT_STYLE: styleSchema.default('links'),
  DEFAULT_RANK: rankingSchema.default('stars'),
  DEFAULT_MODE: modeSchema.default('report'),

  /** Boundary captures: when the trending page is frozen for each period (UTC). */
  CAPTURE_ENABLED: boolean(true),
  CAPTURE_TIMEZONE: z.string().trim().default('UTC'),
  CAPTURE_CRON_DAILY: z.string().trim().default(DEFAULT_CAPTURE_CRON.daily),
  CAPTURE_CRON_WEEKLY: z.string().trim().default(DEFAULT_CAPTURE_CRON.weekly),
  CAPTURE_CRON_MONTHLY: z.string().trim().default(DEFAULT_CAPTURE_CRON.monthly),
});

export type Env = z.output<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`invalid environment:\n${formatZodError(result.error)}`);
  }
  return result.data;
}
