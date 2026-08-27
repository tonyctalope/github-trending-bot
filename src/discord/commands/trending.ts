import {
  ChannelType,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type GuildTextBasedChannel,
} from 'discord.js';
import {
  MAX_LIMIT,
  MODES,
  STYLES,
  cronFor,
  type Mode,
  type Style,
  type Subscription,
} from '../../config/schema.js';
import { PERIODS, isPeriod, type Period } from '../../trending/types.js';
import { checkChannelAccess } from '../publish.js';
import type { DeliveryResult } from '../../delivery.js';
import type { Client } from 'discord.js';
import type { SubscriptionStore } from '../../store/subscriptions.js';
import type { Scheduler } from '../../scheduler/scheduler.js';
import type { Logger } from '../../logger.js';

const PERIOD_CHOICES = [
  { name: 'daily', value: 'daily' },
  { name: 'weekly', value: 'weekly' },
  { name: 'monthly', value: 'monthly' },
  { name: 'all (daily + weekly + monthly)', value: 'all' },
];

const POSTABLE_CHANNELS = [
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
] as const;

export const trendingCommand = new SlashCommandBuilder()
  .setName('trending')
  .setDescription('Schedule GitHub trending digests in this server')
  .setContexts(InteractionContextType.Guild)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((sub) =>
    sub
      .setName('subscribe')
      .setDescription('Post a trending digest in a channel on a schedule')
      .addStringOption((option) =>
        option
          .setName('period')
          .setDescription('Which trending window to post')
          .setRequired(true)
          .addChoices(...PERIOD_CHOICES),
      )
      .addChannelOption((option) =>
        option
          .setName('channel')
          .setDescription('Target channel (defaults to the current one)')
          .addChannelTypes(...POSTABLE_CHANNELS),
      )
      .addStringOption((option) =>
        option
          .setName('language')
          .setDescription('Filter by language, e.g. typescript, rust, go')
          .setAutocomplete(true),
      )
      .addIntegerOption((option) =>
        option
          .setName('limit')
          .setDescription(`How many repositories per post (1-${String(MAX_LIMIT)}, default 5)`)
          .setMinValue(1)
          .setMaxValue(MAX_LIMIT),
      )
      .addStringOption((option) =>
        option
          .setName('cron')
          .setDescription(
            'Override the schedule, e.g. "0 9 * * 1-5" (default: 09:00 daily/Monday/1st)',
          ),
      )
      .addStringOption((option) =>
        option.setName('timezone').setDescription('IANA time zone, e.g. Europe/Paris'),
      )
      .addStringOption((option) =>
        option
          .setName('style')
          .setDescription('Rich embed (default) or plain compact text')
          .addChoices(...STYLES.map((style) => ({ name: style, value: style }))),
      )
      .addStringOption((option) =>
        option
          .setName('spoken_language')
          .setDescription('Filter by the repository spoken language, e.g. fr, en'),
      )
      .addStringOption((option) =>
        option
          .setName('mode')
          .setDescription(
            'report = the closed period just ended (default) · live = trending right now',
          )
          .addChoices(...MODES.map((mode) => ({ name: mode, value: mode }))),
      ),
  )
  .addSubcommand((sub) => sub.setName('list').setDescription('List the digests configured here'))
  .addSubcommand((sub) =>
    sub
      .setName('unsubscribe')
      .setDescription('Remove a scheduled digest')
      .addStringOption((option) =>
        option
          .setName('id')
          .setDescription('Subscription id (see /trending list)')
          .setRequired(true)
          .setAutocomplete(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('now')
      .setDescription('Post a trending digest immediately, without scheduling it')
      .addStringOption((option) =>
        option
          .setName('period')
          .setDescription('Which trending window to post')
          .setRequired(true)
          .addChoices(...PERIOD_CHOICES.filter((choice) => choice.value !== 'all')),
      )
      .addChannelOption((option) =>
        option
          .setName('channel')
          .setDescription('Target channel (defaults to the current one)')
          .addChannelTypes(...POSTABLE_CHANNELS),
      )
      .addStringOption((option) =>
        option.setName('language').setDescription('Filter by language').setAutocomplete(true),
      )
      .addIntegerOption((option) =>
        option
          .setName('limit')
          .setDescription(`How many repositories (1-${String(MAX_LIMIT)})`)
          .setMinValue(1)
          .setMaxValue(MAX_LIMIT),
      )
      .addStringOption((option) =>
        option
          .setName('style')
          .setDescription('Rich embed (default) or plain compact text')
          .addChoices(...STYLES.map((style) => ({ name: style, value: style }))),
      )
      .addStringOption((option) =>
        option
          .setName('source')
          .setDescription('report = last closed period (default) · live = trending right now')
          .addChoices(...MODES.map((mode) => ({ name: mode, value: mode }))),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName('status').setDescription('Show scheduled jobs and their next run'),
  );

/** Languages offered by autocomplete; any other value is still accepted. */
export const SUGGESTED_LANGUAGES = [
  'typescript',
  'javascript',
  'python',
  'rust',
  'go',
  'java',
  'c',
  'c++',
  'c#',
  'php',
  'ruby',
  'kotlin',
  'swift',
  'elixir',
  'zig',
  'lua',
  'shell',
  'html',
  'css',
  'jupyter notebook',
];

export interface CommandContext {
  store: SubscriptionStore;
  scheduler: Scheduler;
  /** Subscriptions declared in the config file (read-only from Discord). */
  managed: () => Subscription[];
  resync: () => void;
  logger: Logger;
  /** Posts one digest: frozen period capture or live snapshot, per subscription. */
  deliver: (client: Client, subscription: Subscription, period: Period) => Promise<DeliveryResult>;
}

function periodsFromChoice(value: string): Period[] {
  if (value === 'all') return [...PERIODS];
  return isPeriod(value) ? [value] : [];
}

function describeSubscription(subscription: Subscription): string {
  const schedule = subscription.periods
    .map((period) => `${period} \`${cronFor(subscription, period)}\``)
    .join(', ');
  const extras = [
    subscription.mode === 'live' ? 'live snapshot' : 'closed period',
    subscription.language ? `lang: ${subscription.language}` : null,
    subscription.spokenLanguage ? `spoken: ${subscription.spokenLanguage}` : null,
    `top ${String(subscription.limit)}`,
    subscription.style,
    subscription.timezone,
  ]
    .filter(Boolean)
    .join(' · ');
  const lock = subscription.managed ? ' 🔒 (config file)' : '';
  return `**\`${subscription.id}\`**${lock} → <#${subscription.channelId}>\n· ${schedule}\n· ${extras}`;
}

function resolveTargetChannel(
  interaction: ChatInputCommandInteraction,
): GuildTextBasedChannel | string {
  const option = interaction.options.getChannel('channel');
  const channel = option ?? interaction.channel;
  if (!channel) return 'no channel resolved — pass the `channel` option explicitly';
  if (!('isTextBased' in channel) || !channel.isTextBased() || channel.isDMBased()) {
    return 'the target must be a text channel of this server';
  }
  const problem = checkChannelAccess(channel, interaction.client);
  return problem ?? channel;
}

async function handleSubscribe(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
): Promise<void> {
  const target = resolveTargetChannel(interaction);
  if (typeof target === 'string') {
    await interaction.editReply(`❌ ${target}`);
    return;
  }

  const periods = periodsFromChoice(interaction.options.getString('period', true));
  if (periods.length === 0) {
    await interaction.editReply('❌ unknown period');
    return;
  }

  try {
    const subscription = await context.store.add(
      {
        channelId: target.id,
        guildId: interaction.guildId,
        periods,
        language: interaction.options.getString('language'),
        spokenLanguage: interaction.options.getString('spoken_language'),
        limit: interaction.options.getInteger('limit') ?? undefined,
        cron: interaction.options.getString('cron'),
        timezone: interaction.options.getString('timezone') ?? undefined,
        style: (interaction.options.getString('style') as Style | null) ?? undefined,
        mode: (interaction.options.getString('mode') as Mode | null) ?? undefined,
      },
      interaction.user.id,
    );
    context.resync();
    const next = context.scheduler
      .status()
      .filter((job) => job.subscriptionId === subscription.id)
      .map((job) => `· ${job.period}: next ${job.nextRun ?? 'never'}`)
      .join('\n');
    await interaction.editReply(`✅ subscribed\n${describeSubscription(subscription)}\n${next}`);
  } catch (cause) {
    context.logger.warn({ err: cause }, 'subscribe rejected');
    await interaction.editReply(`❌ ${(cause as Error).message}`);
  }
}

async function handleList(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
): Promise<void> {
  const all = [...context.managed(), ...context.store.list()].filter(
    (subscription) => subscription.guildId == null || subscription.guildId === interaction.guildId,
  );
  if (all.length === 0) {
    await interaction.editReply('No digest configured yet — try `/trending subscribe`.');
    return;
  }
  await interaction.editReply(all.map(describeSubscription).join('\n\n').slice(0, 1900));
}

async function handleUnsubscribe(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
): Promise<void> {
  const id = interaction.options.getString('id', true).trim();
  if (context.managed().some((subscription) => subscription.id === id)) {
    await interaction.editReply(
      `❌ \`${id}\` comes from the config file: remove it there and restart the bot.`,
    );
    return;
  }
  const removed = await context.store.remove(id);
  if (!removed) {
    await interaction.editReply(`❌ no subscription with id \`${id}\``);
    return;
  }
  context.resync();
  await interaction.editReply(`🗑️ removed \`${id}\` (was posting in <#${removed.channelId}>)`);
}

async function handleNow(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
): Promise<void> {
  const target = resolveTargetChannel(interaction);
  if (typeof target === 'string') {
    await interaction.editReply(`❌ ${target}`);
    return;
  }
  const periodValue = interaction.options.getString('period', true);
  if (!isPeriod(periodValue)) {
    await interaction.editReply('❌ unknown period');
    return;
  }

  const draft: Subscription = {
    id: 'adhoc',
    channelId: target.id,
    guildId: interaction.guildId,
    periods: [periodValue],
    language: interaction.options.getString('language'),
    spokenLanguage: null,
    limit: interaction.options.getInteger('limit') ?? 5,
    cron: null,
    timezone: 'UTC',
    style: (interaction.options.getString('style') as Style | null) ?? 'embed',
    mode: (interaction.options.getString('source') as Mode | null) ?? 'report',
    onMissingReport: 'capture',
    managed: false,
    createdBy: interaction.user.id,
    createdAt: new Date().toISOString(),
  };

  try {
    const result = await context.deliver(interaction.client, draft, periodValue);
    await interaction.editReply(
      result.posted
        ? `✅ posted in <#${target.id}> — ${result.messageUrl ?? ''}`
        : `⏳ nothing posted: ${result.reason ?? 'unknown reason'}`,
    );
  } catch (cause) {
    context.logger.warn({ err: cause }, 'ad-hoc post failed');
    await interaction.editReply(`❌ ${(cause as Error).message}`);
  }
}

async function handleStatus(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
): Promise<void> {
  const jobs = context.scheduler.status();
  if (jobs.length === 0) {
    await interaction.editReply('No job scheduled.');
    return;
  }
  const lines = jobs
    .sort((a, b) => (a.nextRun ?? '').localeCompare(b.nextRun ?? ''))
    .map((job) => {
      const where = job.kind === 'capture' ? '🧊 freezes the page' : `<#${job.channelId ?? '?'}>`;
      return `\`${job.key}\` ${where} ${job.period} · \`${job.cron}\` (${job.timezone}) → ${job.nextRun ?? 'never'}`;
    });
  await interaction.editReply(lines.join('\n').slice(0, 1900));
}

export async function handleTrendingCommand(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  switch (interaction.options.getSubcommand()) {
    case 'subscribe':
      return handleSubscribe(interaction, context);
    case 'list':
      return handleList(interaction, context);
    case 'unsubscribe':
      return handleUnsubscribe(interaction, context);
    case 'now':
      return handleNow(interaction, context);
    case 'status':
      return handleStatus(interaction, context);
    default:
      await interaction.editReply('❌ unknown subcommand');
  }
}

export async function handleTrendingAutocomplete(
  interaction: AutocompleteInteraction,
  context: CommandContext,
): Promise<void> {
  const focused = interaction.options.getFocused(true);
  const query = focused.value.toLowerCase();

  if (focused.name === 'language') {
    const matches = SUGGESTED_LANGUAGES.filter((language) => language.includes(query)).slice(0, 25);
    await interaction.respond(matches.map((language) => ({ name: language, value: language })));
    return;
  }

  if (focused.name === 'id') {
    const options = [...context.managed(), ...context.store.list()]
      .filter((subscription) => subscription.id.includes(query))
      .slice(0, 25)
      .map((subscription) => ({
        name: `${subscription.id} · ${subscription.periods.join('+')}${subscription.managed ? ' (config file)' : ''}`,
        value: subscription.id,
      }));
    await interaction.respond(options);
    return;
  }

  await interaction.respond([]);
}
