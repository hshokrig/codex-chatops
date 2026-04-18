# Operator Runbook

## Daily Start

1. Confirm Codex auth is healthy with `codex login status`.
2. Confirm the service is healthy:
   - `curl http://127.0.0.1:3000/healthz`
   - `curl http://127.0.0.1:3000/readyz`
3. Check `#codex-status`, `#codex-audit`, and `#codex-usage`.
4. Use each repo category's `#codex-events` for lightweight session activity:
   - Discord-managed session thread links
   - privacy-safe VS Code Codex activity for mapped repos

## Starting a Session

1. Go to the repo category's `#codex-sessions`.
2. Send a normal-language task message.
3. If operator password is enabled, click `Authorize Run` and complete the password modal before Codex starts.
4. Continue either:
   - inside the created thread
   - with a new top-level message in the same channel
5. Use `#codex-chat` for generic path-based or cross-repo work.

## Approvals

- Commit, PR, staging deploy, and prod deploy are all explicit approval flows.
- Production deploy uses a second confirmation step before approval.
- Use the session thread buttons as the source of truth. `#codex-approvals` is only a mirrored feed.

## Reset and Archive

- `Reset Session` clears the Codex thread binding and keeps the worktree/branch.
- `Archive Session` locks out further runs in that thread and archives the thread in Discord.

## Recovery

- Service restart:
  - `systemctl --user restart codex-chatops.service`
- Force usage rollup:
  - `curl -X POST http://127.0.0.1:3000/admin/usage-rollups`
- Re-bootstrap Discord structure:
  - `pnpm bootstrap:discord`

## Safety Rules

- Never run the bot on a public or untrusted host.
- Never expose arbitrary shell execution to Discord.
- Never copy `~/.codex/auth.json` into repo files or artifacts.
- Never use a normal Discord user account instead of a bot token.
- Treat `GENERIC_WORKSPACE_PATH` as a privileged scope boundary.
