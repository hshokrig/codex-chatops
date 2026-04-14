import { describe, expect, it } from "vitest";

import { DiscordBootstrapService } from "../../src/core/bootstrap/discord-bootstrap.js";
import { createTestRepo } from "../helpers/test-db.js";

function createBootstrapClient() {
  const created: string[] = [];
  const categories = new Map<
    string,
    {
      id: string;
      name: string;
      type: number;
      edit?: (input: { name: string; parent?: string }) => Promise<void>;
    }
  >();
  const channels = new Map<
    string,
    {
      id: string;
      name: string;
      type: number;
      parentId?: string;
      edit: (input: { name: string; parent?: string }) => Promise<void>;
    }
  >();

  const guild = {
    channels: {
      async fetch() {
        return new Map<string, { id: string; name: string; type: number }>([
          ...categories.entries(),
          ...channels.entries()
        ]);
      },
      async create(input: { name: string; type: number; parent?: string }) {
        const record = {
          id: `${input.name}-id`,
          name: input.name,
          type: input.type,
          parentId: input.parent,
          async edit(update: { name: string; parent?: string }) {
            record.name = update.name;
            record.parentId = update.parent;
          }
        };
        if (input.type === 4) {
          categories.set(record.id, record);
        } else {
          channels.set(record.id, record);
        }
        created.push(input.name);
        return record;
      }
    }
  };

  const client = {
    guilds: {
      async fetch() {
        return guild;
      }
    }
  };

  return { client, created };
}

describe("DiscordBootstrapService", () => {
  it("creates missing categories and channels in create-missing mode", async () => {
    const { client, created } = createBootstrapClient();
    const service = new DiscordBootstrapService(client as never);

    const report = await service.ensureStructure({
      guildId: "guild-1",
      repos: [createTestRepo()],
      mode: "create-missing",
      globalChannels: {}
    });

    expect(created).toContain("00-control");
    expect(created).toContain("10-mint");
    expect(created).toContain("codex-sessions");
    expect(report.created.length).toBeGreaterThan(0);
  });

  it("reports missing structures in validate mode", async () => {
    const { client } = createBootstrapClient();
    const service = new DiscordBootstrapService(client as never);
    const report = await service.ensureStructure({
      guildId: "guild-1",
      repos: [createTestRepo()],
      mode: "validate",
      globalChannels: {}
    });

    expect(report.created).toHaveLength(0);
    expect(report.missing).toContain("category:00-control");
  });
});
