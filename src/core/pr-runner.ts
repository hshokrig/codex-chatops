import { spawn } from "node:child_process";

import { Octokit } from "@octokit/rest";

import type { EnvironmentConfig, RepoDefinition } from "../types/domain.js";

export interface PullRequestResult {
  url: string;
  number?: number;
}

export class PullRequestRunner {
  private readonly octokit?: Octokit;

  constructor(private readonly env: EnvironmentConfig) {
    if (env.githubToken) {
      this.octokit = new Octokit({ auth: env.githubToken });
    }
  }

  async openPullRequest(input: {
    repo: RepoDefinition;
    branchName: string;
    title: string;
    body: string;
  }): Promise<PullRequestResult> {
    if (!input.repo.githubOwner || !input.repo.githubRepo) {
      throw new Error(`Repo ${input.repo.slug} is missing github_owner/github_repo`);
    }

    if (this.env.githubUseGhCli) {
      return this.openWithGh(input.repo, input.branchName, input.title, input.body);
    }

    if (!this.octokit) {
      throw new Error("GITHUB_TOKEN is required unless GITHUB_USE_GH_CLI=true");
    }

    const response = await this.octokit.pulls.create({
      owner: input.repo.githubOwner,
      repo: input.repo.githubRepo,
      head: input.branchName,
      base: input.repo.defaultBranch,
      title: input.title,
      body: input.body
    });

    return {
      url: response.data.html_url,
      number: response.data.number
    };
  }

  private openWithGh(
    repo: RepoDefinition,
    branchName: string,
    title: string,
    body: string
  ): Promise<PullRequestResult> {
    return new Promise((resolve, reject) => {
      const args = [
        "pr",
        "create",
        "--repo",
        `${repo.githubOwner}/${repo.githubRepo}`,
        "--base",
        repo.defaultBranch,
        "--head",
        branchName,
        "--title",
        title,
        "--body",
        body
      ];
      const child = spawn("gh", args, {
        cwd: repo.localPath,
        env: process.env
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`gh pr create failed: ${stderr}`));
          return;
        }
        resolve({
          url: stdout.trim()
        });
      });
    });
  }
}
