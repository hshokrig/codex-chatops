import { afterEach, describe, expect, it } from "vitest";

import { UsageMetricsService } from "../../src/core/usage-metrics.js";
import { createTestDb } from "../helpers/test-db.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

describe("UsageMetricsService", () => {
  it("aggregates per-repo daily rollups", () => {
    const fixture = createTestDb();
    cleanups.push(fixture.cleanup);
    const date = "2026-04-12";

    fixture.db.createSession({
      id: "session-1",
      platform: "discord",
      guildId: "guild-1",
      channelId: "channel-session",
      threadId: "thread-1",
      repoId: "mint",
      codexThreadId: "codex-thread-1",
      worktreePath: "/tmp/worktree-1",
      branchName: "chatops/mint/session-1",
      requestedBy: "user-1",
      title: "Fix bug",
      status: "open",
      createdAt: `${date}T08:00:00.000Z`,
      updatedAt: `${date}T08:10:00.000Z`,
      archivedAt: null
    });

    fixture.db.createRun({
      id: "run-1",
      sessionId: "session-1",
      prompt: "Fix bug",
      requestedBy: "user-1",
      status: "succeeded",
      resultSummary: "Done",
      createdAt: `${date}T08:01:00.000Z`,
      updatedAt: `${date}T08:02:00.000Z`,
      completedAt: `${date}T08:03:00.000Z`
    });

    const service = new UsageMetricsService(fixture.db);
    const rollups = service.persistDailyRollups(date);

    expect(rollups).toHaveLength(1);
    expect(rollups[0]?.repoSlug).toBe("mint");
    expect(rollups[0]?.runCount).toBe(1);
    expect(rollups[0]?.successCount).toBe(1);
    expect(rollups[0]?.activeSessionCount).toBe(1);
  });
});
