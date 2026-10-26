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

`bun run check` runs formatting, lint, strict typecheck, and tests. `bun run audit` fails on high/critical dependency advisories. `pack:check` verifies that every `exports` target is present in the packed tarball.

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

Read [AGENTS.md](./AGENTS.md) and §7, §12.8, §14, and §18 of the research report. The server/TUI split is load-bearing: do not move server-only work into the TUI.

## Security

Never commit tokens, `.env` files, or captured private repository data. Report vulnerabilities privately as described in [SECURITY.md](./SECURITY.md).

## Commits

Use a clear imperative subject. Keep the research document and implementation changes in separate commits when practical.
