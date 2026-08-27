import { Events, MessageFlags, type Client, type Interaction } from 'discord.js';
import { createClient } from './discord/client.js';
import { registerCommands } from './discord/register.js';
import {
  handleTrendingAutocomplete,
  handleTrendingCommand,
  type CommandContext,
} from './discord/commands/trending.js';
import { publishTrending } from './discord/publish.js';
import { Scheduler } from './scheduler/scheduler.js';
import type { Env } from './config/env.js';
import type { Subscription } from './config/schema.js';
import type { SubscriptionStore } from './store/subscriptions.js';
import type { Logger } from './logger.js';
import type { HealthStatus } from './health.js';

export interface BotOptions {
  env: Env;
  store: SubscriptionStore;
  /** Subscriptions from the config file: reapplied at every boot. */
  managed: Subscription[];
  logger: Logger;
}

export class Bot {
  readonly client: Client;
  readonly scheduler: Scheduler;
  private ready = false;

  constructor(private readonly options: BotOptions) {
    this.client = createClient();
    this.scheduler = new Scheduler(async (subscription, period) => {
      await publishTrending(this.client, subscription, period);
    }, options.logger);
  }

  subscriptions(): Subscription[] {
    return [...this.options.managed, ...this.options.store.list()];
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
            channelId: job.subscription.channelId,
          },
          'job scheduled',
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

  healthStatus(): HealthStatus {
    return {
      status: this.ready ? 'ok' : 'starting',
      uptimeSeconds: Math.round(process.uptime()),
      user: this.client.user?.tag ?? null,
      guilds: this.client.guilds.cache.size,
      subscriptions: this.subscriptions().length,
      jobs: this.scheduler.status(),
    };
  }

  async stop(): Promise<void> {
    this.scheduler.stop();
    await this.client.destroy();
  }
}
