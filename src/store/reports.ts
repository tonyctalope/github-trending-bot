import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { formatZodError } from '../config/schema.js';
import { reportSchema, sliceKey, type TrendingReport } from '../trending/report.js';
import { PERIODS, type Period } from '../trending/types.js';
import type { Logger } from '../logger.js';

/** How many captures of each period are kept on disk. */
export const DEFAULT_RETENTION: Record<Period, number> = {
  daily: 120,
  weekly: 78,
  monthly: 60,
};

/**
 * Frozen period captures on the data volume, one JSON per (period, key, slice):
 *   /data/reports/daily/2026-08-27.json
 *   /data/reports/weekly/2026-W35__lang-typescript.json
 *
 * Keys sort lexicographically in chronological order for all three periods,
 * which is what makes "latest" and "the one before" plain string comparisons.
 */
export class ReportStore {
  constructor(
    readonly dir: string,
    private readonly logger?: Logger,
  ) {}

  static fromDataDir(dataDir: string, logger?: Logger): ReportStore {
    return new ReportStore(join(dataDir, 'reports'), logger);
  }

  private file(period: Period, key: string, slice: string): string {
    return join(this.dir, period, `${key}${slice}.json`);
  }

  async save(report: TrendingReport): Promise<string> {
    const slice = sliceKey(report.language, report.spokenLanguage);
    const path = this.file(report.period, report.key, slice);
    await mkdir(join(this.dir, report.period), { recursive: true });
    const temp = `${path}.${process.pid.toString()}.tmp`;
    await writeFile(temp, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    await rename(temp, path);
    return path;
  }

  async get(period: Period, key: string, slice = ''): Promise<TrendingReport | null> {
    let raw: string;
    try {
      raw = await readFile(this.file(period, key, slice), 'utf8');
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw cause;
    }
    const parsed = reportSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      this.logger?.warn(
        { period, key, slice, problem: formatZodError(parsed.error) },
        'ignoring an unreadable report',
      );
      return null;
    }
    return parsed.data;
  }

  /** Keys stored for a slice, oldest first. */
  async keys(period: Period, slice = ''): Promise<string[]> {
    let entries: string[];
    try {
      entries = await readdir(join(this.dir, period));
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw cause;
    }
    const suffix = `${slice}.json`;
    return (
      entries
        .filter((name) => name.endsWith(suffix) && !name.endsWith('.tmp'))
        .map((name) => name.slice(0, -suffix.length))
        // a plain slice must not swallow the filtered ones (…__lang-rust.json)
        .filter((key) => slice !== '' || !key.includes('__'))
        .filter((key) => key.length > 0)
        .sort()
    );
  }

  async latest(period: Period, slice = ''): Promise<TrendingReport | null> {
    const keys = await this.keys(period, slice);
    const last = keys.at(-1);
    return last === undefined ? null : this.get(period, last, slice);
  }

  /** The capture right before `key`, used to show rank movements. */
  async previous(period: Period, key: string, slice = ''): Promise<TrendingReport | null> {
    const keys = await this.keys(period, slice);
    const earlier = keys.filter((candidate) => candidate < key);
    const last = earlier.at(-1);
    return last === undefined ? null : this.get(period, last, slice);
  }

  async prune(retention: Record<Period, number> = DEFAULT_RETENTION): Promise<number> {
    let removed = 0;
    for (const period of PERIODS) {
      let entries: string[];
      try {
        entries = await readdir(join(this.dir, period));
      } catch {
        continue;
      }
      // group by slice so a language filter is not pruned by the plain reports
      const bySlice = new Map<string, string[]>();
      for (const name of entries) {
        if (!name.endsWith('.json')) continue;
        const base = name.slice(0, -'.json'.length);
        const separator = base.indexOf('__');
        const slice = separator === -1 ? '' : base.slice(separator);
        bySlice.set(slice, [...(bySlice.get(slice) ?? []), name]);
      }
      for (const names of bySlice.values()) {
        const excess = names.sort().slice(0, Math.max(0, names.length - retention[period]));
        for (const name of excess) {
          await unlink(join(this.dir, period, name));
          removed += 1;
        }
      }
    }
    if (removed > 0) this.logger?.debug({ removed }, 'pruned old reports');
    return removed;
  }
}
