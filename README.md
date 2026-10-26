# opencode-nexusnv-github-sidebar

[![CI](https://github.com/nexusnv/opencode-nexusnv-github-sidebar/actions/workflows/ci.yml/badge.svg)](https://github.com/nexusnv/opencode-nexusnv-github-sidebar/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

A project-level GitHub workbench for OpenCode V2. It will show the current repository's open pull requests and issues in the sidebar, prioritize the viewer's work, and turn a row into a worktree-backed OpenCode session.

> **Status: repository foundation only.** No plugin behavior is implemented yet. The P0 MVP starts after this scaffold. The verified design and API research live in [opencode-github-sidebar-plugin-research.md](https://github.com/nexusnv/opencode-nexusnv-github-sidebar/blob/main/opencode-github-sidebar-plugin-research.md).

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

- A TUI plugin runs on the **client** machine. It cannot read a remote server's filesystem, git credentials, or stored secrets.
- A server plugin can detect the repository, resolve the token, call GitHub, and run `git fetch` / `worktree.create` where the project actually lives.
- The TUI still owns session creation, synthetic context admission, and tab focus because it has the current model/agent selection and the tab UI.

The RPC is **location-scoped**. Every call passes `{ location: context.location }` so it reaches the plugin instance for that project directory.

## Requirements

- OpenCode `v2.1.4` with the Bun runtime.
- Bun `1.4.x` for development.
- `git` on the server host.
- A GitHub token through one of:
  - the plugin-owned `github-sidebar` integration (recommended),
  - `GH_TOKEN` / `GITHUB_TOKEN` on the server,
  - `gh auth token --hostname <host>`.

The package is not published yet. During development it is loaded from this directory or a local package link.

## Development

```sh
bun install
bun run check
```

| Script                 | Purpose                                                    |
| ---------------------- | ---------------------------------------------------------- |
| `bun run typecheck`    | Strict TypeScript check with `tsc --noEmit`                |
| `bun run lint`         | `oxlint` over `src`, `test`, and `scripts`                 |
| `bun run lint:fix`     | Apply safe lint fixes                                      |
| `bun run format`       | Format with Prettier                                       |
| `bun run format:check` | Verify formatting without writing                          |
| `bun test`             | Run the Bun test suite                                     |
| `bun run test:watch`   | Run tests in watch mode                                    |
| `bun run check`        | Format check, lint, typecheck, and tests                   |
| `bun run audit`        | Fail on high/critical dependency advisories                |
| `bun run pack:check`   | Pack the package and assert every export target is present |

The toolchain is intentionally Bun-first because the OpenCode V2 plugin host runs on Bun and compiles TSX at runtime. Node packaging/build output will be added when the plugin is ready to publish.

## Project layout

```
.
├── src/
│   ├── index.ts        # server plugin entry (placeholder)
│   ├── tui.tsx         # TUI plugin entry (placeholder)
│   ├── rpc.ts          # shared location-scoped RPC contract (placeholder)
│   ├── server/         # planned: repo, auth, GitHub, cache, launch
│   ├── tui/            # planned: sidebar, rows, panel, launch
│   └── shared/         # planned: types and status mapping
├── test/               # Bun tests; TUI render tests will use testRender
├── scripts/            # repository tooling
├── .github/workflows/  # CI, secret scanning, audit, pack gate
├── AGENTS.md           # implementation rules for agent sessions
├── CONTRIBUTING.md
├── SECURITY.md
├── CHANGELOG.md
└── opencode-github-sidebar-plugin-research.md
```

The `server/`, `tui/`, and `shared/` directories are planned and will be created when the corresponding P0 work starts.

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

- Tokens stay on the server. They are never returned over RPC, written to TUI storage, logged, or passed to git.
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
