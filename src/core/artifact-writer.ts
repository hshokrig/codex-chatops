import path from "node:path";

import { writeBinaryFile, writeTextFile } from "../lib/fs.js";
import type { CheckResult } from "./git-runner.js";
import type { MessageAttachmentInput, PreparedAttachment, SessionRecord, UsageRollup } from "../types/domain.js";

export interface RunArtifactsInput {
  session: SessionRecord;
  runId: string;
  requestPrompt: string;
  summary: string;
  checks: CheckResult[];
  patchDiff: string;
  events: unknown[];
  metadata: Record<string, unknown>;
  decisionLog?: string;
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "attachment";
}

export class ArtifactWriter {
  constructor(private readonly chatopsRoot: string) {}

  sessionRoot(sessionId: string): string {
    return path.resolve(this.chatopsRoot, "sessions", sessionId);
  }

  runRoot(sessionId: string, runId: string): string {
    return path.resolve(this.sessionRoot(sessionId), "runs", runId);
  }

  attachmentRoot(sessionId: string, runId: string): string {
    return path.resolve(this.runRoot(sessionId, runId), "attachments");
  }

  async writeSessionArtifacts(session: SessionRecord): Promise<void> {
    const root = this.sessionRoot(session.id);
    await writeTextFile(path.join(root, "session.json"), JSON.stringify(session, null, 2));
    await writeTextFile(
      path.join(root, "session.md"),
      `# Session ${session.id}\n\n- Repo: ${session.repoId}\n- Branch: ${session.branchName}\n- Worktree: ${session.worktreePath}\n`
    );
    await writeTextFile(path.join(root, "branch.txt"), `${session.branchName}\n`);
    await writeTextFile(path.join(root, "worktree.txt"), `${session.worktreePath}\n`);
  }

  async writeRunArtifacts(input: RunArtifactsInput): Promise<void> {
    const root = this.runRoot(input.session.id, input.runId);
    await writeTextFile(path.join(root, "request.md"), input.requestPrompt);
    await writeTextFile(path.join(root, "summary.md"), input.summary);
    await writeTextFile(
      path.join(root, "checks.md"),
      input.checks
        .map(
          (check) =>
            `## ${check.command}\n\nExit code: ${check.exitCode}\n\n\`\`\`\n${check.output.trim()}\n\`\`\`\n`
        )
        .join("\n")
    );
    await writeTextFile(path.join(root, "patch.diff"), input.patchDiff);
    await writeTextFile(
      path.join(root, "events.jsonl"),
      input.events.map((event) => JSON.stringify(event)).join("\n")
    );
    await writeTextFile(path.join(root, "metadata.json"), JSON.stringify(input.metadata, null, 2));
    await writeTextFile(path.join(root, "decision-log.md"), input.decisionLog ?? "");
  }

  async prepareAttachments(
    sessionId: string,
    runId: string,
    attachments: MessageAttachmentInput[]
  ): Promise<PreparedAttachment[]> {
    const prepared: PreparedAttachment[] = [];

    for (const attachment of attachments) {
      const response = await fetch(attachment.url);
      if (!response.ok) {
        throw new Error(`Failed to download attachment ${attachment.name}: ${response.status} ${response.statusText}`);
      }

      const filePath = path.join(this.attachmentRoot(sessionId, runId), `${attachment.id}-${sanitizeFileName(attachment.name)}`);
      await writeBinaryFile(filePath, await response.arrayBuffer());
      prepared.push({
        ...attachment,
        localPath: filePath
      });
    }

    return prepared;
  }

  async writeUsageRollup(rollup: UsageRollup): Promise<void> {
    const filePath = path.resolve(this.chatopsRoot, "usage", `${rollup.date}-${rollup.repoSlug}.json`);
    await writeTextFile(filePath, JSON.stringify(rollup, null, 2));
  }
}
