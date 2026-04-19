import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

const { spawnMock, startThreadMock, resumeThreadMock, codexConstructorMock } =
  vi.hoisted(() => ({
    spawnMock: vi.fn(),
    startThreadMock: vi.fn(),
    resumeThreadMock: vi.fn(),
    codexConstructorMock: vi.fn()
  }));

vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args)
}));

vi.mock("@openai/codex-sdk", () => ({
  Codex: codexConstructorMock
}));

import { CodexRunner } from "../../src/core/codex-runner.js";

function createExecChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn();
  queueMicrotask(() => {
    child.stdout.write(
      `${JSON.stringify({
        type: "thread.started",
        thread_id: "thread-1"
      })}\n`
    );
    child.emit("close", 0);
  });
  return child;
}

function createSdkResult() {
  return {
    events: (async function* () {
      yield { type: "thread.started", thread_id: "thread-1" };
      yield {
        type: "item.completed",
        item: { id: "item-1", type: "agent_message", text: "done" }
      };
    })()
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("CodexRunner", () => {
  it("passes --skip-git-repo-check to codex exec when requested", async () => {
    let capturedArgs: string[] = [];
    spawnMock.mockImplementation((_bin: string, args: string[]) => {
      capturedArgs = args;
      return createExecChild();
    });

    const runner = new CodexRunner({
      codexMode: "exec",
      codexBin: "codex",
      codexProfile: undefined
    } as never);

    const result = await runner.run({
      prompt: "hello",
      worktreePath: "/tmp/workspace",
      skipGitRepoCheck: true
    });

    expect(result.threadId).toBe("thread-1");
    expect(capturedArgs).toContain("--skip-git-repo-check");
  });

  it("does not pass --skip-git-repo-check to codex exec when not requested", async () => {
    let capturedArgs: string[] = [];
    spawnMock.mockImplementation((_bin: string, args: string[]) => {
      capturedArgs = args;
      return createExecChild();
    });

    const runner = new CodexRunner({
      codexMode: "exec",
      codexBin: "codex",
      codexProfile: undefined
    } as never);

    await runner.run({
      prompt: "hello",
      worktreePath: "/tmp/workspace"
    });

    expect(capturedArgs).not.toContain("--skip-git-repo-check");
  });

  it("passes skipGitRepoCheck through the SDK when requested", async () => {
    startThreadMock.mockReturnValue({
      id: "thread-1",
      runStreamed: vi.fn(async () => createSdkResult())
    });
    resumeThreadMock.mockReturnValue({
      id: "thread-1",
      runStreamed: vi.fn(async () => createSdkResult())
    });
    codexConstructorMock.mockImplementation(function () {
      return {
        startThread: startThreadMock,
        resumeThread: resumeThreadMock
      };
    });

    const runner = new CodexRunner({
      codexMode: "sdk",
      codexBin: "codex",
      codexProfile: undefined
    } as never);

    const result = await runner.run({
      prompt: "fix it",
      worktreePath: "/tmp/worktree",
      skipGitRepoCheck: true
    });

    expect(result.threadId).toBe("thread-1");
    expect(codexConstructorMock).toHaveBeenCalledWith({
      codexPathOverride: "codex"
    });
    expect(startThreadMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workingDirectory: "/tmp/worktree",
        skipGitRepoCheck: true
      })
    );
  });

  it("keeps SDK repo checks enabled by default", async () => {
    startThreadMock.mockReturnValue({
      id: "thread-1",
      runStreamed: vi.fn(async () => createSdkResult())
    });
    codexConstructorMock.mockImplementation(function () {
      return {
        startThread: startThreadMock,
        resumeThread: resumeThreadMock
      };
    });

    const runner = new CodexRunner({
      codexMode: "sdk",
      codexBin: "codex",
      codexProfile: undefined
    } as never);

    await runner.run({
      prompt: "fix it",
      worktreePath: "/tmp/worktree"
    });

    expect(startThreadMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workingDirectory: "/tmp/worktree",
        skipGitRepoCheck: false
      })
    );
  });
});
