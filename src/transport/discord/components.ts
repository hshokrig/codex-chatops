import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type MessageCreateOptions
} from "discord.js";

export type PrimaryAction =
  | "status"
  | "diff"
  | "commit"
  | "pr"
  | "deploy-staging"
  | "deploy-prod"
  | "cancel"
  | "reset"
  | "archive"
  | "new"
  | "approve"
  | "reject"
  | "confirm-prod";

export const PASSWORD_FIELD_ID = "operator-password";

export function componentId(
  action: PrimaryAction,
  sessionId: string,
  extra?: string
): string {
  return ["codex", action, sessionId, extra].filter(Boolean).join(":");
}

export function parseComponentId(customId: string): {
  namespace: string;
  action: PrimaryAction;
  sessionId: string;
  extra?: string;
} | null {
  const [namespace, action, sessionId, extra] = customId.split(":");
  if (namespace !== "codex" || !action || !sessionId) {
    return null;
  }
  return {
    namespace,
    action: action as PrimaryAction,
    sessionId,
    extra
  };
}

export function buildSessionActionRows(
  sessionId: string
): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(componentId("status", sessionId))
        .setLabel("Status")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(componentId("diff", sessionId))
        .setLabel("Diff")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(componentId("commit", sessionId))
        .setLabel("Commit")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(componentId("pr", sessionId))
        .setLabel("Open PR")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(componentId("deploy-staging", sessionId))
        .setLabel("Deploy Staging")
        .setStyle(ButtonStyle.Success)
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(componentId("deploy-prod", sessionId))
        .setLabel("Deploy Prod")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(componentId("cancel", sessionId))
        .setLabel("Cancel Run")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(componentId("reset", sessionId))
        .setLabel("Reset Session")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(componentId("archive", sessionId))
        .setLabel("Archive Session")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(componentId("new", sessionId))
        .setLabel("New Session")
        .setStyle(ButtonStyle.Secondary)
    )
  ];
}

export function buildApprovalRow(
  sessionId: string,
  approvalId: string
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(componentId("approve", sessionId, approvalId))
      .setLabel("Approve")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(componentId("reject", sessionId, approvalId))
      .setLabel("Reject")
      .setStyle(ButtonStyle.Danger)
  );
}

export function buildProdConfirmationRow(
  sessionId: string
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(componentId("confirm-prod", sessionId))
      .setLabel("Confirm Prod Deploy")
      .setStyle(ButtonStyle.Danger)
  );
}

export function buildRunAuthorizationRow(
  authorizationId: string
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(["codex-auth", "authorize-run", authorizationId].join(":"))
      .setLabel("Authorize Run")
      .setStyle(ButtonStyle.Primary)
  );
}

export function parseAuthorizationComponentId(customId: string): {
  namespace: string;
  action: "authorize-run";
  authorizationId: string;
} | null {
  const [namespace, action, authorizationId] = customId.split(":");
  if (
    namespace !== "codex-auth" ||
    action !== "authorize-run" ||
    !authorizationId
  ) {
    return null;
  }
  return {
    namespace,
    action,
    authorizationId
  };
}

export function buildPasswordModal(
  customId: string,
  title = "Authorize Command"
): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(title)
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(PASSWORD_FIELD_ID)
          .setLabel("Password")
          .setRequired(true)
          .setStyle(TextInputStyle.Short)
      )
    );
}

export function passwordModalId(
  action: "prompt" | "approve",
  primaryId: string,
  secondaryId?: string
): string {
  return ["codex-modal", action, primaryId, secondaryId]
    .filter(Boolean)
    .join(":");
}

export function parsePasswordModalId(customId: string): {
  namespace: string;
  action: "prompt" | "approve";
  primaryId: string;
  secondaryId?: string;
} | null {
  const [namespace, action, primaryId, secondaryId] = customId.split(":");
  if (
    namespace !== "codex-modal" ||
    !primaryId ||
    (action !== "prompt" && action !== "approve")
  ) {
    return null;
  }
  return {
    namespace,
    action,
    primaryId,
    secondaryId
  };
}

export function followupMessage(
  content: string,
  sessionId: string
): MessageCreateOptions {
  return {
    content,
    components: buildSessionActionRows(sessionId)
  };
}

export async function safeInteractionReply(
  interaction: ButtonInteraction,
  options: Parameters<ButtonInteraction["reply"]>[0]
): Promise<void> {
  if (interaction.deferred || interaction.replied) {
    await interaction.followUp(options);
    return;
  }
  await interaction.reply(options);
}
