import { type Message, ThreadAutoArchiveDuration } from "discord.js";

import type { RepoDefinition } from "../../types/domain.js";

export class ThreadManager {
  async createSessionThread(message: Message, repo: RepoDefinition, prompt: string) {
    const threadName = `${repo.slug}: ${prompt.slice(0, 70)}`.replace(/\s+/g, " ").trim();
    return message.startThread({
      name: threadName || `${repo.slug} session`,
      autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
      reason: `New Codex session for ${repo.slug}`
    });
  }
}
