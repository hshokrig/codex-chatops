import { randomUUID } from "node:crypto";

import type { ArtifactWriter } from "./artifact-writer.js";
import type { GitRunner } from "./git-runner.js";
import type { DatabaseClient } from "../persistence/db.js";
import type { RepoDefinition, SessionRecord } from "../types/domain.js";

function nowIso(): string {
  return new Date().toISOString();
}

export class SessionManager {
  constructor(
    private readonly db: DatabaseClient,
    private readonly gitRunner: GitRunner,
    private readonly artifactWriter: ArtifactWriter,
    private readonly chatopsRoot: string
  ) {}

  async createSession(input: {
    guildId: string;
    channelId: string;
    threadId: string;
    repo: RepoDefinition;
    requestedBy: string;
    title: string;
    codexThreadId?: string;
  }): Promise<SessionRecord> {
    const sessionId = randomUUID();
    const workspace = await this.gitRunner.prepareSessionWorkspace(
      input.repo,
      sessionId,
      this.chatopsRoot
    );
    const session: SessionRecord = {
      id: sessionId,
      platform: "discord",
      guildId: input.guildId,
      channelId: input.channelId,
      threadId: input.threadId,
      repoId: input.repo.slug,
      codexThreadId: input.codexThreadId ?? "",
      worktreePath: workspace.worktreePath,
      branchName: workspace.branchName,
      requestedBy: input.requestedBy,
      title: input.title,
      status: "open",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      archivedAt: null
    };
    this.db.createSession(session);
    await this.artifactWriter.writeSessionArtifacts(session);
    return session;
  }

  getByThreadId(threadId: string): SessionRecord | null {
    return this.db.getSessionByThreadId(threadId);
  }

  getById(sessionId: string): SessionRecord | null {
    return this.db.getSessionById(sessionId);
  }

  setStatus(sessionId: string, status: SessionRecord["status"]): void {
    this.db.updateSessionStatus(sessionId, status);
  }

  updateCodexThread(sessionId: string, codexThreadId: string): void {
    this.db.updateSessionCodexThread(sessionId, codexThreadId);
  }

  resetSession(sessionId: string): string {
    this.db.updateSessionCodexThread(sessionId, "");
    return "";
  }

  archiveSession(sessionId: string): void {
    this.db.archiveSession(sessionId);
  }
}
