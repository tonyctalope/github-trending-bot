import {
  PermissionFlagsBits,
  type Client,
  type GuildTextBasedChannel,
  type Message,
  type MessageCreateOptions,
} from 'discord.js';
import { fetchTrending } from '../trending/client.js';
import type { Period, TrendingRepo } from '../trending/types.js';
import type { TrendingReport } from '../trending/report.js';
import { renderReport, renderTrending } from './render.js';
import { selectRepos } from '../trending/select.js';
import type { Subscription } from '../config/schema.js';

export const REQUIRED_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
];

export class PublishError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PublishError';
  }
}

/** What the publisher asks the scraper for; injectable so tests stay offline. */
export interface FetchReposOptions {
  period: Period;
  language?: string | null;
  spokenLanguage?: string | null;
}

/** What a publish call posted, so the caller can remember it. */
export interface PublishOutcome {
  message: Message;
  chosen: TrendingRepo[];
}

export interface PublishDeps {
  fetchRepos?: (options: FetchReposOptions) => Promise<TrendingRepo[]>;
}

/** Human-readable reason why the bot cannot post in a channel, or `null` if it can. */
export function checkChannelAccess(channel: GuildTextBasedChannel, client: Client): string | null {
  const me = client.user;
  if (!me) return 'the bot is not logged in yet';
  const permissions = channel.permissionsFor(me);
  if (!permissions) return `cannot resolve my permissions in <#${channel.id}>`;
  const missing = REQUIRED_PERMISSIONS.filter((flag) => !permissions.has(flag));
  if (missing.length > 0) {
    const names = missing.map((flag) => {
      const entry = Object.entries(PermissionFlagsBits).find(([, value]) => value === flag);
      return entry?.[0] ?? String(flag);
    });
    return `missing permission(s) in <#${channel.id}>: ${names.join(', ')}`;
  }
  return null;
}

async function resolveChannel(client: Client, channelId: string): Promise<GuildTextBasedChannel> {
  const channel = await client.channels.fetch(channelId).catch((cause: unknown) => {
    throw new PublishError(`channel ${channelId} is unreachable: ${(cause as Error).message}`);
  });
  if (!channel) throw new PublishError(`channel ${channelId} does not exist`);
  if (!channel.isTextBased() || channel.isDMBased()) {
    throw new PublishError(`channel ${channelId} is not a guild text channel`);
  }
  const problem = checkChannelAccess(channel, client);
  if (problem) throw new PublishError(problem);
  return channel;
}

/**
 * Sends the payloads in order and returns the first message, which anchors the
 * digest: the `links` style needs one message per five repositories so Discord
 * previews every one of them.
 */
async function sendAll(
  channel: GuildTextBasedChannel,
  payloads: readonly MessageCreateOptions[],
): Promise<Message> {
  const sent: Message[] = [];
  for (const payload of payloads) {
    sent.push(await channel.send(payload));
  }
  const first = sent[0];
  if (!first) throw new PublishError('the renderer produced no message');
  return first;
}

export async function publishTrending(
  client: Client,
  subscription: Subscription,
  period: Period,
  deps: PublishDeps = {},
  exclude?: ReadonlySet<string>,
): Promise<PublishOutcome> {
  const fetchRepos = deps.fetchRepos ?? fetchTrending;
  const repos = await fetchRepos({
    period,
    language: subscription.language,
    spokenLanguage: subscription.spokenLanguage,
  });
  const channel = await resolveChannel(client, subscription.channelId);
  const { chosen } = selectRepos(repos, {
    ranking: subscription.rank,
    limit: subscription.limit,
    exclude,
  });
  const message = await sendAll(
    channel,
    renderTrending({
      period,
      repos,
      limit: subscription.limit,
      style: subscription.style,
      ranking: subscription.rank,
      exclude,
      language: subscription.language,
      spokenLanguage: subscription.spokenLanguage,
    }),
  );
  return { message, chosen };
}

/** Posts a frozen period capture (the `report` mode). */
export async function publishReport(
  client: Client,
  subscription: Subscription,
  report: TrendingReport,
  previous?: TrendingReport | null,
  exclude?: ReadonlySet<string>,
): Promise<PublishOutcome> {
  const channel = await resolveChannel(client, subscription.channelId);
  const { chosen } = selectRepos(report.repos, {
    ranking: subscription.rank,
    limit: subscription.limit,
    exclude,
  });
  const message = await sendAll(
    channel,
    renderReport({
      report,
      previous,
      limit: subscription.limit,
      style: subscription.style,
      ranking: subscription.rank,
      exclude,
    }),
  );
  return { message, chosen };
}
