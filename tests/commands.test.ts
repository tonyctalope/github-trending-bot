import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pino } from 'pino';
import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  Client,
  GuildTextBasedChannel,
} from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  handleTrendingAutocomplete,
  handleTrendingCommand,
  trendingCommand,
  type CommandContext,
} from '../src/discord/commands/trending.js';
import { REQUIRED_PERMISSIONS } from '../src/discord/publish.js';
import { Scheduler } from '../src/scheduler/scheduler.js';
import { SubscriptionStore } from '../src/store/subscriptions.js';
import { subscriptionSchema, type Subscription } from '../src/config/schema.js';

const CURRENT_CHANNEL = '111111111111111111';
const OTHER_CHANNEL = '222222222222222222';
const GUILD = '333333333333333333';

const logger = pino({ level: 'silent' });

function fakeChannel(id: string, granted: bigint[] = REQUIRED_PERMISSIONS): GuildTextBasedChannel {
  return {
    id,
    isTextBased: () => true,
    isDMBased: () => false,
    permissionsFor: () => ({ has: (flag: bigint) => granted.includes(flag) }),
  } as unknown as GuildTextBasedChannel;
}

const client = { user: { id: '999999999999999999' } } as unknown as Client;

interface FakeOptions {
  subcommand: string;
  strings?: Record<string, string>;
  integers?: Record<string, number>;
  channel?: unknown;
  currentChannel?: unknown;
}

function fakeInteraction(options: FakeOptions): {
  interaction: ChatInputCommandInteraction;
  replies: string[];
} {
  const replies: string[] = [];
  const interaction = {
    client,
    guildId: GUILD,
    user: { id: '444444444444444444' },
    channel: options.currentChannel ?? fakeChannel(CURRENT_CHANNEL),
    options: {
      getSubcommand: () => options.subcommand,
      getString: (name: string) => options.strings?.[name] ?? null,
      getInteger: (name: string) => options.integers?.[name] ?? null,
      getChannel: () => options.channel ?? null,
    },
    deferReply: vi.fn(() => Promise.resolve()),
    editReply: vi.fn((content: string) => {
      replies.push(content);
      return Promise.resolve();
    }),
  } as unknown as ChatInputCommandInteraction;
  return { interaction, replies };
}

let store: SubscriptionStore;
let scheduler: Scheduler;
let managed: Subscription[];
let context: CommandContext;
let publish: ReturnType<typeof vi.fn>;
let resync: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'trending-cmd-'));
  store = SubscriptionStore.fromDataDir(dir);
  await store.load();
  scheduler = new Scheduler(() => Promise.resolve());
  managed = [];
  publish = vi.fn(() => Promise.resolve({ url: 'https://discord.com/channels/1/2/3' }));
  resync = vi.fn(() => {
    scheduler.sync([...managed, ...store.list()]);
  });
  context = {
    store,
    scheduler,
    managed: () => managed,
    resync,
    logger,
    publish: publish as unknown as CommandContext['publish'],
  };
});

afterEach(() => {
  scheduler.stop();
});

describe('command definition', () => {
  it('declares the five subcommands and requires Manage Server', () => {
    const json = trendingCommand.toJSON();
    expect(json.name).toBe('trending');
    expect(json.options?.map((option) => option.name)).toEqual([
      'subscribe',
      'list',
      'unsubscribe',
      'now',
      'status',
    ]);
    expect(json.default_member_permissions).toBe('32'); // ManageGuild
  });
});

describe('/trending subscribe', () => {
  it('defaults to the current channel and schedules the job', async () => {
    const { interaction, replies } = fakeInteraction({
      subcommand: 'subscribe',
      strings: { period: 'daily' },
    });

    await handleTrendingCommand(interaction, context);

    const [created] = store.list();
    expect(created).toMatchObject({
      channelId: CURRENT_CHANNEL,
      guildId: GUILD,
      periods: ['daily'],
      createdBy: '444444444444444444',
    });
    expect(resync).toHaveBeenCalled();
    expect(scheduler.size).toBe(1);
    expect(replies[0]).toContain('✅ subscribed');
    expect(replies[0]).toContain(created!.id);
  });

  it('expands "all" into the three periods, one job each', async () => {
    const { interaction } = fakeInteraction({
      subcommand: 'subscribe',
      strings: { period: 'all' },
    });

    await handleTrendingCommand(interaction, context);

    expect(store.list()[0]?.periods).toEqual(['daily', 'weekly', 'monthly']);
    expect(scheduler.size).toBe(3);
  });

  it('accepts an explicit channel and every filter', async () => {
    const { interaction, replies } = fakeInteraction({
      subcommand: 'subscribe',
      strings: {
        period: 'weekly',
        language: 'rust',
        cron: '30 7 * * 1',
        timezone: 'Europe/Paris',
        style: 'compact',
        spoken_language: 'fr',
      },
      integers: { limit: 12 },
      channel: fakeChannel(OTHER_CHANNEL),
    });

    await handleTrendingCommand(interaction, context);

    expect(store.list()[0]).toMatchObject({
      channelId: OTHER_CHANNEL,
      periods: ['weekly'],
      language: 'rust',
      spokenLanguage: 'fr',
      limit: 12,
      cron: '30 7 * * 1',
      timezone: 'Europe/Paris',
      style: 'compact',
    });
    expect(replies[0]).toContain('30 7 * * 1');
  });

  it('refuses an invalid cron without persisting anything', async () => {
    const { interaction, replies } = fakeInteraction({
      subcommand: 'subscribe',
      strings: { period: 'daily', cron: 'chaque matin' },
    });

    await handleTrendingCommand(interaction, context);

    expect(store.list()).toEqual([]);
    expect(replies[0]).toContain('❌');
    expect(replies[0]).toMatch(/cron/);
  });

  it('refuses a channel the bot cannot post in', async () => {
    const { interaction, replies } = fakeInteraction({
      subcommand: 'subscribe',
      strings: { period: 'daily' },
      channel: fakeChannel(OTHER_CHANNEL, []),
    });

    await handleTrendingCommand(interaction, context);

    expect(store.list()).toEqual([]);
    expect(replies[0]).toMatch(/missing permission/);
  });

  it('refuses a target that is not a text channel', async () => {
    const { interaction, replies } = fakeInteraction({
      subcommand: 'subscribe',
      strings: { period: 'daily' },
      channel: { id: OTHER_CHANNEL, isTextBased: () => false, isDMBased: () => false },
    });

    await handleTrendingCommand(interaction, context);
    expect(replies[0]).toMatch(/text channel/);
  });
});

describe('/trending list', () => {
  it('says when nothing is configured', async () => {
    const { interaction, replies } = fakeInteraction({ subcommand: 'list' });
    await handleTrendingCommand(interaction, context);
    expect(replies[0]).toMatch(/No digest configured/);
  });

  it('shows stored and config-file subscriptions, marking the locked ones', async () => {
    managed.push(
      subscriptionSchema.parse({
        id: 'file-1',
        channelId: OTHER_CHANNEL,
        guildId: GUILD,
        periods: ['monthly'],
        managed: true,
      }),
    );
    await store.add({ channelId: CURRENT_CHANNEL, guildId: GUILD, periods: ['daily'] });

    const { interaction, replies } = fakeInteraction({ subcommand: 'list' });
    await handleTrendingCommand(interaction, context);

    expect(replies[0]).toContain('file-1');
    expect(replies[0]).toContain('🔒');
    expect(replies[0]).toContain(`<#${CURRENT_CHANNEL}>`);
    expect(replies[0]).toContain('0 9 1 * *');
  });

  it('hides subscriptions belonging to another guild', async () => {
    await store.add({
      channelId: CURRENT_CHANNEL,
      guildId: '555555555555555555',
      periods: ['daily'],
    });
    const { interaction, replies } = fakeInteraction({ subcommand: 'list' });
    await handleTrendingCommand(interaction, context);
    expect(replies[0]).toMatch(/No digest configured/);
  });
});

describe('/trending unsubscribe', () => {
  it('removes a subscription and reschedules', async () => {
    const created = await store.add({
      channelId: CURRENT_CHANNEL,
      guildId: GUILD,
      periods: ['daily'],
    });
    resync();
    expect(scheduler.size).toBe(1);

    const { interaction, replies } = fakeInteraction({
      subcommand: 'unsubscribe',
      strings: { id: created.id },
    });
    await handleTrendingCommand(interaction, context);

    expect(store.list()).toEqual([]);
    expect(scheduler.size).toBe(0);
    expect(replies[0]).toContain('🗑️');
  });

  it('reports an unknown id', async () => {
    const { interaction, replies } = fakeInteraction({
      subcommand: 'unsubscribe',
      strings: { id: 'nope' },
    });
    await handleTrendingCommand(interaction, context);
    expect(replies[0]).toMatch(/no subscription with id/);
  });

  it('refuses to remove a config-file subscription', async () => {
    managed.push(
      subscriptionSchema.parse({
        id: 'file-1',
        channelId: OTHER_CHANNEL,
        periods: ['daily'],
        managed: true,
      }),
    );
    const { interaction, replies } = fakeInteraction({
      subcommand: 'unsubscribe',
      strings: { id: 'file-1' },
    });

    await handleTrendingCommand(interaction, context);
    expect(replies[0]).toMatch(/config file/);
    expect(managed).toHaveLength(1);
  });
});

describe('/trending now', () => {
  it('posts immediately without creating a subscription', async () => {
    const { interaction, replies } = fakeInteraction({
      subcommand: 'now',
      strings: { period: 'monthly', language: 'go' },
      integers: { limit: 3 },
    });

    await handleTrendingCommand(interaction, context);

    expect(store.list()).toEqual([]);
    const [, draft, period] = publish.mock.calls[0] as [unknown, Subscription, string];
    expect(draft).toMatchObject({ channelId: CURRENT_CHANNEL, language: 'go', limit: 3 });
    expect(period).toBe('monthly');
    expect(replies[0]).toContain('✅ posted');
  });

  it('reports why the post failed', async () => {
    publish.mockImplementation(() => Promise.reject(new Error('GitHub answered HTTP 503')));
    const { interaction, replies } = fakeInteraction({
      subcommand: 'now',
      strings: { period: 'daily' },
    });

    await handleTrendingCommand(interaction, context);
    expect(replies[0]).toContain('❌');
    expect(replies[0]).toContain('HTTP 503');
  });
});

describe('/trending status', () => {
  it('says when no job is scheduled', async () => {
    const { interaction, replies } = fakeInteraction({ subcommand: 'status' });
    await handleTrendingCommand(interaction, context);
    expect(replies[0]).toBe('No job scheduled.');
  });

  it('lists every job with its next run', async () => {
    await store.add({ channelId: CURRENT_CHANNEL, guildId: GUILD, periods: ['daily', 'weekly'] });
    resync();

    const { interaction, replies } = fakeInteraction({ subcommand: 'status' });
    await handleTrendingCommand(interaction, context);

    expect(replies[0]).toContain(':daily');
    expect(replies[0]).toContain(':weekly');
    expect(replies[0]).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });
});

describe('unknown subcommand', () => {
  it('answers instead of hanging the interaction', async () => {
    const { interaction, replies } = fakeInteraction({ subcommand: 'teleport' });
    await handleTrendingCommand(interaction, context);
    expect(replies[0]).toMatch(/unknown subcommand/);
  });
});

describe('autocomplete', () => {
  function fakeAutocomplete(
    name: string,
    value: string,
  ): {
    interaction: AutocompleteInteraction;
    responses: { name: string; value: string }[][];
  } {
    const responses: { name: string; value: string }[][] = [];
    const interaction = {
      options: { getFocused: () => ({ name, value }) },
      respond: vi.fn((choices: { name: string; value: string }[]) => {
        responses.push(choices);
        return Promise.resolve();
      }),
    } as unknown as AutocompleteInteraction;
    return { interaction, responses };
  }

  it('suggests matching languages', async () => {
    const { interaction, responses } = fakeAutocomplete('language', 'ty');
    await handleTrendingAutocomplete(interaction, context);
    expect(responses[0]?.map((choice) => choice.value)).toContain('typescript');
  });

  it('caps the language suggestions at the Discord maximum', async () => {
    const { interaction, responses } = fakeAutocomplete('language', '');
    await handleTrendingAutocomplete(interaction, context);
    expect(responses[0]?.length).toBeLessThanOrEqual(25);
  });

  it('suggests existing subscription ids, flagging the locked ones', async () => {
    const created = await store.add({ channelId: CURRENT_CHANNEL, periods: ['daily'] });
    managed.push(
      subscriptionSchema.parse({
        id: 'file-1',
        channelId: OTHER_CHANNEL,
        periods: ['weekly'],
        managed: true,
      }),
    );

    const { interaction, responses } = fakeAutocomplete('id', '');
    await handleTrendingAutocomplete(interaction, context);

    const values = responses[0] ?? [];
    expect(values.map((choice) => choice.value)).toEqual(['file-1', created.id]);
    expect(values[0]?.name).toContain('config file');
  });

  it('answers nothing for an unknown option', async () => {
    const { interaction, responses } = fakeAutocomplete('mystery', '');
    await handleTrendingAutocomplete(interaction, context);
    expect(responses[0]).toEqual([]);
  });
});
