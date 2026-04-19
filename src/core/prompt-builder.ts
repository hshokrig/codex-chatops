import type {
  PreparedAttachment,
  RepoDefinition,
  RunRecord,
  SessionRecord
} from "../types/domain.js";

export interface PromptBuildInput {
  repo: RepoDefinition;
  session: SessionRecord;
  request: string;
  conversationContext?: string;
  priorRuns: RunRecord[];
  checks: string[];
  summaryPath: string;
  checksPath: string;
  attachments?: PreparedAttachment[];
}

export class PromptBuilder {
  build(input: PromptBuildInput): string {
    const priorSummary =
      input.priorRuns.length === 0
        ? "No prior runs in this session."
        : input.priorRuns
            .map(
              (run) => `- ${run.createdAt}: ${run.resultSummary ?? run.status}`
            )
            .join("\n");

    return [
      `You are working on repo: ${input.repo.slug}`,
      `Repo path: ${input.repo.localPath}`,
      `Active branch: ${input.session.branchName}`,
      `Session objective: Continue the Discord thread session ${input.session.id}`,
      `Current run request: ${input.request}`,
      "",
      "Conversation context:",
      input.conversationContext?.trim() ||
        "No recent Discord context captured.",
      "",
      "Context isolation and QA:",
      "- Treat only the current run request, captured conversation context, and current-session artifacts as in scope.",
      "- Do not reuse people, chats, tasks, or message drafts from other channels, threads, or external conversations unless they are explicitly present in this run's context.",
      "- If prior Codex thread history appears to conflict with the current request/context, stop following that stale history and follow the current request/context instead.",
      "- Before taking any outward action or drafting any user-facing/external message, run a QA pass on the candidate output.",
      "- QA must reject drafts that are only a generic acknowledgement, `got it`, `ok`, or mostly emoji copied from an earlier drafting pass.",
      "- QA must verify the content is specifically relevant to the messages in the current channel/thread context; if relevance is weak or unsupported, do not send and report the blocker instead.",
      "",
      "Attachments:",
      !input.attachments || input.attachments.length === 0
        ? "- No attachments."
        : input.attachments
            .map(
              (attachment) =>
                `- ${attachment.name} (${attachment.contentType ?? "unknown type"}, ${attachment.size ?? "unknown size"} bytes) at ${attachment.localPath}`
            )
            .join("\n"),
      "",
      "Constraints:",
      "- Work only inside the session worktree.",
      "- If attachments are provided, inspect the saved local files when they are relevant to the request.",
      "- Do not deploy directly.",
      "- Do not expose or copy secrets.",
      "- Keep changes deterministic and reviewable.",
      "- Run appropriate tests/checks when relevant.",
      "- Write a concise final summary suitable for Discord operators.",
      "- Explain blockers clearly.",
      "",
      "Prior session summary:",
      priorSummary,
      "",
      "Required checks:",
      input.checks.length === 0
        ? "- No configured checks."
        : input.checks.map((check) => `- ${check}`).join("\n"),
      "",
      "Artifacts to produce:",
      `- Summary path: ${input.summaryPath}`,
      `- Checks path: ${input.checksPath}`,
      "",
      "Execution style:",
      "- First think briefly about the plan.",
      "- Then implement the changes.",
      "- Return concise operational output only."
    ].join("\n");
  }
}
