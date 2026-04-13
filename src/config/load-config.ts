import { readFile } from "node:fs/promises";

import YAML from "yaml";

import { repoMapSchema } from "./repo-map.schema.js";
import type { RepoDefinition, RepoMap } from "../types/domain.js";

export async function loadRepoMap(filePath: string): Promise<RepoMap> {
  const source = await readFile(filePath, "utf8");
  const raw = YAML.parse(source);
  const parsed = repoMapSchema.parse(raw);

  const repos: RepoDefinition[] = parsed.repos.map((repo) => ({
    slug: repo.slug,
    categoryName: repo.category_name,
    sessionChannelId: repo.session_channel_id,
    eventsChannelId: repo.events_channel_id,
    deploymentsChannelId: repo.deployments_channel_id,
    localPath: repo.local_path,
    defaultBranch: repo.default_branch,
    codexProfile: repo.codex_profile,
    allowedUsers: repo.allowed_users,
    allowedRoles: repo.allowed_roles,
    checks: repo.checks,
    deployWorkflows: repo.deploy_workflows,
    requirePrApproval: repo.require_pr_approval,
    requireProdConfirmation: repo.require_prod_confirmation,
    githubOwner: repo.github_owner,
    githubRepo: repo.github_repo
  }));

  return { repos };
}
