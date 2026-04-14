import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

import { GitRunner } from "../../src/core/git-runner.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Codex",
      GIT_AUTHOR_EMAIL: "codex@example.com",
      GIT_COMMITTER_NAME: "Codex",
      GIT_COMMITTER_EMAIL: "codex@example.com"
    }
  }).trim();
}

describe("GitRunner", () => {
  it("falls back to HEAD when the configured default branch does not exist locally", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "codex-chatops-git-runner-"));
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));

    const repoPath = path.join(root, "repo");
    const chatopsRoot = path.join(root, "chatops");

    git(root, "init", "--initial-branch=feature/next", repoPath);
    git(repoPath, "config", "user.name", "Codex");
    git(repoPath, "config", "user.email", "codex@example.com");
    execFileSync("bash", ["-lc", "printf 'hello\\n' > README.md"], {
      cwd: repoPath
    });
    git(repoPath, "add", "README.md");
    git(repoPath, "commit", "-m", "initial");

    const runner = new GitRunner();
    const workspace = await runner.prepareSessionWorkspace(
      {
        slug: "repo",
        categoryName: "repo",
        sessionChannelId: "session",
        eventsChannelId: "events",
        deploymentsChannelId: "deployments",
        localPath: repoPath,
        defaultBranch: "main",
        codexProfile: "default",
        allowedUsers: [],
        allowedRoles: [],
        checks: [],
        deployWorkflows: {},
        requirePrApproval: false,
        requireProdConfirmation: false
      },
      "session-1",
      chatopsRoot
    );

    expect(workspace.branchName).toBe("chatops/repo/session-1");
    expect(workspace.worktreePath).toBe(
      path.join(chatopsRoot, "worktrees", "session-1")
    );
    expect(git(repoPath, "worktree", "list")).toContain(workspace.worktreePath);
  });
});
