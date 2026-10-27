# opencode-nexusnv-github-sidebar

[![CI](https://github.com/nexusnv/opencode-nexusnv-github-sidebar/actions/workflows/ci.yml/badge.svg)](https://github.com/nexusnv/opencode-nexusnv-github-sidebar/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

A project-level GitHub workbench for OpenCode V2. It will show the current repository's open pull requests and issues in the sidebar, prioritize the viewer's work, and turn a row into a worktree-backed OpenCode session.

> **Status: loadable foundation.** The package now exposes a tested server/TUI/RPC skeleton. The server registers the plugin-owned credential methods and a location-scoped `health` RPC; the TUI appends a minimal GitHub marker after `health` succeeds for the same plugin and directory. P0 GitHub data and launch behavior start next.

The verified design and API research live in [opencode-github-sidebar-plugin-research.md](https://github.com/nexusnv/opencode-nexusnv-github-sidebar/blob/main/opencode-github-sidebar-plugin-research.md).

## What P0 will do

- Detect the GitHub repository on the **server** where the OpenCode project lives; render nothing when the location is not a git repository or has no supported GitHub remote.
- Show a pinned current-branch PR, the viewer's open PRs and issues, and bounded/collapsible other rows so a large repository does not flood the 36-cell sidebar.
- Show PR title, comment count, review count, CI status, merge status, draft state, and author.
- Show issue title, comment count, labels, author, and assignee.
- Primary click: focus an existing linked root session; otherwise create or reuse a worktree, create a session there, inject the PR/issue context with `resume: false`, and focus the new tab.
- Secondary browser action: `o` or the `↗` control opens the canonical GitHub URL.
- Resolve auth from a plugin-owned `github-sidebar` integration, environment variables, or `gh auth token`; show a `/connect` call to action when no token is available.
- Work against a local or remote OpenCode server. Credentials, git operations, and worktree creation stay on the server.

## Architecture

```
┌──────────────────────────────────┐        ┌──────────────────────────────────────┐
│ TUI plugin (client)              │        │ Server plugin (server/location)      │
│                                  │  RPC   │                                      │
│ sidebar.content                  │ ─────► │ repo detection (git)                 │
│  ├─ repo header                  │        │ auth resolution                      │
│  ├─ branch PR                    │        │ GraphQL client + cache               │
│  ├─ viewer / other PRs           │ ◄───── │ normalization + sanitization         │
│  ├─ viewer / other issues        │        │ git fetch + worktree creation        │
│  └─ refresh / connect CTA        │        │ launch context query                 │
│                                  │        │                                      │
│ session create + synthetic       │        │                                      │
│ context + tab focus              │        │                                      │
└──────────────────────────────────┘        └──────────────────────────────────────┘
```

The split is deliberate:

- A TUI plugin runs on the **client** machine, but its `context.client` is a full client for the connected server. OpenCode 2.1.4 does **not** sandbox it: `client.credential.*`, `client.file.*`, `client.pty.*`, `client.shell.*`, `client.experimental.*`, `client.worktree.*`, and the `client.session` process methods (`shell`, `command`, `background`, `environment`) can reach server credentials, files, commands, and worktrees. This plugin therefore keeps that work in the server half and treats TUI code as trusted; the TUI must never call those APIs.
- A server plugin can detect the repository, resolve the token, call GitHub, and run `git fetch` / `worktree.create` where the project actually lives.
- The TUI still owns session creation, synthetic context admission, and tab focus because it has the current model/agent selection and the tab UI.

The RPC is **location-scoped**. Every call passes `{ location: requireRpcLocation(context) }`, which reduces the runtime location to the wire shape `{ directory }` and reaches the plugin instance for that project directory. When a call is attempted without a location, the helper throws `MissingLocationError` instead of silently targeting the server's default location. The sidebar itself does not attempt an RPC without a location; it renders nothing until the host supplies one.

### Foundation vertical slice

The current skeleton is deliberately narrow:

- **Server** (`src/index.ts`): registers the `github-sidebar` integration (`env` and `key` methods) and a location-scoped `health` RPC.
- **TUI** (`src/tui.tsx`): appends one claim to `sidebar.content`; it shows the GitHub marker only after `health` reports `ok` for the same plugin and directory the sidebar is rendering. It rechecks when the location or workspace identity changes.
- **Shared** (`src/shared/`): identifier constants, a sanitized git environment, and the required-location guard.
- **Host loading** (`index.ts`, `tui.tsx`, `rpc.ts`): thin root shims so local directory targets resolve exactly as the host expects.

There are no GitHub API calls, repository detection, worktree creation, session launch, or real rows yet. Those are P0.

## Requirements

- OpenCode `v2.1.4` with the Bun runtime.
- Bun `1.4.x` for development.
- `git` on the server host.
- A GitHub token through one of:
  - the plugin-owned `github-sidebar` integration (recommended),
  - `GH_TOKEN` / `GITHUB_TOKEN` on the server,
  - `gh auth token --hostname <host>`.

The package is not published yet. During development the host loads it from a local directory. Directory targets probe `<dir>/server` first, then `<dir>/index`, followed by `<dir>/tui` and `<dir>/rpc`, so this repository keeps thin root shims with those names.

### Loading locally

Point your project `opencode.json(c)` at the absolute repository path:

```jsonc
{
  "plugins": [
    {
      "package": "/absolute/path/to/opencode-nexusnv-github-sidebar",
    },
  ],
}
```

The server half loads from `opencode.json(c)`; the TUI half is auto-loaded from the server inventory. Add a `cli.json` entry only when you need client-local options such as `openLinks`:

```json
{
  "plugins": [
    {
      "package": "/absolute/path/to/opencode-nexusnv-github-sidebar",
      "options": {
        "openLinks": "auto"
      }
    }
  ]
}
```

Restart OpenCode after changing server code. The foundation marker appears only when the TUI can reach the server `health` RPC and the reply names the same plugin and directory the sidebar is rendering. A health reply from another location leaves the marker in the unavailable state. If the host never supplies a location, the marker stays blank and no RPC is attempted; the plugin never falls back to the server's default location.

The RPC and health payload identify a location by directory only. A reconnect to a different server or workspace that reuses the same directory cannot be distinguished yet; P0 should revalidate on connection events or extend the RPC identity.

## Development

```sh
bun install
bun run check
```

| Script                 | Purpose                                                                |
| ---------------------- | ---------------------------------------------------------------------- |
| `bun run typecheck`    | Strict TypeScript check with `tsc --noEmit`                            |
| `bun run lint`         | `oxlint` over `src`, `test`, and `scripts`                             |
| `bun run lint:fix`     | Apply safe lint fixes                                                  |
| `bun run format`       | Format with Prettier                                                   |
| `bun run format:check` | Verify formatting without writing                                      |
| `bun test`             | Run the Bun test suite                                                 |
| `bun run test:watch`   | Run tests in watch mode                                                |
| `bun run check`        | Format check, lint, typecheck, and tests                               |
| `bun run audit`        | Fail on high/critical dependency advisories                            |
| `bun run pack:check`   | Pack the package and assert every export and directory shim is present |

The toolchain is intentionally Bun-first because the OpenCode V2 plugin host runs on Bun and compiles TSX at runtime. Node packaging/build output will be added when the plugin is ready to publish.

`bun test` loads the server, TUI, and RPC entrypoints through `@opencode/plugin/host`, verifies the default plugin definitions, exercises the sanitized git environment in a real repository, and renders the TUI marker with `testRender`. `bun run typecheck` also includes negative type tests for the public TUI contract and theme tokens.

The test preload (`test/preload.ts`, wired through `bunfig.toml`) registers `@opentui/solid`'s Bun plugin, the same Solid transform and client-runtime substitution the OpenCode host applies to TUI plugins. Keep it: without the transform, JSX props are evaluated once and `createEffect` is a no-op, so reactive render tests would be meaningless.

`solid-js` stays pinned to `1.9.15` to match the OpenCode `2.1.4` host. The `seroval` and `seroval-plugins` overrides keep Solid's dev/test copy on patched builds without changing the Solid runtime; both advisories are high/critical and fixed in `1.6.3`. Re-evaluate the override when the host upgrades Solid.

## Project layout

```
.
├── index.ts            # local-directory server entry (re-exports src/index.ts)
├── tui.tsx             # local-directory TUI entry (re-exports src/tui.tsx)
├── rpc.ts              # local-directory RPC entry (re-exports src/rpc.ts)
├── src/
│   ├── index.ts        # server plugin: credential methods + health RPC
│   ├── tui.tsx         # TUI plugin: sidebar.content claim
│   ├── rpc.ts          # shared location-scoped contract
│   ├── shared/
│   │   ├── git.ts      # sanitized git environment + execFile wrapper
│   │   ├── ids.ts      # plugin/RPC identifiers
│   │   └── location.ts # required-location guard
│   ├── server/         # planned: repo, auth, GitHub, cache, launch
│   └── tui/            # planned: rows, sections, panel, launch
├── test/               # Bun tests, including host loading and testRender
├── scripts/            # repository tooling
├── .github/workflows/  # CI, secret scanning, audit, pack gate
├── AGENTS.md           # implementation rules for agent sessions
├── CONTRIBUTING.md
├── SECURITY.md
├── CHANGELOG.md
└── opencode-github-sidebar-plugin-research.md
```

`src/server/` and `src/tui/` are planned. `src/shared/` now contains the foundation helpers used by the skeleton and P0.

## Configuration (planned)

Server-side data, display, and action options belong in `opencode.json(c)`:

```jsonc
{
  "plugins": [
    {
      "package": "opencode-nexusnv-github-sidebar",
      "options": {
        "hosts": ["github.com"],
        "scope": "auto",
        "pulls": { "limit": 8 },
        "issues": { "limit": 5 },
        "actions": { "enabled": true, "worktree": true },
      },
    },
  ],
}
```

Only client-local options belong in `cli.json`:

```jsonc
{
  "plugins": [
    {
      "package": "opencode-nexusnv-github-sidebar",
      "options": {
        "openLinks": "auto",
      },
    },
  ],
}
```

`cli.json` is global-only. Server options never reach the TUI half; the RPC returns the effective view so the TUI does not duplicate defaults.

## Security

- **Trust boundary:** OpenCode 2.1.4 does not isolate TUI plugins from server APIs. `context.client` can read stored credential secrets (`credential.list`), read/write server files, create PTYs, run shells, execute session process commands, and create worktrees. The plugin never calls those APIs from the TUI; allowed client surfaces are `session.create`, `session.synthetic`, `session.list`, `session.get`, `integration.list/connect`, `location.get`, `rpc`, `data`, `ui`, `storage`, `keymap`, `theme`, and `attention`. The `session` process methods (`shell`, `command`, `background`, `environment`) remain forbidden. Treat the TUI half as trusted code. A test (`test/tui-boundary.test.ts`) fails if forbidden client APIs appear in TUI sources; it is a line-oriented tripwire, so aliases and computed access still require review.
- The plugin keeps tokens on the server in its intended path. Its RPC never returns them, and they are never written to TUI storage, logged, or passed to git. This is a plugin policy, not a host sandbox.
- Git subprocesses receive an explicit environment allowlist (`PATH`, `HOME`, locale, temp, SSH agent, and platform basics). `GH_TOKEN`, `GITHUB_TOKEN`, askpass helpers, and unrelated secrets are stripped; `GIT_TERMINAL_PROMPT=0` is forced. `HOME`, `PATH`, and `SSH_AUTH_SOCK` are deliberately retained so git can use the server's existing credential helper or SSH agent.
- The GitHub host is allowlisted before any token use. API URLs are HTTPS-only and redirects are rejected.
- PR/issue bodies are untrusted. Injected context delimiters and explicit "background only" instructions are required; the plugin never auto-sends a prompt.
- Titles, bodies, labels, and URLs are sanitized before rendering.
- Debug logs redact headers, tokens, and private titles.

See §18.1 of the research report for the full checklist.

## Research

The design document records the verified OpenCode 2.1.4 plugin/TUI/RPC APIs, the GitHub GraphQL query (1 rate-limit point at 50 PRs + 50 issues), prior art, auth options, launch semantics, UX constraints, configuration split, test plan, and risks.

Start with the executive summary and then read §12.8 (action model), §14 (configuration), and §18 (security) before implementing P0.

## License

MIT. See [LICENSE](./LICENSE).
