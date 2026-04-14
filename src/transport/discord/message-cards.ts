import {
  EmbedBuilder,
  type InteractionReplyOptions,
  type MessageCreateOptions
} from "discord.js";

export type CardTone = "info" | "success" | "warning" | "danger" | "neutral";

const CARD_COLORS: Record<CardTone, number> = {
  info: 0x3b82f6,
  success: 0x22c55e,
  warning: 0xf59e0b,
  danger: 0xef4444,
  neutral: 0x64748b
};

function clamp(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, Math.max(limit - 3, 0)).trimEnd()}...`;
}

function inferTone(content: string): CardTone {
  if (
    /FAILED|rejected|not authorized|degraded|unavailable|Action failed/i.test(
      content
    )
  ) {
    return "danger";
  }
  if (
    /approval requested|Pending approval|still working|awaiting/i.test(content)
  ) {
    return "warning";
  }
  if (/SUCCEEDED|READY|approved|created|completed|started/i.test(content)) {
    return "success";
  }
  if (/usage metrics/i.test(content)) {
    return "neutral";
  }
  return "info";
}

function parseCardContent(content: string): {
  title: string;
  description?: string;
  fields: Array<{ name: string; value: string }>;
} {
  const lines = content
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line, index, all) => !(index === all.length - 1 && line === ""));

  const title = clamp(lines.shift()?.trim() || "Codex ChatOps", 256);
  const fields: Array<{ name: string; value: string }> = [];
  const descriptionLines: string[] = [];
  let currentField:
    | {
        name: string;
        valueLines: string[];
      }
    | undefined;
  let freeformMode = false;

  const flushField = (): void => {
    if (!currentField) {
      return;
    }
    fields.push({
      name: clamp(currentField.name, 256),
      value: clamp(currentField.valueLines.join("\n").trim() || "\u200b", 1024)
    });
    currentField = undefined;
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      flushField();
      if (descriptionLines.length > 0) {
        descriptionLines.push("");
      }
      freeformMode = true;
      continue;
    }

    if (!freeformMode) {
      const fieldMatch = /^([^:]{1,80}):\s*(.*)$/.exec(trimmed);
      if (fieldMatch) {
        const fieldName = fieldMatch[1] ?? "Details";
        flushField();
        currentField = {
          name: fieldName,
          valueLines: fieldMatch[2] ? [fieldMatch[2]] : []
        };
        continue;
      }

      if (currentField) {
        currentField.valueLines.push(trimmed);
        continue;
      }
    }

    descriptionLines.push(trimmed);
  }

  flushField();

  const description = descriptionLines.join("\n").trim();
  return {
    title,
    ...(description ? { description: clamp(description, 4096) } : {}),
    fields: fields.slice(0, 25)
  };
}

export function buildCardMessage(
  content: string,
  options: {
    tone?: CardTone;
    footer?: string;
    components?: MessageCreateOptions["components"];
  } = {}
): MessageCreateOptions {
  const parsed = parseCardContent(content);
  const embed = new EmbedBuilder()
    .setColor(CARD_COLORS[options.tone ?? inferTone(content)])
    .setTitle(parsed.title);

  if (parsed.description) {
    embed.setDescription(parsed.description);
  }

  if (parsed.fields.length > 0) {
    embed.addFields(parsed.fields);
  }

  if (options.footer?.trim()) {
    embed.setFooter({ text: clamp(options.footer.trim(), 2048) });
  }

  return {
    embeds: [embed],
    ...(options.components ? { components: options.components } : {})
  };
}

export function buildCardReply(
  content: string,
  options: {
    tone?: CardTone;
    footer?: string;
    components?: InteractionReplyOptions["components"];
    ephemeral?: boolean;
  } = {}
): InteractionReplyOptions {
  const message = buildCardMessage(content, options);
  return {
    embeds: message.embeds,
    ...(message.components ? { components: message.components } : {}),
    ...(options.ephemeral !== undefined ? { ephemeral: options.ephemeral } : {})
  };
}
