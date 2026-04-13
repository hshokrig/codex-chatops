import type { RepoDefinition, SessionRecord } from "../types/domain.js";
import type { RepoRegistry } from "./repo-registry.js";
import type { SessionManager } from "./session-manager.js";

export interface RouteInput {
  channelId: string;
  threadId?: string;
}

export interface RouteResult {
  kind: "new-session" | "existing-session" | "ignored";
  repo?: RepoDefinition;
  session?: SessionRecord;
}

export class SessionRouter {
  constructor(
    private readonly repoRegistry: RepoRegistry,
    private readonly sessionManager: SessionManager
  ) {}

  route(input: RouteInput): RouteResult {
    if (input.threadId) {
      const session = this.sessionManager.getByThreadId(input.threadId);
      if (session) {
        const repo = this.repoRegistry.resolveRepoById(session.repoId);
        if (repo) {
          return { kind: "existing-session", session, repo };
        }
      }
    }

    const binding = this.repoRegistry.resolveBinding(input.channelId);
    if (!binding || binding.purpose !== "session-intake") {
      return { kind: "ignored" };
    }

    const repo = this.repoRegistry.resolveSessionRepo(input.channelId);
    if (!repo) {
      return { kind: "ignored" };
    }

    return { kind: "new-session", repo };
  }
}
