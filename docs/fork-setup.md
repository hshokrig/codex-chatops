# Fork Setup

This guide is for someone who wants to fork the repo and run their own Discord bot against their own local Codex setup.

## Who This Is For

Use this project if you want:

- a self-hosted Discord bot
- local execution on your own machine
- your own Codex login
- your own private Discord guild
- your own allowlisted repos

Do not use this as a public multi-tenant bot.

## Prerequisites

- Node.js 20+
- `pnpm`
- `git`
- a local `codex` installation and successful `codex login`
- a Discord application and bot
- a Discord server you control

## 1. Fork and Clone

```bash
git clone <your-fork-url>
cd codex-chatops
pnpm install
```

## 2. Create Discord Bot Credentials

In the Discord Developer Portal:

1. Create a new application.
2. Create a bot user.
3. Enable the Message Content intent.
4. Copy:
   - bot token
   - application ID
   - public key
   - your guild ID

Invite the bot with permissions for:

- viewing channels
- sending messages
- creating and managing threads
- using slash commands

## 3. Create Local Config

Copy the templates:

```bash
cp .env.example .secrets/.env.local
cp repo-map.example.yaml .secrets/repo-map.yaml
```

Fill in `.secrets/.env.local` with your own:

- Discord bot token
- application ID
- guild ID
- optional control-channel IDs
- optional `GENERIC_WORKSPACE_PATH`

## 4. Map Your Repos

Edit `.secrets/repo-map.yaml`.

For each repo, set:

- `slug`
- `category_name`
- `local_path`
- `default_branch`
- `checks`
- `allowed_users`
- optional `github_owner` and `github_repo`

If you do not know your Discord channel IDs yet, you can:

- leave placeholder values initially
- run bootstrap in `create-missing` mode
- then replace the placeholders with the real IDs

## 5. Prepare the Database

```bash
pnpm db:migrate
```

## 6. Bootstrap Discord

```bash
pnpm bootstrap:discord
```

This validates or creates:

- `#codex-chat`
- `#codex-status`
- `#codex-approvals`
- `#codex-usage`
- `#codex-audit`
- per-repo `#codex-sessions`
- per-repo `#codex-events`
- per-repo `#codex-deployments`

## 7. Start the Service

Development mode:

```bash
pnpm dev
```

Production-style local run:

```bash
pnpm build
pnpm start
```

## 8. Verify Health

```bash
pnpm smoke:local
curl http://127.0.0.1:3000/healthz
curl http://127.0.0.1:3000/readyz
```

## 9. First Use

Repo-bound work:

- open a repo `#codex-sessions`
- send a plain message

Generic work:

- open `#codex-chat`
- ask it to inspect a specific path or repo

## Optional Features

### Generic chat workspace

Set `GENERIC_WORKSPACE_PATH` if you want generic path-based prompts.

### VS Code session bridge

This is optional.
If local Codex state files are not present, the bridge disables itself.

### GitHub PR and deploy integration

Set `GITHUB_TOKEN` or use `GITHUB_USE_GH_CLI=true` if you want PR and workflow actions.

## Common Mistakes

- forgetting to enable the Message Content intent
- pointing `local_path` to the wrong repo
- making `GENERIC_WORKSPACE_PATH` too broad
- assuming the included systemd units are universal installers
- trying to expose the bot to untrusted Discord users
