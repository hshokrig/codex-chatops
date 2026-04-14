export function payloadText(payload: unknown): string {
  if (typeof payload === "string") {
    return payload;
  }

  if (!payload || typeof payload !== "object") {
    return String(payload);
  }

  const message = payload as {
    content?: unknown;
    embeds?: unknown[];
  };
  const parts: string[] = [];

  if (typeof message.content === "string" && message.content.trim()) {
    parts.push(message.content);
  }

  if (Array.isArray(message.embeds)) {
    for (const embed of message.embeds) {
      const data =
        embed &&
        typeof embed === "object" &&
        "toJSON" in embed &&
        typeof (embed as { toJSON?: unknown }).toJSON === "function"
          ? (embed as { toJSON: () => Record<string, unknown> }).toJSON()
          : (embed as Record<string, unknown>);

      if (typeof data.title === "string" && data.title.trim()) {
        parts.push(data.title);
      }
      if (typeof data.description === "string" && data.description.trim()) {
        parts.push(data.description);
      }
      if (Array.isArray(data.fields)) {
        for (const field of data.fields) {
          if (!field || typeof field !== "object") {
            continue;
          }
          const typedField = field as { name?: unknown; value?: unknown };
          if (typeof typedField.name === "string" && typedField.name.trim()) {
            parts.push(typedField.name);
          }
          if (typeof typedField.value === "string" && typedField.value.trim()) {
            parts.push(typedField.value);
          }
        }
      }
      if (
        data.footer &&
        typeof data.footer === "object" &&
        typeof (data.footer as { text?: unknown }).text === "string"
      ) {
        parts.push((data.footer as { text: string }).text);
      }
    }
  }

  return parts.join("\n");
}
