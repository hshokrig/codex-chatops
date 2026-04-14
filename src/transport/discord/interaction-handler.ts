import { randomUUID } from "node:crypto";

import {
  ChannelType,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type Interaction,
  type MessageCreateOptions,
  type ModalSubmitInteraction
} from "discord.js";

import {
  PASSWORD_FIELD_ID,
  buildApprovalRow,
  buildPasswordModal,
  buildProdConfirmationRow,
  parseAuthorizationComponentId,
  parseComponentId,
  parsePasswordModalId,
  passwordModalId,
  safeInteractionReply
} from "./components.js";
import type { DiscordEventHandler } from "./event-handler.js";
import { buildCardMessage, buildCardReply } from "./message-cards.js";
import type { RunAuthorizationService } from "./run-authorization.js";
import type { ApprovalService } from "../../core/approvals.js";
import type { DeployRunner } from "../../core/deploy-runner.js";
import type { GitRunner } from "../../core/git-runner.js";
import type { PullRequestRunner } from "../../core/pr-runner.js";
import type { RepoRegistry } from "../../core/repo-registry.js";
import type { SessionManager } from "../../core/session-manager.js";
import type { SummaryRenderer } from "../../core/summary-renderer.js";
import type { DatabaseClient } from "../../persistence/db.js";
import { logger } from "../../lib/logger.js";
import type {
  EnvironmentConfig,
  RepoDefinition,
  SessionRecord
} from "../../types/domain.js";

type SendableChannel = {
  send: (payload: string | MessageCreateOptions) => Promise<unknown>;
};
type RepoInteraction =
  | ButtonInteraction
  | ChatInputCommandInteraction
  | ModalSubmitInteraction;

function isSendableChannel(channel: unknown): channel is SendableChannel {
  return (
    Boolean(channel) &&
    typeof (channel as { send?: unknown }).send === "function"
  );
}

function extractRoleIds(member: unknown): string[] {
  if (!member || typeof member !== "object") {
    return [];
  }

  const roles = (member as { roles?: unknown }).roles;
  if (Array.isArray(roles)) {
    return roles.map(String);
  }

  if (roles && typeof roles === "object" && "cache" in roles) {
    const cache = (roles as { cache?: Map<string, unknown> }).cache;
    if (cache instanceof Map) {
      return [...cache.keys()];
    }
  }

  return [];
}

function unauthorizedCommandMessage(): string {
  return "You are not authorized to run this command.";
}

async function fetchTextChannel(client: Client, channelId?: string | null) {
  if (!channelId) {
    return null;
  }
  return client.channels.fetch(channelId);
}

export interface InteractionHandlerDependencies {
  client: Client;
  env: EnvironmentConfig;
  db: DatabaseClient;
  repoRegistry: RepoRegistry;
  sessionManager: SessionManager;
  approvals: ApprovalService;
  gitRunner: GitRunner;
  prRunner: PullRequestRunner;
  deployRunner: DeployRunner;
  summaryRenderer: SummaryRenderer;
  activeRuns: Map<string, AbortController>;
  eventHandler: DiscordEventHandler;
  runAuthorization: RunAuthorizationService;
}

export const slashCommands = [
  {
    name: "codex-status",
    description: "Show status for the current session thread"
  },
  {
    name: "codex-reset",
    description: "Reset the current session"
  },
  {
    name: "codex-new",
    description: "Show how to start a new session"
  }
];

export class DiscordInteractionHandler {
  constructor(private readonly deps: InteractionHandlerDependencies) {}

  register(): void {
    this.deps.client.on("interactionCreate", async (interaction) => {
      await this.handleInteraction(interaction);
    });
  }

  async handleInteraction(interaction: Interaction): Promise<void> {
    if (interaction.isButton()) {
      await this.handleButton(interaction);
      return;
    }

    if (interaction.isModalSubmit()) {
      await this.handleModalSubmit(interaction);
      return;
    }

    if (interaction.isChatInputCommand()) {
      await this.handleSlashCommand(interaction);
    }
  }

  private async handleSlashCommand(
    interaction: ChatInputCommandInteraction
  ): Promise<void> {
    const session = this.deps.sessionManager.getByThreadId(
      interaction.channelId
    );
    if (!session) {
      await interaction.reply({
        content: "This command only works inside a session thread.",
        ephemeral: true
      });
      return;
    }

    const repo = this.deps.repoRegistry.resolveRepoById(session.repoId);
    if (!repo) {
      await interaction.reply({
        content: "Repo mapping not found for this session.",
        ephemeral: true
      });
      return;
    }

    if (!this.isRepoAuthorized(repo, interaction)) {
      await interaction.reply({
        content: unauthorizedCommandMessage(),
        ephemeral: true
      });
      return;
    }

    switch (interaction.commandName) {
      case "codex-status": {
        const latestRun = this.deps.db.getLatestRunForSession(session.id);
        const changedFiles = await this.deps.gitRunner.listChangedFiles(
          session.worktreePath
        );
        const dirty = await this.deps.gitRunner.hasUncommittedChanges(
          session.worktreePath
        );
        const pending = this.deps.db.listPendingApprovals(session.id);
        await interaction.reply({
          ...buildCardReply(
            this.deps.summaryRenderer.renderStatus(
              repo,
              session,
              latestRun,
              changedFiles,
              dirty,
              pending
            ),
            {
              tone: latestRun?.status === "failed" ? "danger" : "info",
              footer: repo.slug,
              ephemeral: true
            }
          )
        });
        break;
      }
      case "codex-reset":
        this.deps.sessionManager.resetSession(session.id);
        this.deps.db.insertEvent({
          id: randomUUID(),
          sessionId: session.id,
          ts: new Date().toISOString(),
          kind: "session.reset",
          payloadJson: JSON.stringify({ by: interaction.user.id })
        });
        await interaction.reply({
          content:
            "Session reset. The next prompt will start a fresh Codex thread.",
          ephemeral: true
        });
        break;
      case "codex-new":
        await interaction.reply({
          content: `Post a new top-level mention in <#${session.channelId}> to start another session.`,
          ephemeral: true
        });
        break;
      default:
        await interaction.reply({
          content: "Unknown command.",
          ephemeral: true
        });
    }
  }

  private async handleButton(interaction: ButtonInteraction): Promise<void> {
    const authorization = parseAuthorizationComponentId(interaction.customId);
    if (authorization) {
      await this.handlePromptAuthorizationButton(
        interaction,
        authorization.authorizationId
      );
      return;
    }

    const parsed = parseComponentId(interaction.customId);
    if (!parsed) {
      return;
    }

    const session = this.deps.sessionManager.getById(parsed.sessionId);
    if (!session) {
      await safeInteractionReply(interaction, {
        content: "Session not found.",
        ephemeral: true
      });
      return;
    }

    const repo = this.deps.repoRegistry.resolveRepoById(session.repoId);
    if (!repo) {
      await safeInteractionReply(interaction, {
        content: "Repo mapping missing for this session.",
        ephemeral: true
      });
      return;
    }

    if (!this.isRepoAuthorized(repo, interaction)) {
      await safeInteractionReply(interaction, {
        content: unauthorizedCommandMessage(),
        ephemeral: true
      });
      return;
    }

    try {
      switch (parsed.action) {
        case "status":
          await this.handleStatus(interaction, repo, session);
          break;
        case "diff":
          await this.handleDiff(interaction, session);
          break;
        case "commit":
          await this.handleApprovalRequest(interaction, session, "commit", {
            prompt: "Commit current worktree changes"
          });
          break;
        case "pr":
          await this.handleApprovalRequest(interaction, session, "open-pr", {
            prompt: "Open pull request from current session branch"
          });
          break;
        case "deploy-staging":
          await this.handleApprovalRequest(
            interaction,
            session,
            "deploy-staging",
            {
              environment: "staging"
            }
          );
          break;
        case "deploy-prod":
          if (repo.requireProdConfirmation) {
            await safeInteractionReply(interaction, {
              content:
                "Production deploy needs a second confirmation before approval is requested.",
              ephemeral: true,
              components: [buildProdConfirmationRow(session.id)]
            });
          } else {
            await this.handleApprovalRequest(
              interaction,
              session,
              "deploy-production",
              {
                environment: "production"
              }
            );
          }
          break;
        case "confirm-prod":
          await this.handleApprovalRequest(
            interaction,
            session,
            "deploy-production",
            {
              environment: "production",
              confirmedBy: interaction.user.id
            }
          );
          break;
        case "approve":
          await this.handleApprove(interaction, repo, session, parsed.extra);
          break;
        case "reject":
          await this.handleReject(interaction, parsed.extra);
          break;
        case "cancel":
          await this.handleCancel(interaction, session);
          break;
        case "reset":
          this.deps.sessionManager.resetSession(session.id);
          await safeInteractionReply(interaction, {
            content:
              "Session reset. The next prompt will start a fresh Codex thread.",
            ephemeral: true
          });
          break;
        case "archive":
          this.deps.sessionManager.archiveSession(session.id);
          if (interaction.channel?.type === ChannelType.PublicThread) {
            await interaction.channel.setArchived(true, "Session archived");
          }
          await safeInteractionReply(interaction, {
            content: "Session archived.",
            ephemeral: true
          });
          break;
        case "new":
          await safeInteractionReply(interaction, {
            content: `Start a new top-level mention in <#${session.channelId}>.`,
            ephemeral: true
          });
          break;
        default:
          await safeInteractionReply(interaction, {
            content: "Unsupported action.",
            ephemeral: true
          });
      }
    } catch (error) {
      logger.error(
        { err: error, customId: interaction.customId },
        "Interaction failed"
      );
      await safeInteractionReply(interaction, {
        content: `Action failed: ${error instanceof Error ? error.message : String(error)}`,
        ephemeral: true
      });
    }
  }

  private async handleModalSubmit(
    interaction: ModalSubmitInteraction
  ): Promise<void> {
    const parsed = parsePasswordModalId(interaction.customId);
    if (!parsed) {
      return;
    }

    const password = interaction.fields.getTextInputValue(PASSWORD_FIELD_ID);
    if (!this.deps.runAuthorization.verifyPassword(password)) {
      await interaction.reply({
        content: unauthorizedCommandMessage(),
        ephemeral: true
      });
      return;
    }

    try {
      switch (parsed.action) {
        case "prompt":
          await this.handlePromptPasswordModal(interaction, parsed.primaryId);
          break;
        case "approve":
          await this.handleApprovePasswordModal(
            interaction,
            parsed.primaryId,
            parsed.secondaryId
          );
          break;
      }
    } catch (error) {
      logger.error(
        { err: error, customId: interaction.customId },
        "Modal interaction failed"
      );
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({
          content: `Action failed: ${error instanceof Error ? error.message : String(error)}`,
          ephemeral: true
        });
      } else {
        await interaction.reply({
          content: `Action failed: ${error instanceof Error ? error.message : String(error)}`,
          ephemeral: true
        });
      }
    }
  }

  private async handlePromptAuthorizationButton(
    interaction: ButtonInteraction,
    authorizationId: string
  ): Promise<void> {
    const pending =
      this.deps.runAuthorization.getPromptAuthorization(authorizationId);
    if (!pending) {
      await safeInteractionReply(interaction, {
        content:
          "This run authorization has expired. Resend the prompt to try again.",
        ephemeral: true
      });
      return;
    }

    if (pending.requestedBy !== interaction.user.id) {
      await safeInteractionReply(interaction, {
        content: unauthorizedCommandMessage(),
        ephemeral: true
      });
      return;
    }

    await interaction.showModal(
      buildPasswordModal(
        passwordModalId("prompt", authorizationId),
        "Authorize Run"
      )
    );
  }

  private async handlePromptPasswordModal(
    interaction: ModalSubmitInteraction,
    authorizationId: string
  ): Promise<void> {
    const pending =
      this.deps.runAuthorization.consumePromptAuthorization(authorizationId);
    if (!pending) {
      await interaction.reply({
        content:
          "This run authorization has expired. Resend the prompt to try again.",
        ephemeral: true
      });
      return;
    }

    if (pending.requestedBy !== interaction.user.id) {
      await interaction.reply({
        content: unauthorizedCommandMessage(),
        ephemeral: true
      });
      return;
    }

    await interaction.reply({
      content: "Authorization accepted. Starting the run.",
      ephemeral: true
    });
    await this.deps.eventHandler.executeAuthorizedPrompt(pending);
  }

  private async handleApprovePasswordModal(
    interaction: ModalSubmitInteraction,
    sessionId: string,
    approvalId?: string
  ): Promise<void> {
    if (!approvalId) {
      await interaction.reply({
        content: "Approval id missing.",
        ephemeral: true
      });
      return;
    }

    const session = this.deps.sessionManager.getById(sessionId);
    if (!session) {
      await interaction.reply({
        content: "Session not found.",
        ephemeral: true
      });
      return;
    }

    const repo = this.deps.repoRegistry.resolveRepoById(session.repoId);
    if (!repo) {
      await interaction.reply({
        content: "Repo mapping missing for this session.",
        ephemeral: true
      });
      return;
    }

    if (!this.isRepoAuthorized(repo, interaction)) {
      await interaction.reply({
        content: unauthorizedCommandMessage(),
        ephemeral: true
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const resultMessage = await this.executeApproval(
      repo,
      session,
      approvalId,
      interaction.user.id
    );
    await interaction.editReply(resultMessage);
  }

  private async handleStatus(
    interaction: ButtonInteraction,
    repo: RepoDefinition,
    session: SessionRecord
  ): Promise<void> {
    const latestRun = this.deps.db.getLatestRunForSession(session.id);
    const changedFiles = await this.deps.gitRunner.listChangedFiles(
      session.worktreePath
    );
    const dirty = await this.deps.gitRunner.hasUncommittedChanges(
      session.worktreePath
    );
    const pending = this.deps.db.listPendingApprovals(session.id);
    await safeInteractionReply(interaction, {
      ...buildCardReply(
        this.deps.summaryRenderer.renderStatus(
          repo,
          session,
          latestRun,
          changedFiles,
          dirty,
          pending
        ),
        {
          tone: latestRun?.status === "failed" ? "danger" : "info",
          footer: repo.slug,
          ephemeral: true
        }
      ),
      ephemeral: true
    });
  }

  private async handleDiff(
    interaction: ButtonInteraction,
    session: SessionRecord
  ): Promise<void> {
    const diff = await this.deps.gitRunner.captureDiff(session.worktreePath);
    const payload = diff.trim()
      ? `\`\`\`diff\n${diff.slice(0, 3500)}\n\`\`\``
      : "No diff available.";
    await safeInteractionReply(interaction, {
      content: payload,
      ephemeral: true
    });
  }

  private async handleApprovalRequest(
    interaction: ButtonInteraction,
    session: SessionRecord,
    type: "commit" | "open-pr" | "deploy-staging" | "deploy-production",
    payload: Record<string, unknown>
  ): Promise<void> {
    const existing = this.deps.db.getPendingApprovalByType(session.id, type);
    if (existing) {
      await safeInteractionReply(interaction, {
        content: `A pending ${type} approval already exists.`,
        ephemeral: true
      });
      return;
    }

    const latestRun = this.deps.db.getLatestRunForSession(session.id);
    const approval = this.deps.approvals.requestApproval({
      sessionId: session.id,
      runId: latestRun?.id,
      type,
      requestedBy: interaction.user.id,
      payload
    });

    const threadChannel = await fetchTextChannel(
      this.deps.client,
      session.threadId
    );
    if (threadChannel && isSendableChannel(threadChannel)) {
      await threadChannel.send({
        content: `Approval requested: ${approval.type}`,
        components: [buildApprovalRow(session.id, approval.id)]
      });
    }

    const approvalsChannel = await fetchTextChannel(
      this.deps.client,
      this.deps.env.approvalsChannelId
    );
    if (isSendableChannel(approvalsChannel)) {
      await approvalsChannel.send(
        buildCardMessage(
          `Pending approval ${approval.type}\nTitle: ${session.title}\nThread: <#${session.threadId}>`,
          {
            tone: "warning",
            footer: "codex-approvals"
          }
        )
      );
    }

    await safeInteractionReply(interaction, {
      content: `Requested approval for ${type}.`,
      ephemeral: true
    });
  }

  private async handleApprove(
    interaction: ButtonInteraction,
    repo: RepoDefinition,
    session: SessionRecord,
    approvalId?: string
  ): Promise<void> {
    if (!approvalId) {
      throw new Error("Approval id missing");
    }

    if (this.deps.runAuthorization.isEnabled()) {
      await interaction.showModal(
        buildPasswordModal(
          passwordModalId("approve", session.id, approvalId),
          "Authorize Approval"
        )
      );
      return;
    }

    const resultMessage = await this.executeApproval(
      repo,
      session,
      approvalId,
      interaction.user.id
    );
    await safeInteractionReply(interaction, {
      content: resultMessage,
      ephemeral: true
    });
  }

  private async executeApproval(
    repo: RepoDefinition,
    session: SessionRecord,
    approvalId: string,
    decidedBy: string
  ): Promise<string> {
    const approval = this.deps.approvals.approve(approvalId, decidedBy);
    let resultMessage = `${approval.type} approved.`;

    switch (approval.type) {
      case "commit": {
        const hasChanges = await this.deps.gitRunner.hasUncommittedChanges(
          session.worktreePath
        );
        if (!hasChanges) {
          throw new Error("No changes to commit");
        }
        const sha = await this.deps.gitRunner.commitChanges(
          session.worktreePath,
          `chatops(${repo.slug}): ${session.title}`
        );
        resultMessage = `Commit created: ${sha}`;
        break;
      }
      case "open-pr": {
        const latestRun = this.deps.db.getLatestRunForSession(session.id);
        const summary = latestRun?.resultSummary ?? "ChatOps session update";
        await this.deps.gitRunner.pushBranch(
          session.worktreePath,
          session.branchName
        );
        const pr = await this.deps.prRunner.openPullRequest({
          repo,
          branchName: session.branchName,
          title: `${repo.slug}: ${session.title}`,
          body: summary
        });
        resultMessage = `Pull request opened: ${pr.url}`;
        break;
      }
      case "deploy-staging": {
        const deployment = await this.deps.deployRunner.trigger({
          repo,
          environment: "staging",
          branchName: session.branchName
        });
        resultMessage = deployment.runUrl
          ? `${deployment.message}\n${deployment.runUrl}`
          : deployment.message;
        break;
      }
      case "deploy-production": {
        const deployment = await this.deps.deployRunner.trigger({
          repo,
          environment: "production",
          branchName: session.branchName
        });
        resultMessage = deployment.runUrl
          ? `${deployment.message}\n${deployment.runUrl}`
          : deployment.message;
        break;
      }
    }

    const eventsChannel = await fetchTextChannel(
      this.deps.client,
      repo.eventsChannelId
    );
    if (isSendableChannel(eventsChannel)) {
      await eventsChannel.send(
        buildCardMessage(
          `${approval.type} approved for ${repo.slug}\n${resultMessage}`,
          {
            tone: "success",
            footer: "Approval execution"
          }
        )
      );
    }

    const deploymentsChannel =
      approval.type === "deploy-staging" ||
      approval.type === "deploy-production"
        ? await fetchTextChannel(this.deps.client, repo.deploymentsChannelId)
        : null;
    if (deploymentsChannel && isSendableChannel(deploymentsChannel)) {
      await deploymentsChannel.send(
        buildCardMessage(resultMessage, {
          tone: "info",
          footer: repo.slug
        })
      );
    }

    return resultMessage;
  }

  private async handleReject(
    interaction: ButtonInteraction,
    approvalId?: string
  ): Promise<void> {
    if (!approvalId) {
      throw new Error("Approval id missing");
    }
    const approval = this.deps.approvals.reject(
      approvalId,
      interaction.user.id
    );
    await safeInteractionReply(interaction, {
      content: `${approval.type} rejected.`,
      ephemeral: true
    });
  }

  private async handleCancel(
    interaction: ButtonInteraction,
    session: SessionRecord
  ): Promise<void> {
    const controller = this.deps.activeRuns.get(session.id);
    if (!controller) {
      await safeInteractionReply(interaction, {
        content: "No active run to cancel.",
        ephemeral: true
      });
      return;
    }

    controller.abort();
    this.deps.activeRuns.delete(session.id);
    await safeInteractionReply(interaction, {
      content: "Cancellation requested for the active run.",
      ephemeral: true
    });
  }

  private isRepoAuthorized(
    repo: RepoDefinition,
    interaction: RepoInteraction
  ): boolean {
    return this.deps.repoRegistry.isAuthorized(
      repo,
      interaction.user.id,
      extractRoleIds(interaction.member)
    );
  }
}
