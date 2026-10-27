import { execFile } from "node:child_process"

/**
 * Environment inherited by git. Keep this list explicit: `process.env` can
 * contain `GH_TOKEN`, `GITHUB_TOKEN`, and askpass helpers that must not be
 * forwarded to git hooks, filters, or remote helpers.
 *
 * `HOME`, `PATH`, and `SSH_AUTH_SOCK` are deliberately retained so git can use
 * the server's existing credential helper or SSH agent. That is trusted server
 * configuration, not plugin-provided secret material.
 */
const GIT_ENV_KEYS = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TMPDIR",
  "TEMP",
  "TMP",
  "SSH_AUTH_SOCK",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "PATHEXT",
] as const

export interface SanitizedGitEnvOptions {
  /** Source environment. Defaults to `process.env`; tests pass a fixture. */
  readonly env?: NodeJS.ProcessEnv
}

export function sanitizedGitEnv(options: SanitizedGitEnvOptions = {}): Record<string, string> {
  const source = options.env ?? process.env
  const result: Record<string, string> = {}

  for (const key of GIT_ENV_KEYS) {
    const value = source[key]
    if (value !== undefined) result[key] = value
  }

  result.GIT_TERMINAL_PROMPT = "0"
  result.GIT_OPTIONAL_LOCKS = "0"
  return result
}

export interface RunGitOptions extends SanitizedGitEnvOptions {
  readonly timeoutMs?: number
  readonly signal?: AbortSignal
}

/**
 * Run git without a shell and without inheriting the server's full environment.
 * The caller supplies only the arguments; the checkout is selected with `-C`.
 */
export function runGit(args: readonly string[], cwd: string, options: RunGitOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["-C", cwd, ...args],
      {
        timeout: options.timeoutMs ?? 15_000,
        maxBuffer: 4 << 20,
        env: sanitizedGitEnv({ env: options.env ?? process.env }),
        windowsHide: true,
        ...(options.signal ? { signal: options.signal } : {}),
      },
      (error, stdout) => {
        if (error) {
          reject(error)
          return
        }
        resolve(stdout.trim())
      },
    )
  })
}
