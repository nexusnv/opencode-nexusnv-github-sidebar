import { runGit } from "../shared/git.js"
import { isHostAllowed, parseRemoteUrl } from "../shared/remote.js"

export interface DetectedRepo {
  /** Git checkout root for the location, including worktrees. */
  readonly root: string
  readonly remote: string
  readonly branch: string | null
  readonly defaultBranchHint: string | null
  readonly host: string
  readonly owner: string
  readonly name: string
  readonly nameWithOwner: string
  readonly url: string
}

export type RepoDetection =
  | { readonly status: "ok"; readonly repo: DetectedRepo }
  | { readonly status: "no-git" }
  | { readonly status: "no-remote" }
  | { readonly status: "malformed-remote" }
  | { readonly status: "unsupported-host"; readonly host: string }

export interface DetectRepoOptions {
  readonly directory: string
  readonly remote: string
  readonly hosts: readonly string[]
  readonly signal?: AbortSignal
  /** Source environment override for tests. */
  readonly env?: NodeJS.ProcessEnv
}

const TIMEOUT_MS = 5_000

function git(args: readonly string[], directory: string, options: DetectRepoOptions): Promise<string> {
  return runGit(args, directory, {
    timeoutMs: TIMEOUT_MS,
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.env ? { env: options.env } : {}),
  })
}

async function optionalGit(
  args: readonly string[],
  directory: string,
  options: DetectRepoOptions,
): Promise<string | null> {
  try {
    const value = await git(args, directory, options)
    return value || null
  } catch (error) {
    if (options.signal?.aborted) throw error
    return null
  }
}

/**
 * Resolve the checkout root, remote, and branch for a server-side location.
 * The location directory comes from `ctx.location`, never from the TUI's
 * working directory.
 */
export async function detectRepo(options: DetectRepoOptions): Promise<RepoDetection> {
  let root: string
  try {
    root = await git(["rev-parse", "--show-toplevel"], options.directory, options)
  } catch (error) {
    if (options.signal?.aborted) throw error
    return { status: "no-git" }
  }
  if (!root) return { status: "no-git" }

  let remoteNames: string[]
  try {
    const output = await git(["remote"], root, options)
    remoteNames = output.split("\n").filter(Boolean)
  } catch (error) {
    if (options.signal?.aborted) throw error
    return { status: "no-remote" }
  }
  if (remoteNames.length === 0) return { status: "no-remote" }

  const remote = remoteNames.includes(options.remote)
    ? options.remote
    : remoteNames.includes("origin")
      ? "origin"
      : remoteNames[0]
  if (!remote) return { status: "no-remote" }

  const remoteUrl = await optionalGit(["remote", "get-url", remote], root, options)
  if (!remoteUrl) return { status: "no-remote" }

  const parsed = parseRemoteUrl(remoteUrl)
  if (!parsed.ok) return { status: "malformed-remote" }
  if (!isHostAllowed(parsed.value.host, options.hosts)) {
    return { status: "unsupported-host", host: parsed.value.host }
  }

  const branch = await optionalGit(["symbolic-ref", "--short", "-q", "HEAD"], root, options)
  const remoteHead = await optionalGit(["symbolic-ref", "--short", "-q", `refs/remotes/${remote}/HEAD`], root, options)
  const defaultBranchHint = remoteHead?.startsWith(`${remote}/`) ? remoteHead.slice(remote.length + 1) : null

  return {
    status: "ok",
    repo: {
      root,
      remote,
      branch,
      defaultBranchHint,
      host: parsed.value.host,
      owner: parsed.value.owner,
      name: parsed.value.name,
      nameWithOwner: `${parsed.value.owner}/${parsed.value.name}`,
      url: parsed.value.url,
    },
  }
}

/** Checkout root used for the monorepo subpath calculation. */
export async function checkoutRoot(directory: string, signal?: AbortSignal, env?: NodeJS.ProcessEnv): Promise<string> {
  try {
    const root = await runGit(["rev-parse", "--show-toplevel"], directory, {
      timeoutMs: TIMEOUT_MS,
      ...(signal ? { signal } : {}),
      ...(env ? { env } : {}),
    })
    return root || directory
  } catch (error) {
    if (signal?.aborted) throw error
    return directory
  }
}
