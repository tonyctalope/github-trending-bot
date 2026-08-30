import { Events, MessageFlags, type Client, type Interaction } from 'discord.js';
import { createClient } from './discord/client.js';
import { registerCommands } from './discord/register.js';
import {
  handleTrendingAutocomplete,
  handleTrendingCommand,
  type CommandContext,
} from './discord/commands/trending.js';
import { captureSlicesFor, runCapture } from './capture.js';
import { Deliverer } from './delivery.js';
import { Scheduler, type CaptureJobPlan } from './scheduler/scheduler.js';
import { PERIODS, type Period } from './trending/types.js';
import type { Env } from './config/env.js';
import type { Subscription } from './config/schema.js';
import type { SubscriptionStore } from './store/subscriptions.js';
import type { ReportStore } from './store/reports.js';
import type { HistoryStore } from './store/history.js';
import type { Logger } from './logger.js';
import type { HealthStatus } from './health.js';

export interface BotOptions {
  env: Env;
  store: SubscriptionStore;
  reports: ReportStore;
  history: HistoryStore;
  /** Subscriptions from the config file: reapplied at every boot. */
  managed: Subscription[];
  logger: Logger;
}

export class Bot {
  readonly client: Client;
  readonly scheduler: Scheduler;
  readonly deliverer: Deliverer;
  private ready = false;

  constructor(private readonly options: BotOptions) {
    this.client = createClient();
    this.deliverer = new Deliverer(options.reports, options.history, options.logger);
    this.scheduler = new Scheduler(
      async (subscription, period) => {
        const result = await this.deliverer.deliver(this.client, subscription, period);
        if (!result.posted) {
          options.logger.warn(
            { subscription: subscription.id, period, reason: result.reason },
            'nothing posted for a due job',
          );
        }
      },
      options.logger,
      async (period) => {
        await this.capture(period);
      },
    );
  }

  subscriptions(): Subscription[] {
    return [...this.options.managed, ...this.options.store.list()];
  }

  /** Nightly boundary captures, one per period (UTC by default). */
  capturePlans(): CaptureJobPlan[] {
    const { env } = this.options;
    if (!env.CAPTURE_ENABLED) return [];
    return [
      { period: 'daily', cron: env.CAPTURE_CRON_DAILY, timezone: env.CAPTURE_TIMEZONE },
      { period: 'weekly', cron: env.CAPTURE_CRON_WEEKLY, timezone: env.CAPTURE_TIMEZONE },
      { period: 'monthly', cron: env.CAPTURE_CRON_MONTHLY, timezone: env.CAPTURE_TIMEZONE },
    ];
  }

  async capture(period: Period): Promise<void> {
    const slices = captureSlicesFor(this.subscriptions(), period);
    await runCapture(this.options.reports, period, slices, {}, this.options.logger);
  }

  /**
   * Read from disk on every call, never cached: a one-shot `capture` container
   * writes to the same volume, and a stale cache would report `null` while the
   * captures are right there.
   */
  private async latestCaptures(): Promise<Record<Period, string | null>> {
    const entries = await Promise.all(
      PERIODS.map(async (period) => {
        const latest = await this.options.reports.latest(period);
        return [period, latest?.key ?? null] as const;
      }),
    );
    return Object.fromEntries(entries) as Record<Period, string | null>;
  }

  private get commandContext(): CommandContext {
    return {
      store: this.options.store,
      scheduler: this.scheduler,
      managed: () => [...this.options.managed],
      resync: () => {
        this.scheduler.sync(this.subscriptions());
      },
      logger: this.options.logger,
      deliver: (client, subscription, period) =>
        this.deliverer.deliver(client, subscription, period),
    };
  }

  async start(token: string): Promise<void> {
    const { logger, env } = this.options;

    this.client.once(Events.ClientReady, (client) => {
      this.ready = true;
      logger.info(
        { user: client.user.tag, guilds: client.guilds.cache.size },
        'connected to Discord',
      );
      for (const job of this.scheduler.sync(this.subscriptions())) {
        logger.info(
          {
            job: job.key,
            cron: job.cron,
            timezone: job.timezone,
            mode: job.subscription.mode,
            channelId: job.subscription.channelId,
          },
          'job scheduled',
        );
      }
      for (const plan of this.scheduler.syncCaptures(this.capturePlans())) {
        logger.info(
          { period: plan.period, cron: plan.cron, timezone: plan.timezone },
          'boundary capture scheduled',
        );
      }
      if (env.REGISTER_COMMANDS) {
        registerCommands(client, env.DEV_GUILD_ID, logger).catch((error: unknown) => {
          logger.error({ err: error }, 'could not register slash commands');
        });
      }
    });

    this.client.on(Events.InteractionCreate, (interaction) => {
      void this.route(interaction);
    });
    this.client.on(Events.Error, (error) => {
      logger.error({ err: error }, 'discord client error');
    });
    this.client.on(Events.Warn, (message) => {
      logger.warn({ message }, 'discord client warning');
    });

    await this.client.login(token);
  }

  private async route(interaction: Interaction): Promise<void> {
    const { logger } = this.options;
    try {
      if (interaction.isAutocomplete()) {
        if (interaction.commandName !== 'trending') return;
        await handleTrendingAutocomplete(interaction, this.commandContext);
        return;
      }
      if (!interaction.isChatInputCommand() || interaction.commandName !== 'trending') return;
      await handleTrendingCommand(interaction, this.commandContext);
    } catch (error) {
      logger.error({ err: error }, 'interaction handler failed');
      if (!interaction.isRepliable()) return;
      const content = `❌ unexpected error: ${(error as Error).message}`;
      const reply =
        interaction.deferred || interaction.replied
          ? interaction.editReply({ content })
          : interaction.reply({ content, flags: MessageFlags.Ephemeral });
      await reply.catch(() => undefined);
    }
  }

  async healthStatus(): Promise<HealthStatus> {
    return {
      status: this.ready ? 'ok' : 'starting',
      uptimeSeconds: Math.round(process.uptime()),
      user: this.client.user?.tag ?? null,
      guilds: this.client.guilds.cache.size,
      subscriptions: this.subscriptions().length,
      latestCaptures: await this.latestCaptures(),
      jobs: this.scheduler.status(),
    };
  }

  async stop(): Promise<void> {
    this.scheduler.stop();
    await this.client.destroy();
  }
}
