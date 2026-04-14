import type {
  ApprovalRecord,
  RepoDefinition,
  RunRecord,
  SessionRecord,
  UsageRollup
} from "../types/domain.js";
import type { CheckResult } from "./git-runner.js";

function sessionTitle(session: SessionRecord, repo: RepoDefinition): string {
  const normalized = session.title.replace(/\s+/g, " ").trim();
  return normalized || `${repo.slug} session`;
}

function threadMention(session: SessionRecord): string {
  return `<#${session.threadId}>`;
}

export interface RunSummaryInput {
  repo: RepoDefinition;
  session: SessionRecord;
  run: RunRecord;
  checks: CheckResult[];
  changedFiles: string[];
  summary: string;
  hasUncommittedChanges: boolean;
  pendingApprovals: ApprovalRecord[];
}

export interface RepoEventInput {
  repo: RepoDefinition;
  session: SessionRecord;
  run: RunRecord;
  runCount: number;
  changedFiles: string[];
  hasUncommittedChanges: boolean;
}

export class SummaryRenderer {
  renderRunSummary(input: RunSummaryInput): string {
    const checksSummary =
      input.checks.length === 0
        ? "No configured checks."
        : input.checks
            .map(
              (check) =>
                `${check.exitCode === 0 ? "PASS" : "FAIL"} ${check.command}`
            )
            .join("\n");

    const approvals =
      input.pendingApprovals.length === 0
        ? "None"
        : input.pendingApprovals
            .map((approval) => `${approval.type} (${approval.status})`)
            .join(", ");

    return [
      `Run ${input.run.status.toUpperCase()} for \`${input.repo.slug}\``,
      `Session: \`${input.session.id}\``,
      `Branch: \`${input.session.branchName}\``,
      `Changed files (${input.changedFiles.length}): ${input.changedFiles.join(", ") || "none"}`,
      `Checks:\n${checksSummary}`,
      `Uncommitted changes: ${input.hasUncommittedChanges ? "yes" : "no"}`,
      `Pending approvals: ${approvals}`,
      "",
      input.summary.trim()
    ].join("\n");
  }

  renderSessionStarted(repo: RepoDefinition, session: SessionRecord): string {
    return [
      `New Codex session for \`${repo.slug}\``,
      `Thread: ${threadMention(session)}`,
      `Title: ${sessionTitle(session, repo)}`,
      `Session: \`${session.id}\``
    ].join("\n");
  }

  renderRepoEvent(input: RepoEventInput): string {
    return [
      `Codex activity for \`${input.repo.slug}\``,
      `Thread: ${threadMention(input.session)}`,
      `Title: ${sessionTitle(input.session, input.repo)}`,
      `Run status: ${input.run.status}`,
      `Runs in session: ${input.runCount}`,
      `Changed files: ${input.changedFiles.length}`,
      `Dirty worktree: ${input.hasUncommittedChanges ? "yes" : "no"}`
    ].join("\n");
  }

  renderDeploymentUpdate(
    repo: RepoDefinition,
    environment: "staging" | "production",
    state: string,
    extra?: string
  ): string {
    return [
      `Deployment ${state.toUpperCase()} for \`${repo.slug}\``,
      `Environment: ${environment}`,
      extra?.trim() ?? ""
    ]
      .filter(Boolean)
      .join("\n");
  }

  renderStatus(
    repo: RepoDefinition,
    session: SessionRecord,
    latestRun: RunRecord | null,
    changedFiles: string[],
    hasUncommittedChanges: boolean,
    pendingApprovals: ApprovalRecord[]
  ): string {
    return [
      `Session ${session.id}`,
      `Repo: ${repo.slug}`,
      `Title: ${sessionTitle(session, repo)}`,
      `Thread: ${threadMention(session)}`,
      `Branch: ${session.branchName}`,
      `State: ${session.status}`,
      `Latest run: ${latestRun?.status ?? "none"}`,
      `Changed files: ${changedFiles.length}`,
      `Dirty worktree: ${hasUncommittedChanges ? "yes" : "no"}`,
      `Pending approvals: ${pendingApprovals.length}`,
      `Last updated: ${session.updatedAt}`
    ].join("\n");
  }

  renderUsageMetrics(date: string, rollups: UsageRollup[]): string {
    const lines = [`Usage metrics for ${date}`];
    for (const rollup of rollups) {
      lines.push(
        `${rollup.repoSlug}: sessions=${rollup.sessionCount}, runs=${rollup.runCount}, prompts=${rollup.promptCount}, success=${rollup.successCount}, failures=${rollup.failureCount}, avgRunMs=${rollup.avgRunMs}, active=${rollup.activeSessionCount}`
      );
    }
    return lines.join("\n");
  }
}
