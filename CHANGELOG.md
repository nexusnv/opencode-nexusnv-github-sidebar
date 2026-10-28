# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0] - 2026-10-29

### Added

- P0 GitHub workbench: server-side repository detection, integration/env/`gh` auth precedence, one-query GraphQL snapshots, normalization/sanitization, TTL + stale cache, and location-scoped `summary`/`prepareLaunch` RPCs.
- Sidebar sections for the current-branch PR, the viewer's PRs/issues, and bounded other rows; PR CI/merge/draft/review detail and issue labels/assignees; empty, loading, stale, auth, unavailable, rate-limit, and error states; collapsible sections and refresh controls.
- Worktree-backed launch: PR head/default-branch fetch, worktree reuse/creation, local branch creation, monorepo subpath handling, session metadata links, synthetic context with `resume: false`, and tab focus / router fallback.
- Read-only `actions.enabled: false` mode that opens the browser and never touches sessions or git.
- Server option parsing with an effective view returned over RPC; client-only `openLinks` (`auto`, `browser`, `osc8`).
- Runtime contract validators on the TUI boundary and safe HTTPS/OSC 8 link handling.
- Hermetic tests for remote parsing, auth precedence, cache/stale behavior, normalization, context limits, git/launch flows, service orchestration, TUI state/render/launch, and contract validation.
- Opt-in live smoke test: `GITHUB_SIDEBAR_LIVE=1 bun run smoke:live`.
- Loadable foundation: server and TUI plugins with a location-scoped `health` RPC, an additive `sidebar.content` claim, and local-directory entrypoint shims.
- Credential integration methods for `GH_TOKEN`/`GITHUB_TOKEN` and a personal access token, plus a sanitized git environment and required-location guard.
- Foundation tests: host resolution and loading for directory and package targets, default plugin exports, location enforcement and wire-shape narrowing, location-matched health gating, token stripping, TUI trust-boundary enforcement, and TUI rendering.
- Security documentation records that OpenCode 2.1.4 does not sandbox TUI plugins; the TUI half must never call `client.credential/file/pty/shell/experimental/worktree` APIs or the `client.session` process methods.
- Bun/TypeScript package contract, strict typecheck, Oxlint, Prettier, CI, secret scanning, dependency audit, and package export check.
- Initial README, contributor guide, security policy, and agent implementation rules.

### Changed

- The issue launch query uses the `issueOrPullRequest` union because `Issue.pullRequest` does not exist in the GitHub schema.
- GraphQL issue launch is rejected when the number resolves to a pull request.
- The TUI hides and does not fetch for child sessions.
- README requirements now state that the P0 flow is verified on OpenCode 2.2.0 as well as the pinned 2.1.4 types.

### Fixed

- TUI lifecycle state now lives in `src/tui/state.tsx`. OpenCode 2.2.0 rewrites `solid-js` to the host runtime for `.tsx` sources only; the previous `.ts` module loaded the plugin's own Solid server build, so effects never tracked the host's location and the sidebar stayed on "Loading GitHub…". `test/tui-runtime.test.ts` blocks runtime host imports from `.ts` sources.

[0.1.0]: https://github.com/nexusnv/opencode-nexusnv-github-sidebar/releases/tag/v0.1.0
