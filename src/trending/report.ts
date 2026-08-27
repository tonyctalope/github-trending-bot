import { z } from 'zod';
import { buildTrendingUrl, fetchTrending } from './client.js';
import { periodKeyAt } from './period.js';
import { PERIODS, type Period, type TrendingRepo } from './types.js';

/**
 * A frozen capture of the trending page for one calendar period — the unit the
 * public report sites publish ("report for 27 August"). Captured near the end of
 * the period so the figures describe the period that is closing.
 */
export interface TrendingReport {
  period: Period;
  /** Calendar key in UTC: 2026-08-27, 2026-W35, 2026-08. */
  key: string;
  capturedAt: string;
  url: string;
  language: string | null;
  spokenLanguage: string | null;
  /** True when the capture did not happen at the period boundary. */
  partial: boolean;
  repos: TrendingRepo[];
}

export const repoSchema = z.object({
  fullName: z.string(),
  owner: z.string(),
  name: z.string(),
  url: z.string(),
  description: z.string().nullable(),
  language: z.string().nullable(),
  languageColor: z.string().nullable(),
  stars: z.number(),
  forks: z.number(),
  periodStars: z.number().nullable(),
  builtBy: z.array(z.string()).default([]),
});

export const reportSchema = z.object({
  period: z.enum(PERIODS),
  key: z.string().min(1),
  capturedAt: z.string(),
  url: z.string(),
  language: z.string().nullable().default(null),
  spokenLanguage: z.string().nullable().default(null),
  partial: z.boolean().default(false),
  repos: z.array(repoSchema),
});

export interface CaptureQuery {
  period: Period;
  language?: string | null;
  spokenLanguage?: string | null;
}

export interface CaptureDeps {
  fetchRepos?: (query: CaptureQuery) => Promise<TrendingRepo[]>;
  now?: () => Date;
}

/**
 * Identifies the filter slice of a report, so slices never overwrite each other.
 * Unsafe characters become `_<hex>` rather than a single `_`: collapsing them
 * would file `c++` and `c#` under the very same name.
 */
export function sliceKey(language?: string | null, spokenLanguage?: string | null): string {
  const safe = (value: string): string =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9.-]/g, (character) => `_${(character.codePointAt(0) ?? 0).toString(16)}`);
  const parts: string[] = [];
  if (language) parts.push(`lang-${safe(language)}`);
  if (spokenLanguage) parts.push(`spoken-${safe(spokenLanguage)}`);
  return parts.length > 0 ? `__${parts.join('__')}` : '';
}

export async function captureReport(
  query: CaptureQuery,
  deps: CaptureDeps = {},
): Promise<TrendingReport> {
  const now = deps.now?.() ?? new Date();
  const fetchRepos = deps.fetchRepos ?? fetchTrending;
  const repos = await fetchRepos(query);
  return {
    period: query.period,
    key: periodKeyAt(query.period, now),
    capturedAt: now.toISOString(),
    url: buildTrendingUrl(query),
    language: query.language ?? null,
    spokenLanguage: query.spokenLanguage ?? null,
    partial: false,
    repos,
  };
}
