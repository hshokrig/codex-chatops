import { afterEach, describe, expect, it } from "vitest";

import { RepoRegistry } from "../../src/core/repo-registry.js";
import { createTestDb, createTestRepo } from "../helpers/test-db.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

describe("RepoRegistry", () => {
  it("resolves repos only from session intake channels", () => {
    const fixture = createTestDb([
      createTestRepo({
        slug: "mint",
        sessionChannelId: "mint-sessions",
        eventsChannelId: "mint-events",
        deploymentsChannelId: "mint-deploys"
      })
    ]);
    cleanups.push(fixture.cleanup);

    const registry = new RepoRegistry(fixture.db);

    expect(registry.resolveSessionRepo("mint-sessions")?.slug).toBe("mint");
    expect(registry.resolveSessionRepo("mint-events")).toBeNull();
    expect(registry.resolveBinding("mint-events")?.purpose).toBe("repo-events");
  });

  it("applies user and role allowlists", () => {
    const repo = createTestRepo({
      allowedUsers: ["user-1"],
      allowedRoles: ["role-1"]
    });
    const fixture = createTestDb([repo]);
    cleanups.push(fixture.cleanup);
    const registry = new RepoRegistry(fixture.db);

    expect(registry.isAuthorized(repo, "user-1", ["role-1"])).toBe(true);
    expect(registry.isAuthorized(repo, "user-2", ["role-1"])).toBe(false);
    expect(registry.isAuthorized(repo, "user-1", ["role-2"])).toBe(false);
  });
});
