# Codex ChatOps

Discord-first private ChatOps bridge for Codex running on a trusted local machine. Discord is the operator interface, Codex is the execution engine, and each Discord session thread maps to one persistent Codex thread, one worktree, and one branch.

## Architecture

- `transport/discord`: message intake, thread creation, buttons, slash commands
- `core`: session routing, worktree management, Codex execution, approvals, PRs, deploys, summaries, usage metrics
- `persistence`: SQLite bootstrap and event/session storage
- `api`: health, ready, and admin endpoints
- `.chatops/`: artifacts, worktrees, and usage snapshots

## Discord Server Layout

- `00-control`
  - `#codex-status`
  - `#codex-approvals`
  - `#codex-usage`
  - `#codex-audit`
- `10-mint`
  - `#codex-sessions`
  - `#codex-events`
  - `#codex-deployments`
- `11-n2cis`
  - `#codex-sessions`
  - `#codex-events`
  - `#codex-deployments`
- `12-tandvy`
  - `#codex-sessions`
  - `#codex-events`
  - `#codex-deployments`

Use each repo category's `#codex-sessions` channel for top-level prompts. Each session becomes a Discord thread inside that channel. The paired `#codex-events` channel is a lightweight activity feed for managed Discord sessions and mapped local VS Code Codex sessions. It does not mirror full thread content.

## Setup

1. Create a Discord application and bot in the Discord Developer Portal.
2. Invite the bot to your private guild with permissions for:
   - viewing channels
   - sending messages
   - creating/managing threads
   - using slash commands
   - creating channels only if you want bootstrap mode to create missing structure
3. Copy `.env.example` to `.secrets/.env.local` and fill in the real values.
4. Copy `repo-map.example.yaml` to `.secrets/repo-map.yaml` and set the real repo/channel/workflow mappings.
5. Sign in to Codex locally with ChatGPT:
   - `codex login`
   - or `codex login --device-auth`
6. Install dependencies and initialize the DB:
   - `pnpm install`
   - `pnpm db:migrate`
7. Bootstrap Discord structure:
   - `pnpm bootstrap:discord`
8. Start the service:
   - `pnpm dev`
   - or `pnpm start` after `pnpm build`

## Auth

- Supported operational mode: Codex local authenticated with ChatGPT sign-in.
- Do not store a Discord user email/password in this repo.
- Do not copy `~/.codex/auth.json` into `.secrets/`, the repo, or `.chatops/`.
- The service also reads lightweight metadata from `~/.codex/state_5.sqlite`, `~/.codex/logs_2.sqlite`, and `~/.codex/session_index.jsonl` to publish privacy-safe VS Code session activity for mapped repos.
- `allowed_users` in `.secrets/repo-map.yaml` remains the Discord account allowlist for each repo.
- If `DISCORD_OPERATOR_PASSWORD` is set, prompt-triggered runs and approval execution require a password modal before they execute.
- Discord bots cannot inspect phone IMEI or device identifiers; this project can bind to Discord user identity, not to a specific handset.
- GitHub API access is optional but required for PR/deploy actions unless `gh` CLI mode is used.

## Operator Workflow

1. Send a task message in a repo category's `#codex-sessions` channel.
2. The bot opens a thread, creates a session, and runs Codex in a repo-specific worktree.
3. Send normal messages inside the same thread to continue the same Codex thread and branch.
4. Use buttons or slash commands for:
   - status
   - diff
   - commit
   - PR
   - deploy staging
   - deploy prod
   - cancel
   - reset
   - archive

## Commands

- `pnpm dev`: run the service in watch mode
- `pnpm build`: compile TypeScript
- `pnpm test`: run unit and integration tests
- `pnpm smoke:local`: verify env, repo map, DB, and Codex auth
- `pnpm bootstrap:discord`: validate or create the Discord structure and register commands

## Health and Admin

- `GET /healthz`
- `GET /readyz`
- `GET /admin/sessions/:id`
- `POST /admin/bootstrap-discord`
- `POST /admin/usage-rollups`

## Files and Artifacts

- `.chatops/sessions/<session-id>/session.json`
- `.chatops/sessions/<session-id>/session.md`
- `.chatops/sessions/<session-id>/runs/<run-id>/request.md`
- `.chatops/sessions/<session-id>/runs/<run-id>/summary.md`
- `.chatops/sessions/<session-id>/runs/<run-id>/checks.md`
- `.chatops/sessions/<session-id>/runs/<run-id>/patch.diff`
- `.chatops/sessions/<session-id>/runs/<run-id>/events.jsonl`
- `.chatops/usage/*.json`

## Deployment Setup

- Configure allowlisted workflows in `.secrets/repo-map.yaml`.
- Staging deploys require explicit approval.
- Production deploys require second confirmation plus approval.
- Example workflow files are in [docs/examples/deploy-staging.yml](docs/examples/deploy-staging.yml) and [docs/examples/deploy-production.yml](docs/examples/deploy-production.yml).

## Troubleshooting

- `pnpm smoke:local` fails on Codex auth:
  - run `codex login status`
  - re-auth with `codex login`
- Discord bootstrap cannot create channels:
  - add channel management permission temporarily
  - rerun `pnpm bootstrap:discord`
- PR/deploy actions fail:
  - verify `GITHUB_TOKEN` or `gh` CLI auth
  - verify `github_owner`, `github_repo`, and workflow IDs in the repo map
- Native dependency issues:
  - run `pnpm approve-builds --all`
  - run `pnpm rebuild better-sqlite3 esbuild`

## Additional Docs

- [Operator Runbook](docs/operator-runbook.md)
- [Sample Transcripts](docs/sample-transcripts.md)
