import { Client, GatewayIntentBits, Partials } from 'discord.js';

/**
 * The bot only needs the `Guilds` intent: it never reads message content, so no
 * privileged intent has to be enabled in the developer portal.
 */
export function createClient(): Client {
  return new Client({
    intents: [GatewayIntentBits.Guilds],
    partials: [Partials.Channel],
    allowedMentions: { parse: [] },
  });
}
