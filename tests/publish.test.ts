import { PermissionFlagsBits, type Client, type GuildTextBasedChannel } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import {
  REQUIRED_PERMISSIONS,
  checkChannelAccess,
  publishTrending,
} from '../src/discord/publish.js';
import { subscriptionSchema, type Subscription } from '../src/config/schema.js';
import type { TrendingRepo } from '../src/trending/types.js';

const channelId = '123456789012345678';

const repos: TrendingRepo[] = [
  {
    fullName: 'owner/repo',
    owner: 'owner',
    name: 'repo',
    url: 'https://github.com/owner/repo',
    description: 'A repository',
    language: 'Go',
    languageColor: '#00ADD8',
    stars: 42,
    forks: 1,
    periodStars: 7,
    builtBy: [],
  },
];

function fakeChannel(granted: bigint[] = REQUIRED_PERMISSIONS): GuildTextBasedChannel & {
  send: ReturnType<typeof vi.fn>;
} {
  return {
    id: channelId,
    isTextBased: () => true,
    isDMBased: () => false,
    permissionsFor: () => ({ has: (flag: bigint) => granted.includes(flag) }),
    send: vi.fn(() => Promise.resolve({ url: 'https://discord.com/channels/1/2/3' })),
  } as unknown as GuildTextBasedChannel & { send: ReturnType<typeof vi.fn> };
}

function fakeClient(channel: unknown): Client {
  return {
    user: { id: '999999999999999999', tag: 'bot#0001' },
    channels: { fetch: vi.fn(() => Promise.resolve(channel)) },
  } as unknown as Client;
}

function subscription(overrides: Partial<Subscription> = {}): Subscription {
  return subscriptionSchema.parse({ id: 'sub1', channelId, periods: ['daily'], ...overrides });
}

describe('checkChannelAccess', () => {
  it('accepts a channel where every required permission is granted', () => {
    expect(checkChannelAccess(fakeChannel(), fakeClient(null))).toBeNull();
  });

  it('names the missing permissions', () => {
    const channel = fakeChannel([
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
    ]);
    expect(checkChannelAccess(channel, fakeClient(null))).toMatch(/EmbedLinks/);
  });

  it('reports a client that is not logged in', () => {
    const client = { user: null } as unknown as Client;
    expect(checkChannelAccess(fakeChannel(), client)).toMatch(/not logged in/);
  });

  it('reports unresolvable permissions', () => {
    const channel = {
      id: channelId,
      permissionsFor: () => null,
    } as unknown as GuildTextBasedChannel;
    expect(checkChannelAccess(channel, fakeClient(null))).toMatch(/cannot resolve my permissions/);
  });
});

describe('publishTrending', () => {
  it('sends the rendered digest to the subscription channel', async () => {
    const channel = fakeChannel();
    const client = fakeClient(channel);
    const fetchRepos = vi.fn(() => Promise.resolve(repos));

    await publishTrending(client, subscription({ limit: 3, language: 'go' }), 'weekly', {
      fetchRepos,
    });

    expect(fetchRepos.mock.calls[0]?.[0]).toMatchObject({ period: 'weekly', language: 'go' });
    const payload = channel.send.mock.calls[0]?.[0] as { embeds?: unknown[] };
    expect(payload.embeds).toHaveLength(1);
  });

  it('honours the compact style of the subscription', async () => {
    const channel = fakeChannel();
    await publishTrending(fakeClient(channel), subscription({ style: 'compact' }), 'daily', {
      fetchRepos: () => Promise.resolve(repos),
    });

    const payload = channel.send.mock.calls[0]?.[0] as { content?: string };
    expect(payload.content).toContain('owner/repo');
  });

  it('fails clearly when the channel no longer exists', async () => {
    await expect(
      publishTrending(fakeClient(null), subscription(), 'daily', {
        fetchRepos: () => Promise.resolve(repos),
      }),
    ).rejects.toThrow(/does not exist/);
  });

  it('fails clearly when the channel is a DM', async () => {
    const dm = { id: channelId, isTextBased: () => true, isDMBased: () => true };
    await expect(
      publishTrending(fakeClient(dm), subscription(), 'daily', {
        fetchRepos: () => Promise.resolve(repos),
      }),
    ).rejects.toThrow(/not a guild text channel/);
  });

  it('surfaces a permission problem instead of throwing a raw Discord error', async () => {
    const channel = fakeChannel([PermissionFlagsBits.ViewChannel]);
    await expect(
      publishTrending(fakeClient(channel), subscription(), 'daily', {
        fetchRepos: () => Promise.resolve(repos),
      }),
    ).rejects.toThrow(/missing permission/);
  });

  it('wraps an unreachable channel', async () => {
    const client = {
      user: { id: '999999999999999999' },
      channels: { fetch: () => Promise.reject(new Error('Missing Access')) },
    } as unknown as Client;

    await expect(
      publishTrending(client, subscription(), 'daily', {
        fetchRepos: () => Promise.resolve(repos),
      }),
    ).rejects.toThrow(/unreachable: Missing Access/);
  });

  it('does not send anything when scraping fails', async () => {
    const channel = fakeChannel();
    await expect(
      publishTrending(fakeClient(channel), subscription(), 'daily', {
        fetchRepos: () => Promise.reject(new Error('GitHub answered HTTP 503')),
      }),
    ).rejects.toThrow(/HTTP 503/);
    expect(channel.send).not.toHaveBeenCalled();
  });
});
