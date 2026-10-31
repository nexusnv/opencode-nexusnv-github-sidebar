/* oxlint-disable eslint/no-control-regex -- branch names reject control characters */
import path from "node:path"
import type { GithubSidebarConfig } from "../config.js"
import { runGit } from "../shared/git.js"
import { emptyLaunchResult } from "../shared/types.js"
import type { JsonValue, LaunchKind, LaunchResult } from "../shared/types.js"
import {
  buildIssueContext,
  buildMinimalContext,
  buildPullContext,
  contextDescription,
  type ContextOptions,
} from "./context.js"
import type { LaunchItem } from "./normalize.js"
import { canonicalItemUrl } from "./normalize.js"
import type { DetectedRepo } from "./repo.js"
import { checkoutRoot } from "./repo.js"

export interface LaunchServerContext {
  readonly location: {
    readonly directory: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly worktree: {
    list(input: { readonly projectID: string }): Promise<readonly { readonly directory: string }[]>
    create(input: {
      readonly projectID: string
      readonly from?: string
      readonly branch?: string
      readonly name?: string
    }): Promise<{ readonly directory: string }>
    remove(input: { readonly projectID: string; readonly directory: string; readonly force: boolean }): Promise<void>
  }
  readonly storage: {
    get(key: string): Promise<unknown>
    set(key: string, value: JsonValue): Promise<void>
  }
}

export interface PrepareLaunchOptions {
  readonly ctx: LaunchServerContext
  readonly config: GithubSidebarConfig
  readonly repo: DetectedRepo
  readonly kind: LaunchKind
  readonly number: number
  /** Authoritative item context, or undefined when the body query failed. */
  readonly item: LaunchItem | undefined
  readonly isPrivate: boolean
  readonly signal: AbortSignal
  readonly env?: NodeJS.ProcessEnv
}

interface StoredWorktree {
  readonly directory: string
  readonly branch: string
  readonly base: string
  readonly subpath: string
  readonly updatedAt: number
}

const LOCAL_TIMEOUT_MS = 15_000
const MAX_BRANCH_ATTEMPTS = 10

function repositoryOf(options: PrepareLaunchOptions) {
  return {
    host: options.repo.host,
    nameWithOwner: options.repo.nameWithOwner,
    url: options.repo.url,
    isPrivate: options.isPrivate,
  } as const
}

function fail(options: PrepareLaunchOptions, code: LaunchResult["code"], message: string): LaunchResult {
  return {
    ...emptyLaunchResult(options.kind, options.number, code, message),
    repository: repositoryOf(options),
  }
}

function storedWorktree(value: unknown): StoredWorktree | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const entry = value as Record<string, unknown>
  if (
    typeof entry.directory !== "string" ||
    typeof entry.branch !== "string" ||
    typeof entry.base !== "string" ||
    typeof entry.subpath !== "string" ||
    typeof entry.updatedAt !== "number"
  ) {
    return undefined
  }
  return {
    directory: entry.directory,
    branch: entry.branch,
    base: entry.base,
    subpath: entry.subpath,
    updatedAt: entry.updatedAt,
  }
}

function storageKey(ctx: LaunchServerContext, repo: DetectedRepo, kind: LaunchKind, number: number): string {
  return `worktree:${ctx.location.project.id}:${repo.host}/${repo.owner}/${repo.name}:${kind}/${number}`
}

function validBranchName(value: string | undefined): value is string {
  if (!value || value.length > 255) return false
  if (/[\s~^:?*[\\\u0000-\u001f\u007f]/.test(value)) return false
  if (value.startsWith("-") || value.startsWith("/") || value.endsWith("/") || value.endsWith(".")) return false
  if (value === "@" || value.includes("..") || value.includes("@{") || value.includes("//")) return false
  return true
}

async function git(
  args: readonly string[],
  cwd: string,
  signal: AbortSignal,
  env: NodeJS.ProcessEnv | undefined,
  timeoutMs = LOCAL_TIMEOUT_MS,
): Promise<string> {
  return runGit(args, cwd, {
    timeoutMs,
    signal,
    ...(env ? { env } : {}),
  })
}

async function optionalGit(
  args: readonly string[],
  cwd: string,
  signal: AbortSignal,
  env: NodeJS.ProcessEnv | undefined,
  timeoutMs = LOCAL_TIMEOUT_MS,
): Promise<string | null> {
  try {
    const value = await git(args, cwd, signal, env, timeoutMs)
    return value || null
  } catch (error) {
    if (signal.aborted) throw error
    return null
  }
}

function resolveInside(root: string, relative: string): string | undefined {
  if (!relative) return root
  const resolved = path.resolve(root, relative)
  const prefix = path.resolve(root) + path.sep
  return resolved === path.resolve(root) || resolved.startsWith(prefix) ? resolved : undefined
}

async function computeSubpath(options: PrepareLaunchOptions, worktreeDirectory: string): Promise<string> {
  const root = await checkoutRoot(options.ctx.location.directory, options.signal, options.env)
  const relative = path.relative(root, options.ctx.location.directory)
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return ""
  const sessionDirectory = resolveInside(worktreeDirectory, relative)
  return sessionDirectory ? relative : ""
}

async function existingWorktree(options: PrepareLaunchOptions, key: string): Promise<StoredWorktree | undefined> {
  if (!options.config.actions.reuseWorktree) return undefined
  let stored: StoredWorktree | undefined
  try {
    stored = storedWorktree(await options.ctx.storage.get(key))
  } catch {
    return undefined
  }
  if (!stored) return undefined

  try {
    const entries = await options.ctx.worktree.list({ projectID: options.ctx.location.project.id })
    const match = entries.some((entry) => path.resolve(entry.directory) === path.resolve(stored.directory))
    if (!match) return undefined
  } catch {
    return undefined
  }

  const branch = await optionalGit(
    ["symbolic-ref", "--short", "-q", "HEAD"],
    stored.directory,
    options.signal,
    options.env,
  )
  return branch === stored.branch ? stored : undefined
}

async function chooseBranch(
  directory: string,
  base: string,
  options: PrepareLaunchOptions,
): Promise<string | undefined> {
  for (let attempt = 1; attempt <= MAX_BRANCH_ATTEMPTS; attempt++) {
    const candidate = attempt === 1 ? base : `${base}-${attempt}`
    try {
      await git(["switch", "-c", candidate], directory, options.signal, options.env)
      return candidate
    } catch (error) {
      if (options.signal.aborted) throw error
    }
  }
  return undefined
}

async function behindCount(directory: string, ref: string, options: PrepareLaunchOptions): Promise<number | undefined> {
  const output = await optionalGit(["rev-list", "--count", `HEAD..${ref}`], directory, options.signal, options.env)
  if (!output) return undefined
  const count = Number(output)
  return Number.isFinite(count) && count >= 0 ? Math.trunc(count) : undefined
}

function contextOptions(
  options: PrepareLaunchOptions,
  checkedOut: boolean,
  worktreePath: string | undefined,
  branch: string | undefined,
  behind: number | undefined,
): ContextOptions {
  return {
    mode: options.config.actions.context,
    bodyLimitBytes: options.config.actions.bodyLimitBytes,
    checkedOut,
    worktreePath,
    branch,
    behind,
  }
}

export async function prepareLaunch(options: PrepareLaunchOptions): Promise<LaunchResult> {
  const { config, repo, kind, number } = options
  const url = canonicalItemUrl(
    {
      host: repo.host,
      owner: repo.owner,
      name: repo.name,
      nameWithOwner: repo.nameWithOwner,
      url: repo.url,
      isPrivate: options.isPrivate,
    },
    kind === "pull" ? "pull" : "issue",
    number,
  )
  const defaultBranch = options.item?.defaultBranch || repo.defaultBranchHint || ""
  const base =
    kind === "pull"
      ? options.item?.kind === "pull"
        ? options.item.baseRefName || defaultBranch
        : defaultBranch
      : defaultBranch

  if (!config.actions.enabled) return fail(options, "disabled", "GitHub actions are disabled in configuration.")

  const useWorktree = config.actions.worktree && (kind === "pull" || config.actions.issueWorktree)

  if (!useWorktree) {
    const description = options.item
      ? contextDescription(options.item)
      : `${kind === "pull" ? "PR" : "Issue"} #${number}`
    const context = options.item
      ? kind === "pull" && options.item.kind === "pull"
        ? buildPullContext(
            options.item,
            repo.nameWithOwner,
            contextOptions(options, false, undefined, undefined, undefined),
          )
        : options.item.kind === "issue"
          ? buildIssueContext(
              options.item,
              repo.nameWithOwner,
              contextOptions(options, false, undefined, undefined, undefined),
            )
          : ""
      : buildMinimalContext(
          kind,
          number,
          repo.nameWithOwner,
          url,
          contextOptions(options, false, undefined, undefined, undefined),
        )
    return {
      ...emptyLaunchResult(kind, number, "ok", ""),
      ok: true,
      repository: repositoryOf(options),
      title: options.item?.title || `${kind === "pull" ? "PR" : "Issue"} #${number}`,
      url,
      base,
      sessionDirectory: options.ctx.location.directory,
      context,
      description,
    }
  }

  if (kind === "issue" && !validBranchName(defaultBranch)) {
    return fail(options, "no-default-branch", "Could not determine the repository default branch.")
  }

  const startRef = kind === "pull" ? `refs/opencode/pr/${number}` : `refs/opencode/base/${defaultBranch}`
  const sourceDirectory = options.ctx.location.project.directory

  try {
    await git(
      [
        "fetch",
        "--no-tags",
        repo.remote,
        kind === "pull" ? `+refs/pull/${number}/head:${startRef}` : `+refs/heads/${defaultBranch}:${startRef}`,
      ],
      sourceDirectory,
      options.signal,
      options.env,
      config.actions.fetchTimeoutMs,
    )
  } catch (error) {
    if (options.signal.aborted) throw error
    return fail(
      options,
      "fetch-failed",
      `Could not fetch ${kind === "pull" ? "the pull request" : "the default branch"} from ${repo.remote}. Check the server's git credentials.`,
    )
  }

  const item = options.item
  const sameRepository =
    kind === "pull" && item?.kind === "pull" && !item.isCrossRepository && validBranchName(item.headRefName)
  if (sameRepository && item.kind === "pull") {
    try {
      await git(
        [
          "fetch",
          "--no-tags",
          repo.remote,
          `+refs/heads/${item.headRefName}:refs/remotes/${repo.remote}/${item.headRefName}`,
        ],
        sourceDirectory,
        options.signal,
        options.env,
        config.actions.fetchTimeoutMs,
      )
    } catch (error) {
      if (options.signal.aborted) throw error
      // The PR ref is enough to launch; upstream is a convenience.
    }
  }

  const key = storageKey(options.ctx, repo, kind, number)
  const reuse = await existingWorktree(options, key)

  let worktreeDirectory: string
  let branch: string
  let reused: boolean

  if (reuse) {
    worktreeDirectory = reuse.directory
    branch = reuse.branch
    reused = true
  } else {
    const worktreeName = `${kind === "pull" ? config.actions.branchPrefix.pr : config.actions.branchPrefix.issue}${number}`
    let created: { readonly directory: string }
    try {
      created = await options.ctx.worktree.create({
        projectID: options.ctx.location.project.id,
        from: sourceDirectory,
        branch: startRef,
        name: worktreeName,
      })
    } catch (error) {
      if (options.signal.aborted) throw error
      return fail(options, "worktree-failed", "Could not create a worktree for this item.")
    }
    worktreeDirectory = created.directory

    const chosen = await chooseBranch(
      worktreeDirectory,
      `${kind === "pull" ? config.actions.branchPrefix.pr : config.actions.branchPrefix.issue}${number}`,
      options,
    )
    if (!chosen) {
      try {
        await options.ctx.worktree.remove({
          projectID: options.ctx.location.project.id,
          directory: worktreeDirectory,
          force: false,
        })
      } catch {
        // Keep the detached worktree; a later launch can still reuse or remove it.
      }
      return fail(options, "branch-failed", "Could not create a local branch for this item.")
    }
    branch = chosen
    reused = false
  }

  if (!reused && sameRepository && item.kind === "pull") {
    await optionalGit(
      ["branch", "--set-upstream-to", `${repo.remote}/${item.headRefName}`, branch],
      worktreeDirectory,
      options.signal,
      options.env,
    )
  }

  const subpath = await computeSubpath(options, worktreeDirectory)
  const sessionDirectory = resolveInside(worktreeDirectory, subpath) ?? worktreeDirectory
  const behind = await behindCount(worktreeDirectory, startRef, options)

  const checkedOut = true
  const context = options.item
    ? options.item.kind === "pull"
      ? buildPullContext(
          options.item,
          repo.nameWithOwner,
          contextOptions(options, checkedOut, worktreeDirectory, branch, behind),
        )
      : buildIssueContext(
          options.item,
          repo.nameWithOwner,
          contextOptions(options, checkedOut, worktreeDirectory, branch, behind),
        )
    : buildMinimalContext(
        kind,
        number,
        repo.nameWithOwner,
        url,
        contextOptions(options, checkedOut, worktreeDirectory, branch, behind),
      )

  const description = options.item ? contextDescription(options.item) : `${kind === "pull" ? "PR" : "Issue"} #${number}`

  try {
    const stored: StoredWorktree = {
      directory: worktreeDirectory,
      branch,
      base,
      subpath,
      updatedAt: Date.now(),
    }
    await options.ctx.storage.set(key, { ...stored })
  } catch {
    // The worktree map is a reuse optimization. Do not fail a launch that
    // otherwise succeeded; a retry may create one extra worktree.
  }

  return {
    ...emptyLaunchResult(kind, number, "ok", ""),
    ok: true,
    repository: repositoryOf(options),
    title: options.item?.title || `${kind === "pull" ? "PR" : "Issue"} #${number}`,
    url,
    branch,
    base,
    worktree: worktreeDirectory,
    subpath,
    sessionDirectory,
    reused,
    context,
    description,
  }
}
