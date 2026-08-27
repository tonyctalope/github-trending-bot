import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  formatZodError,
  storeFileSchema,
  subscriptionInputSchema,
  subscriptionSchema,
  type Subscription,
  type SubscriptionInput,
} from '../config/schema.js';
import type { Logger } from '../logger.js';

export const STORE_FILENAME = 'subscriptions.json';

function newId(taken: ReadonlySet<string>): string {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const id = randomBytes(4).toString('hex').slice(0, 6);
    if (!taken.has(id)) return id;
  }
  throw new Error('could not allocate a free subscription id');
}

/**
 * Subscriptions created from Discord, persisted as JSON so they survive a
 * container restart. Writes are atomic (temp file + rename) so a crash mid-write
 * cannot truncate the state.
 */
export class SubscriptionStore {
  private subscriptions: Subscription[] = [];

  constructor(
    readonly file: string,
    private readonly logger?: Logger,
  ) {}

  static fromDataDir(dataDir: string, logger?: Logger): SubscriptionStore {
    return new SubscriptionStore(join(dataDir, STORE_FILENAME), logger);
  }

  async load(): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(this.file, 'utf8');
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') {
        this.subscriptions = [];
        return;
      }
      throw cause;
    }

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      await this.quarantine(raw, 'file is not valid JSON');
      return;
    }

    const parsed = storeFileSchema.safeParse(json);
    if (!parsed.success) {
      await this.quarantine(raw, `schema mismatch:\n${formatZodError(parsed.error)}`);
      return;
    }
    this.subscriptions = parsed.data.subscriptions.map((subscription) => ({
      ...subscription,
      managed: false,
    }));
  }

  list(): Subscription[] {
    return [...this.subscriptions];
  }

  get(id: string): Subscription | undefined {
    return this.subscriptions.find((subscription) => subscription.id === id);
  }

  async add(input: SubscriptionInput, createdBy?: string | null): Promise<Subscription> {
    const parsedInput = subscriptionInputSchema.safeParse(input);
    if (!parsedInput.success) {
      throw new Error(`invalid subscription:\n${formatZodError(parsedInput.error)}`);
    }
    const subscription = subscriptionSchema.parse({
      ...parsedInput.data,
      id: newId(new Set(this.subscriptions.map((existing) => existing.id))),
      managed: false,
      createdBy: createdBy ?? null,
      createdAt: new Date().toISOString(),
    });
    this.subscriptions = [...this.subscriptions, subscription];
    await this.persist();
    return subscription;
  }

  async remove(id: string): Promise<Subscription | undefined> {
    const removed = this.get(id);
    if (!removed) return undefined;
    this.subscriptions = this.subscriptions.filter((subscription) => subscription.id !== id);
    await this.persist();
    return removed;
  }

  async removeByChannel(channelId: string): Promise<Subscription[]> {
    const removed = this.subscriptions.filter(
      (subscription) => subscription.channelId === channelId,
    );
    if (removed.length === 0) return [];
    this.subscriptions = this.subscriptions.filter(
      (subscription) => subscription.channelId !== channelId,
    );
    await this.persist();
    return removed;
  }

  private async persist(): Promise<void> {
    const payload = `${JSON.stringify({ version: 1, subscriptions: this.subscriptions }, null, 2)}\n`;
    await mkdir(dirname(this.file), { recursive: true });
    const temp = `${this.file}.${process.pid.toString()}.tmp`;
    await writeFile(temp, payload, { encoding: 'utf8', mode: 0o600 });
    await rename(temp, this.file);
  }

  /** Keeps a copy of unreadable state instead of overwriting it silently. */
  private async quarantine(raw: string, reason: string): Promise<void> {
    const backup = `${this.file}.invalid`;
    try {
      await writeFile(backup, raw, { encoding: 'utf8', mode: 0o600 });
    } catch {
      // best effort only
    }
    this.subscriptions = [];
    this.logger?.error(
      { file: this.file, backup, reason },
      'ignoring unreadable subscription store, starting from an empty list',
    );
  }
}
