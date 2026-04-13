import { afterEach, describe, expect, it } from "vitest";

import { ApprovalService } from "../../src/core/approvals.js";
import { createTestDb } from "../helpers/test-db.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

describe("ApprovalService", () => {
  it("creates and approves approval requests", () => {
    const fixture = createTestDb();
    cleanups.push(fixture.cleanup);
    const approvals = new ApprovalService(fixture.db);
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
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      archivedAt: null
    });

    const approval = approvals.requestApproval({
      sessionId: "session-1",
      type: "commit",
      requestedBy: "user-1",
      payload: { branch: "chatops/mint/session-1" }
    });

    const approved = approvals.approve(approval.id, "user-2");

    expect(approval.status).toBe("pending");
    expect(approved.status).toBe("approved");
    expect(approved.decidedBy).toBe("user-2");
  });

  it("rejects approval requests", () => {
    const fixture = createTestDb();
    cleanups.push(fixture.cleanup);
    const approvals = new ApprovalService(fixture.db);
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
      title: "Deploy bugfix",
      status: "open",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      archivedAt: null
    });

    const approval = approvals.requestApproval({
      sessionId: "session-1",
      type: "deploy-production",
      requestedBy: "user-1",
      payload: {}
    });

    const rejected = approvals.reject(approval.id, "user-3");
    expect(rejected.status).toBe("rejected");
    expect(rejected.decidedBy).toBe("user-3");
  });
});
