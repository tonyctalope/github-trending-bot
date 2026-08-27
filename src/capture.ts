import { captureReport, sliceKey, type TrendingReport } from './trending/report.js';
import { isPeriodBoundary, periodKeyAt } from './trending/period.js';
import { DEFAULT_RETENTION, type ReportStore } from './store/reports.js';
import type { Subscription } from './config/schema.js';
import type { Period } from './trending/types.js';
import type { Logger } from './logger.js';

export interface CaptureSlice {
  language: string | null;
  spokenLanguage: string | null;
}

/**
 * Which trending pages have to be frozen for a period: the plain one, plus one
 * per distinct filter used by a `report` subscription of that period. Nothing is
 * captured for filters nobody reads.
 */
export function captureSlicesFor(
  subscriptions: readonly Subscription[],
  period: Period,
): CaptureSlice[] {
  const slices = new Map<string, CaptureSlice>([['', { language: null, spokenLanguage: null }]]);
  for (const subscription of subscriptions) {
    if (subscription.mode !== 'report') continue;
    if (!subscription.periods.includes(period)) continue;
    const language = subscription.language ?? null;
    const spokenLanguage = subscription.spokenLanguage ?? null;
    slices.set(sliceKey(language, spokenLanguage), { language, spokenLanguage });
  }
  return [...slices.values()];
}

export interface CaptureRunDeps {
  capture?: typeof captureReport;
  now?: () => Date;
  /** Capture even when it is not the end of the period (manual runs). */
  force?: boolean;
}

export interface CaptureRunResult {
  period: Period;
  key: string;
  skipped: boolean;
  saved: TrendingReport[];
  failures: { slice: CaptureSlice; message: string }[];
}

/**
 * Freezes the trending page for a period. Weekly and monthly captures only run on
 * the last day of their period, so the same nightly cron can drive all three.
 */
export async function runCapture(
  reports: ReportStore,
  period: Period,
  slices: readonly CaptureSlice[],
  deps: CaptureRunDeps = {},
  logger?: Logger,
): Promise<CaptureRunResult> {
  const now = deps.now?.() ?? new Date();
  const key = periodKeyAt(period, now);

  if (!deps.force && !isPeriodBoundary(period, now)) {
    logger?.debug({ period, key }, 'not the end of the period, capture skipped');
    return { period, key, skipped: true, saved: [], failures: [] };
  }

  const capture = deps.capture ?? captureReport;
  const saved: TrendingReport[] = [];
  const failures: { slice: CaptureSlice; message: string }[] = [];

  for (const slice of slices) {
    try {
      const captured = await capture(
        { period, language: slice.language, spokenLanguage: slice.spokenLanguage },
        { now: () => now },
      );
      // A forced run happens outside the nightly boundary job, so the figures do
      // not describe the whole period yet: say so rather than imply completeness.
      const report = { ...captured, partial: deps.force === true };
      await reports.save(report);
      saved.push(report);
      logger?.info(
        {
          period,
          key: report.key,
          slice: sliceKey(slice.language, slice.spokenLanguage),
          repos: report.repos.length,
        },
        'period capture stored',
      );
    } catch (cause) {
      failures.push({ slice, message: (cause as Error).message });
      logger?.error({ period, key, slice, err: cause }, 'period capture failed');
    }
  }

  await reports.prune(DEFAULT_RETENTION);
  return { period, key, skipped: false, saved, failures };
}
