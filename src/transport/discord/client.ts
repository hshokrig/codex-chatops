import {
  Client,
  GatewayIntentBits,
  Partials,
  type RESTPostAPIApplicationCommandsJSONBody
} from "discord.js";

import { slashCommands } from "./interaction-handler.js";
import type { EnvironmentConfig } from "../../types/domain.js";

export function createDiscordClient(env: EnvironmentConfig): Client {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMembers,
      ...(env.allowThreadPlainReply ? [GatewayIntentBits.MessageContent] : [])
    ],
    partials: [Partials.Channel]
  });
}

export async function registerSlashCommands(
  client: Client,
  guildId: string
): Promise<void> {
  if (!client.application) {
    throw new Error("Discord application is not ready");
  }
  const commands = slashCommands as RESTPostAPIApplicationCommandsJSONBody[];
  await client.application.commands.set(commands, guildId);
}
