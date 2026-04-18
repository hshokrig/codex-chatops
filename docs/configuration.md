# Configuration

## Environment File

Copy `.env.example` to `.secrets/.env.local`.

Key variables:

- `DISCORD_BOT_TOKEN`
  Bot token from the Discord Developer Portal.
- `DISCORD_APPLICATION_ID`
  Discord application ID.
- `DISCORD_GUILD_ID`
  Guild where channels and commands are managed.
- `CHATOPS_DB_PATH`
  SQLite database path.
- `CHATOPS_ROOT`
  Root for artifacts and worktrees.
- `CHATOPS_REPO_MAP_PATH`
  Path to the repo map YAML file.
- `CODEX_MODE`
  `sdk` or `exec`.
- `CODEX_BIN`
  Codex executable. `codex` is the safest portable default.
- `CHAT_CHANNEL_ID`
  Optional global `#codex-chat` channel binding.
- `GENERIC_WORKSPACE_PATH`
  Optional direct workspace for generic chat.
- `STATUS_CHANNEL_ID`
- `USAGE_CHANNEL_ID`
- `AUDIT_CHANNEL_ID`
- `APPROVALS_CHANNEL_ID`
  Optional global control channels.
- `GITHUB_TOKEN`
  Needed for GitHub API operations unless `GITHUB_USE_GH_CLI=true`.

## Repo Map

Copy `repo-map.example.yaml` to `.secrets/repo-map.yaml`.

Each repo entry defines:
- `slug`
- `category_name`
- `session_channel_id`
- `events_channel_id`
- `deployments_channel_id`
- `local_path`
- `default_branch`
- `codex_profile`
- `allowed_users`
- `allowed_roles`
- `checks`
- `deploy_workflows`
- `require_pr_approval`
- `require_prod_confirmation`
- `github_owner`
- `github_repo`

## Channel Model

Global control channels:
- `codex-chat`
- `codex-status`
- `codex-approvals`
- `codex-usage`
- `codex-audit`

Per-repo channels:
- `codex-sessions`
- `codex-events`
- `codex-deployments`

## Discord Requirements

Required bot capabilities:
- read messages
- send messages
- create and manage threads
- use slash commands

Required privileged intent for plain non-mention messages:
- Message Content intent

## Systemd Notes

The included systemd units are templates, not universal installers.

Before using them on another machine, verify:
- repo checkout path
- `pnpm` availability
- `codex` availability on `PATH`
- user-level systemd availability

Forks that do not use systemd can ignore those files and run the service directly with `pnpm dev` or `pnpm start`.
