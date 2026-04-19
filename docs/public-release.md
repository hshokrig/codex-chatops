# Public Release Audit

## Short Answer

This repo is close to being publishable as source code, but it is not ready to market as a generic public-use service without caveats.

It does not appear to commit live secrets, but it is still tightly coupled to a trusted self-hosted workflow.

## What Looks Safe

- `.secrets/` is gitignored.
- `.chatops/` is gitignored.
- `.env.example` is tracked instead of a live env file.
- The tracked repo map example uses placeholder IDs and paths.
- No live Discord token, GitHub token, or Codex auth artifact appears to be committed.

## What Is Still Coupled To Your Environment

### Trusted-host security model

The product assumes:

- one trusted machine
- a trusted private Discord guild
- explicit repo allowlists
- local access to Codex and Git

That is a valid architecture, but it is not the same as a multi-tenant public bot.

### Local-path assumptions

Repo execution depends on local filesystem paths from `repo-map.yaml`.
Generic chat depends on a local `GENERIC_WORKSPACE_PATH`.

### Local Codex state integration

The optional VS Code bridge reads local Codex metadata from `~/.codex/...`.
That feature is user-machine specific and should be documented as optional.

### Deployment templates

The systemd units assume a checkout path under `%h/Projects/codex-chatops`.
That is a template assumption, not a portable installer.

## Secrets and Privacy Risks

### Secrets in Git

No committed live secret was found during this review.

### Operational risk

The bigger risk is not committed secrets.
It is that the bot exposes local-code execution via Discord in a trusted environment.

That means:

- a compromised Discord account is high impact
- a bad repo mapping can expose the wrong local directory
- a too-broad generic workspace can inspect or modify more than intended

## What To Fix Before Wider Public Sharing

1. Make all installation paths explicitly configurable in the systemd templates and docs.
2. Document the trusted-host model prominently.
3. Document the VS Code bridge as optional.
4. Narrow the generic workspace guidance so operators do not point it at an overly broad root by accident.
5. Use the [release checklist](release-checklist.md) before every public release.

## Verdict

### Safe to publish as code?

Yes, with documentation cleanup and a clear self-hosted security warning.

### Safe for "everyone to use" as-is?

No.

As written, this is a power tool for a trusted self-hosted operator, not a public bot that untrusted users should be able to command.

## Audit Summary For This Review

What I checked in this pass:

- current tracked files
- git history for hardcoded personal paths and common secret patterns
- tracked docs and runtime templates for fork-time assumptions

What I found:

- no committed live Discord, GitHub, or similar tokens in the scanned history
- no tracked `.secrets/` or `.chatops/` data
- one tracked hardcoded personal Codex binary path in `systemd/codex-chatops-auth-check.service` history, already fixed in the current working tree
- remaining coupling is architectural and operational, not secret leakage
