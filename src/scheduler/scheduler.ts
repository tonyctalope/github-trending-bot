import { Cron } from 'croner';
import { cronFor, type Subscription } from '../config/schema.js';
import type { Period } from '../trending/types.js';
import type { Logger } from '../logger.js';

export interface PlannedJob {
  key: string;
  subscription: Subscription;
  period: Period;
  cron: string;
  timezone: string;
}

export interface JobStatus {
  key: string;
  subscriptionId: string;
  channelId: string;
  period: Period;
  cron: string;
  timezone: string;
  nextRun: string | null;
}

/**
 * One cron job per (subscription, period): a subscription listing `daily` and
 * `weekly` gets the daily cadence for one and the Monday cadence for the other,
 * unless it overrides `cron` explicitly.
 */
export function planJobs(subscriptions: readonly Subscription[]): PlannedJob[] {
  return subscriptions.flatMap((subscription) =>
    subscription.periods.map((period) => ({
      key: `${subscription.id}:${period}`,
      subscription,
      period,
      cron: cronFor(subscription, period),
      timezone: subscription.timezone,
    })),
  );
}

export type JobRunner = (subscription: Subscription, period: Period) => Promise<void>;

export class Scheduler {
  private jobs = new Map<string, { cron: Cron; job: PlannedJob }>();

  constructor(
    private readonly run: JobRunner,
    private readonly logger?: Logger,
  ) {}

  /** Replaces every running job with the jobs implied by `subscriptions`. */
  sync(subscriptions: readonly Subscription[]): PlannedJob[] {
    this.stop();
    const planned = planJobs(subscriptions);
    for (const job of planned) {
      const cron = new Cron(
        job.cron,
        { name: job.key, timezone: job.timezone, protect: true, catch: true },
        () => {
          void this.execute(job);
        },
      );
      this.jobs.set(job.key, { cron, job });
    }
    this.logger?.info({ jobs: planned.length }, 'scheduler synchronised');
    return planned;
  }

  private async execute(job: PlannedJob): Promise<void> {
    const context = { job: job.key, channelId: job.subscription.channelId, period: job.period };
    try {
      await this.run(job.subscription, job.period);
      this.logger?.info(context, 'trending posted');
    } catch (cause) {
      this.logger?.error({ ...context, err: cause }, 'trending job failed');
    }
  }

  status(): JobStatus[] {
    return [...this.jobs.values()].map(({ cron, job }) => ({
      key: job.key,
      subscriptionId: job.subscription.id,
      channelId: job.subscription.channelId,
      period: job.period,
      cron: job.cron,
      timezone: job.timezone,
      nextRun: cron.nextRun()?.toISOString() ?? null,
    }));
  }

  get size(): number {
    return this.jobs.size;
  }

  stop(): void {
    for (const { cron } of this.jobs.values()) cron.stop();
    this.jobs.clear();
  }
}
