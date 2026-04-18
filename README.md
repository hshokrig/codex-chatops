# Codex ChatOps

Discord-first ChatOps bridge for Codex running on a trusted local machine.

The bot turns Discord channels into an operator interface for local Codex execution:
- repo-bound work in repo-specific `#codex-sessions` channels
- generic path-based work in `#codex-chat`
- one Discord session thread per Codex thread, branch, and workspace

## Status

This project is usable, but it is not a zero-config public SaaS-style bot.
It is designed for a trusted self-hosted setup where the operator controls:
- the Discord server
- the local machine running Codex
- the allowlisted repos and users

## Quick Start

1. Copy `.env.example` to `.secrets/.env.local`.
2. Copy `repo-map.example.yaml` to `.secrets/repo-map.yaml`.
3. Fill in Discord IDs, local repo paths, and optional GitHub settings.
4. Sign in locally with `codex login`.
5. Install dependencies with `pnpm install`.
6. Initialize the DB with `pnpm db:migrate`.
7. Bootstrap Discord with `pnpm bootstrap:discord`.
8. Start the service with `pnpm dev` or `pnpm start`.

## Documentation

- [Docs Index](docs/README.md)
- [Architecture](docs/architecture.md)
- [Configuration](docs/configuration.md)
- [Fork Setup](docs/fork-setup.md)
- [Usage Guide](docs/usage-guide.md)
- [Operator Runbook](docs/operator-runbook.md)
- [Public Release Audit](docs/public-release.md)
- [Release Checklist](docs/release-checklist.md)
- [Sample Transcripts](docs/sample-transcripts.md)

## Commands

- `pnpm dev`
- `pnpm build`
- `pnpm test`
- `pnpm lint`
- `pnpm smoke:local`
- `pnpm bootstrap:discord`

## Security Model

- Run this only on a trusted host.
- Keep `.secrets/` out of version control.
- Do not copy `~/.codex/auth.json` into the repo or artifacts.
- Treat Discord access as privileged access to local code execution.

## Examples

Deployment workflow examples live in:
- [docs/examples/deploy-staging.yml](docs/examples/deploy-staging.yml)
- [docs/examples/deploy-production.yml](docs/examples/deploy-production.yml)
