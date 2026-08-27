import type { Client } from 'discord.js';
import { trendingCommand } from './commands/trending.js';
import type { Logger } from '../logger.js';

/**
 * Publishes the command set. Global by default (a few minutes to appear the
 * first time); instant when `DEV_GUILD_ID` targets a single guild.
 */
export async function registerCommands(
  client: Client,
  devGuildId: string | undefined,
  logger: Logger,
): Promise<void> {
  if (!client.application) throw new Error('client has no application — not logged in');
  const body = [trendingCommand.toJSON()];
  const registered = devGuildId
    ? await client.application.commands.set(body, devGuildId)
    : await client.application.commands.set(body);
  logger.info(
    { scope: devGuildId ? `guild:${devGuildId}` : 'global', commands: registered.size },
    'slash commands registered',
  );
}
