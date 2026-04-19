import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import { CodexRunner } from "../../src/core/codex-runner.js";

const spawnMock = vi.fn();

vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args)
}));

afterEach(() => {
  spawnMock.mockReset();
});

describe("CodexRunner", () => {
  it("passes --skip-git-repo-check to codex exec when requested", async () => {
    let capturedArgs: string[] = [];
    spawnMock.mockImplementation((_bin: string, args: string[]) => {
      capturedArgs = args;
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
});
