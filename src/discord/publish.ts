import {
  PermissionFlagsBits,
  type Client,
  type GuildTextBasedChannel,
  type Message,
} from 'discord.js';
import { fetchTrending } from '../trending/client.js';
import type { Period, TrendingRepo } from '../trending/types.js';
import type { TrendingReport } from '../trending/report.js';
import { renderReport, renderTrending } from './render.js';
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

export async function publishTrending(
  client: Client,
  subscription: Subscription,
  period: Period,
  deps: PublishDeps = {},
): Promise<Message> {
  const fetchRepos = deps.fetchRepos ?? fetchTrending;
  const repos = await fetchRepos({
    period,
    language: subscription.language,
    spokenLanguage: subscription.spokenLanguage,
  });
  const channel = await resolveChannel(client, subscription.channelId);
  const message = renderTrending({
    period,
    repos,
    limit: subscription.limit,
    style: subscription.style,
    language: subscription.language,
    spokenLanguage: subscription.spokenLanguage,
  });
  return channel.send(message);
}

/** Posts a frozen period capture (the `report` mode). */
export async function publishReport(
  client: Client,
  subscription: Subscription,
  report: TrendingReport,
  previous?: TrendingReport | null,
): Promise<Message> {
  const channel = await resolveChannel(client, subscription.channelId);
  const message = renderReport({
    report,
    previous,
    limit: subscription.limit,
    style: subscription.style,
  });
  return channel.send(message);
}
