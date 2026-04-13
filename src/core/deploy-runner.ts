import { spawn } from "node:child_process";

import { Octokit } from "@octokit/rest";

import type { EnvironmentConfig, RepoDefinition } from "../types/domain.js";

export interface DeploymentRequest {
  repo: RepoDefinition;
  environment: "staging" | "production";
  branchName: string;
}

export interface DeploymentResult {
  workflowId: string;
  state: "queued" | "completed";
  runUrl?: string;
  message: string;
}

export class DeployRunner {
  private readonly octokit?: Octokit;

  constructor(private readonly env: EnvironmentConfig) {
    if (env.githubToken) {
      this.octokit = new Octokit({ auth: env.githubToken });
    }
  }

  async trigger(request: DeploymentRequest): Promise<DeploymentResult> {
    const workflow = request.repo.deployWorkflows[request.environment];
    if (!workflow) {
      throw new Error(`No ${request.environment} deployment configured for ${request.repo.slug}`);
    }
    if (!request.repo.githubOwner || !request.repo.githubRepo) {
      throw new Error(`Repo ${request.repo.slug} is missing github_owner/github_repo`);
    }

    const ref =
      workflow.ref === "session-branch"
        ? request.branchName
        : workflow.ref === "default-branch"
          ? request.repo.defaultBranch
          : workflow.ref;

    if (this.env.githubUseGhCli) {
      await this.runGhDispatch(request.repo, workflow.workflow_id, ref, workflow.inputs ?? {});
      return {
        workflowId: workflow.workflow_id,
        state: "queued",
        message: `Triggered ${request.environment} deploy via gh CLI on ${ref}`
      };
    }

    if (!this.octokit) {
      throw new Error("GITHUB_TOKEN is required unless GITHUB_USE_GH_CLI=true");
    }

    const dispatchPayload = {
      owner: request.repo.githubOwner,
      repo: request.repo.githubRepo,
      workflow_id: workflow.workflow_id,
      ref,
      ...(workflow.inputs ? { inputs: workflow.inputs } : {})
    };

    await this.octokit.actions.createWorkflowDispatch(dispatchPayload);

    const workflowRuns = await this.octokit.actions.listWorkflowRuns({
      owner: request.repo.githubOwner,
      repo: request.repo.githubRepo,
      workflow_id: workflow.workflow_id,
      branch: ref,
      per_page: 1
    });

    const run = workflowRuns.data.workflow_runs.at(0);
    const result: DeploymentResult = {
      workflowId: workflow.workflow_id,
      state: "queued",
      message: `Triggered ${request.environment} deploy on ${ref}`
    };
    if (run?.html_url) {
      result.runUrl = run.html_url;
    }
    return result;
  }

  private runGhDispatch(
    repo: RepoDefinition,
    workflowId: string,
    ref: string,
    inputs: Record<string, string>
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = [
        "workflow",
        "run",
        workflowId,
        "--repo",
        `${repo.githubOwner}/${repo.githubRepo}`,
        "--ref",
        ref
      ];

      for (const [key, value] of Object.entries(inputs)) {
        args.push("-f", `${key}=${value}`);
      }

      const child = spawn("gh", args, {
        cwd: repo.localPath,
        env: process.env
      });
      let stderr = "";
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      child.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`gh workflow run failed: ${stderr}`));
          return;
        }
        resolve();
      });
      child.on("error", reject);
    });
  }
}
