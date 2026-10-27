# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- Loadable foundation: server and TUI plugins with a location-scoped `health` RPC, an additive `sidebar.content` claim, and local-directory entrypoint shims.
- Credential integration methods for `GH_TOKEN`/`GITHUB_TOKEN` and a personal access token, plus a sanitized git environment and required-location guard.
- Foundation tests: host resolution and loading for directory and package targets, default plugin exports, location enforcement and wire-shape narrowing, location-matched health gating, token stripping, TUI trust-boundary enforcement, and TUI rendering.
- Security documentation records that OpenCode 2.1.4 does not sandbox TUI plugins; the TUI half must never call `client.credential/file/pty/shell/experimental/worktree` APIs or the `client.session` process methods.
- Bun/TypeScript package contract, strict typecheck, Oxlint, Prettier, CI, secret scanning, dependency audit, and package export check.
- Initial README, contributor guide, security policy, and agent implementation rules.

P0 GitHub data and launch behavior are not implemented yet.
