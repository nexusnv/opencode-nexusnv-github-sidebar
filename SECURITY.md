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

The plugin is designed so GitHub tokens never leave the server. If you find a path where a token reaches the TUI, RPC output, logs, git arguments, synthetic context, or a toast, treat it as a security bug.

## Scope

In scope:

- credential leakage or host-allowlist bypass,
- command injection through git/remote/title/body data,
- path traversal in worktree or session directories,
- prompt injection that causes unintended tool execution,
- XSS/terminal escape injection through rendered GitHub data.

Out of scope:

- vulnerabilities in GitHub itself,
- vulnerabilities in OpenCode outside this plugin,
- users intentionally running untrusted PR code after being warned.
