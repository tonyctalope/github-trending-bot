import type { Client } from 'discord.js';
import { publishReport, publishTrending } from './discord/publish.js';
import { captureReport, sliceKey, type TrendingReport } from './trending/report.js';
import { periodKeyAt } from './trending/period.js';
import type { ReportStore } from './store/reports.js';
import type { HistoryStore } from './store/history.js';
import type { Subscription } from './config/schema.js';
import type { Period } from './trending/types.js';
import type { Logger } from './logger.js';

export interface DeliveryResult {
  posted: boolean;
  /** Why nothing was posted, when `posted` is false. */
  reason?: string;
  report?: TrendingReport;
  messageUrl?: string;
}

export interface DeliveryDeps {
  capture?: typeof captureReport;
  publishLive?: typeof publishTrending;
  publishReport?: typeof publishReport;
}

/**
 * Turns a due (subscription, period) pair into a Discord post.
 *
 * In `report` mode the digest is the frozen capture of the last closed period —
 * so a daily subscription delivered in the morning shows yesterday, complete,
 * exactly like the public report sites. `live` keeps GitHub's rolling snapshot.
 */
export class Deliverer {
  constructor(
    private readonly reports: ReportStore,
    private readonly history: HistoryStore,
    private readonly logger: Logger,
    private readonly deps: DeliveryDeps = {},
  ) {}

  /** What this subscription posted recently, and should not repeat. */
  private async cooldownSet(
    subscription: Subscription,
    period: Period,
  ): Promise<ReadonlySet<string>> {
    if (subscription.cooldown <= 0) return new Set();
    return this.history.recent(subscription.id, period, subscription.cooldown);
  }

  private async remember(
    subscription: Subscription,
    period: Period,
    key: string,
    repos: readonly string[],
  ): Promise<void> {
    if (subscription.cooldown <= 0 || repos.length === 0) return;
    await this.history.record(subscription.id, {
      period,
      key,
      postedAt: new Date().toISOString(),
      repos: [...repos],
    });
  }

  async deliver(
    client: Client,
    subscription: Subscription,
    period: Period,
  ): Promise<DeliveryResult> {
    const exclude = await this.cooldownSet(subscription, period);

    if (subscription.mode === 'live') {
      const publish = this.deps.publishLive ?? publishTrending;
      const outcome = await publish(client, subscription, period, {}, exclude);
      await this.remember(
        subscription,
        period,
        periodKeyAt(period, new Date()),
        outcome.chosen.map((repo) => repo.fullName),
      );
      return { posted: true, messageUrl: outcome.message.url };
    }

    const slice = sliceKey(subscription.language, subscription.spokenLanguage);
    let report = await this.reports.latest(period, slice);

    if (!report) {
      if (subscription.onMissingReport === 'skip') {
        return {
          posted: false,
          reason: `no ${period} capture stored yet for this filter — waiting for the next period boundary`,
        };
      }
      const capture = this.deps.capture ?? captureReport;
      const fresh = await capture({
        period,
        language: subscription.language,
        spokenLanguage: subscription.spokenLanguage,
      });
      // Flagged in the footer: this one was not taken at the period boundary.
      report = { ...fresh, partial: true };
      await this.reports.save(report);
      this.logger.info(
        { period, key: report.key, slice },
        'no stored capture, took a partial one to avoid a silent gap',
      );
    }

    const previous = await this.reports.previous(period, report.key, slice);
    const publish = this.deps.publishReport ?? publishReport;
    const outcome = await publish(client, subscription, report, previous, exclude);
    await this.remember(
      subscription,
      period,
      report.key,
      outcome.chosen.map((repo) => repo.fullName),
    );
    return { posted: true, report, messageUrl: outcome.message.url };
  }
}
