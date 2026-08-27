import type { Client, Message } from 'discord.js';
import { publishReport, publishTrending } from './discord/publish.js';
import { captureReport, sliceKey, type TrendingReport } from './trending/report.js';
import type { ReportStore } from './store/reports.js';
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
    private readonly logger: Logger,
    private readonly deps: DeliveryDeps = {},
  ) {}

  async deliver(
    client: Client,
    subscription: Subscription,
    period: Period,
  ): Promise<DeliveryResult> {
    if (subscription.mode === 'live') {
      const publish = this.deps.publishLive ?? publishTrending;
      const message: Message = await publish(client, subscription, period);
      return { posted: true, messageUrl: message.url };
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
    const message = await publish(client, subscription, report, previous);
    return { posted: true, report, messageUrl: message.url };
  }
}
