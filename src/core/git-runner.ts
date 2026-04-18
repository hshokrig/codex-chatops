import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";

import { simpleGit } from "simple-git";

import type { RepoDefinition } from "../types/domain.js";
import { ensureDirectory } from "../lib/fs.js";

export interface SessionWorkspace {
  branchName: string;
  worktreePath: string;
}

export interface CheckResult {
  command: string;
  exitCode: number;
  output: string;
}

export class GitRunner {
  async prepareSessionWorkspace(
    repo: RepoDefinition,
    sessionId: string,
    chatopsRoot: string
  ): Promise<SessionWorkspace> {
    if (repo.workspaceMode === "direct") {
      const worktreePath = path.resolve(repo.localPath);
      await ensureDirectory(worktreePath);
      return {
        branchName: `direct/${repo.slug}/${sessionId}`,
        worktreePath
      };
    }

    const branchName = `chatops/${repo.slug}/${sessionId}`;
    const root = path.resolve(chatopsRoot);
    const worktreePath = path.join(root, "worktrees", sessionId);

    await ensureDirectory(path.join(root, "worktrees"));

    const repoGit = simpleGit(repo.localPath);
    try {
      await access(worktreePath, constants.F_OK);
    } catch {
      const baseRef = await this.resolveBaseRef(repoGit, repo.defaultBranch);
      await repoGit.raw([
        "worktree",
        "add",
        "-b",
        branchName,
        worktreePath,
        baseRef
      ]);
    }

    return { branchName, worktreePath };
  }

  private async resolveBaseRef(
    repoGit: ReturnType<typeof simpleGit>,
    defaultBranch: string
  ): Promise<string> {
    const candidates = [defaultBranch, `origin/${defaultBranch}`, "HEAD"];

    for (const candidate of candidates) {
      try {
        await repoGit.revparse(["--verify", candidate]);
        return candidate;
      } catch {
        continue;
      }
    }

    throw new Error(
      `Unable to create a session worktree: no valid base ref found for ${defaultBranch}, origin/${defaultBranch}, or HEAD.`
    );
  }

  async listChangedFiles(worktreePath: string): Promise<string[]> {
    const git = simpleGit(worktreePath);
    const diff = await git.diff(["--name-only"]);
    return diff
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }

  async hasUncommittedChanges(worktreePath: string): Promise<boolean> {
    const git = simpleGit(worktreePath);
    const status = await git.status();
    return !status.isClean();
  }

  async captureDiff(worktreePath: string): Promise<string> {
    const git = simpleGit(worktreePath);
    return git.diff();
  }

  async commitChanges(worktreePath: string, message: string): Promise<string> {
    const git = simpleGit(worktreePath);
    await git.add(".");
    const result = await git.commit(message);
    return result.commit;
  }

  async pushBranch(worktreePath: string, branchName: string): Promise<void> {
    const git = simpleGit(worktreePath);
    await git.push("origin", branchName, { "--set-upstream": null });
  }

  async currentHead(worktreePath: string): Promise<string> {
    const git = simpleGit(worktreePath);
    return git.revparse(["HEAD"]);
  }

  async runChecks(
    worktreePath: string,
    checks: string[]
  ): Promise<CheckResult[]> {
    const results: CheckResult[] = [];

    for (const command of checks) {
      results.push(await this.runCheck(worktreePath, command));
    }

    return results;
  }

  private runCheck(cwd: string, command: string): Promise<CheckResult> {
    return new Promise((resolve) => {
      const child = spawn("bash", ["-lc", command], {
        cwd,
        env: process.env
      });

      let output = "";
      child.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        output += chunk.toString("utf8");
      });

      child.on("close", (exitCode) => {
        resolve({
          command,
          exitCode: exitCode ?? 1,
          output
        });
      });
    });
  }
}
