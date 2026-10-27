# Security policy

## Reporting a vulnerability

Report security issues privately through GitHub Security Advisories:

<https://github.com/nexusnv/opencode-nexusnv-github-sidebar/security/advisories/new>

Do not open a public issue for a suspected token leak, credential exposure, prompt-injection bypass, or worktree path escape.

Include:

- affected version or commit,
- reproduction steps,
- impact,
- whether a token or private repository data was exposed.

## Supported versions

The project is pre-release. Only the current `main` branch is supported until the first tagged release.

## Token handling

The plugin is designed so its RPC, rendering, and git calls never expose GitHub tokens to the TUI. If you find a path where this plugin's token reaches the TUI, RPC output, logs, git arguments, synthetic context, or a toast, treat it as a security bug.

OpenCode 2.1.4 does **not** sandbox TUI plugins. `context.client` can call `credential.list()` (which returns stored secret values), read/write server files, create PTYs, run shells, execute session process commands, and create worktrees. The plugin's TUI half must never use `credential.*`, `file.*`, `pty.*`, `shell.*`, `experimental.*`, `worktree.*`, or the `session` process methods (`shell`, `command`, `background`, `environment`); only the server half may touch credentials, git, and worktrees. Treat TUI plugin code as trusted code. The source tripwire is line-oriented, so aliases and computed access still require review.

## Scope

In scope:

- credential leakage or host-allowlist bypass,
- TUI code calling server credential, file, PTY, shell, experimental, worktree, or session process APIs,
- command injection through git/remote/title/body data,
- path traversal in worktree or session directories,
- prompt injection that causes unintended tool execution,
- XSS/terminal escape injection through rendered GitHub data.

Out of scope:

- vulnerabilities in GitHub itself,
- vulnerabilities in OpenCode outside this plugin,
- users intentionally running untrusted PR code after being warned.
