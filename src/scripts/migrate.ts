import { config as loadDotenv } from "dotenv";

import { loadEnv } from "../config/env.js";
import { loadRepoMap } from "../config/load-config.js";
import { DatabaseClient } from "../persistence/db.js";

loadDotenv({ path: ".env", quiet: true });
loadDotenv({ path: ".secrets/.env.local", quiet: true, override: true });

const env = loadEnv();
const repoMap = await loadRepoMap(env.chatopsRepoMapPath);
const db = new DatabaseClient(env.chatopsDbPath);

db.syncRepoConfig(repoMap.repos, {
  chatChannelId: env.chatChannelId,
  statusChannelId: env.statusChannelId,
  usageChannelId: env.usageChannelId,
  auditChannelId: env.auditChannelId,
  approvalsChannelId: env.approvalsChannelId
});

console.log(`Database initialized at ${env.chatopsDbPath}`);
console.log(`Loaded ${repoMap.repos.length} repo definitions.`);

db.close();
