# Usage Guide

## Which Channel To Use

Use a repo's `#codex-sessions` channel when you want work tied to one mapped repo.

Use `#codex-chat` when you want:

- generic Q&A
- path-based inspection
- cross-repo investigation
- a prompt where you will specify which repo or directory to inspect

## Starting Work

### Repo-bound work

1. Open that repo's `#codex-sessions`.
2. Send a plain message such as `fix the failing auth test`.
3. The bot creates a thread and runs Codex.

### Generic work

1. Open `#codex-chat`.
2. Send a prompt such as `inspect /home/me/Projects/social-media-agent and summarize the test setup`.

## Continuing Work

You can continue in two ways:

- post inside the created thread
- post another top-level message in the same channel

Top-level follow-ups reuse your latest active session for that channel.

## Mention Behavior

Mentioning the bot in any non-thread channel starts or continues a generic session if `GENERIC_WORKSPACE_PATH` is configured.

Example:

```text
@CodexVSC inspect /path/to/repo and explain the current failure
```

## Attachments and Context

The bot includes:

- your current message
- the message you replied to, if any
- the last 10 messages in the channel
- attachment metadata and saved local copies

## Laptop Workflow

Typical pattern:

1. Use repo `#codex-sessions` channels for active implementation work.
2. Use `#codex-chat` for planning, debugging, and path-based checks.
3. Jump into the thread when you want focused back-and-forth.
4. Send a new top-level message when you want to continue quickly without hunting for the thread.

## Mobile Workflow

Best pattern:

1. Start from the parent channel.
2. Let the bot create the thread.
3. Use the thread for detail when needed.
4. For quick follow-ups, send a fresh top-level message in the same channel.

This is usually easier than threading every message from mobile.
