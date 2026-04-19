import { randomUUID } from "node:crypto";

import {
  type Client,
  type GuildMember,
  type Message,
  type MessageCreateOptions,
  type Snowflake
} from "discord.js";

import {
  buildRunAuthorizationRow,
  buildSessionActionRows
} from "./components.js";
import { buildCardMessage } from "./message-cards.js";
import type {
  PendingPromptAuthorization,
  RunAuthorizationService
} from "./run-authorization.js";
import type { ThreadManager } from "./thread-manager.js";
import type { RepoRegistry } from "../../core/repo-registry.js";
import type { RunOrchestrator } from "../../core/run-orchestrator.js";
import type { SessionManager } from "../../core/session-manager.js";
import type { DatabaseClient } from "../../persistence/db.js";
import type { SummaryRenderer } from "../../core/summary-renderer.js";
import { logger } from "../../lib/logger.js";
import type {
  EnvironmentConfig,
  MessageAttachmentInput,
  RepoDefinition,
  SessionRecord
} from "../../types/domain.js";

function stripBotMention(content: string, botId: string): string {
  return content
    .replaceAll(`<@${botId}>`, "")
    .replaceAll(`<@!${botId}>`, "")
    .trim();
}

type SendableChannel = {
  send: (options: string | MessageCreateOptions) => Promise<unknown>;
};

function isSendableChannel(channel: unknown): channel is SendableChannel {
  return (
    Boolean(channel) &&
    typeof (channel as { send?: unknown }).send === "function"
  );
}

async function sendText(
  channel: unknown,
  content: string | MessageCreateOptions
): Promise<void> {
  if (!isSendableChannel(channel)) {
    return;
  }
  await channel.send(content);
}

function normalizePrompt(
  prompt: string,
  attachments: MessageAttachmentInput[]
): string {
  if (prompt.trim()) {
    return prompt.trim();
  }
  if (attachments.length > 0) {
    return "Review the attached files and summarize anything relevant.";
  }
  return "";
}

function formatAuthorName(message: {
  author?: {
    globalName?: string | null;
    username?: string | null;
    tag?: string | null;
    id?: string;
  };
}): string {
  return (
    message.author?.globalName ??
    message.author?.username ??
    message.author?.tag ??
    message.author?.id ??
    "unknown"
  );
}

function formatConversationMessage(
  message: {
    author?: {
      bot?: boolean | null;
      globalName?: string | null;
      username?: string | null;
      tag?: string | null;
      id?: string;
    };
    content?: string;
    createdAt?: Date;
    createdTimestamp?: number;
  },
  fallback = "No text content."
): string {
  const createdAt = message.createdAt
    ? message.createdAt.toISOString()
    : typeof message.createdTimestamp === "number"
      ? new Date(message.createdTimestamp).toISOString()
      : "unknown time";
  const content = message.content?.trim() || fallback;
  return `[${createdAt}] ${formatAuthorName(message)}: ${content}`;
}

function isHumanConversationMessage(message: {
  author?: {
    bot?: boolean | null;
    system?: boolean | null;
  };
}): boolean {
  return !message.author?.bot && !message.author?.system;
}

export interface EventHandlerDependencies {
  client: Client;
  env: EnvironmentConfig;
  db: DatabaseClient;
  repoRegistry: RepoRegistry;
  sessionManager: SessionManager;
  runOrchestrator: RunOrchestrator;
  threadManager: ThreadManager;
  summaryRenderer: SummaryRenderer;
  activeRuns: Map<string, AbortController>;
  runAuthorization: RunAuthorizationService;
}

export class DiscordEventHandler {
  constructor(private readonly deps: EventHandlerDependencies) {}

  register(): void {
    this.deps.client.on("messageCreate", async (message) => {
      await this.handleMessage(message);
    });
  }

  async handleMessage(message: Message): Promise<void> {
    if (message.author.bot || !message.inGuild()) {
      return;
    }

    const botId = this.deps.client.user?.id;
    if (!botId) {
      return;
    }

    const isThread = message.channel.isThread();
    const rootChannelId = isThread
      ? message.channel.parentId
      : message.channelId;
    if (!rootChannelId) {
      return;
    }
    const mentioned = message.mentions.users.has(botId);

    const route = isThread
      ? this.deps.sessionManager.getByThreadId(message.channelId)
      : null;
    const conversationContext = await this.captureConversationContext(message);

    if (isThread && route) {
      const prompt = mentioned
        ? stripBotMention(message.content, botId)
        : message.content.trim();
      const attachments = this.extractAttachments(message);
      const normalizedPrompt = normalizePrompt(prompt, attachments);
      if (!normalizedPrompt && attachments.length === 0) {
        await message.reply(
          "Send a message in this thread or attach a file to continue the session."
        );
        return;
      }
      if (this.deps.runAuthorization.isEnabled()) {
        await this.requestPromptAuthorization({
          mode: "continue",
          message,
          repo: this.mustResolveRepo(route),
          session: route,
          prompt: normalizedPrompt,
          conversationContext,
          attachments,
          requestedBy: message.author.id
        });
        return;
      }
      await this.continueSession(
        message,
        route,
        normalizedPrompt,
        attachments,
        conversationContext
      );
      return;
    }

    const binding = this.deps.repoRegistry.resolveBinding(rootChannelId);
    if (isThread) {
      return;
    }

    const repo = this.resolveStartRepo(
      rootChannelId,
      binding?.purpose,
      mentioned
    );
    if (!repo) {
      if (mentioned) {
        await message.reply(
          "Generic chat is not configured. Set `GENERIC_WORKSPACE_PATH` to allow bot mentions outside repo intake channels."
        );
      }
      return;
    }

    if (
      !mentioned &&
      binding &&
      binding.purpose !== "session-intake" &&
      binding.purpose !== "global-chat"
    ) {
      return;
    }

    if (mentioned && !binding && repo.workspaceMode !== "direct") {
      await message.reply("This channel is not bound to a managed repository.");
      return;
    }

    if (!this.isAuthorized(repo, message.member)) {
      await message.reply("You are not authorized to operate this repository.");
      return;
    }

    const prompt = mentioned
      ? stripBotMention(message.content, botId)
      : message.content.trim();
    const attachments = this.extractAttachments(message);
    const normalizedPrompt = normalizePrompt(prompt, attachments);
    if (!normalizedPrompt && attachments.length === 0) {
      await message.reply(
        "Send a task description or attach a file to start a session."
      );
      return;
    }

    const existingSession = this.deps.sessionManager.getLatestActiveByChannel(
      message.channelId,
      message.author.id
    );

    if (this.deps.runAuthorization.isEnabled()) {
      await this.requestPromptAuthorization({
        mode: existingSession ? "continue" : "start",
        message,
        repo: existingSession ? this.mustResolveRepo(existingSession) : repo,
        session: existingSession ?? undefined,
        prompt: normalizedPrompt,
        conversationContext,
        attachments,
        requestedBy: message.author.id
      });
      return;
    }

    if (existingSession) {
      await this.continueSessionFromParentChannel(
        message,
        existingSession,
        normalizedPrompt,
        attachments,
        conversationContext
      );
      return;
    }

    await this.startSession(
      message,
      repo,
      normalizedPrompt,
      attachments,
      conversationContext
    );
  }

  async executeAuthorizedPrompt(
    request: PendingPromptAuthorization
  ): Promise<void> {
    if (request.mode === "start") {
      await this.startSession(
        request.message,
        request.repo,
        request.prompt,
        request.attachments,
        request.conversationContext
      );
      return;
    }

    const session = request.session
      ? (this.deps.sessionManager.getById(request.session.id) ??
        request.session)
      : null;

    if (!session) {
      await request.message.reply("This session no longer exists.");
      return;
    }

    await this.continueSession(
      request.message,
      session,
      request.prompt,
      request.attachments,
      request.conversationContext
    );
  }

  private async continueSession(
    message: Message,
    session: SessionRecord,
    prompt: string,
    attachments: MessageAttachmentInput[],
    conversationContext?: string
  ): Promise<void> {
    const repo = this.deps.repoRegistry.resolveRepoById(session.repoId);
    if (!repo) {
      await message.reply(
        "The repo mapping for this session no longer exists."
      );
      return;
    }
    if (session.status === "archived") {
      await message.reply(
        "This session has been archived and will not accept new runs."
      );
      return;
    }
    if (!this.isAuthorized(repo, message.member)) {
      await message.reply(
        "You are not authorized to continue this repository session."
      );
      return;
    }
    const normalizedPrompt = normalizePrompt(prompt, attachments);
    if (!normalizedPrompt && attachments.length === 0) {
      await message.reply(
        "Send a message in this thread or attach a file to continue the session."
      );
      return;
    }
    await this.runInThread(
      message.channel,
      repo,
      session,
      normalizedPrompt,
      message.author.id,
      attachments,
      conversationContext
    );
  }

  private async startSession(
    message: Message,
    repo: RepoDefinition,
    normalizedPrompt: string,
    attachments: MessageAttachmentInput[],
    conversationContext?: string
  ): Promise<void> {
    if (!message.guildId) {
      throw new Error("Guild id missing for Discord session start");
    }
    const thread = await this.deps.threadManager.createSessionThread(
      message,
      repo,
      normalizedPrompt
    );
    const session = await this.deps.sessionManager.createSession({
      guildId: message.guildId,
      channelId: message.channelId,
      threadId: thread.id,
      repo,
      requestedBy: message.author.id,
      title: normalizedPrompt
    });
    const eventsChannel = repo.eventsChannelId
      ? await this.deps.client.channels.fetch(repo.eventsChannelId)
      : null;
    await sendText(
      eventsChannel,
      buildCardMessage(
        this.deps.summaryRenderer.renderSessionStarted(repo, session),
        {
          tone: "info",
          footer: "Session created"
        }
      )
    );
    await this.runInThread(
      thread,
      repo,
      session,
      normalizedPrompt,
      message.author.id,
      attachments,
      conversationContext
    );
  }

  private async continueSessionFromParentChannel(
    message: Message,
    session: SessionRecord,
    prompt: string,
    attachments: MessageAttachmentInput[],
    conversationContext?: string
  ): Promise<void> {
    const repo = this.mustResolveRepo(session);
    if (session.status === "archived") {
      await sendText(
        message.channel,
        buildCardMessage("The latest session in this channel is archived.", {
          tone: "warning",
          footer: repo.slug
        })
      );
      return;
    }

    const thread = await this.deps.client.channels.fetch(session.threadId);
    if (!thread) {
      await message.reply(
        "The latest session thread for this channel was not found."
      );
      return;
    }

    await sendText(
      message.channel,
      buildCardMessage(
        `Continuing the latest session in <#${session.threadId}>.`,
        {
          tone: "info",
          footer: repo.slug
        }
      )
    );
    await this.runInThread(
      thread,
      repo,
      session,
      prompt,
      message.author.id,
      attachments,
      conversationContext
    );
  }

  private async runInThread(
    thread: unknown,
    repo: RepoDefinition,
    session: SessionRecord,
    prompt: string,
    requestedBy: Snowflake,
    attachments: MessageAttachmentInput[],
    conversationContext?: string
  ): Promise<void> {
    if (this.deps.activeRuns.has(session.id)) {
      await sendText(thread, "A run is already active in this session.");
      return;
    }

    const controller = new AbortController();
    this.deps.activeRuns.set(session.id, controller);
    let progressTimer: ReturnType<typeof setTimeout> | undefined;

    try {
      const attachmentSummary =
        attachments.length === 0
          ? ""
          : ` with ${attachments.length} attachment${attachments.length === 1 ? "" : "s"}`;
      await sendText(
        thread,
        buildCardMessage(
          `Starting Codex run for \`${repo.slug}\` in this session${attachmentSummary}.`,
          {
            tone: "info",
            footer: session.title
          }
        )
      );
      progressTimer = setTimeout(() => {
        void sendText(
          thread,
          buildCardMessage(
            `Codex is still working on \`${repo.slug}\`.\nYou can keep this thread open and wait for the final summary.`,
            {
              tone: "warning",
              footer: session.title
            }
          )
        );
      }, 15000);
      const result = await this.deps.runOrchestrator.execute({
        session,
        repo,
        prompt,
        conversationContext,
        requestedBy,
        attachments,
        signal: controller.signal
      });

      if (isSendableChannel(thread)) {
        await thread.send({
          ...buildCardMessage(result.summary, {
            tone: result.run.status === "failed" ? "danger" : "success",
            footer: repo.slug
          }),
          components: buildSessionActionRows(session.id)
        });
      }

      const runCount = Math.max(
        this.deps.db.listRunsForSession(session.id).length,
        1
      );
      const eventsChannel = repo.eventsChannelId
        ? await this.deps.client.channels.fetch(repo.eventsChannelId)
        : null;
      await sendText(
        eventsChannel,
        buildCardMessage(
          this.deps.summaryRenderer.renderRepoEvent({
            repo,
            session,
            run: result.run,
            runCount,
            changedFiles: result.changedFiles,
            hasUncommittedChanges: result.hasUncommittedChanges
          }),
          {
            tone: "info",
            footer: "Repo activity"
          }
        )
      );

      const auditChannelId = this.deps.env.auditChannelId;
      if (auditChannelId) {
        const auditChannel =
          await this.deps.client.channels.fetch(auditChannelId);
        await sendText(
          auditChannel,
          buildCardMessage(
            `Run completed for \`${repo.slug}\`\nTitle: ${session.title}\nThread: <#${session.threadId}>`,
            {
              tone: "neutral",
              footer: "codex-audit"
            }
          )
        );
      }

      this.deps.db.insertEvent({
        id: randomUUID(),
        sessionId: session.id,
        runId: result.run.id,
        ts: new Date().toISOString(),
        kind: "run.completed",
        payloadJson: JSON.stringify({
          repoSlug: repo.slug,
          changedFiles: result.changedFiles,
          hasUncommittedChanges: result.hasUncommittedChanges
        })
      });
    } catch (error) {
      logger.error({ err: error, sessionId: session.id }, "Run failed");
      await sendText(
        thread,
        buildCardMessage(
          `Run failed: ${error instanceof Error ? error.message : String(error)}`,
          {
            tone: "danger",
            footer: repo.slug
          }
        )
      );
    } finally {
      if (progressTimer) {
        clearTimeout(progressTimer);
      }
      this.deps.activeRuns.delete(session.id);
    }
  }

  private isAuthorized(
    repo: RepoDefinition,
    member: GuildMember | null
  ): boolean {
    if (!member) {
      return false;
    }
    return this.deps.repoRegistry.isAuthorized(repo, member.id, [
      ...member.roles.cache.keys()
    ]);
  }

  private async requestPromptAuthorization(input: {
    mode: "start" | "continue";
    message: Message;
    repo: RepoDefinition;
    session?: SessionRecord;
    prompt: string;
    conversationContext?: string;
    attachments: MessageAttachmentInput[];
    requestedBy: string;
  }): Promise<void> {
    const authorization =
      this.deps.runAuthorization.createPromptAuthorization(input);
    await input.message.reply({
      content:
        "Run authorization required. Click `Authorize Run` and enter your password to continue. If this is not you, no command will run.",
      components: [buildRunAuthorizationRow(authorization.id)]
    });
  }

  private mustResolveRepo(session: SessionRecord): RepoDefinition {
    const repo = this.deps.repoRegistry.resolveRepoById(session.repoId);
    if (!repo) {
      throw new Error(`Repo mapping missing for session ${session.id}`);
    }
    return repo;
  }

  private extractAttachments(message: Message): MessageAttachmentInput[] {
    return [...message.attachments.values()].map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      url: attachment.url,
      contentType: attachment.contentType ?? undefined,
      size: attachment.size ?? undefined
    }));
  }

  private resolveStartRepo(
    channelId: string,
    purpose: string | undefined,
    mentioned: boolean
  ): RepoDefinition | null {
    if (purpose === "session-intake") {
      return this.deps.repoRegistry.resolveSessionRepo(channelId);
    }

    if (purpose === "global-chat") {
      return this.deps.repoRegistry.getGenericRepo();
    }

    if (mentioned) {
      return this.deps.repoRegistry.getGenericRepo();
    }

    return null;
  }

  private async captureConversationContext(message: Message): Promise<string> {
    const sections: string[] = [];

    if (typeof message.fetchReference === "function") {
      try {
        const referenced = await message.fetchReference();
        if (isHumanConversationMessage(referenced)) {
          sections.push(
            "Referenced message:\n" + formatConversationMessage(referenced)
          );
        }
      } catch {
        // Ignore missing or inaccessible references.
      }
    }

    const channel = message.channel as {
      messages?: {
        fetch?: (input?: {
          limit?: number;
          before?: string;
        }) => Promise<unknown>;
      };
    };

    if (channel.messages?.fetch) {
      try {
        const fetched = await channel.messages.fetch({
          limit: 10,
          before: message.id
        });
        const recentMessages =
          fetched && typeof fetched === "object" && "values" in fetched
            ? [...(fetched as { values: () => Iterable<Message> }).values()]
            : [];
        const humanMessages = recentMessages.filter((entry) =>
          isHumanConversationMessage(entry)
        );
        if (humanMessages.length > 0) {
          sections.push(
            [
              "Recent channel messages:",
              ...humanMessages
                .reverse()
                .map((entry) => formatConversationMessage(entry))
            ].join("\n")
          );
        }
      } catch {
        // Ignore fetch failures and continue without channel history.
      }
    }

    return sections.join("\n\n");
  }
}
