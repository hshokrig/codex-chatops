import { describe, expect, it } from "vitest";

import { PromptBuilder } from "../../src/core/prompt-builder.js";
import { createTestRepo } from "../helpers/test-db.js";
import type { SessionRecord } from "../../src/types/domain.js";

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

describe("PromptBuilder", () => {
  it("injects context-isolation guidance and QA checks into the run prompt", () => {
    const prompt = new PromptBuilder().build({
      repo: createTestRepo(),
      session: createSession(),
      request: "Reply to Milad based only on the current thread.",
      conversationContext:
        "Recent channel messages:\n[2026-04-19T09:24:53.343Z] Hossein: keep this scoped to the current thread",
      priorRuns: [],
      checks: ["pnpm test"],
      summaryPath: "/tmp/summary.md",
      checksPath: "/tmp/checks.md"
    });

    expect(prompt).toContain("Context isolation and QA:");
    expect(prompt).toContain(
      "Do not reuse people, chats, tasks, or message drafts from other channels, threads, or external conversations"
    );
    expect(prompt).toContain(
      "QA must reject drafts that are only a generic acknowledgement"
    );
    expect(prompt).toContain(
      "QA must verify the content is specifically relevant to the messages in the current channel/thread context"
    );
  });
});
