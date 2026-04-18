import Fastify from "fastify";
import { spawn } from "node:child_process";

import { DiscordBootstrapService } from "../core/bootstrap/discord-bootstrap.js";
import type { DatabaseClient } from "../persistence/db.js";
import type { RepoRegistry } from "../core/repo-registry.js";
import type { UsageMetricsService } from "../core/usage-metrics.js";
import type { SummaryRenderer } from "../core/summary-renderer.js";
import type { Client } from "discord.js";
import type { EnvironmentConfig } from "../types/domain.js";

export interface ReadyState {
  discordConnected: boolean;
  configLoaded: boolean;
  codexAuthHealthy: boolean;
}

export interface ApiServerDependencies {
  env: EnvironmentConfig;
  db: DatabaseClient;
  repoRegistry: RepoRegistry;
  usageMetrics: UsageMetricsService;
  summaryRenderer: SummaryRenderer;
  readyState: ReadyState;
  discordClient: Client;
}

export async function createApiServer(deps: ApiServerDependencies) {
  const fastify = Fastify();

  fastify.get("/healthz", async () => ({
    ok: true
  }));

  fastify.get("/readyz", async () => ({
    ok:
      deps.readyState.discordConnected &&
      deps.readyState.configLoaded &&
      deps.readyState.codexAuthHealthy,
    ...deps.readyState
  }));

  fastify.get("/admin/sessions/:id", async (request, reply) => {
    const params = request.params as { id: string };
    const session = deps.db.getSessionById(params.id);
    if (!session) {
      reply.code(404);
      return { error: "Session not found" };
    }
    const latestRun = deps.db.getLatestRunForSession(session.id);
    const events = deps.db.listEvents(session.id);
    return {
      session,
      latestRun,
      events
    };
  });

  fastify.post("/admin/reload-config", async () => ({
    ok: true,
    message:
      "Config reload is handled by process restart in this implementation."
  }));

  fastify.post("/admin/bootstrap-discord", async () => {
    const bootstrap = new DiscordBootstrapService(deps.discordClient);
    return bootstrap.ensureStructure({
      guildId: deps.env.discordGuildId,
      repos: deps.repoRegistry.listRepos(),
      mode: deps.env.discordBootstrapMode,
      globalChannels: {
        chatChannelId: deps.env.chatChannelId,
        statusChannelId: deps.env.statusChannelId,
        usageChannelId: deps.env.usageChannelId,
        auditChannelId: deps.env.auditChannelId,
        approvalsChannelId: deps.env.approvalsChannelId
      }
    });
  });

  fastify.post("/admin/usage-rollups", async () => {
    const date = new Date().toISOString().slice(0, 10);
    const rollups = deps.usageMetrics.persistDailyRollups(date);
    return {
      ok: true,
      message: deps.summaryRenderer.renderUsageMetrics(date, rollups)
    };
  });

  return fastify;
}

export async function checkCodexAuth(codexBin: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(codexBin, ["login", "status"], {
      env: process.env
    });
    child.on("close", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
}
