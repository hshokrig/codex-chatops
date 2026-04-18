# Architecture

## Purpose

Codex ChatOps bridges Discord and local Codex execution.
Each operator request becomes a managed session with:
- one Discord thread
- one Codex thread
- one local workspace
- one tracked session record in SQLite

## Major Components

- `src/transport/discord`
  Discord client setup, message intake, thread creation, buttons, and interaction handling.
- `src/core`
  Session management, prompt construction, Codex execution, Git operations, approvals, deploy orchestration, summaries, and usage metrics.
- `src/persistence`
  SQLite schema, config sync, sessions, runs, approvals, and event storage.
- `src/api`
  Health and admin endpoints.
- `.chatops/`
  Session artifacts, prepared attachments, run summaries, checks, and diffs.

## Runtime Flow

### Repo-bound flow

1. A user posts in a repo's `#codex-sessions` channel.
2. The bot resolves the mapped repo from `repo-map.yaml`.
3. A Discord thread is created for the session.
4. A session workspace is prepared:
   - `git-worktree` mode for managed repos
   - `direct` mode for the generic workspace
5. The prompt is expanded with:
   - the current request
   - recent Discord channel history
   - reply target context
   - attachment metadata and local paths
   - prior run summaries
   - required checks
6. Codex runs in the prepared workspace.
7. Checks and artifacts are written.
8. A summary is posted back to Discord and recorded in SQLite.

### Generic chat flow

1. A user posts in `#codex-chat`, or mentions the bot in another non-thread channel.
2. The bot uses the configured `GENERIC_WORKSPACE_PATH`.
3. The operator can specify which repo or path to inspect in the prompt.

## Session Behavior

- Starting a new request opens a thread.
- Follow-ups can be sent either:
  - inside the session thread
  - as a new top-level message in the same channel
- A top-level follow-up reuses the latest active session for that channel and user.

## Data Model

Main persisted objects:
- `repos`
- `channel_bindings`
- `sessions`
- `runs`
- `approvals`
- `events`
- `usage_rollups`

## Security Boundaries

- Discord is the operator UI, not the trust boundary.
- The trusted boundary is the machine running Codex plus the repo allowlist.
- The service is intentionally designed for private or tightly controlled guilds.
- The system should not be exposed as arbitrary public command execution.

## Optional VS Code Session Bridge

The VS Code bridge reads local Codex metadata from:
- `~/.codex/state_5.sqlite`
- `~/.codex/logs_2.sqlite`
- `~/.codex/session_index.jsonl`

If those files are missing, the bridge disables itself.
This feature is optional and does not block core Discord ChatOps behavior.
