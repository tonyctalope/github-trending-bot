import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { PERIODS, type Period } from '../trending/types.js';
import type { Logger } from '../logger.js';

const entrySchema = z.object({
  period: z.enum(PERIODS),
  key: z.string(),
  postedAt: z.string(),
  repos: z.array(z.string()),
});

const fileSchema = z.object({
  version: z.literal(1).default(1),
  entries: z.array(entrySchema).default([]),
});

export type DigestEntry = z.output<typeof entrySchema>;

/** Kept per subscription, well above any usable cooldown. */
const MAX_ENTRIES = 200;

function safeId(id: string): string {
  return id
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, (character) => `_${(character.codePointAt(0) ?? 0).toString(16)}`);
}

/**
 * What each subscription has already posted, so a repository that keeps topping
 * the charts does not fill the same channel day after day.
 */
export class HistoryStore {
  constructor(
    readonly dir: string,
    private readonly logger?: Logger,
  ) {}

  static fromDataDir(dataDir: string, logger?: Logger): HistoryStore {
    return new HistoryStore(join(dataDir, 'history'), logger);
  }

  private file(subscriptionId: string): string {
    return join(this.dir, `${safeId(subscriptionId)}.json`);
  }

  private async read(subscriptionId: string): Promise<DigestEntry[]> {
    let raw: string;
    try {
      raw = await readFile(this.file(subscriptionId), 'utf8');
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw cause;
    }
    const parsed = fileSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      this.logger?.warn({ subscriptionId }, 'ignoring an unreadable digest history');
      return [];
    }
    return parsed.data.entries;
  }

  /** Repositories posted by the last `digests` runs of this subscription and period. */
  async recent(subscriptionId: string, period: Period, digests: number): Promise<Set<string>> {
    if (digests <= 0) return new Set();
    const entries = (await this.read(subscriptionId))
      .filter((entry) => entry.period === period)
      .slice(-digests);
    return new Set(entries.flatMap((entry) => entry.repos));
  }

  async record(subscriptionId: string, entry: DigestEntry): Promise<void> {
    const entries = [...(await this.read(subscriptionId)), entry].slice(-MAX_ENTRIES);
    const path = this.file(subscriptionId);
    await mkdir(this.dir, { recursive: true });
    const temp = `${path}.${process.pid.toString()}.tmp`;
    await writeFile(temp, `${JSON.stringify({ version: 1, entries }, null, 2)}\n`, 'utf8');
    await rename(temp, path);
  }

  /** Subscription ids that have a history file, for housekeeping. */
  async known(): Promise<string[]> {
    try {
      return (await readdir(this.dir))
        .filter((name) => name.endsWith('.json'))
        .map((name) => name.slice(0, -'.json'.length));
    } catch {
      return [];
    }
  }
}
