import {
  ChannelType,
  type CategoryChannel,
  type Client,
  type GuildBasedChannel
} from "discord.js";

import type { RepoDefinition } from "../../types/domain.js";

export interface BootstrapReport {
  created: string[];
  validated: string[];
  missing: string[];
}

export class DiscordBootstrapService {
  constructor(private readonly client: Client) {}

  async ensureStructure(input: {
    guildId: string;
    repos: RepoDefinition[];
    mode: "validate" | "create-missing";
    globalChannels: {
      chatChannelId?: string;
      statusChannelId?: string;
      usageChannelId?: string;
      auditChannelId?: string;
      approvalsChannelId?: string;
    };
  }): Promise<BootstrapReport> {
    const guild = await this.client.guilds.fetch(input.guildId);
    const existingChannels = await guild.channels.fetch();
    const existingValues = [...existingChannels.values()];
    const report: BootstrapReport = { created: [], validated: [], missing: [] };

    const ensureCategory = async (
      name: string
    ): Promise<CategoryChannel | null> => {
      const match = existingValues.find(
        (channel): channel is CategoryChannel =>
          channel !== null &&
          channel.type === ChannelType.GuildCategory &&
          channel.name === name
      );
      if (match) {
        report.validated.push(`category:${name}`);
        return match;
      }
      if (input.mode === "create-missing") {
        const created = await guild.channels.create({
          name,
          type: ChannelType.GuildCategory
        });
        existingValues.push(created);
        report.created.push(`category:${name}`);
        return created;
      }
      report.missing.push(`category:${name}`);
      return null;
    };

    const ensureTextChannel = async (
      id: string | undefined,
      name: string,
      parent: CategoryChannel | null
    ): Promise<GuildBasedChannel | null> => {
      if (id) {
        const existing = existingChannels.get(id);
        if (existing) {
          if (
            input.mode === "create-missing" &&
            existing.type === ChannelType.GuildText &&
            (existing.name !== name || existing.parentId !== parent?.id)
          ) {
            await existing.edit({
              name,
              parent: parent?.id
            });
          }
          report.validated.push(`channel:${name}`);
          return existing;
        }
      }
      const byName = existingValues.find(
        (channel) =>
          channel !== null &&
          channel.type === ChannelType.GuildText &&
          channel.name === name &&
          channel.parentId === parent?.id
      );
      if (byName) {
        report.validated.push(`channel:${name}`);
        return byName;
      }
      if (input.mode === "create-missing" && parent) {
        const created = await guild.channels.create({
          name,
          type: ChannelType.GuildText,
          parent: parent.id
        });
        existingValues.push(created);
        report.created.push(`channel:${name}`);
        return created;
      }
      report.missing.push(`channel:${name}`);
      return null;
    };

    const controlCategory = await ensureCategory("00-control");
    await ensureTextChannel(
      input.globalChannels.chatChannelId,
      "codex-chat",
      controlCategory
    );
    await ensureTextChannel(
      input.globalChannels.statusChannelId,
      "codex-status",
      controlCategory
    );
    await ensureTextChannel(
      input.globalChannels.approvalsChannelId,
      "codex-approvals",
      controlCategory
    );
    await ensureTextChannel(
      input.globalChannels.usageChannelId,
      "codex-usage",
      controlCategory
    );
    await ensureTextChannel(
      input.globalChannels.auditChannelId,
      "codex-audit",
      controlCategory
    );

    for (const repo of input.repos) {
      const category = await ensureCategory(repo.categoryName);
      await ensureTextChannel(
        repo.sessionChannelId,
        "codex-sessions",
        category
      );
      await ensureTextChannel(repo.eventsChannelId, "codex-events", category);
      await ensureTextChannel(
        repo.deploymentsChannelId,
        "codex-deployments",
        category
      );
    }

    return report;
  }
}
