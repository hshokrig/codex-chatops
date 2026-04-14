import { writeFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RepoRegistry } from "../../src/core/repo-registry.js";
import { SummaryRenderer } from "../../src/core/summary-renderer.js";
import { VsCodeSessionBridge } from "../../src/core/vscode-session-bridge.js";
import { createTestDb, createTestRepo } from "../helpers/test-db.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

function createCodexFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "codex-chatops-codex-home-"));
  const stateDbPath = path.join(root, "state_5.sqlite");
  const logsDbPath = path.join(root, "logs_2.sqlite");
  const sessionIndexPath = path.join(root, "session_index.jsonl");

  const stateDb = new Database(stateDbPath);
  stateDb.exec(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      cwd TEXT NOT NULL,
      title TEXT,
      source TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0,
      tokens_used INTEGER NOT NULL DEFAULT 0,
      git_branch TEXT
    );
  `);

  const logsDb = new Database(logsDbPath);
  logsDb.exec(`
    CREATE TABLE logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      feedback_log_body TEXT,
      thread_id TEXT
    );
  `);

  writeFileSync(sessionIndexPath, "", "utf8");

  return {
    root,
    stateDb,
    logsDb,
    sessionIndexPath,
    cleanup() {
      stateDb.close();
      logsDb.close();
      rmSync(root, { recursive: true, force: true });
    }
  };
}

function insertVsCodeThread(input: {
  stateDb: Database.Database;
  id: string;
  cwd: string;
  updatedAt: number;
  title?: string;
  source?: string;
  tokensUsed?: number;
  branch?: string | null;
}) {
  input.stateDb
    .prepare(
      `
        INSERT INTO threads (
          id, cwd, title, source, created_at, updated_at, archived, tokens_used, git_branch
        ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
      `
    )
    .run(
      input.id,
      input.cwd,
      input.title ?? "",
      input.source ?? "vscode",
      input.updatedAt,
      input.updatedAt,
      input.tokensUsed ?? 0,
      input.branch ?? "main"
    );
}

function setThreadUpdatedAt(
  stateDb: Database.Database,
  threadId: string,
  updatedAt: number,
  tokensUsed = 0
) {
  stateDb
    .prepare("UPDATE threads SET updated_at = ?, tokens_used = ? WHERE id = ?")
    .run(updatedAt, tokensUsed, threadId);
}

function writeThreadName(
  sessionIndexPath: string,
  threadId: string,
  name: string
) {
  writeFileSync(
    sessionIndexPath,
    `${JSON.stringify({ id: threadId, thread_name: name })}\n`,
    "utf8"
  );
}

function insertPromptLog(
  logsDb: Database.Database,
  threadId: string,
  submissionId: string
) {
  logsDb
    .prepare("INSERT INTO logs (feedback_log_body, thread_id) VALUES (?, ?)")
    .run(`submission.id="${submissionId}" codex.op="user_input"`, threadId);
}

function insertToolLog(
  logsDb: Database.Database,
  threadId: string,
  toolName: string,
  callId: string
) {
  logsDb
    .prepare("INSERT INTO logs (feedback_log_body, thread_id) VALUES (?, ?)")
    .run(`tool_name="${toolName}" call_id="${callId}"`, threadId);
}

describe("VsCodeSessionBridge", () => {
  it("publishes a session-started message for a new mapped VS Code thread using the human thread name", async () => {
    const repo = createTestRepo({
      slug: "codex-chatops",
      localPath: "/workspace/codex-chatops",
      eventsChannelId: "events-1"
    });
    const fixture = createTestDb([repo]);
    const codexFixture = createCodexFixture();
    cleanups.push(fixture.cleanup, codexFixture.cleanup);

    const eventMessages: string[] = [];
    const bridge = new VsCodeSessionBridge({
      client: {
        channels: {
          fetch: vi.fn(async () => ({
            send: vi.fn(async (message: string) => {
              eventMessages.push(message);
            })
          }))
        }
      } as never,
      repoRegistry: new RepoRegistry(fixture.db),
      summaryRenderer: new SummaryRenderer(),
      codexHomePath: codexFixture.root
    });

    const baselineNow = 1_776_200_000_000;
    insertVsCodeThread({
      stateDb: codexFixture.stateDb,
      id: "thread-existing",
      cwd: "/workspace/codex-chatops",
      updatedAt: Math.floor(baselineNow / 1000)
    });
    await bridge.pollNow(baselineNow);

    insertVsCodeThread({
      stateDb: codexFixture.stateDb,
      id: "thread-new",
      cwd: "/workspace/codex-chatops",
      updatedAt: Math.floor((baselineNow + 5_000) / 1000),
      branch: "feature/live-bridge"
    });
    writeThreadName(
      codexFixture.sessionIndexPath,
      "thread-new",
      "Show Codex threads in Discord"
    );
    insertPromptLog(codexFixture.logsDb, "thread-new", "submission-1");

    await bridge.pollNow(baselineNow + 5_000);

    expect(eventMessages).toHaveLength(1);
    expect(eventMessages[0]).toContain(
      "VS Code Codex session for `codex-chatops`"
    );
    expect(eventMessages[0]).toContain("Title: Show Codex threads in Discord");
    expect(eventMessages[0]).toContain("Branch: feature/live-bridge");
    expect(eventMessages[0]).toContain("Prompts so far: 1");

    bridge.stop();
  });

  it("publishes a quiet activity update with prompt and tool counts after the session settles", async () => {
    const repo = createTestRepo({
      slug: "codex-chatops",
      localPath: "/workspace/codex-chatops",
      eventsChannelId: "events-1"
    });
    const fixture = createTestDb([repo]);
    const codexFixture = createCodexFixture();
    cleanups.push(fixture.cleanup, codexFixture.cleanup);

    const eventMessages: string[] = [];
    const bridge = new VsCodeSessionBridge({
      client: {
        channels: {
          fetch: vi.fn(async () => ({
            send: vi.fn(async (message: string) => {
              eventMessages.push(message);
            })
          }))
        }
      } as never,
      repoRegistry: new RepoRegistry(fixture.db),
      summaryRenderer: new SummaryRenderer(),
      codexHomePath: codexFixture.root
    });

    const initialNow = 1_776_200_000_000;
    insertVsCodeThread({
      stateDb: codexFixture.stateDb,
      id: "thread-1",
      cwd: "/workspace/codex-chatops",
      updatedAt: Math.floor(initialNow / 1000),
      branch: "main"
    });
    writeThreadName(
      codexFixture.sessionIndexPath,
      "thread-1",
      "Discord bridge"
    );
    insertPromptLog(codexFixture.logsDb, "thread-1", "submission-1");
    await bridge.pollNow(initialNow);

    insertPromptLog(codexFixture.logsDb, "thread-1", "submission-2");
    insertToolLog(codexFixture.logsDb, "thread-1", "exec_command", "call-1");
    insertToolLog(codexFixture.logsDb, "thread-1", "exec_command", "call-1");
    insertToolLog(codexFixture.logsDb, "thread-1", "apply_patch", "call-2");
    insertToolLog(
      codexFixture.logsDb,
      "thread-1",
      "mcp__playwright__browser_snapshot",
      "call-3"
    );
    setThreadUpdatedAt(
      codexFixture.stateDb,
      "thread-1",
      Math.floor((initialNow + 1_000) / 1000),
      4321
    );

    await bridge.pollNow(initialNow + 70_000);

    expect(eventMessages).toHaveLength(1);
    expect(eventMessages[0]).toContain(
      "VS Code Codex activity for `codex-chatops`"
    );
    expect(eventMessages[0]).toContain("Title: Discord bridge");
    expect(eventMessages[0]).toContain("Prompts in session: 2");
    expect(eventMessages[0]).toContain("Tool calls observed: 3");
    expect(eventMessages[0]).toContain("Shell commands: 1");
    expect(eventMessages[0]).toContain("Patches: 1");
    expect(eventMessages[0]).toContain("Tokens recorded: 4321");
    expect(eventMessages[0]).toContain("Last activity: <t:");

    bridge.stop();
  });

  it("ignores unmapped workspaces and non-vscode thread sources", async () => {
    const repo = createTestRepo({
      slug: "codex-chatops",
      localPath: "/workspace/codex-chatops",
      eventsChannelId: "events-1"
    });
    const fixture = createTestDb([repo]);
    const codexFixture = createCodexFixture();
    cleanups.push(fixture.cleanup, codexFixture.cleanup);

    const eventMessages: string[] = [];
    const bridge = new VsCodeSessionBridge({
      client: {
        channels: {
          fetch: vi.fn(async () => ({
            send: vi.fn(async (message: string) => {
              eventMessages.push(message);
            })
          }))
        }
      } as never,
      repoRegistry: new RepoRegistry(fixture.db),
      summaryRenderer: new SummaryRenderer(),
      codexHomePath: codexFixture.root
    });

    const now = 1_776_200_000_000;
    insertVsCodeThread({
      stateDb: codexFixture.stateDb,
      id: "thread-unmapped",
      cwd: "/workspace/elsewhere",
      updatedAt: Math.floor(now / 1000)
    });
    insertVsCodeThread({
      stateDb: codexFixture.stateDb,
      id: "thread-exec",
      cwd: "/workspace/codex-chatops",
      source: "exec",
      updatedAt: Math.floor(now / 1000)
    });

    await bridge.pollNow(now);
    await bridge.pollNow(now + 120_000);

    expect(eventMessages).toHaveLength(0);

    bridge.stop();
  });
});
