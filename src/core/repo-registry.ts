import type { RepoDefinition } from "../types/domain.js";
import type { DatabaseClient } from "../persistence/db.js";

export class RepoRegistry {
  constructor(private readonly db: DatabaseClient) {}

  sync(
    repos: RepoDefinition[],
    globals: {
      statusChannelId?: string;
      usageChannelId?: string;
      auditChannelId?: string;
      approvalsChannelId?: string;
    }
  ): void {
    this.db.syncRepoConfig(repos, globals);
  }

  resolveSessionRepo(channelId: string): RepoDefinition | null {
    return this.db.getRepoBySessionChannel(channelId);
  }

  resolveRepoById(repoId: string): RepoDefinition | null {
    return this.db.getRepoById(repoId);
  }

  resolveBinding(channelId: string) {
    return this.db.getChannelBinding(channelId);
  }

  listRepos(): RepoDefinition[] {
    return this.db.listRepos();
  }

  isAuthorized(repo: RepoDefinition, userId: string, roleIds: string[]): boolean {
    const userAllowed = repo.allowedUsers.length === 0 || repo.allowedUsers.includes(userId);
    const roleAllowed =
      repo.allowedRoles.length === 0 || roleIds.some((roleId) => repo.allowedRoles.includes(roleId));
    return userAllowed && roleAllowed;
  }
}
