import { config as loadDotenv } from "dotenv";
import {
  ActivityType,
  type MessageCreateOptions,
  type PresenceStatusData
} from "discord.js";

import { loadEnv } from "./config/env.js";
import { loadRepoMap } from "./config/load-config.js";
import { ArtifactWriter } from "./core/artifact-writer.js";
import { ApprovalService } from "./core/approvals.js";
import { DiscordBootstrapService } from "./core/bootstrap/discord-bootstrap.js";
import { CodexRunner } from "./core/codex-runner.js";
import { DeployRunner } from "./core/deploy-runner.js";
import { GitRunner } from "./core/git-runner.js";
import { PromptBuilder } from "./core/prompt-builder.js";
import { PullRequestRunner } from "./core/pr-runner.js";
import { RepoRegistry } from "./core/repo-registry.js";
import { RunOrchestrator } from "./core/run-orchestrator.js";
import { SessionManager } from "./core/session-manager.js";
import { SummaryRenderer } from "./core/summary-renderer.js";
import { UsageMetricsService } from "./core/usage-metrics.js";
import { VsCodeSessionBridge } from "./core/vscode-session-bridge.js";
import { logger } from "./lib/logger.js";
import { DatabaseClient } from "./persistence/db.js";
import {
  createApiServer,
  checkCodexAuth,
  type ReadyState
} from "./api/server.js";
import {
  createDiscordClient,
  registerSlashCommands
} from "./transport/discord/client.js";
import { buildCardMessage } from "./transport/discord/message-cards.js";
import { DiscordEventHandler } from "./transport/discord/event-handler.js";
import { DiscordInteractionHandler } from "./transport/discord/interaction-handler.js";
import { RunAuthorizationService } from "./transport/discord/run-authorization.js";
import { ThreadManager } from "./transport/discord/thread-manager.js";

function isSendableChannel(channel: unknown): channel is {
  send: (content: string | MessageCreateOptions) => Promise<unknown>;
} {
  return (
    Boolean(channel) &&
    typeof (channel as { send?: unknown }).send === "function"
  );
}

function buildStatusMessage(readyState: ReadyState): string {
  const ready =
    readyState.discordConnected &&
    readyState.configLoaded &&
    readyState.codexAuthHealthy;
  return [
    `ChatOps status: ${ready ? "READY" : "DEGRADED"}`,
    `Discord: ${readyState.discordConnected ? "connected" : "disconnected"}`,
    `Config: ${readyState.configLoaded ? "loaded" : "invalid"}`,
    `Codex CLI auth: ${readyState.codexAuthHealthy ? "available" : "unavailable"}`
  ].join("\n");
}

function buildPresence(readyState: ReadyState): {
  status: PresenceStatusData;
  activityType: ActivityType;
  activityName: string;
} {
  if (!readyState.discordConnected) {
    return {
      status: "dnd",
      activityType: ActivityType.Watching,
      activityName: "Discord unavailable"
    };
  }

  if (!readyState.codexAuthHealthy) {
    return {
      status: "idle",
      activityType: ActivityType.Watching,
      activityName: "Codex unavailable"
    };
  }

  return {
    status: "online",
    activityType: ActivityType.Watching,
    activityName: "Codex ready"
  };
}

export async function createApplication() {
  loadDotenv({ path: ".env", quiet: true });
  loadDotenv({ path: ".secrets/.env.local", quiet: true, override: true });

  const env = loadEnv();
  const repoMap = await loadRepoMap(env.chatopsRepoMapPath);
  const db = new DatabaseClient(env.chatopsDbPath);
  const repoRegistry = new RepoRegistry(db);
  repoRegistry.sync(repoMap.repos, {
    statusChannelId: env.statusChannelId,
    usageChannelId: env.usageChannelId,
    auditChannelId: env.auditChannelId,
    approvalsChannelId: env.approvalsChannelId
  });

  const artifactWriter = new ArtifactWriter(env.chatopsRoot);
  const gitRunner = new GitRunner();
  const summaryRenderer = new SummaryRenderer();
  const promptBuilder = new PromptBuilder();
  const codexRunner = new CodexRunner(env);
  const sessionManager = new SessionManager(
    db,
    gitRunner,
    artifactWriter,
    env.chatopsRoot
  );
  const runOrchestrator = new RunOrchestrator(
    db,
    codexRunner,
    gitRunner,
    artifactWriter,
    promptBuilder,
    summaryRenderer
  );
  const approvals = new ApprovalService(db);
  const prRunner = new PullRequestRunner(env);
  const deployRunner = new DeployRunner(env);
  const usageMetrics = new UsageMetricsService(db);
  const discordClient = createDiscordClient(env);
  const threadManager = new ThreadManager();
  const vsCodeSessionBridge = new VsCodeSessionBridge({
    client: discordClient,
    repoRegistry,
    summaryRenderer
  });
  const runAuthorization = new RunAuthorizationService(
    env.discordOperatorPassword
  );
  const activeRuns = new Map<string, AbortController>();
  const readyState: ReadyState = {
    discordConnected: false,
    configLoaded: true,
    codexAuthHealthy: await checkCodexAuth(env.codexBin)
  };
  let lastStatusMessage = "";

  const publishStatus = async (): Promise<void> => {
    if (!env.statusChannelId) {
      return;
    }
    const message = buildStatusMessage(readyState);
    if (message === lastStatusMessage) {
      return;
    }
    const channel = await discordClient.channels.fetch(env.statusChannelId);
    if (isSendableChannel(channel)) {
      await channel.send(
        buildCardMessage(message, {
          tone:
            readyState.discordConnected && readyState.codexAuthHealthy
              ? "success"
              : "warning",
          footer: "codex-status"
        })
      );
      lastStatusMessage = message;
    }
  };

  const publishPresence = (): void => {
    if (!discordClient.user) {
      return;
    }

    const presence = buildPresence(readyState);
    discordClient.user.setPresence({
      status: presence.status,
      activities: [
        {
          type: presence.activityType,
          name: presence.activityName
        }
      ]
    });
  };

  const eventHandler = new DiscordEventHandler({
    client: discordClient,
    env,
    db,
    repoRegistry,
    sessionManager,
    runOrchestrator,
    threadManager,
    summaryRenderer,
    activeRuns,
    runAuthorization
  });

  const interactionHandler = new DiscordInteractionHandler({
    client: discordClient,
    env,
    db,
    repoRegistry,
    sessionManager,
    approvals,
    gitRunner,
    prRunner,
    deployRunner,
    summaryRenderer,
    activeRuns,
    eventHandler,
    runAuthorization
  });

  eventHandler.register();
  interactionHandler.register();

  discordClient.once("clientReady", async () => {
    readyState.discordConnected = true;
    publishPresence();
    await registerSlashCommands(discordClient, env.discordGuildId);
    vsCodeSessionBridge.start();

    if (env.enableDiscordBootstrap) {
      const bootstrap = new DiscordBootstrapService(discordClient);
      const report = await bootstrap.ensureStructure({
        guildId: env.discordGuildId,
        repos: repoRegistry.listRepos(),
        mode: env.discordBootstrapMode,
        globalChannels: {
          statusChannelId: env.statusChannelId,
          usageChannelId: env.usageChannelId,
          auditChannelId: env.auditChannelId,
          approvalsChannelId: env.approvalsChannelId
        }
      });
      logger.info({ report }, "Discord bootstrap completed");
    }

    await publishStatus();
  });

  const api = await createApiServer({
    env,
    db,
    repoRegistry,
    usageMetrics,
    summaryRenderer,
    readyState,
    discordClient
  });

  const usageInterval = setInterval(
    async () => {
      const date = new Date().toISOString().slice(0, 10);
      const rollups = usageMetrics.persistDailyRollups(date);
      const channelId = env.usageChannelId;
      if (channelId) {
        const channel = await discordClient.channels.fetch(channelId);
        if (
          channel &&
          "send" in channel &&
          typeof channel.send === "function"
        ) {
          await channel.send(
            buildCardMessage(
              summaryRenderer.renderUsageMetrics(date, rollups),
              {
                tone: "neutral",
                footer: "codex-usage"
              }
            )
          );
        }
      }
    },
    1000 * 60 * 60 * 24
  );

  const codexAuthInterval = setInterval(
    async () => {
      readyState.codexAuthHealthy = await checkCodexAuth(env.codexBin);
      publishPresence();
      await publishStatus();
    },
    1000 * 60 * 60 * 24
  );

  return {
    env,
    db,
    api,
    discordClient,
    readyState,
    async start() {
      await api.listen({
        host: env.fastifyHost,
        port: env.fastifyPort
      });
      await discordClient.login(env.discordBotToken);
      publishPresence();
      logger.info("ChatOps service started");
    },
    async stop() {
      clearInterval(usageInterval);
      clearInterval(codexAuthInterval);
      vsCodeSessionBridge.stop();
      await api.close();
      await discordClient.destroy();
      db.close();
    }
  };
}
