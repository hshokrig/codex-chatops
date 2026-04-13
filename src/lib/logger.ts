import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: [
      "discordBotToken",
      "githubToken",
      "payload.token",
      "headers.authorization"
    ],
    remove: true
  }
});
