import { afterEach, describe, expect, it, vi } from "vitest";

import { ArtifactWriter } from "../../src/core/artifact-writer.js";
import type { GitRunner } from "../../src/core/git-runner.js";
import { RepoRegistry } from "../../src/core/repo-registry.js";
import { SessionManager } from "../../src/core/session-manager.js";
import { SummaryRenderer } from "../../src/core/summary-renderer.js";
import { DiscordEventHandler } from "../../src/transport/discord/event-handler.js";
import { RunAuthorizationService } from "../../src/transport/discord/run-authorization.js";
import { payloadText } from "../helpers/discord-payload.js";
import { createTestDb, createTestRepo } from "../helpers/test-db.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

describe("DiscordEventHandler", () => {
  it("starts a new session thread from a top-level mention and mirrors lightweight activity to repo events", async () => {
    const repo = createTestRepo({
      sessionChannelId: "mint-sessions",
      eventsChannelId: "mint-events"
    });
    const fixture = createTestDb([repo]);
    cleanups.push(fixture.cleanup);

    const threadMessages: unknown[] = [];
    const eventMessages: unknown[] = [];
    const auditMessages: unknown[] = [];

    const fakeThread = {
      id: "thread-1",
      send: vi.fn(async (payload) => {
        threadMessages.push(payload);
      })
    };

    const handler = new DiscordEventHandler({
      client: {
        user: { id: "bot-1" },
        channels: {
          fetch: vi.fn(async (channelId: string) => {
            if (channelId === "mint-events") {
              return {
                send: vi.fn(async (payload) => eventMessages.push(payload))
              };
            }
            if (channelId === "audit-log") {
              return {
                send: vi.fn(async (payload) => auditMessages.push(payload))
              };
            }
            return null;
          })
        }
      } as never,
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
        fastifyPort: 3000,
        auditChannelId: "audit-log"
      },
      db: fixture.db,
      repoRegistry: new RepoRegistry(fixture.db),
      sessionManager: new SessionManager(
        fixture.db,
        {
          prepareSessionWorkspace: vi.fn(async () => ({
            branchName: "chatops/mint/session-1",
            worktreePath: `${fixture.root}/worktree`
          }))
        } as unknown as GitRunner,
        new ArtifactWriter(fixture.root),
        fixture.root
      ),
      runOrchestrator: {
        execute: vi.fn(async ({ session }) => ({
          run: {
            id: "run-1",
            sessionId: session.id,
            prompt: "Fix flaky test",
            requestedBy: "user-1",
            status: "succeeded",
            resultSummary: "Fixed flaky test",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            completedAt: new Date().toISOString()
          },
          summary: "Fixed flaky test",
          changedFiles: ["src/test.ts"],
          hasUncommittedChanges: true
        }))
      } as never,
      threadManager: {
        createSessionThread: vi.fn(async () => fakeThread)
      } as never,
      summaryRenderer: new SummaryRenderer(),
      activeRuns: new Map(),
      runAuthorization: new RunAuthorizationService()
    });

    const message = {
      author: { bot: false, id: "user-1" },
      content: "<@bot-1> fix the flaky login tests",
      inGuild: () => true,
      mentions: { users: { has: (id: string) => id === "bot-1" } },
      channel: { isThread: () => false },
      channelId: "mint-sessions",
      guildId: "guild-1",
      attachments: new Map(),
      member: { id: "user-1", roles: { cache: new Map() } },
      reply: vi.fn()
    };

    await handler.handleMessage(message as never);

    expect(threadMessages).toHaveLength(2);
    expect(eventMessages).toHaveLength(2);
    expect(payloadText(eventMessages[0])).toContain(
      "New Codex session for `mint`"
    );
    expect(payloadText(eventMessages[0])).toContain("Thread");
    expect(payloadText(eventMessages[0])).toContain("<#thread-1>");
    expect(payloadText(eventMessages[0])).toContain("Title");
    expect(payloadText(eventMessages[0])).toContain(
      "fix the flaky login tests"
    );
    expect(payloadText(eventMessages[1])).toContain(
      "Codex activity for `mint`"
    );
    expect(payloadText(eventMessages[1])).toContain("Runs in session");
    expect(payloadText(eventMessages[1])).toContain("1");
    expect(payloadText(eventMessages[1])).toContain("Changed files");
    expect(payloadText(eventMessages[1])).toContain("1");
    expect(payloadText(eventMessages[1])).not.toContain("Fixed flaky test");
    expect(auditMessages).toHaveLength(1);
    expect(payloadText(auditMessages[0])).toContain(
      "fix the flaky login tests"
    );
    expect(fixture.db.getSessionByThreadId("thread-1")).not.toBeNull();
  });

  it("starts a new session thread from a plain top-level message in a sessions channel", async () => {
    const repo = createTestRepo({
      slug: "tandvy-klinic",
      sessionChannelId: "tandvy-sessions",
      eventsChannelId: "tandvy-events"
    });
    const fixture = createTestDb([repo]);
    cleanups.push(fixture.cleanup);

    const threadMessages: unknown[] = [];
    const fakeThread = {
      id: "thread-plain-1",
      send: vi.fn(async (payload) => {
        threadMessages.push(payload);
      })
    };

    const handler = new DiscordEventHandler({
      client: {
        user: { id: "bot-1" },
        channels: { fetch: vi.fn(async () => null) }
      } as never,
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
      repoRegistry: new RepoRegistry(fixture.db),
      sessionManager: new SessionManager(
        fixture.db,
        {
          prepareSessionWorkspace: vi.fn(async () => ({
            branchName: "chatops/tandvy-klinic/session-1",
            worktreePath: `${fixture.root}/worktree`
          }))
        } as unknown as GitRunner,
        new ArtifactWriter(fixture.root),
        fixture.root
      ),
      runOrchestrator: {
        execute: vi.fn(async ({ session }) => ({
          run: {
            id: "run-plain-1",
            sessionId: session.id,
            prompt: "can you see my repo?",
            requestedBy: "user-1",
            status: "succeeded",
            resultSummary: "Repo visible",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            completedAt: new Date().toISOString()
          },
          summary: "Repo visible",
          changedFiles: [],
          hasUncommittedChanges: false
        }))
      } as never,
      threadManager: {
        createSessionThread: vi.fn(async () => fakeThread)
      } as never,
      summaryRenderer: new SummaryRenderer(),
      activeRuns: new Map(),
      runAuthorization: new RunAuthorizationService()
    });

    const message = {
      author: { bot: false, id: "user-1" },
      content: "can you see my repo?",
      inGuild: () => true,
      mentions: { users: { has: () => false } },
      channel: { isThread: () => false },
      channelId: "tandvy-sessions",
      guildId: "guild-1",
      attachments: new Map(),
      member: { id: "user-1", roles: { cache: new Map() } },
      reply: vi.fn()
    };

    await handler.handleMessage(message as never);

    expect(threadMessages).toHaveLength(2);
    expect(fixture.db.getSessionByThreadId("thread-plain-1")).not.toBeNull();
  });

  it("continues an existing session thread from a plain reply", async () => {
    const repo = createTestRepo({
      slug: "tandvy-klinic",
      sessionChannelId: "tandvy-sessions",
      eventsChannelId: "tandvy-events"
    });
    const fixture = createTestDb([repo]);
    cleanups.push(fixture.cleanup);
    const repoRegistry = new RepoRegistry(fixture.db);
    const sessionManager = new SessionManager(
      fixture.db,
      {
        prepareSessionWorkspace: vi.fn(async () => ({
          branchName: "chatops/tandvy-klinic/session-1",
          worktreePath: `${fixture.root}/worktree`
        }))
      } as unknown as GitRunner,
      new ArtifactWriter(fixture.root),
      fixture.root
    );
    const session = await sessionManager.createSession({
      guildId: "guild-1",
      channelId: "tandvy-sessions",
      threadId: "thread-existing-1",
      repo,
      requestedBy: "user-1",
      title: "initial prompt"
    });

    const threadMessages: unknown[] = [];
    const handler = new DiscordEventHandler({
      client: {
        user: { id: "bot-1" },
        channels: { fetch: vi.fn(async () => null) }
      } as never,
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
      runOrchestrator: {
        execute: vi.fn(async ({ session: activeSession, prompt }) => ({
          run: {
            id: "run-followup-1",
            sessionId: activeSession.id,
            prompt,
            requestedBy: "user-1",
            status: "succeeded",
            resultSummary: "Follow-up done",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            completedAt: new Date().toISOString()
          },
          summary: "Follow-up done",
          changedFiles: [],
          hasUncommittedChanges: false
        }))
      } as never,
      threadManager: { createSessionThread: vi.fn() } as never,
      summaryRenderer: new SummaryRenderer(),
      activeRuns: new Map(),
      runAuthorization: new RunAuthorizationService()
    });

    const message = {
      author: { bot: false, id: "user-1" },
      content: "summarize main services",
      inGuild: () => true,
      mentions: { users: { has: () => false } },
      channel: {
        isThread: () => true,
        parentId: "tandvy-sessions",
        send: vi.fn(async (payload) => {
          threadMessages.push(payload);
        })
      },
      channelId: session.threadId,
      guildId: "guild-1",
      attachments: new Map(),
      member: { id: "user-1", roles: { cache: new Map() } },
      reply: vi.fn()
    };

    await handler.handleMessage(message as never);

    expect(threadMessages).toHaveLength(2);
  });

  it("ignores messages in repo event channels", async () => {
    const repo = createTestRepo({
      sessionChannelId: "mint-sessions",
      eventsChannelId: "mint-events"
    });
    const fixture = createTestDb([repo]);
    cleanups.push(fixture.cleanup);

    const handler = new DiscordEventHandler({
      client: { user: { id: "bot-1" } } as never,
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
      repoRegistry: new RepoRegistry(fixture.db),
      sessionManager: {
        getByThreadId: vi.fn(() => null)
      } as never,
      runOrchestrator: { execute: vi.fn() } as never,
      threadManager: { createSessionThread: vi.fn() } as never,
      summaryRenderer: new SummaryRenderer(),
      activeRuns: new Map(),
      runAuthorization: new RunAuthorizationService()
    });

    const message = {
      author: { bot: false, id: "user-1" },
      content: "<@bot-1> should be ignored here",
      inGuild: () => true,
      mentions: { users: { has: (id: string) => id === "bot-1" } },
      channel: { isThread: () => false },
      channelId: "mint-events",
      guildId: "guild-1",
      attachments: new Map(),
      member: { id: "user-1", roles: { cache: new Map() } },
      reply: vi.fn()
    };

    await handler.handleMessage(message as never);

    expect(fixture.db.raw("SELECT * FROM sessions")).toHaveLength(0);
  });

  it("starts a generic session from a bot mention in an arbitrary channel and forwards channel context", async () => {
    const repo = createTestRepo({
      sessionChannelId: "mint-sessions",
      eventsChannelId: "mint-events"
    });
    const genericRepo = createTestRepo({
      slug: "__generic__",
      categoryName: "00-control",
      sessionChannelId: "",
      eventsChannelId: "",
      deploymentsChannelId: "",
      localPath: `${process.cwd()}`,
      defaultBranch: "direct",
      workspaceMode: "direct"
    });
    const fixture = createTestDb([repo]);
    cleanups.push(fixture.cleanup);

    const threadMessages: unknown[] = [];
    const fakeThread = {
      id: "thread-generic-1",
      send: vi.fn(async (payload) => {
        threadMessages.push(payload);
      })
    };
    const execute = vi.fn(async ({ session, conversationContext }) => ({
      run: {
        id: "run-generic-1",
        sessionId: session.id,
        prompt: "inspect /home/hossein/Projects/Tandvy-Klinic",
        requestedBy: "user-1",
        status: "succeeded",
        resultSummary: "Generic workspace ok",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString()
      },
      summary: conversationContext ?? "missing context",
      changedFiles: [],
      hasUncommittedChanges: false
    }));

    const handler = new DiscordEventHandler({
      client: {
        user: { id: "bot-1" },
        channels: { fetch: vi.fn(async () => null) }
      } as never,
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
        fastifyPort: 3000,
        genericWorkspacePath: process.cwd()
      },
      db: fixture.db,
      repoRegistry: new RepoRegistry(fixture.db, genericRepo),
      sessionManager: new SessionManager(
        fixture.db,
        {
          prepareSessionWorkspace: vi.fn(async () => ({
            branchName: "direct/__generic__/session-1",
            worktreePath: process.cwd()
          }))
        } as unknown as GitRunner,
        new ArtifactWriter(fixture.root),
        fixture.root
      ),
      runOrchestrator: { execute } as never,
      threadManager: {
        createSessionThread: vi.fn(async () => fakeThread)
      } as never,
      summaryRenderer: new SummaryRenderer(),
      activeRuns: new Map(),
      runAuthorization: new RunAuthorizationService()
    });

    const message = {
      id: "message-generic-1",
      author: { bot: false, id: "user-1", username: "hossein" },
      content:
        "<@bot-1> inspect /home/hossein/Projects/Tandvy-Klinic and tell me if the repo looks healthy",
      createdAt: new Date("2026-04-18T12:00:00.000Z"),
      inGuild: () => true,
      mentions: { users: { has: (id: string) => id === "bot-1" } },
      channel: {
        isThread: () => false,
        messages: {
          fetch: vi.fn(
            async () =>
              new Map([
                [
                  "previous-1",
                  {
                    author: { username: "alice" },
                    content: "please check the latest repo state",
                    createdAt: new Date("2026-04-18T11:59:00.000Z")
                  }
                ]
              ])
          )
        }
      },
      channelId: "random-channel",
      guildId: "guild-1",
      attachments: new Map(),
      member: { id: "user-1", roles: { cache: new Map() } },
      fetchReference: vi.fn(async () => ({
        author: { username: "alice" },
        content: "look at the repo in this path",
        createdAt: new Date("2026-04-18T11:58:00.000Z")
      })),
      reply: vi.fn()
    };

    await handler.handleMessage(message as never);

    expect(threadMessages).toHaveLength(2);
    expect(fixture.db.getSessionByThreadId("thread-generic-1")?.repoId).toBe(
      "__generic__"
    );
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationContext: expect.stringContaining("Recent channel messages:")
      })
    );
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationContext: expect.stringContaining("Referenced message:")
      })
    );
  });

  it("filters bot-authored messages out of captured conversation context", async () => {
    const repo = createTestRepo({
      slug: "__generic__",
      categoryName: "00-control",
      sessionChannelId: "",
      eventsChannelId: "",
      deploymentsChannelId: "",
      localPath: `${process.cwd()}`,
      defaultBranch: "direct",
      workspaceMode: "direct"
    });
    const fixture = createTestDb();
    cleanups.push(fixture.cleanup);

    const fakeThread = {
      id: "thread-generic-bot-filter-1",
      send: vi.fn(async () => undefined)
    };
    const execute = vi.fn(async ({ session, conversationContext }) => ({
      run: {
        id: "run-generic-bot-filter-1",
        sessionId: session.id,
        prompt: "check context isolation",
        requestedBy: "user-1",
        status: "succeeded",
        resultSummary: "Context captured",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString()
      },
      summary: conversationContext ?? "missing context",
      changedFiles: [],
      hasUncommittedChanges: false
    }));

    const handler = new DiscordEventHandler({
      client: {
        user: { id: "bot-1" },
        channels: { fetch: vi.fn(async () => null) }
      } as never,
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
        fastifyPort: 3000,
        genericWorkspacePath: process.cwd()
      },
      db: fixture.db,
      repoRegistry: new RepoRegistry(fixture.db, repo),
      sessionManager: new SessionManager(
        fixture.db,
        {
          prepareSessionWorkspace: vi.fn(async () => ({
            branchName: "direct/__generic__/session-1",
            worktreePath: process.cwd()
          }))
        } as unknown as GitRunner,
        new ArtifactWriter(fixture.root),
        fixture.root
      ),
      runOrchestrator: { execute } as never,
      threadManager: {
        createSessionThread: vi.fn(async () => fakeThread)
      } as never,
      summaryRenderer: new SummaryRenderer(),
      activeRuns: new Map(),
      runAuthorization: new RunAuthorizationService()
    });

    const message = {
      id: "message-generic-bot-filter-1",
      author: { bot: false, id: "user-1", username: "hossein" },
      content: "<@bot-1> check whether the recent context stays scoped",
      createdAt: new Date("2026-04-18T12:00:00.000Z"),
      inGuild: () => true,
      mentions: { users: { has: (id: string) => id === "bot-1" } },
      channel: {
        isThread: () => false,
        messages: {
          fetch: vi.fn(
            async () =>
              new Map([
                [
                  "previous-bot-1",
                  {
                    author: { bot: true, username: "CodexVSC" },
                    content: "This bot-authored diagnostic should be ignored.",
                    createdAt: new Date("2026-04-18T11:57:00.000Z")
                  }
                ],
                [
                  "previous-human-1",
                  {
                    author: { username: "Hossein" },
                    content: "please stay within this thread context",
                    createdAt: new Date("2026-04-18T11:58:00.000Z")
                  }
                ]
              ])
          )
        }
      },
      channelId: "random-channel",
      guildId: "guild-1",
      attachments: new Map(),
      member: { id: "user-1", roles: { cache: new Map() } },
      fetchReference: vi.fn(async () => ({
        author: { bot: true, username: "CodexVSC" },
        content: "ignore this referenced bot message too",
        createdAt: new Date("2026-04-18T11:56:00.000Z")
      })),
      reply: vi.fn()
    };

    await handler.handleMessage(message as never);

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationContext: expect.stringContaining(
          "please stay within this thread context"
        )
      })
    );
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationContext: expect.not.stringContaining(
          "bot-authored diagnostic"
        )
      })
    );
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationContext: expect.not.stringContaining(
          "referenced bot message"
        )
      })
    );
  });

  it("continues the latest channel session from a new top-level message without creating a fresh thread", async () => {
    const repo = createTestRepo({
      slug: "tandvy-klinic",
      sessionChannelId: "tandvy-sessions",
      eventsChannelId: "tandvy-events"
    });
    const fixture = createTestDb([repo]);
    cleanups.push(fixture.cleanup);
    const repoRegistry = new RepoRegistry(fixture.db);
    const sessionManager = new SessionManager(
      fixture.db,
      {
        prepareSessionWorkspace: vi.fn(async () => ({
          branchName: "chatops/tandvy-klinic/session-1",
          worktreePath: `${fixture.root}/worktree`
        }))
      } as unknown as GitRunner,
      new ArtifactWriter(fixture.root),
      fixture.root
    );
    const session = await sessionManager.createSession({
      guildId: "guild-1",
      channelId: "tandvy-sessions",
      threadId: "thread-channel-followup-1",
      repo,
      requestedBy: "user-1",
      title: "initial prompt"
    });

    const channelMessages: unknown[] = [];
    const threadMessages: unknown[] = [];
    const createSessionThread = vi.fn();
    const execute = vi.fn(async ({ session: activeSession, prompt }) => ({
      run: {
        id: "run-parent-followup-1",
        sessionId: activeSession.id,
        prompt,
        requestedBy: "user-1",
        status: "succeeded",
        resultSummary: "Follow-up done",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString()
      },
      summary: "Follow-up done",
      changedFiles: [],
      hasUncommittedChanges: false
    }));

    const handler = new DiscordEventHandler({
      client: {
        user: { id: "bot-1" },
        channels: {
          fetch: vi.fn(async (channelId: string) => {
            if (channelId === session.threadId) {
              return {
                id: session.threadId,
                send: vi.fn(async (payload) => {
                  threadMessages.push(payload);
                })
              };
            }
            return null;
          })
        }
      } as never,
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
      runOrchestrator: { execute } as never,
      threadManager: { createSessionThread } as never,
      summaryRenderer: new SummaryRenderer(),
      activeRuns: new Map(),
      runAuthorization: new RunAuthorizationService()
    });

    const message = {
      id: "message-parent-followup-1",
      author: { bot: false, id: "user-1" },
      content: "follow up without replying inside the thread",
      createdAt: new Date("2026-04-18T12:01:00.000Z"),
      inGuild: () => true,
      mentions: { users: { has: () => false } },
      channel: {
        isThread: () => false,
        send: vi.fn(async (payload) => {
          channelMessages.push(payload);
        }),
        messages: {
          fetch: vi.fn(async () => new Map())
        }
      },
      channelId: "tandvy-sessions",
      guildId: "guild-1",
      attachments: new Map(),
      member: { id: "user-1", roles: { cache: new Map() } },
      reply: vi.fn()
    };

    await handler.handleMessage(message as never);

    expect(createSessionThread).not.toHaveBeenCalled();
    expect(channelMessages).toHaveLength(1);
    expect(threadMessages).toHaveLength(2);
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        session: expect.objectContaining({ id: session.id })
      })
    );
  });

  it("forwards message attachments to the orchestrator", async () => {
    const repo = createTestRepo({
      slug: "tandvy-klinic",
      sessionChannelId: "tandvy-sessions",
      eventsChannelId: "tandvy-events"
    });
    const fixture = createTestDb([repo]);
    cleanups.push(fixture.cleanup);

    const fakeThread = {
      id: "thread-attachment-1",
      send: vi.fn(async () => undefined)
    };
    const execute = vi.fn(async ({ session }) => ({
      run: {
        id: "run-attachment-1",
        sessionId: session.id,
        prompt: "summarize attached file",
        requestedBy: "user-1",
        status: "succeeded",
        resultSummary: "Attachment received",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString()
      },
      summary: "Attachment received",
      changedFiles: [],
      hasUncommittedChanges: false
    }));

    const handler = new DiscordEventHandler({
      client: {
        user: { id: "bot-1" },
        channels: { fetch: vi.fn(async () => null) }
      } as never,
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
      repoRegistry: new RepoRegistry(fixture.db),
      sessionManager: new SessionManager(
        fixture.db,
        {
          prepareSessionWorkspace: vi.fn(async () => ({
            branchName: "chatops/tandvy-klinic/session-attachment",
            worktreePath: `${fixture.root}/worktree`
          }))
        } as unknown as GitRunner,
        new ArtifactWriter(fixture.root),
        fixture.root
      ),
      runOrchestrator: { execute } as never,
      threadManager: {
        createSessionThread: vi.fn(async () => fakeThread)
      } as never,
      summaryRenderer: new SummaryRenderer(),
      activeRuns: new Map(),
      runAuthorization: new RunAuthorizationService()
    });

    const attachments = new Map([
      [
        "att-1",
        {
          id: "att-1",
          name: "notes.txt",
          url: "data:text/plain;base64,bm90ZXMK",
          contentType: "text/plain",
          size: 6
        }
      ]
    ]);

    const message = {
      author: { bot: false, id: "user-1" },
      content: "summarize attached file",
      inGuild: () => true,
      mentions: { users: { has: () => false } },
      channel: { isThread: () => false },
      channelId: "tandvy-sessions",
      guildId: "guild-1",
      attachments,
      member: { id: "user-1", roles: { cache: new Map() } },
      reply: vi.fn()
    };

    await handler.handleMessage(message as never);

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [
          expect.objectContaining({
            id: "att-1",
            name: "notes.txt",
            contentType: "text/plain"
          })
        ]
      })
    );
  });

  it("creates a default prompt when a session starts from attachments only", async () => {
    const repo = createTestRepo({
      slug: "tandvy-klinic",
      sessionChannelId: "tandvy-sessions",
      eventsChannelId: "tandvy-events"
    });
    const fixture = createTestDb([repo]);
    cleanups.push(fixture.cleanup);

    const fakeThread = {
      id: "thread-attachment-only-1",
      send: vi.fn(async () => undefined)
    };
    const execute = vi.fn(async ({ session, prompt }) => ({
      run: {
        id: "run-attachment-only-1",
        sessionId: session.id,
        prompt,
        requestedBy: "user-1",
        status: "succeeded",
        resultSummary: "Attachment-only request received",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString()
      },
      summary: "Attachment-only request received",
      changedFiles: [],
      hasUncommittedChanges: false
    }));

    const handler = new DiscordEventHandler({
      client: {
        user: { id: "bot-1" },
        channels: { fetch: vi.fn(async () => null) }
      } as never,
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
      repoRegistry: new RepoRegistry(fixture.db),
      sessionManager: new SessionManager(
        fixture.db,
        {
          prepareSessionWorkspace: vi.fn(async () => ({
            branchName: "chatops/tandvy-klinic/session-attachment-only",
            worktreePath: `${fixture.root}/worktree`
          }))
        } as unknown as GitRunner,
        new ArtifactWriter(fixture.root),
        fixture.root
      ),
      runOrchestrator: { execute } as never,
      threadManager: {
        createSessionThread: vi.fn(async () => fakeThread)
      } as never,
      summaryRenderer: new SummaryRenderer(),
      activeRuns: new Map(),
      runAuthorization: new RunAuthorizationService()
    });

    const attachments = new Map([
      [
        "att-1",
        {
          id: "att-1",
          name: "notes.txt",
          url: "data:text/plain;base64,bm90ZXMK",
          contentType: "text/plain",
          size: 6
        }
      ]
    ]);

    const message = {
      author: { bot: false, id: "user-1" },
      content: "",
      inGuild: () => true,
      mentions: { users: { has: () => false } },
      channel: { isThread: () => false },
      channelId: "tandvy-sessions",
      guildId: "guild-1",
      attachments,
      member: { id: "user-1", roles: { cache: new Map() } },
      reply: vi.fn()
    };

    await handler.handleMessage(message as never);

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "Review the attached files and summarize anything relevant."
      })
    );
  });

  it("requires password authorization before starting a prompt run when operator password is configured", async () => {
    const repo = createTestRepo({
      sessionChannelId: "mint-sessions",
      eventsChannelId: "mint-events"
    });
    const fixture = createTestDb([repo]);
    cleanups.push(fixture.cleanup);

    const execute = vi.fn();
    const createSessionThread = vi.fn();
    const reply = vi.fn();

    const handler = new DiscordEventHandler({
      client: {
        user: { id: "bot-1" },
        channels: { fetch: vi.fn(async () => null) }
      } as never,
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
      sessionManager: new SessionManager(
        fixture.db,
        {
          prepareSessionWorkspace: vi.fn(async () => ({
            branchName: "chatops/mint/session-1",
            worktreePath: `${fixture.root}/worktree`
          }))
        } as unknown as GitRunner,
        new ArtifactWriter(fixture.root),
        fixture.root
      ),
      runOrchestrator: { execute } as never,
      threadManager: { createSessionThread } as never,
      summaryRenderer: new SummaryRenderer(),
      activeRuns: new Map(),
      runAuthorization: new RunAuthorizationService("test-password")
    });

    const message = {
      author: { bot: false, id: "user-1" },
      content: "ship the patch",
      inGuild: () => true,
      mentions: { users: { has: () => false } },
      channel: { isThread: () => false },
      channelId: "mint-sessions",
      guildId: "guild-1",
      attachments: new Map(),
      member: { id: "user-1", roles: { cache: new Map() } },
      reply
    };

    await handler.handleMessage(message as never);

    expect(execute).not.toHaveBeenCalled();
    expect(createSessionThread).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledOnce();
    expect(reply.mock.calls[0]?.[0]).toMatchObject({
      content: expect.stringContaining("Run authorization required")
    });
  });
});
