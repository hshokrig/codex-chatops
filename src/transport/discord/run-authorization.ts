import { randomUUID, timingSafeEqual } from "node:crypto";

import type { Message } from "discord.js";

import type {
  MessageAttachmentInput,
  RepoDefinition,
  SessionRecord
} from "../../types/domain.js";

function safeCompare(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export interface PendingPromptAuthorization {
  id: string;
  mode: "start" | "continue";
  message: Message;
  repo: RepoDefinition;
  session?: SessionRecord;
  prompt: string;
  attachments: MessageAttachmentInput[];
  requestedBy: string;
  createdAt: number;
  expiresAt: number;
}

export class RunAuthorizationService {
  private readonly pendingPromptAuthorizations = new Map<
    string,
    PendingPromptAuthorization
  >();

  constructor(
    private readonly operatorPassword?: string,
    private readonly ttlMs = 5 * 60 * 1000
  ) {}

  isEnabled(): boolean {
    return Boolean(this.operatorPassword);
  }

  createPromptAuthorization(input: {
    mode: "start" | "continue";
    message: Message;
    repo: RepoDefinition;
    session?: SessionRecord;
    prompt: string;
    attachments: MessageAttachmentInput[];
    requestedBy: string;
  }): PendingPromptAuthorization {
    const now = Date.now();
    const authorization: PendingPromptAuthorization = {
      id: randomUUID(),
      mode: input.mode,
      message: input.message,
      repo: input.repo,
      session: input.session,
      prompt: input.prompt,
      attachments: input.attachments,
      requestedBy: input.requestedBy,
      createdAt: now,
      expiresAt: now + this.ttlMs
    };
    this.pendingPromptAuthorizations.set(authorization.id, authorization);
    return authorization;
  }

  getPromptAuthorization(id: string): PendingPromptAuthorization | null {
    const authorization = this.pendingPromptAuthorizations.get(id);
    if (!authorization) {
      return null;
    }
    if (authorization.expiresAt < Date.now()) {
      this.pendingPromptAuthorizations.delete(id);
      return null;
    }
    return authorization;
  }

  consumePromptAuthorization(id: string): PendingPromptAuthorization | null {
    const authorization = this.getPromptAuthorization(id);
    if (!authorization) {
      return null;
    }
    this.pendingPromptAuthorizations.delete(id);
    return authorization;
  }

  verifyPassword(candidate: string): boolean {
    if (!this.operatorPassword) {
      return true;
    }
    return safeCompare(candidate.trim(), this.operatorPassword.trim());
  }
}
