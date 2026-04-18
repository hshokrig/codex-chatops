# Release Checklist

Use this before publishing the repo or tagging a release intended for others to fork.

## Source Hygiene

- [ ] `.secrets/` is ignored and not tracked
- [ ] `.chatops/` is ignored and not tracked
- [ ] no live `.env.local` or repo-map files are committed
- [ ] no generated session artifacts are committed
- [ ] no private screenshots, sample payloads, or operator data are committed

## Secret Review

- [ ] current tree scanned for Discord, GitHub, OpenAI, and other token formats
- [ ] git history scanned for committed secrets or private credentials
- [ ] no committed Codex auth artifacts such as `~/.codex/auth.json`
- [ ] no committed private database snapshots or personal exports

## Personal Coupling Review

- [ ] no hardcoded personal home-directory paths remain in tracked runtime files
- [ ] no hardcoded Discord guild IDs or channel IDs remain in tracked templates
- [ ] tracked docs do not assume one specific username, machine, or repo layout
- [ ] any local-path assumptions are documented as self-hosted configuration

## Documentation

- [ ] `README.md` is concise and points to `docs/`
- [ ] `docs/fork-setup.md` matches the current setup flow
- [ ] `docs/configuration.md` matches `.env.example`
- [ ] `docs/public-release.md` reflects the current security model
- [ ] systemd files are documented as templates, not universal installers

## Behavior Verification

- [ ] `pnpm build`
- [ ] `pnpm test`
- [ ] `pnpm lint`
- [ ] `pnpm smoke:local`
- [ ] Discord bootstrap validates successfully
- [ ] `GET /readyz` returns healthy in a valid local setup

## Security Model Confirmation

- [ ] docs clearly state that this is a trusted self-hosted bot
- [ ] docs clearly state it is not a public multi-tenant service
- [ ] generic workspace usage is documented as privileged
- [ ] operator allowlists and approval flows are documented

## Optional Release Follow-Up

- [ ] add GitHub issue templates for bug reports and setup questions
- [ ] add a contribution guide if outside contributors are expected
- [ ] add a changelog or release notes format if regular releases are planned
