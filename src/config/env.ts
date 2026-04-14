import path from "node:path";

import { z } from "zod";

import type { EnvironmentConfig } from "../types/domain.js";

const envSchema = z.object({
  DISCORD_BOT_TOKEN: z.string().min(1),
  DISCORD_APPLICATION_ID: z.string().min(1),
  DISCORD_PUBLIC_KEY: z.string().min(1).optional(),
  DISCORD_GUILD_ID: z.string().min(1),
  DISCORD_OPERATOR_PASSWORD: z.string().min(1).optional(),
  CHATOPS_DB_PATH: z.string().min(1).default(".chatops/chatops.sqlite"),
  CHATOPS_ROOT: z.string().min(1).default(".chatops"),
  CHATOPS_REPO_MAP_PATH: z.string().min(1).default(".secrets/repo-map.yaml"),
  CODEX_MODE: z.enum(["sdk", "exec"]).default("sdk"),
  CODEX_BIN: z.string().min(1).default("codex"),
  CODEX_PROFILE: z.string().min(1).optional(),
  ALLOW_THREAD_PLAIN_REPLY: z
    .string()
    .default("false")
    .transform((value) => value === "true"),
  ENABLE_PRS: z
    .string()
    .default("true")
    .transform((value) => value === "true"),
  ENABLE_DEPLOYS: z
    .string()
    .default("true")
    .transform((value) => value === "true"),
  ENABLE_DISCORD_BOOTSTRAP: z
    .string()
    .default("true")
    .transform((value) => value === "true"),
  DISCORD_BOOTSTRAP_MODE: z
    .enum(["validate", "create-missing"])
    .default("create-missing"),
  STATUS_CHANNEL_ID: z.string().min(1).optional(),
  USAGE_CHANNEL_ID: z.string().min(1).optional(),
  AUDIT_CHANNEL_ID: z.string().min(1).optional(),
  APPROVALS_CHANNEL_ID: z.string().min(1).optional(),
  GITHUB_TOKEN: z.string().min(1).optional(),
  GITHUB_USE_GH_CLI: z
    .string()
    .default("false")
    .transform((value) => value === "true"),
  FASTIFY_HOST: z.string().min(1).default("127.0.0.1"),
  FASTIFY_PORT: z
    .string()
    .default("3000")
    .transform((value) => Number.parseInt(value, 10))
    .pipe(z.number().int().positive())
});

export function loadEnv(
  input: NodeJS.ProcessEnv = process.env
): EnvironmentConfig {
  const parsed = envSchema.parse(input);
  const cwd = process.cwd();

  return {
    discordBotToken: parsed.DISCORD_BOT_TOKEN,
    discordApplicationId: parsed.DISCORD_APPLICATION_ID,
    discordPublicKey: parsed.DISCORD_PUBLIC_KEY,
    discordGuildId: parsed.DISCORD_GUILD_ID,
    discordOperatorPassword: parsed.DISCORD_OPERATOR_PASSWORD,
    chatopsDbPath: path.resolve(cwd, parsed.CHATOPS_DB_PATH),
    chatopsRoot: path.resolve(cwd, parsed.CHATOPS_ROOT),
    chatopsRepoMapPath: path.resolve(cwd, parsed.CHATOPS_REPO_MAP_PATH),
    codexMode: parsed.CODEX_MODE,
    codexBin: parsed.CODEX_BIN,
    codexProfile: parsed.CODEX_PROFILE,
    allowThreadPlainReply: parsed.ALLOW_THREAD_PLAIN_REPLY,
    enablePrs: parsed.ENABLE_PRS,
    enableDeploys: parsed.ENABLE_DEPLOYS,
    enableDiscordBootstrap: parsed.ENABLE_DISCORD_BOOTSTRAP,
    discordBootstrapMode: parsed.DISCORD_BOOTSTRAP_MODE,
    statusChannelId: parsed.STATUS_CHANNEL_ID,
    usageChannelId: parsed.USAGE_CHANNEL_ID,
    auditChannelId: parsed.AUDIT_CHANNEL_ID,
    approvalsChannelId: parsed.APPROVALS_CHANNEL_ID,
    githubToken: parsed.GITHUB_TOKEN,
    githubUseGhCli: parsed.GITHUB_USE_GH_CLI,
    fastifyHost: parsed.FASTIFY_HOST,
    fastifyPort: parsed.FASTIFY_PORT
  };
}
