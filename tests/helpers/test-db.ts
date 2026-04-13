import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { DatabaseClient } from "../../src/persistence/db.js";
import type { RepoDefinition } from "../../src/types/domain.js";

export function createTestRepo(overrides: Partial<RepoDefinition> = {}): RepoDefinition {
  return {
    slug: "mint",
    categoryName: "10-mint",
    sessionChannelId: "channel-session",
    eventsChannelId: "channel-events",
    deploymentsChannelId: "channel-deployments",
    localPath: "/tmp/mint",
    defaultBranch: "main",
    codexProfile: "default",
    allowedUsers: [],
    allowedRoles: [],
    checks: [],
    deployWorkflows: {},
    requirePrApproval: true,
    requireProdConfirmation: true,
    ...overrides
  };
}

export function createTestDb(repos: RepoDefinition[] = [createTestRepo()]) {
  const root = mkdtempSync(path.join(tmpdir(), "codex-chatops-test-"));
  const db = new DatabaseClient(path.join(root, "chatops.sqlite"));
  db.syncRepoConfig(repos, {});

  return {
    root,
    db,
    cleanup() {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  };
}
