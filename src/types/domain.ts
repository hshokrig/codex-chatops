export type ChannelPurpose =
  | "session-intake"
  | "repo-events"
  | "repo-deployments"
  | "global-status"
  | "global-usage"
  | "global-audit"
  | "global-approvals";

export type SessionStatus =
  | "open"
  | "running"
  | "awaiting_approval"
  | "archived"
  | "failed";

export type RunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "blocked"
  | "failed"
  | "cancelled";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";

export type ApprovalType =
  | "commit"
  | "open-pr"
  | "deploy-staging"
  | "deploy-production";

export interface DeploymentWorkflowConfig {
  workflow_id: string;
  ref: "session-branch" | "default-branch" | string;
  inputs?: Record<string, string>;
}

export interface RepoDefinition {
  slug: string;
  categoryName: string;
  sessionChannelId: string;
  eventsChannelId: string;
  deploymentsChannelId: string;
  localPath: string;
  defaultBranch: string;
  codexProfile: string;
  allowedUsers: string[];
  allowedRoles: string[];
  checks: string[];
  deployWorkflows: Partial<Record<"staging" | "production", DeploymentWorkflowConfig>>;
  requirePrApproval: boolean;
  requireProdConfirmation: boolean;
  githubOwner?: string;
  githubRepo?: string;
}

export interface RepoMap {
  repos: RepoDefinition[];
}

export interface EnvironmentConfig {
  discordBotToken: string;
  discordApplicationId: string;
  discordPublicKey?: string;
  discordGuildId: string;
  chatopsDbPath: string;
  chatopsRoot: string;
  chatopsRepoMapPath: string;
  codexMode: "sdk" | "exec";
  codexBin: string;
  codexProfile?: string;
  allowThreadPlainReply: boolean;
  enablePrs: boolean;
  enableDeploys: boolean;
  enableDiscordBootstrap: boolean;
  discordBootstrapMode: "validate" | "create-missing";
  statusChannelId?: string;
  usageChannelId?: string;
  auditChannelId?: string;
  approvalsChannelId?: string;
  githubToken?: string;
  githubUseGhCli: boolean;
  fastifyHost: string;
  fastifyPort: number;
}

export interface DiscordChannelBinding {
  channelId: string;
  repoId?: string;
  purpose: ChannelPurpose;
}

export interface RepoRecord {
  id: string;
  slug: string;
  category_name: string;
  local_path: string;
  default_branch: string;
  codex_profile: string;
  allowed_users_json: string;
  allowed_roles_json: string;
  checks_json: string;
  deploy_workflows_json: string;
  require_pr_approval: number;
  require_prod_confirmation: number;
  github_owner?: string;
  github_repo?: string;
  created_at: string;
  updated_at: string;
}

export interface SessionRecord {
  id: string;
  platform: string;
  guildId: string;
  channelId: string;
  threadId: string;
  repoId: string;
  codexThreadId: string;
  worktreePath: string;
  branchName: string;
  requestedBy: string;
  title: string;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
}

export interface RunRecord {
  id: string;
  sessionId: string;
  prompt: string;
  requestedBy: string;
  status: RunStatus;
  resultSummary?: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
}

export interface MessageAttachmentInput {
  id: string;
  name: string;
  url: string;
  contentType?: string;
  size?: number;
}

export interface PreparedAttachment extends MessageAttachmentInput {
  localPath: string;
}

export interface ApprovalRecord {
  id: string;
  sessionId: string;
  runId?: string | null;
  type: ApprovalType;
  status: ApprovalStatus;
  requestedBy: string;
  decidedBy?: string | null;
  createdAt: string;
  decidedAt?: string | null;
  payloadJson: string;
}

export interface EventRecord {
  id: string;
  sessionId?: string | null;
  runId?: string | null;
  ts: string;
  kind: string;
  payloadJson: string;
}

export interface UsageRollup {
  date: string;
  repoSlug: string;
  sessionCount: number;
  runCount: number;
  promptCount: number;
  successCount: number;
  failureCount: number;
  avgRunMs: number;
  activeSessionCount: number;
  createdAt: string;
}
