import { randomUUID } from "node:crypto";
import path from "node:path";

import type { ArtifactWriter } from "./artifact-writer.js";
import type { CodexRunner } from "./codex-runner.js";
import type { GitRunner } from "./git-runner.js";
import type { PromptBuilder } from "./prompt-builder.js";
import type { SummaryRenderer } from "./summary-renderer.js";
import type { DatabaseClient } from "../persistence/db.js";
import type {
  MessageAttachmentInput,
  RepoDefinition,
  RunRecord,
  SessionRecord
} from "../types/domain.js";

function nowIso(): string {
  return new Date().toISOString();
}

export interface RunExecutionResult {
  run: RunRecord;
  summary: string;
  changedFiles: string[];
  hasUncommittedChanges: boolean;
}

export class RunOrchestrator {
  constructor(
    private readonly db: DatabaseClient,
    private readonly codexRunner: CodexRunner,
    private readonly gitRunner: GitRunner,
    private readonly artifactWriter: ArtifactWriter,
    private readonly promptBuilder: PromptBuilder,
    private readonly summaryRenderer: SummaryRenderer
  ) {}

  async execute(input: {
    session: SessionRecord;
    repo: RepoDefinition;
    prompt: string;
    conversationContext?: string;
    requestedBy: string;
    attachments?: MessageAttachmentInput[];
    signal?: AbortSignal;
  }): Promise<RunExecutionResult> {
    const runId = randomUUID();
    const run: RunRecord = {
      id: runId,
      sessionId: input.session.id,
      prompt: input.prompt,
      requestedBy: input.requestedBy,
      status: "running",
      resultSummary: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      completedAt: null
    };
    this.db.createRun(run);
    this.db.updateSessionStatus(input.session.id, "running");

    const priorRuns = this.db
      .listRunsForSession(input.session.id)
      .filter((item) => item.id !== runId);
    const preparedAttachments = await this.artifactWriter.prepareAttachments(
      input.session.id,
      runId,
      input.attachments ?? []
    );
    const prompt = this.promptBuilder.build({
      repo: input.repo,
      session: input.session,
      request: input.prompt,
      conversationContext: input.conversationContext,
      priorRuns,
      checks: input.repo.checks,
      attachments: preparedAttachments,
      summaryPath: path.join(
        this.artifactWriter.runRoot(input.session.id, runId),
        "summary.md"
      ),
      checksPath: path.join(
        this.artifactWriter.runRoot(input.session.id, runId),
        "checks.md"
      )
    });

    const codexRequest = {
      prompt,
      worktreePath: input.session.worktreePath,
      skipGitRepoCheck: input.repo.workspaceMode === "direct",
      ...(input.session.codexThreadId
        ? { threadId: input.session.codexThreadId }
        : {}),
      ...(input.signal ? { signal: input.signal } : {})
    };
    try {
      const codexResult = await this.codexRunner.run(codexRequest);

      if (
        codexResult.threadId !== input.session.codexThreadId &&
        codexResult.threadId
      ) {
        this.db.updateSessionCodexThread(
          input.session.id,
          codexResult.threadId
        );
      }

      const checks = await this.gitRunner.runChecks(
        input.session.worktreePath,
        input.repo.checks
      );
      const changedFiles = await this.gitRunner.listChangedFiles(
        input.session.worktreePath
      );
      const patchDiff = await this.gitRunner.captureDiff(
        input.session.worktreePath
      );
      const hasUncommittedChanges = await this.gitRunner.hasUncommittedChanges(
        input.session.worktreePath
      );
      const pendingApprovals = this.db.listPendingApprovals(input.session.id);
      const renderInputRun: RunRecord = {
        ...run,
        status: checks.some((check) => check.exitCode !== 0)
          ? "failed"
          : "succeeded",
        resultSummary: codexResult.summary,
        completedAt: nowIso(),
        updatedAt: nowIso()
      };

      const summary = this.summaryRenderer.renderRunSummary({
        repo: input.repo,
        session: input.session,
        run: renderInputRun,
        checks,
        changedFiles,
        summary: codexResult.summary,
        hasUncommittedChanges,
        pendingApprovals
      });

      await this.artifactWriter.writeRunArtifacts({
        session: input.session,
        runId,
        requestPrompt: prompt,
        summary,
        checks,
        patchDiff,
        events: codexResult.events,
        metadata: {
          changedFiles,
          items: codexResult.items,
          attachments: preparedAttachments
        }
      });

      const finalStatus = checks.some((check) => check.exitCode !== 0)
        ? "failed"
        : "succeeded";
      this.db.updateRun(runId, {
        status: finalStatus,
        resultSummary: summary,
        completedAt: nowIso()
      });
      this.db.updateSessionStatus(
        input.session.id,
        finalStatus === "failed" ? "failed" : "open"
      );

      return {
        run: {
          ...renderInputRun,
          resultSummary: summary
        },
        summary,
        changedFiles,
        hasUncommittedChanges
      };
    } catch (error) {
      const failureSummary =
        error instanceof Error ? error.message : String(error);
      this.db.updateRun(runId, {
        status: "failed",
        resultSummary: failureSummary,
        completedAt: nowIso()
      });
      this.db.updateSessionStatus(input.session.id, "failed");
      throw error;
    }
  }
}
