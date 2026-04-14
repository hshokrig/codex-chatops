import { spawn } from "node:child_process";

import {
  Codex,
  type ThreadEvent,
  type ThreadItem,
  type ThreadOptions
} from "@openai/codex-sdk";

import type { EnvironmentConfig } from "../types/domain.js";

export interface CodexRunRequest {
  prompt: string;
  worktreePath: string;
  threadId?: string;
  profile?: string;
  onEvent?: (event: ThreadEvent) => Promise<void> | void;
  signal?: AbortSignal;
}

export interface CodexRunResult {
  threadId: string;
  summary: string;
  events: ThreadEvent[];
  items: ThreadItem[];
}

function eventToMessage(item: ThreadItem): string | null {
  if (
    item.type === "agent_message" ||
    item.type === "reasoning" ||
    item.type === "error"
  ) {
    return "text" in item ? item.text : "message" in item ? item.message : null;
  }
  return null;
}

export class CodexRunner {
  constructor(private readonly env: EnvironmentConfig) {}

  async run(request: CodexRunRequest): Promise<CodexRunResult> {
    if (this.env.codexMode === "exec") {
      return this.runWithExec(request);
    }
    return this.runWithSdk(request);
  }

  private async runWithSdk(request: CodexRunRequest): Promise<CodexRunResult> {
    const threadOptions: ThreadOptions = {
      workingDirectory: request.worktreePath,
      sandboxMode: "danger-full-access",
      approvalPolicy: "never",
      skipGitRepoCheck: false,
      webSearchEnabled: false
    };

    const codex = new Codex({
      codexPathOverride: this.env.codexBin
    });
    const thread = request.threadId
      ? codex.resumeThread(request.threadId, threadOptions)
      : codex.startThread(threadOptions);
    const streamed = request.signal
      ? await thread.runStreamed(request.prompt, { signal: request.signal })
      : await thread.runStreamed(request.prompt);

    const events: ThreadEvent[] = [];
    const items = new Map<string, ThreadItem>();
    let threadId = request.threadId ?? thread.id ?? "";
    let summary = "";

    for await (const event of streamed.events) {
      events.push(event);
      if (event.type === "thread.started") {
        threadId = event.thread_id;
      }
      if (
        event.type === "item.started" ||
        event.type === "item.updated" ||
        event.type === "item.completed"
      ) {
        items.set(event.item.id, event.item);
        const maybeMessage = eventToMessage(event.item);
        if (maybeMessage) {
          summary = maybeMessage;
        }
      }
      await request.onEvent?.(event);
    }

    if (!threadId) {
      throw new Error("Codex thread id was not produced by the SDK stream");
    }

    return {
      threadId,
      summary: summary.trim(),
      events,
      items: [...items.values()]
    };
  }

  private async runWithExec(request: CodexRunRequest): Promise<CodexRunResult> {
    const args = request.threadId
      ? ["exec", "resume", request.threadId, request.prompt, "--json"]
      : ["exec", request.prompt, "--json"];

    args.push("-C", request.worktreePath);
    if (request.profile ?? this.env.codexProfile) {
      args.push("-p", request.profile ?? this.env.codexProfile ?? "default");
    }

    const child = spawn(this.env.codexBin, args, {
      cwd: request.worktreePath,
      env: process.env
    });

    if (request.signal) {
      request.signal.addEventListener("abort", () => {
        child.kill("SIGTERM");
      });
    }

    const events: ThreadEvent[] = [];
    let stdoutBuffer = "";
    let stderrBuffer = "";
    let threadId = request.threadId ?? "";
    let summary = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBuffer += chunk.toString("utf8");
    });

    await new Promise<void>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code) => {
        if (code !== 0) {
          reject(
            new Error(`codex exec failed with code ${code}: ${stderrBuffer}`)
          );
          return;
        }
        resolve();
      });
    });

    for (const line of stdoutBuffer
      .split("\n")
      .map((entry) => entry.trim())
      .filter(Boolean)) {
      const event = JSON.parse(line) as ThreadEvent;
      events.push(event);
      if (event.type === "thread.started") {
        threadId = event.thread_id;
      }
      if (
        event.type === "item.started" ||
        event.type === "item.updated" ||
        event.type === "item.completed"
      ) {
        const maybeMessage = eventToMessage(event.item);
        if (maybeMessage) {
          summary = maybeMessage;
        }
      }
      await request.onEvent?.(event);
    }

    if (!threadId) {
      throw new Error("codex exec did not return a thread id");
    }

    return {
      threadId,
      summary: summary.trim(),
      events,
      items: events
        .filter(
          (
            event
          ): event is Extract<
            ThreadEvent,
            { type: "item.started" | "item.updated" | "item.completed" }
          > =>
            event.type === "item.started" ||
            event.type === "item.updated" ||
            event.type === "item.completed"
        )
        .map((event) => event.item)
    };
  }
}
