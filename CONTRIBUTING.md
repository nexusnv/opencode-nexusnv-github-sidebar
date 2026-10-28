# Contributing

## Setup

```sh
bun install
```

Use Bun `1.4.x`. The lockfile is committed; CI installs with `--frozen-lockfile`.

## Before opening a PR

```sh
bun run check
bun run audit
bun run pack:check
```

`bun run check` runs formatting, lint, strict typecheck, and tests. `bun run audit` fails on high/critical dependency advisories. `pack:check` builds `dist/`, verifies that every `exports` target and local-directory shim is present in the packed tarball, and rejects an uncompiled TUI entrypoint.

## Scope

The first milestone is P0 from the [research report](./opencode-github-sidebar-plugin-research.md):

- repo detection on the server,
- auth resolution and connect CTA,
- one GraphQL query for PRs/issues/CI/merge state,
- sidebar sections with viewer-first ordering and bounded other rows,
- focus-or-launch session action,
- secondary browser action,
- tests for the server data layer and launch semantics.

Do not add the full-list panel, OAuth device flow, PR writes, GitLab/Bitbucket, or session-PR adoption without discussing scope first.

## Architecture

Read [AGENTS.md](./AGENTS.md) and §7, §12.8, §14, and §18 of the research report. The server/TUI split is load-bearing: keep credentials, git, and worktree creation on the server, and never use the TUI's unsandboxed server APIs.

## Security

Never commit tokens, `.env` files, or captured private repository data. Report vulnerabilities privately as described in [SECURITY.md](./SECURITY.md).

## Releasing

Follow [Releasing](./docs/v0.1.0-readiness.md#releasing). Releases are published from a `v*` tag by `.github/workflows/publish.yml`, never from a local working tree. The workflow uses the `NPM_TOKEN` repository secret while it exists and falls back to GitHub OIDC trusted publishing when it is absent. Configure the trusted publisher in the npm web UI first (npm requires an interactive 2FA session), then delete the secret.

## Commits

Use a clear imperative subject. Keep the research document and implementation changes in separate commits when practical.
