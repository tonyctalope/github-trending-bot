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

export interface CaptureJobPlan {
  period: Period;
  cron: string;
  timezone: string;
}

export interface JobStatus {
  kind: 'subscription' | 'capture';
  key: string;
  subscriptionId: string | null;
  channelId: string | null;
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
export type CaptureRunner = (period: Period) => Promise<void>;

export class Scheduler {
  private jobs = new Map<string, { cron: Cron; job: PlannedJob }>();
  private captures = new Map<string, { cron: Cron; plan: CaptureJobPlan }>();

  constructor(
    private readonly run: JobRunner,
    private readonly logger?: Logger,
    private readonly capture?: CaptureRunner,
  ) {}

  /**
   * Replaces the subscription jobs with the ones implied by `subscriptions`.
   * Boundary captures are untouched: a `/trending subscribe` must never cancel
   * the nightly freeze.
   */
  sync(subscriptions: readonly Subscription[]): PlannedJob[] {
    this.stopSubscriptions();
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

  /**
   * Boundary captures: one nightly job per period, independent of subscriptions
   * (the weekly/monthly handlers no-op until the last day of their period).
   */
  syncCaptures(plans: readonly CaptureJobPlan[]): CaptureJobPlan[] {
    for (const { cron } of this.captures.values()) cron.stop();
    this.captures.clear();
    if (!this.capture) return [];

    for (const plan of plans) {
      const key = `capture:${plan.period}`;
      const cron = new Cron(
        plan.cron,
        { name: key, timezone: plan.timezone, protect: true, catch: true },
        () => {
          void this.executeCapture(plan);
        },
      );
      this.captures.set(key, { cron, plan });
    }
    this.logger?.info({ captures: this.captures.size }, 'boundary captures scheduled');
    return [...this.captures.values()].map(({ plan }) => plan);
  }

  private async executeCapture(plan: CaptureJobPlan): Promise<void> {
    if (!this.capture) return;
    try {
      await this.capture(plan.period);
    } catch (cause) {
      this.logger?.error({ period: plan.period, err: cause }, 'boundary capture failed');
    }
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
    const captures: JobStatus[] = [...this.captures.values()].map(({ cron, plan }) => ({
      kind: 'capture' as const,
      key: `capture:${plan.period}`,
      subscriptionId: null,
      channelId: null,
      period: plan.period,
      cron: plan.cron,
      timezone: plan.timezone,
      nextRun: cron.nextRun()?.toISOString() ?? null,
    }));
    const subscriptions: JobStatus[] = [...this.jobs.values()].map(({ cron, job }) => ({
      kind: 'subscription' as const,
      key: job.key,
      subscriptionId: job.subscription.id,
      channelId: job.subscription.channelId,
      period: job.period,
      cron: job.cron,
      timezone: job.timezone,
      nextRun: cron.nextRun()?.toISOString() ?? null,
    }));
    return [...subscriptions, ...captures];
  }

  /** Number of subscription jobs (captures are counted by `captureSize`). */
  get size(): number {
    return this.jobs.size;
  }

  get captureSize(): number {
    return this.captures.size;
  }

  private stopSubscriptions(): void {
    for (const { cron } of this.jobs.values()) cron.stop();
    this.jobs.clear();
  }

  stop(): void {
    this.stopSubscriptions();
    for (const { cron } of this.captures.values()) cron.stop();
    this.captures.clear();
  }
}
