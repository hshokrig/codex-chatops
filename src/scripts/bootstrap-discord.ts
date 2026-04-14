import { config as loadDotenv } from "dotenv";

import { loadEnv } from "../config/env.js";
import { loadRepoMap } from "../config/load-config.js";
import {
  createDiscordClient,
  registerSlashCommands
} from "../transport/discord/client.js";
import { DiscordBootstrapService } from "../core/bootstrap/discord-bootstrap.js";

loadDotenv({ path: ".env", quiet: true });
loadDotenv({ path: ".secrets/.env.local", quiet: true, override: true });

const env = loadEnv();
const repoMap = await loadRepoMap(env.chatopsRepoMapPath);
const client = createDiscordClient(env);

client.once("clientReady", async () => {
  await registerSlashCommands(client, env.discordGuildId);
  const bootstrap = new DiscordBootstrapService(client);
  const report = await bootstrap.ensureStructure({
    guildId: env.discordGuildId,
    repos: repoMap.repos,
    mode: env.discordBootstrapMode,
    globalChannels: {
      statusChannelId: env.statusChannelId,
      usageChannelId: env.usageChannelId,
      auditChannelId: env.auditChannelId,
      approvalsChannelId: env.approvalsChannelId
    }
  });
  console.log(JSON.stringify(report, null, 2));
  await client.destroy();
});

await client.login(env.discordBotToken);
