import { mkdirSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { migrations } from "./migrations.js";
import type {
  ApprovalRecord,
  ApprovalStatus,
  ApprovalType,
  ChannelPurpose,
  DiscordChannelBinding,
  EventRecord,
  RepoDefinition,
  RepoRecord,
  RunRecord,
  RunStatus,
  SessionRecord,
  SessionStatus,
  UsageRollup
} from "../types/domain.js";

type JsonRow = Record<string, unknown>;

function nowIso(): string {
  return new Date().toISOString();
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function rowToRepoDefinition(
  row: RepoRecord & {
    session_channel_id?: string;
    events_channel_id?: string;
    deployments_channel_id?: string;
  }
): RepoDefinition {
  return {
    slug: row.slug,
    categoryName: row.category_name,
    sessionChannelId: row.session_channel_id ?? "",
    eventsChannelId: row.events_channel_id ?? "",
    deploymentsChannelId: row.deployments_channel_id ?? "",
    localPath: row.local_path,
    defaultBranch: row.default_branch,
    codexProfile: row.codex_profile,
    allowedUsers: parseJson<string[]>(row.allowed_users_json),
    allowedRoles: parseJson<string[]>(row.allowed_roles_json),
    checks: parseJson<string[]>(row.checks_json),
    deployWorkflows: parseJson(row.deploy_workflows_json),
    githubOwner: row.github_owner ?? undefined,
    githubRepo: row.github_repo ?? undefined,
    requirePrApproval: Boolean(row.require_pr_approval),
    requireProdConfirmation: Boolean(row.require_prod_confirmation)
  };
}

export class DatabaseClient {
  readonly sqlite: Database.Database;

  constructor(dbPath: string) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.sqlite = new Database(dbPath);
    this.sqlite.pragma("journal_mode = WAL");
    this.applyMigrations();
  }

  close(): void {
    this.sqlite.close();
  }

  private applyMigrations(): void {
    for (const migration of migrations) {
      this.sqlite.exec(migration);
    }
  }

  syncRepoConfig(
    repos: RepoDefinition[],
    globals: {
      statusChannelId?: string;
      usageChannelId?: string;
      auditChannelId?: string;
      approvalsChannelId?: string;
    }
  ): void {
    const timestamp = nowIso();
    const tx = this.sqlite.transaction(() => {
      for (const repo of repos) {
        const repoId = repo.slug;
        this.sqlite
          .prepare(
            `
            INSERT INTO repos (
              id, slug, category_name, local_path, default_branch, codex_profile, allowed_users_json,
              allowed_roles_json, checks_json, deploy_workflows_json, require_pr_approval,
              require_prod_confirmation, github_owner, github_repo, created_at, updated_at
            ) VALUES (
              @id, @slug, @category_name, @local_path, @default_branch, @codex_profile, @allowed_users_json,
              @allowed_roles_json, @checks_json, @deploy_workflows_json, @require_pr_approval,
              @require_prod_confirmation, @github_owner, @github_repo, @created_at, @updated_at
            )
            ON CONFLICT(id) DO UPDATE SET
              slug = excluded.slug,
              category_name = excluded.category_name,
              local_path = excluded.local_path,
              default_branch = excluded.default_branch,
              codex_profile = excluded.codex_profile,
              allowed_users_json = excluded.allowed_users_json,
              allowed_roles_json = excluded.allowed_roles_json,
              checks_json = excluded.checks_json,
              deploy_workflows_json = excluded.deploy_workflows_json,
              require_pr_approval = excluded.require_pr_approval,
              require_prod_confirmation = excluded.require_prod_confirmation,
              github_owner = excluded.github_owner,
              github_repo = excluded.github_repo,
              updated_at = excluded.updated_at
          `
          )
          .run({
            id: repoId,
            slug: repo.slug,
            category_name: repo.categoryName,
            local_path: repo.localPath,
            default_branch: repo.defaultBranch,
            codex_profile: repo.codexProfile,
            allowed_users_json: JSON.stringify(repo.allowedUsers),
            allowed_roles_json: JSON.stringify(repo.allowedRoles),
            checks_json: JSON.stringify(repo.checks),
            deploy_workflows_json: JSON.stringify(repo.deployWorkflows),
            require_pr_approval: repo.requirePrApproval ? 1 : 0,
            require_prod_confirmation: repo.requireProdConfirmation ? 1 : 0,
            github_owner: repo.githubOwner ?? null,
            github_repo: repo.githubRepo ?? null,
            created_at: timestamp,
            updated_at: timestamp
          });

        this.upsertChannelBinding({
          channelId: repo.sessionChannelId,
          repoId,
          purpose: "session-intake"
        });
        this.upsertChannelBinding({
          channelId: repo.eventsChannelId,
          repoId,
          purpose: "repo-events"
        });
        this.upsertChannelBinding({
          channelId: repo.deploymentsChannelId,
          repoId,
          purpose: "repo-deployments"
        });
      }

      this.upsertGlobalBinding(globals.statusChannelId, "global-status");
      this.upsertGlobalBinding(globals.usageChannelId, "global-usage");
      this.upsertGlobalBinding(globals.auditChannelId, "global-audit");
      this.upsertGlobalBinding(globals.approvalsChannelId, "global-approvals");
    });

    tx();
  }

  private upsertGlobalBinding(
    channelId: string | undefined,
    purpose: Extract<ChannelPurpose, "global-status" | "global-usage" | "global-audit" | "global-approvals">
  ): void {
    if (!channelId) {
      return;
    }

    this.upsertChannelBinding({
      channelId,
      purpose,
      repoId: undefined
    });
  }

  private upsertChannelBinding(binding: DiscordChannelBinding): void {
    this.sqlite
      .prepare(
        `
        INSERT INTO channel_bindings (channel_id, repo_id, purpose, created_at)
        VALUES (@channel_id, @repo_id, @purpose, @created_at)
        ON CONFLICT(channel_id) DO UPDATE SET
          repo_id = excluded.repo_id,
          purpose = excluded.purpose
      `
      )
      .run({
        channel_id: binding.channelId,
        repo_id: binding.repoId ?? null,
        purpose: binding.purpose,
        created_at: nowIso()
      });
  }

  getChannelBinding(channelId: string): DiscordChannelBinding | null {
    const row = this.sqlite
      .prepare("SELECT channel_id, repo_id, purpose FROM channel_bindings WHERE channel_id = ?")
      .get(channelId) as
      | { channel_id: string; repo_id: string | null; purpose: ChannelPurpose }
      | undefined;

    if (!row) {
      return null;
    }

    return {
      channelId: row.channel_id,
      repoId: row.repo_id ?? undefined,
      purpose: row.purpose
    };
  }

  getRepoBySlug(slug: string): RepoDefinition | null {
    const repoRow = this.sqlite
      .prepare("SELECT * FROM repos WHERE slug = ?")
      .get(slug) as RepoRecord | undefined;

    if (!repoRow) {
      return null;
    }

    return this.inflateRepo(repoRow);
  }

  getRepoById(repoId: string): RepoDefinition | null {
    const repoRow = this.sqlite
      .prepare("SELECT * FROM repos WHERE id = ?")
      .get(repoId) as RepoRecord | undefined;

    if (!repoRow) {
      return null;
    }

    return this.inflateRepo(repoRow);
  }

  getRepoBySessionChannel(channelId: string): RepoDefinition | null {
    const row = this.sqlite
      .prepare(
        `
          SELECT repos.*
          FROM channel_bindings
          JOIN repos ON repos.id = channel_bindings.repo_id
          WHERE channel_bindings.channel_id = ? AND channel_bindings.purpose = 'session-intake'
        `
      )
      .get(channelId) as RepoRecord | undefined;

    if (!row) {
      return null;
    }

    return this.inflateRepo(row);
  }

  listRepos(): RepoDefinition[] {
    const rows = this.sqlite.prepare("SELECT * FROM repos ORDER BY slug").all() as RepoRecord[];
    return rows.map((row) => this.inflateRepo(row));
  }

  private inflateRepo(row: RepoRecord): RepoDefinition {
    const bindings = this.sqlite
      .prepare("SELECT channel_id, purpose FROM channel_bindings WHERE repo_id = ?")
      .all(row.id) as Array<{ channel_id: string; purpose: ChannelPurpose }>;

    const purposeToChannel = new Map(bindings.map((binding) => [binding.purpose, binding.channel_id]));
    return {
      ...rowToRepoDefinition(row),
      sessionChannelId: purposeToChannel.get("session-intake") ?? "",
      eventsChannelId: purposeToChannel.get("repo-events") ?? "",
      deploymentsChannelId: purposeToChannel.get("repo-deployments") ?? ""
    };
  }

  createSession(session: SessionRecord): void {
    this.sqlite
      .prepare(
        `
        INSERT INTO sessions (
          id, platform, guild_id, channel_id, thread_id, repo_id, codex_thread_id, worktree_path,
          branch_name, requested_by, title, status, created_at, updated_at, archived_at
        ) VALUES (
          @id, @platform, @guild_id, @channel_id, @thread_id, @repo_id, @codex_thread_id, @worktree_path,
          @branch_name, @requested_by, @title, @status, @created_at, @updated_at, @archived_at
        )
      `
      )
      .run({
        id: session.id,
        platform: session.platform,
        guild_id: session.guildId,
        channel_id: session.channelId,
        thread_id: session.threadId,
        repo_id: session.repoId,
        codex_thread_id: session.codexThreadId,
        worktree_path: session.worktreePath,
        branch_name: session.branchName,
        requested_by: session.requestedBy,
        title: session.title,
        status: session.status,
        created_at: session.createdAt,
        updated_at: session.updatedAt,
        archived_at: session.archivedAt ?? null
      });
  }

  getSessionByThreadId(threadId: string): SessionRecord | null {
    const row = this.sqlite
      .prepare("SELECT * FROM sessions WHERE thread_id = ?")
      .get(threadId) as JsonRow | undefined;
    return row ? this.mapSession(row) : null;
  }

  getSessionById(sessionId: string): SessionRecord | null {
    const row = this.sqlite
      .prepare("SELECT * FROM sessions WHERE id = ?")
      .get(sessionId) as JsonRow | undefined;
    return row ? this.mapSession(row) : null;
  }

  updateSessionStatus(sessionId: string, status: SessionStatus): void {
    this.sqlite
      .prepare("UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?")
      .run(status, nowIso(), sessionId);
  }

  updateSessionCodexThread(sessionId: string, codexThreadId: string): void {
    this.sqlite
      .prepare("UPDATE sessions SET codex_thread_id = ?, updated_at = ? WHERE id = ?")
      .run(codexThreadId, nowIso(), sessionId);
  }

  archiveSession(sessionId: string): void {
    this.sqlite
      .prepare(
        "UPDATE sessions SET status = 'archived', archived_at = ?, updated_at = ? WHERE id = ?"
      )
      .run(nowIso(), nowIso(), sessionId);
  }

  createRun(run: RunRecord): void {
    this.sqlite
      .prepare(
        `
        INSERT INTO runs (
          id, session_id, prompt, requested_by, status, result_summary, created_at, updated_at, completed_at
        ) VALUES (
          @id, @session_id, @prompt, @requested_by, @status, @result_summary, @created_at, @updated_at, @completed_at
        )
      `
      )
      .run({
        id: run.id,
        session_id: run.sessionId,
        prompt: run.prompt,
        requested_by: run.requestedBy,
        status: run.status,
        result_summary: run.resultSummary ?? null,
        created_at: run.createdAt,
        updated_at: run.updatedAt,
        completed_at: run.completedAt ?? null
      });
  }

  updateRun(runId: string, patch: { status: RunStatus; resultSummary?: string; completedAt?: string }): void {
    this.sqlite
      .prepare(
        `
        UPDATE runs
        SET status = @status,
            result_summary = COALESCE(@result_summary, result_summary),
            completed_at = COALESCE(@completed_at, completed_at),
            updated_at = @updated_at
        WHERE id = @id
      `
      )
      .run({
        id: runId,
        status: patch.status,
        result_summary: patch.resultSummary ?? null,
        completed_at: patch.completedAt ?? null,
        updated_at: nowIso()
      });
  }

  getLatestRunForSession(sessionId: string): RunRecord | null {
    const row = this.sqlite
      .prepare("SELECT * FROM runs WHERE session_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(sessionId) as JsonRow | undefined;
    return row ? this.mapRun(row) : null;
  }

  listRunsForSession(sessionId: string): RunRecord[] {
    const rows = this.sqlite
      .prepare("SELECT * FROM runs WHERE session_id = ? ORDER BY created_at ASC")
      .all(sessionId) as JsonRow[];
    return rows.map((row) => this.mapRun(row));
  }

  createApproval(approval: ApprovalRecord): void {
    this.sqlite
      .prepare(
        `
        INSERT INTO approvals (
          id, session_id, run_id, type, status, requested_by, decided_by, created_at, decided_at, payload_json
        ) VALUES (
          @id, @session_id, @run_id, @type, @status, @requested_by, @decided_by, @created_at, @decided_at, @payload_json
        )
      `
      )
      .run({
        id: approval.id,
        session_id: approval.sessionId,
        run_id: approval.runId ?? null,
        type: approval.type,
        status: approval.status,
        requested_by: approval.requestedBy,
        decided_by: approval.decidedBy ?? null,
        created_at: approval.createdAt,
        decided_at: approval.decidedAt ?? null,
        payload_json: approval.payloadJson
      });
  }

  getApprovalById(approvalId: string): ApprovalRecord | null {
    const row = this.sqlite
      .prepare("SELECT * FROM approvals WHERE id = ?")
      .get(approvalId) as JsonRow | undefined;
    return row ? this.mapApproval(row) : null;
  }

  getPendingApprovalByType(sessionId: string, type: ApprovalType): ApprovalRecord | null {
    const row = this.sqlite
      .prepare(
        "SELECT * FROM approvals WHERE session_id = ? AND type = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1"
      )
      .get(sessionId, type) as JsonRow | undefined;
    return row ? this.mapApproval(row) : null;
  }

  listPendingApprovals(sessionId: string): ApprovalRecord[] {
    const rows = this.sqlite
      .prepare("SELECT * FROM approvals WHERE session_id = ? AND status = 'pending' ORDER BY created_at ASC")
      .all(sessionId) as JsonRow[];
    return rows.map((row) => this.mapApproval(row));
  }

  updateApprovalStatus(
    approvalId: string,
    status: ApprovalStatus,
    decidedBy: string,
    payloadJson?: string
  ): void {
    this.sqlite
      .prepare(
        `
        UPDATE approvals
        SET status = @status,
            decided_by = @decided_by,
            decided_at = @decided_at,
            payload_json = COALESCE(@payload_json, payload_json)
        WHERE id = @id
      `
      )
      .run({
        id: approvalId,
        status,
        decided_by: decidedBy,
        decided_at: nowIso(),
        payload_json: payloadJson ?? null
      });
  }

  insertEvent(event: EventRecord): void {
    this.sqlite
      .prepare(
        "INSERT INTO events (id, session_id, run_id, ts, kind, payload_json) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(
        event.id,
        event.sessionId ?? null,
        event.runId ?? null,
        event.ts,
        event.kind,
        event.payloadJson
      );
  }

  listEvents(sessionId: string): EventRecord[] {
    const rows = this.sqlite
      .prepare("SELECT * FROM events WHERE session_id = ? ORDER BY ts ASC")
      .all(sessionId) as JsonRow[];
    return rows.map((row) => this.mapEvent(row));
  }

  saveUsageRollup(rollup: UsageRollup): void {
    this.sqlite
      .prepare(
        `
        INSERT INTO usage_rollups (
          date, repo_slug, session_count, run_count, prompt_count, success_count, failure_count,
          avg_run_ms, active_session_count, created_at
        ) VALUES (
          @date, @repo_slug, @session_count, @run_count, @prompt_count, @success_count, @failure_count,
          @avg_run_ms, @active_session_count, @created_at
        )
        ON CONFLICT(date, repo_slug) DO UPDATE SET
          session_count = excluded.session_count,
          run_count = excluded.run_count,
          prompt_count = excluded.prompt_count,
          success_count = excluded.success_count,
          failure_count = excluded.failure_count,
          avg_run_ms = excluded.avg_run_ms,
          active_session_count = excluded.active_session_count,
          created_at = excluded.created_at
      `
      )
      .run({
        date: rollup.date,
        repo_slug: rollup.repoSlug,
        session_count: rollup.sessionCount,
        run_count: rollup.runCount,
        prompt_count: rollup.promptCount,
        success_count: rollup.successCount,
        failure_count: rollup.failureCount,
        avg_run_ms: rollup.avgRunMs,
        active_session_count: rollup.activeSessionCount,
        created_at: rollup.createdAt
      });
  }

  listUsageRollups(date: string): UsageRollup[] {
    const rows = this.sqlite
      .prepare("SELECT * FROM usage_rollups WHERE date = ? ORDER BY repo_slug ASC")
      .all(date) as JsonRow[];
    return rows.map((row) => ({
      date: String(row.date),
      repoSlug: String(row.repo_slug),
      sessionCount: Number(row.session_count),
      runCount: Number(row.run_count),
      promptCount: Number(row.prompt_count),
      successCount: Number(row.success_count),
      failureCount: Number(row.failure_count),
      avgRunMs: Number(row.avg_run_ms),
      activeSessionCount: Number(row.active_session_count),
      createdAt: String(row.created_at)
    }));
  }

  raw<T extends JsonRow[]>(sql: string, ...params: unknown[]): T {
    return this.sqlite.prepare(sql).all(...params) as T;
  }

  private mapSession(row: JsonRow): SessionRecord {
    return {
      id: String(row.id),
      platform: String(row.platform),
      guildId: String(row.guild_id),
      channelId: String(row.channel_id),
      threadId: String(row.thread_id),
      repoId: String(row.repo_id),
      codexThreadId: String(row.codex_thread_id),
      worktreePath: String(row.worktree_path),
      branchName: String(row.branch_name),
      requestedBy: String(row.requested_by),
      title: String(row.title),
      status: row.status as SessionStatus,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      archivedAt: row.archived_at ? String(row.archived_at) : null
    };
  }

  private mapRun(row: JsonRow): RunRecord {
    return {
      id: String(row.id),
      sessionId: String(row.session_id),
      prompt: String(row.prompt),
      requestedBy: String(row.requested_by),
      status: row.status as RunStatus,
      resultSummary: row.result_summary ? String(row.result_summary) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      completedAt: row.completed_at ? String(row.completed_at) : null
    };
  }

  private mapApproval(row: JsonRow): ApprovalRecord {
    return {
      id: String(row.id),
      sessionId: String(row.session_id),
      runId: row.run_id ? String(row.run_id) : null,
      type: row.type as ApprovalType,
      status: row.status as ApprovalStatus,
      requestedBy: String(row.requested_by),
      decidedBy: row.decided_by ? String(row.decided_by) : null,
      createdAt: String(row.created_at),
      decidedAt: row.decided_at ? String(row.decided_at) : null,
      payloadJson: String(row.payload_json)
    };
  }

  private mapEvent(row: JsonRow): EventRecord {
    return {
      id: String(row.id),
      sessionId: row.session_id ? String(row.session_id) : null,
      runId: row.run_id ? String(row.run_id) : null,
      ts: String(row.ts),
      kind: String(row.kind),
      payloadJson: String(row.payload_json)
    };
  }
}
