import { describe, expect, it, vi } from "vitest";

import { ArtifactWriter } from "../../src/core/artifact-writer.js";
import type { GitRunner } from "../../src/core/git-runner.js";
import { RepoRegistry } from "../../src/core/repo-registry.js";
import { SessionManager } from "../../src/core/session-manager.js";
import { SummaryRenderer } from "../../src/core/summary-renderer.js";
import {
  componentId,
  passwordModalId
} from "../../src/transport/discord/components.js";
import { DiscordInteractionHandler } from "../../src/transport/discord/interaction-handler.js";
import { RunAuthorizationService } from "../../src/transport/discord/run-authorization.js";
import { createTestDb, createTestRepo } from "../helpers/test-db.js";

describe("DiscordInteractionHandler", () => {
  it("executes a pending prompt after the correct password is submitted", async () => {
    const repo = createTestRepo({
      allowedUsers: ["user-1"]
    });
    const fixture = createTestDb([repo]);
    const runAuthorization = new RunAuthorizationService("test-password");
    const executeAuthorizedPrompt = vi.fn(async () => undefined);

    const pending = runAuthorization.createPromptAuthorization({
      mode: "start",
      message: {} as never,
      repo,
      prompt: "ship it",
      attachments: [],
      requestedBy: "user-1"
    });

    const handler = new DiscordInteractionHandler({
      client: {} as never,
      env: {
        discordBotToken: "token",
        discordApplicationId: "app",
        discordGuildId: "guild-1",
        discordOperatorPassword: "test-password",
        chatopsDbPath: `${fixture.root}/db.sqlite`,
        chatopsRoot: fixture.root,
        chatopsRepoMapPath: `${fixture.root}/repo-map.yaml`,
        codexMode: "sdk",
        codexBin: "codex",
        allowThreadPlainReply: false,
        enablePrs: true,
        enableDeploys: true,
        enableDiscordBootstrap: false,
        discordBootstrapMode: "validate",
        githubUseGhCli: false,
        fastifyHost: "127.0.0.1",
        fastifyPort: 3000
      },
      db: fixture.db,
      repoRegistry: new RepoRegistry(fixture.db),
      sessionManager: {} as never,
      approvals: {} as never,
      gitRunner: {} as never,
      prRunner: {} as never,
      deployRunner: {} as never,
      summaryRenderer: new SummaryRenderer(),
      activeRuns: new Map(),
      eventHandler: {
        executeAuthorizedPrompt
      } as never,
      runAuthorization
    });

    const reply = vi.fn(async () => undefined);

    await handler.handleInteraction({
      isButton: () => false,
      isModalSubmit: () => true,
      isChatInputCommand: () => false,
      customId: passwordModalId("prompt", pending.id),
      fields: {
        getTextInputValue: vi.fn(() => "test-password")
      },
      user: { id: "user-1" },
      reply,
      deferred: false,
      replied: false
    } as never);

    expect(reply).toHaveBeenCalledWith({
      content: "Authorization accepted. Starting the run.",
      ephemeral: true
    });
    expect(executeAuthorizedPrompt).toHaveBeenCalledOnce();
  });

  it("rejects button actions from users outside the repo allowlist", async () => {
    const repo = createTestRepo({
      allowedUsers: ["user-1"]
    });
    const fixture = createTestDb([repo]);
    const repoRegistry = new RepoRegistry(fixture.db);
    const sessionManager = new SessionManager(
      fixture.db,
      {
        prepareSessionWorkspace: vi.fn(async () => ({
          branchName: "chatops/mint/session-1",
          worktreePath: `${fixture.root}/worktree`
        }))
      } as unknown as GitRunner,
      new ArtifactWriter(fixture.root),
      fixture.root
    );

    const session = await sessionManager.createSession({
      guildId: "guild-1",
      channelId: "channel-session",
      threadId: "thread-1",
      repo,
      requestedBy: "user-1",
      title: "Deploy patch"
    });

    const handler = new DiscordInteractionHandler({
      client: {} as never,
      env: {
        discordBotToken: "token",
        discordApplicationId: "app",
        discordGuildId: "guild-1",
        chatopsDbPath: `${fixture.root}/db.sqlite`,
        chatopsRoot: fixture.root,
        chatopsRepoMapPath: `${fixture.root}/repo-map.yaml`,
        codexMode: "sdk",
        codexBin: "codex",
        allowThreadPlainReply: false,
        enablePrs: true,
        enableDeploys: true,
        enableDiscordBootstrap: false,
        discordBootstrapMode: "validate",
        githubUseGhCli: false,
        fastifyHost: "127.0.0.1",
        fastifyPort: 3000
      },
      db: fixture.db,
      repoRegistry,
      sessionManager,
      approvals: {} as never,
      gitRunner: {} as never,
      prRunner: {} as never,
      deployRunner: {} as never,
      summaryRenderer: new SummaryRenderer(),
      activeRuns: new Map(),
      eventHandler: {} as never,
      runAuthorization: new RunAuthorizationService()
    });

    const reply = vi.fn(async () => undefined);

    await handler.handleInteraction({
      isButton: () => true,
      isModalSubmit: () => false,
      isChatInputCommand: () => false,
      customId: componentId("approve", session.id, "approval-1"),
      user: { id: "user-2" },
      member: { roles: { cache: new Map() } },
      reply,
      followUp: vi.fn(async () => undefined),
      deferred: false,
      replied: false
    } as never);

    expect(reply).toHaveBeenCalledWith({
      content: "You are not authorized to run this command.",
      ephemeral: true
    });
  });

  it("shows a password modal before executing an approval when operator password is configured", async () => {
    const repo = createTestRepo({
      allowedUsers: ["user-1"]
    });
    const fixture = createTestDb([repo]);
    const repoRegistry = new RepoRegistry(fixture.db);
    const sessionManager = new SessionManager(
      fixture.db,
      {
        prepareSessionWorkspace: vi.fn(async () => ({
          branchName: "chatops/mint/session-1",
          worktreePath: `${fixture.root}/worktree`
        }))
      } as unknown as GitRunner,
      new ArtifactWriter(fixture.root),
      fixture.root
    );

    const session = await sessionManager.createSession({
      guildId: "guild-1",
      channelId: "channel-session",
      threadId: "thread-1",
      repo,
      requestedBy: "user-1",
      title: "Deploy patch"
    });

    const handler = new DiscordInteractionHandler({
      client: {} as never,
      env: {
        discordBotToken: "token",
        discordApplicationId: "app",
        discordGuildId: "guild-1",
        discordOperatorPassword: "test-password",
        chatopsDbPath: `${fixture.root}/db.sqlite`,
        chatopsRoot: fixture.root,
        chatopsRepoMapPath: `${fixture.root}/repo-map.yaml`,
        codexMode: "sdk",
        codexBin: "codex",
        allowThreadPlainReply: false,
        enablePrs: true,
        enableDeploys: true,
        enableDiscordBootstrap: false,
        discordBootstrapMode: "validate",
        githubUseGhCli: false,
        fastifyHost: "127.0.0.1",
        fastifyPort: 3000
      },
      db: fixture.db,
      repoRegistry,
      sessionManager,
      approvals: {} as never,
      gitRunner: {} as never,
      prRunner: {} as never,
      deployRunner: {} as never,
      summaryRenderer: new SummaryRenderer(),
      activeRuns: new Map(),
      eventHandler: {} as never,
      runAuthorization: new RunAuthorizationService("test-password")
    });

    const showModal = vi.fn(async () => undefined);

    await handler.handleInteraction({
      isButton: () => true,
      isModalSubmit: () => false,
      isChatInputCommand: () => false,
      customId: componentId("approve", session.id, "approval-1"),
      user: { id: "user-1" },
      member: { roles: { cache: new Map() } },
      showModal,
      reply: vi.fn(async () => undefined),
      followUp: vi.fn(async () => undefined),
      deferred: false,
      replied: false
    } as never);

    expect(showModal).toHaveBeenCalledOnce();
  });
});
