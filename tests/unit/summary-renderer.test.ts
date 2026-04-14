import { describe, expect, it } from "vitest";

import { SummaryRenderer } from "../../src/core/summary-renderer.js";
import { createTestRepo } from "../helpers/test-db.js";
import type { RunRecord, SessionRecord } from "../../src/types/domain.js";

function createSession(): SessionRecord {
  return {
    id: "session-1",
    platform: "discord",
    guildId: "guild-1",
    channelId: "channel-1",
    threadId: "thread-1",
    repoId: "mint",
    codexThreadId: "codex-thread-1",
    worktreePath: "/tmp/worktree",
    branchName: "chatops/mint/session-1",
    requestedBy: "user-1",
    title: "Investigate flaky login tests",
    status: "open",
    createdAt: "2026-04-14T10:00:00.000Z",
    updatedAt: "2026-04-14T10:00:00.000Z",
    archivedAt: null
  };
}

function createRun(status: RunRecord["status"]): RunRecord {
  return {
    id: "run-1",
    sessionId: "session-1",
    prompt: "Investigate flaky login tests",
    requestedBy: "user-1",
    status,
    resultSummary: null,
    createdAt: "2026-04-14T10:00:00.000Z",
    updatedAt: "2026-04-14T10:05:00.000Z",
    completedAt: "2026-04-14T10:05:00.000Z"
  };
}

describe("SummaryRenderer", () => {
  it("renders session-started messages with a thread mention and human title", () => {
    const renderer = new SummaryRenderer();
    const repo = createTestRepo();
    const session = createSession();

    const message = renderer.renderSessionStarted(repo, session);

    expect(message).toContain("New Codex session for `mint`");
    expect(message).toContain("Thread: <#thread-1>");
    expect(message).toContain("Title: Investigate flaky login tests");
    expect(message).toContain("Session: `session-1`");
  });

  it("renders repo activity without copying the full run summary", () => {
    const renderer = new SummaryRenderer();
    const repo = createTestRepo();
    const session = createSession();

    const message = renderer.renderRepoEvent({
      repo,
      session,
      run: createRun("succeeded"),
      runCount: 3,
      changedFiles: ["src/app.ts", "README.md"],
      hasUncommittedChanges: true
    });

    expect(message).toContain("Codex activity for `mint`");
    expect(message).toContain("Thread: <#thread-1>");
    expect(message).toContain("Title: Investigate flaky login tests");
    expect(message).toContain("Run status: succeeded");
    expect(message).toContain("Runs in session: 3");
    expect(message).toContain("Changed files: 2");
    expect(message).toContain("Dirty worktree: yes");
  });
});
