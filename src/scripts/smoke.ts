import { config as loadDotenv } from "dotenv";

import { checkCodexAuth } from "../api/server.js";
import { loadEnv } from "../config/env.js";
import { loadRepoMap } from "../config/load-config.js";
import { DatabaseClient } from "../persistence/db.js";

loadDotenv({ path: ".env", quiet: true });
loadDotenv({ path: ".secrets/.env.local", quiet: true, override: true });

const env = loadEnv();
const repoMap = await loadRepoMap(env.chatopsRepoMapPath);
const db = new DatabaseClient(env.chatopsDbPath);
const codexAuthHealthy = await checkCodexAuth(env.codexBin);

db.syncRepoConfig(repoMap.repos, {
  statusChannelId: env.statusChannelId,
  usageChannelId: env.usageChannelId,
  auditChannelId: env.auditChannelId,
  approvalsChannelId: env.approvalsChannelId
});

console.log(
  JSON.stringify(
    {
      codexAuthHealthy,
      repoCount: repoMap.repos.length,
      dbPath: env.chatopsDbPath,
      guildId: env.discordGuildId,
      bootstrapMode: env.discordBootstrapMode
    },
    null,
    2
  )
);

db.close();
