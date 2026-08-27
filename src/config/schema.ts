import { Cron } from 'croner';
import { z } from 'zod';
import { PERIODS, type Period } from '../trending/types.js';

export const SNOWFLAKE_RE = /^\d{17,20}$/;

/** Cadence used when a subscription does not override `cron`. */
export const DEFAULT_CRON: Record<Period, string> = {
  daily: '0 9 * * *',
  weekly: '0 9 * * 1',
  monthly: '0 9 1 * *',
};

export const MAX_LIMIT = 25;
export const DEFAULT_LIMIT = 1;
export const DEFAULT_TIMEZONE = 'UTC';
/**
 * `links` posts the bare GitHub URL and lets Discord build its own repository
 * card (default). `embed` builds ours instead, `compact` is plain text with no
 * preview at all.
 */
export const STYLES = ['links', 'embed', 'compact'] as const;
export type Style = (typeof STYLES)[number];

/**
 * `report` posts the frozen capture of the period that just closed — what the
 * public report sites publish. `live` posts GitHub's current rolling trending.
 */
export const MODES = ['report', 'live'] as const;
export type Mode = (typeof MODES)[number];

/** What to do when no capture exists yet for the period being delivered. */
export const MISSING_REPORT_BEHAVIOURS = ['capture', 'skip'] as const;
export type MissingReportBehaviour = (typeof MISSING_REPORT_BEHAVIOURS)[number];

/** Boundary captures run in UTC, like the calendar keys they are filed under. */
export const DEFAULT_CAPTURE_CRON: Record<Period, string> = {
  daily: '45 23 * * *',
  weekly: '50 23 * * 0',
  // fires every late-month night; the handler only acts on the last day
  monthly: '55 23 28-31 * *',
};

export function isValidCron(expression: string): boolean {
  try {
    const cron = new Cron(expression, { maxRuns: 0 });
    cron.stop();
    return true;
  } catch {
    return false;
  }
}

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

const snowflake = z.string().regex(SNOWFLAKE_RE, 'must be a Discord id (17-20 digits)');
const cronExpression = z
  .string()
  .trim()
  .min(1)
  .refine(
    isValidCron,
    'not a valid cron expression (5 fields, or 6 with seconds — see crontab.guru)',
  );
const timezone = z
  .string()
  .trim()
  .min(1)
  .refine(isValidTimezone, 'not a known IANA time zone (e.g. Europe/Paris, UTC)');

export const periodSchema = z.enum(PERIODS);
export const styleSchema = z.enum(STYLES);
export const modeSchema = z.enum(MODES);
export const missingReportSchema = z.enum(MISSING_REPORT_BEHAVIOURS);

/** What a user (or a config file) may provide when creating a subscription. */
export const subscriptionInputSchema = z.object({
  channelId: snowflake,
  guildId: snowflake.nullish(),
  periods: z
    .array(periodSchema)
    .min(1, 'at least one period is required')
    .transform((periods) =>
      [...new Set(periods)].sort((a, b) => PERIODS.indexOf(a) - PERIODS.indexOf(b)),
    ),
  language: z.string().trim().min(1).max(50).nullish(),
  spokenLanguage: z.string().trim().min(2).max(5).nullish(),
  limit: z.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  cron: cronExpression.nullish(),
  timezone: timezone.default(DEFAULT_TIMEZONE),
  style: styleSchema.default('links'),
  mode: modeSchema.default('report'),
  onMissingReport: missingReportSchema.default('capture'),
});

export const subscriptionSchema = subscriptionInputSchema.extend({
  id: z.string().trim().min(1),
  /** Declared in the config file: read-only from Discord slash commands. */
  managed: z.boolean().default(false),
  createdBy: z.string().nullish(),
  createdAt: z.string().default(() => new Date().toISOString()),
});

export type SubscriptionInput = z.input<typeof subscriptionInputSchema>;
export type Subscription = z.output<typeof subscriptionSchema>;

export const storeFileSchema = z.object({
  version: z.literal(1).default(1),
  subscriptions: z.array(subscriptionSchema).default([]),
});

export type StoreFile = z.output<typeof storeFileSchema>;

/**
 * A subscription as written in the config file: no schema-level defaults, so the
 * `defaults:` block and the env fallbacks stay in charge of what is unset.
 */
export const configSubscriptionSchema = z
  .object({
    channelId: snowflake,
    guildId: snowflake.nullish(),
    periods: z.array(periodSchema).min(1).optional(),
    language: z.string().trim().min(1).max(50).nullish(),
    spokenLanguage: z.string().trim().min(2).max(5).nullish(),
    limit: z.number().int().min(1).max(MAX_LIMIT).optional(),
    cron: cronExpression.nullish(),
    timezone: timezone.optional(),
    style: styleSchema.optional(),
    mode: modeSchema.optional(),
    onMissingReport: missingReportSchema.optional(),
  })
  .strict();

export const configFileSchema = z.object({
  defaults: z
    .object({
      limit: z.number().int().min(1).max(MAX_LIMIT).optional(),
      timezone: timezone.optional(),
      style: styleSchema.optional(),
      mode: modeSchema.optional(),
      language: z.string().trim().min(1).max(50).nullish(),
      spokenLanguage: z.string().trim().min(2).max(5).nullish(),
      cron: cronExpression.nullish(),
    })
    .default({}),
  subscriptions: z.array(configSubscriptionSchema).default([]),
});

/** The cron expression a (subscription, period) pair actually runs on. */
export function cronFor(subscription: Pick<Subscription, 'cron'>, period: Period): string {
  return subscription.cron ?? DEFAULT_CRON[period];
}

export function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
      return `  - ${path}: ${issue.message}`;
    })
    .join('\n');
}
