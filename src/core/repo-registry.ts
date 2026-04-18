import type { RepoDefinition } from "../types/domain.js";
import type { DatabaseClient } from "../persistence/db.js";

export class RepoRegistry {
  constructor(
    private readonly db: DatabaseClient,
    private readonly genericRepo: RepoDefinition | null = null
  ) {}

  sync(
    repos: RepoDefinition[],
    globals: {
      chatChannelId?: string;
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
    if (this.genericRepo?.slug === repoId) {
      return this.genericRepo;
    }
    return this.db.getRepoById(repoId);
  }

  resolveBinding(channelId: string) {
    return this.db.getChannelBinding(channelId);
  }

  listRepos(): RepoDefinition[] {
    return this.db.listRepos();
  }

  getGenericRepo(): RepoDefinition | null {
    return this.genericRepo;
  }

  isAuthorized(
    repo: RepoDefinition,
    userId: string,
    roleIds: string[]
  ): boolean {
    const userAllowed =
      repo.allowedUsers.length === 0 || repo.allowedUsers.includes(userId);
    const roleAllowed =
      repo.allowedRoles.length === 0 ||
      roleIds.some((roleId) => repo.allowedRoles.includes(roleId));
    return userAllowed && roleAllowed;
  }
}
