import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import {
  configFileSchema,
  formatZodError,
  subscriptionSchema,
  type Subscription,
} from './schema.js';
import type { Env } from './env.js';

export interface LoadConfigFileResult {
  path: string;
  found: boolean;
  subscriptions: Subscription[];
}

/**
 * Reads the optional declarative config file. Subscriptions declared there are
 * `managed`: always re-applied at boot and not editable from Discord.
 */
export async function loadConfigFile(path: string, env: Env): Promise<LoadConfigFileResult> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') {
      return { path, found: false, subscriptions: [] };
    }
    throw new Error(`cannot read config file ${path}: ${(cause as Error).message}`, { cause });
  }

  const parsed = configFileSchema.safeParse(parseYaml(raw) ?? {});
  if (!parsed.success) {
    throw new Error(`invalid config file ${path}:\n${formatZodError(parsed.error)}`);
  }

  const { defaults, subscriptions } = parsed.data;
  const resolved: Subscription[] = subscriptions.map((entry, index) => {
    const merged = subscriptionSchema.safeParse({
      ...entry,
      periods: entry.periods ?? ['daily'],
      limit: entry.limit ?? defaults.limit ?? env.DEFAULT_LIMIT,
      timezone: entry.timezone ?? defaults.timezone ?? env.DEFAULT_TIMEZONE,
      style: entry.style ?? defaults.style ?? env.DEFAULT_STYLE,
      mode: entry.mode ?? defaults.mode ?? env.DEFAULT_MODE,
      rank: entry.rank ?? defaults.rank ?? env.DEFAULT_RANK,
      cooldown: entry.cooldown ?? defaults.cooldown ?? env.DEFAULT_COOLDOWN,
      onMissingReport: entry.onMissingReport ?? undefined,
      language: entry.language ?? defaults.language ?? null,
      spokenLanguage: entry.spokenLanguage ?? defaults.spokenLanguage ?? null,
      cron: entry.cron ?? defaults.cron ?? null,
      id: `file-${String(index + 1)}`,
      managed: true,
      createdBy: null,
    });
    if (!merged.success) {
      throw new Error(
        `invalid config file ${path}: subscriptions[${String(index)}]\n${formatZodError(merged.error)}`,
      );
    }
    return merged.data;
  });

  return { path, found: true, subscriptions: resolved };
}
