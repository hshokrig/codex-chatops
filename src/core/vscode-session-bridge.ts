import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import type { Client, MessageCreateOptions } from "discord.js";

import type { RepoRegistry } from "./repo-registry.js";
import type { SummaryRenderer } from "./summary-renderer.js";
import { logger } from "../lib/logger.js";
import { buildCardMessage } from "../transport/discord/message-cards.js";
import type { RepoDefinition } from "../types/domain.js";

const POLL_INTERVAL_MS = 20_000;
const QUIET_WINDOW_MS = 60_000;

const TOOL_CALL_REGEX = /tool_name="([^"]+)"[^]*?call_id="([^"]+)"/g;
const SUBMISSION_REGEX = /submission\.id="([^"]+)"[^]*?codex\.op="user_input"/g;

type SendableChannel = {
  send: (content: string | MessageCreateOptions) => Promise<unknown>;
};

interface CodexThreadRow {
  id: string;
  cwd: string;
  title: string;
  created_at: number;
  updated_at: number;
  tokens_used: number;
  git_branch: string | null;
}

interface ThreadStats {
  promptCount: number;
  toolCallCount: number;
  shellCommandCount: number;
  patchCount: number;
}

interface ObservedSessionState {
  lastReportedPromptCount: number;
}

function isSendableChannel(channel: unknown): channel is SendableChannel {
  return (
    Boolean(channel) &&
    typeof (channel as { send?: unknown }).send === "function"
  );
}

function normalizeTitle(title: string, fallback: string): string {
  const normalized = title.replace(/\s+/g, " ").trim();
  return normalized || fallback;
}

function pathContains(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function workspaceName(cwd: string): string {
  const base = path.basename(cwd.trim());
  return base || cwd;
}

export interface VsCodeSessionBridgeDependencies {
  client: Client;
  repoRegistry: RepoRegistry;
  summaryRenderer: SummaryRenderer;
  codexHomePath?: string;
}

export class VsCodeSessionBridge {
  private readonly codexHomePath: string;
  private readonly stateDbPath: string;
  private readonly logsDbPath: string;
  private readonly sessionIndexPath: string;
  private readonly repoRoots: Array<{
    repo: RepoDefinition;
    resolvedLocalPath: string;
  }>;

  private pollInterval: ReturnType<typeof setInterval> | undefined;
  private stateDb: Database.Database | null = null;
  private logsDb: Database.Database | null = null;
  private initialized = false;
  private readonly observed = new Map<string, ObservedSessionState>();

  constructor(private readonly deps: VsCodeSessionBridgeDependencies) {
    this.codexHomePath = deps.codexHomePath ?? path.join(homedir(), ".codex");
    this.stateDbPath = path.join(this.codexHomePath, "state_5.sqlite");
    this.logsDbPath = path.join(this.codexHomePath, "logs_2.sqlite");
    this.sessionIndexPath = path.join(
      this.codexHomePath,
      "session_index.jsonl"
    );
    this.repoRoots = deps.repoRegistry
      .listRepos()
      .map((repo) => ({
        repo,
        resolvedLocalPath: path.resolve(repo.localPath)
      }))
      .sort(
        (left, right) =>
          right.resolvedLocalPath.length - left.resolvedLocalPath.length
      );
  }

  start(): void {
    if (!this.hasRequiredSources()) {
      logger.info(
        { codexHomePath: this.codexHomePath },
        "VS Code session bridge disabled because Codex state files were not found"
      );
      return;
    }

    void this.pollNow();
    this.pollInterval = setInterval(() => {
      void this.pollNow();
    }, POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = undefined;
    }
    this.stateDb?.close();
    this.logsDb?.close();
    this.stateDb = null;
    this.logsDb = null;
    this.initialized = false;
    this.observed.clear();
  }

  async pollNow(nowMs = Date.now()): Promise<void> {
    if (!this.hasRequiredSources()) {
      return;
    }

    try {
      this.ensureConnections();
      const threadNames = this.loadThreadNames();
      const threads = this.loadThreads();
      const activeThreadIds = new Set<string>();

      for (const thread of threads) {
        const repo = this.resolveRepo(thread.cwd);
        if (!repo) {
          continue;
        }

        activeThreadIds.add(thread.id);
        const stats = this.loadThreadStats(thread.id);
        const title = normalizeTitle(
          threadNames.get(thread.id) ?? thread.title,
          `${repo.slug} session`
        );
        const state = this.observed.get(thread.id);

        if (!this.initialized) {
          this.observed.set(thread.id, {
            lastReportedPromptCount: stats.promptCount
          });
          continue;
        }

        if (!state) {
          await this.publishStart(repo, thread, title, stats.promptCount);
          this.observed.set(thread.id, {
            lastReportedPromptCount: 0
          });
          continue;
        }

        if (
          stats.promptCount > state.lastReportedPromptCount &&
          nowMs - thread.updated_at * 1000 >= QUIET_WINDOW_MS
        ) {
          await this.publishActivity(repo, thread, title, stats);
          state.lastReportedPromptCount = stats.promptCount;
        }
      }

      this.initialized = true;

      for (const threadId of [...this.observed.keys()]) {
        if (!activeThreadIds.has(threadId)) {
          this.observed.delete(threadId);
        }
      }
    } catch (error) {
      logger.error({ err: error }, "VS Code session bridge poll failed");
    }
  }

  private hasRequiredSources(): boolean {
    return existsSync(this.stateDbPath) && existsSync(this.logsDbPath);
  }

  private ensureConnections(): void {
    if (!this.stateDb) {
      this.stateDb = new Database(this.stateDbPath, {
        readonly: true,
        fileMustExist: true
      });
      this.stateDb.pragma("busy_timeout = 1000");
    }

    if (!this.logsDb) {
      this.logsDb = new Database(this.logsDbPath, {
        readonly: true,
        fileMustExist: true
      });
      this.logsDb.pragma("busy_timeout = 1000");
    }
  }

  private loadThreadNames(): Map<string, string> {
    if (!existsSync(this.sessionIndexPath)) {
      return new Map();
    }

    const source = readFileSync(this.sessionIndexPath, "utf8");
    const names = new Map<string, string>();

    for (const line of source.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      try {
        const parsed = JSON.parse(trimmed) as {
          id?: string;
          thread_name?: string;
        };
        if (parsed.id && parsed.thread_name) {
          names.set(parsed.id, parsed.thread_name);
        }
      } catch (error) {
        logger.debug(
          { err: error, line: trimmed.slice(0, 120) },
          "Skipping invalid Codex session index row"
        );
      }
    }

    return names;
  }

  private loadThreads(): CodexThreadRow[] {
    if (!this.stateDb) {
      return [];
    }

    return this.stateDb
      .prepare(
        `
          SELECT
            id,
            cwd,
            COALESCE(title, '') AS title,
            created_at,
            updated_at,
            COALESCE(tokens_used, 0) AS tokens_used,
            git_branch
          FROM threads
          WHERE source = 'vscode'
            AND archived = 0
            AND cwd IS NOT NULL
            AND cwd != ''
          ORDER BY updated_at DESC
        `
      )
      .all() as CodexThreadRow[];
  }

  private loadThreadStats(threadId: string): ThreadStats {
    if (!this.logsDb) {
      return {
        promptCount: 0,
        toolCallCount: 0,
        shellCommandCount: 0,
        patchCount: 0
      };
    }

    const rows = this.logsDb
      .prepare(
        `
          SELECT feedback_log_body
          FROM logs
          WHERE thread_id = ?
            AND feedback_log_body IS NOT NULL
            AND (
              feedback_log_body LIKE '%codex.op="user_input"%'
              OR (
                feedback_log_body LIKE '%tool_name="%'
                AND feedback_log_body LIKE '%call_id="%'
              )
            )
        `
      )
      .all(threadId) as Array<{ feedback_log_body: string }>;

    const submissions = new Set<string>();
    const toolCalls = new Set<string>();
    const shellCommands = new Set<string>();
    const patches = new Set<string>();

    for (const row of rows) {
      const body = row.feedback_log_body;
      SUBMISSION_REGEX.lastIndex = 0;
      TOOL_CALL_REGEX.lastIndex = 0;

      for (const match of body.matchAll(SUBMISSION_REGEX)) {
        const submissionId = match[1];
        if (submissionId) {
          submissions.add(submissionId);
        }
      }

      for (const match of body.matchAll(TOOL_CALL_REGEX)) {
        const toolName = match[1];
        const callId = match[2];
        if (!toolName || !callId) {
          continue;
        }
        const uniqueKey = `${toolName}:${callId}`;
        toolCalls.add(uniqueKey);
        if (toolName === "exec_command") {
          shellCommands.add(uniqueKey);
        }
        if (toolName === "apply_patch") {
          patches.add(uniqueKey);
        }
      }
    }

    return {
      promptCount: submissions.size,
      toolCallCount: toolCalls.size,
      shellCommandCount: shellCommands.size,
      patchCount: patches.size
    };
  }

  private resolveRepo(cwd: string): RepoDefinition | null {
    const resolvedCwd = path.resolve(cwd);

    for (const candidate of this.repoRoots) {
      if (pathContains(candidate.resolvedLocalPath, resolvedCwd)) {
        return candidate.repo;
      }
    }

    return null;
  }

  private async publishStart(
    repo: RepoDefinition,
    thread: CodexThreadRow,
    title: string,
    promptCount: number
  ): Promise<void> {
    const channel = await this.resolveDestinationChannel(repo);
    if (!channel) {
      return;
    }

    await channel.send(
      buildCardMessage(
        this.deps.summaryRenderer.renderVsCodeSessionStarted({
          repo,
          title,
          workspaceName: workspaceName(thread.cwd),
          branchName: thread.git_branch,
          promptCount
        }),
        {
          tone: "info",
          footer: "VS Code session"
        }
      )
    );
  }

  private async publishActivity(
    repo: RepoDefinition,
    thread: CodexThreadRow,
    title: string,
    stats: ThreadStats
  ): Promise<void> {
    const channel = await this.resolveDestinationChannel(repo);
    if (!channel) {
      return;
    }

    await channel.send(
      buildCardMessage(
        this.deps.summaryRenderer.renderVsCodeSessionActivity({
          repo,
          title,
          workspaceName: workspaceName(thread.cwd),
          promptCount: stats.promptCount,
          toolCallCount: stats.toolCallCount,
          shellCommandCount: stats.shellCommandCount,
          patchCount: stats.patchCount,
          tokensUsed: Math.max(thread.tokens_used, 0),
          lastActivityUnix: Math.floor(thread.updated_at)
        }),
        {
          tone: "info",
          footer: "VS Code activity"
        }
      )
    );
  }

  private async resolveDestinationChannel(
    repo: RepoDefinition
  ): Promise<SendableChannel | null> {
    const channelId = repo.eventsChannelId;
    if (!channelId) {
      return null;
    }

    const channel = await this.deps.client.channels.fetch(channelId);
    return isSendableChannel(channel) ? channel : null;
  }
}
