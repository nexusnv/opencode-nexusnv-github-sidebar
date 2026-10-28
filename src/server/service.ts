import type { GithubSidebarConfig, ParsedConfig } from "../config.js"
import { effectiveView } from "../config.js"
import { graphqlEndpoint } from "../shared/remote.js"
import type {
  IssueView,
  LaunchKind,
  LaunchResult,
  PullView,
  RepoRef,
  SummaryData,
  SummaryResponse,
} from "../shared/types.js"
import { emptyLaunchResult } from "../shared/types.js"
import { VERSION } from "../shared/version.js"
import type { AuthContext } from "./auth.js"
import { invalidateAuthCache, resolveAuth, tokenFingerprint } from "./auth.js"
import { SummaryCache } from "./cache.js"
import { GithubRequestError, githubGraphql, type FetchLike } from "./github.js"
import { prepareLaunch, type LaunchServerContext } from "./launch.js"
import {
  normalizeLaunchIssue,
  normalizeLaunchPull,
  normalizeSidebar,
  type LaunchIssueItem,
  type LaunchPullItem,
} from "./normalize.js"
import { LAUNCH_ISSUE_QUERY, LAUNCH_PULL_QUERY, SIDEBAR_QUERY } from "./query.js"
import { detectRepo, type DetectedRepo } from "./repo.js"

const USER_AGENT = `opencode-nexusnv-github-sidebar/${VERSION}`

export interface ServiceContext extends AuthContext, LaunchServerContext {
  readonly location: {
    readonly directory: string
    readonly project: { readonly id: string; readonly directory: string }
  }
}

export interface ServiceDeps {
  readonly env?: NodeJS.ProcessEnv
  readonly fetchImpl?: FetchLike
  readonly now?: () => number
}

interface CachedSummary {
  readonly selected: SummaryData
  readonly full: SummaryData
  readonly isPrivate: boolean
}

interface LastSummary {
  readonly data: SummaryData
  readonly isPrivate: boolean
  readonly fetchedAt: number
}

class NotFoundError extends Error {}

function repoRef(repo: DetectedRepo, isPrivate = false): RepoRef {
  return {
    host: repo.host,
    owner: repo.owner,
    name: repo.name,
    nameWithOwner: repo.nameWithOwner,
    url: repo.url,
    isPrivate,
  }
}

function summaryResponse(options: {
  readonly config: GithubSidebarConfig
  readonly status: SummaryResponse["status"]
  readonly message?: string
  readonly repository?: RepoRef
  readonly data?: SummaryData
  readonly fetchedAt?: number
  readonly retryAt?: string
}): SummaryResponse {
  return {
    status: options.status,
    message: options.message ?? "",
    view: effectiveView(options.config),
    ...(options.repository ? { repository: options.repository } : {}),
    ...(options.data ? { data: options.data } : {}),
    fetchedAt: options.fetchedAt ?? 0,
    retryAt: options.retryAt ?? "",
  }
}

function launchFailure(
  kind: LaunchKind,
  number: number,
  code: LaunchResult["code"],
  message: string,
  repository?: {
    readonly host: string
    readonly nameWithOwner: string
    readonly url: string
    readonly isPrivate: boolean
  },
): LaunchResult {
  const result = emptyLaunchResult(kind, number, code, message)
  return repository ? { ...result, repository } : result
}

export class GithubSidebarService {
  private readonly ctx: ServiceContext
  private readonly parsed: ParsedConfig
  private readonly config: GithubSidebarConfig
  private readonly cache: SummaryCache<CachedSummary>
  private readonly lastSummary = new Map<string, LastSummary>()
  private readonly deps: ServiceDeps

  constructor(ctx: ServiceContext, parsed: ParsedConfig, deps: ServiceDeps = {}) {
    this.ctx = ctx
    this.parsed = parsed
    this.config = parsed.config
    this.deps = deps
    this.cache = new SummaryCache<CachedSummary>(deps.now)
  }

  private repoKey(repo: DetectedRepo): string {
    return `${repo.host}/${repo.owner}/${repo.name}`
  }

  private async detect(signal: AbortSignal) {
    return detectRepo({
      directory: this.ctx.location.directory,
      remote: this.config.remote,
      hosts: this.config.hosts,
      signal,
      ...(this.deps.env ? { env: this.deps.env } : {}),
    })
  }

  private async graphql<T>(
    repo: DetectedRepo,
    token: string,
    query: string,
    variables: Readonly<Record<string, unknown>>,
    signal: AbortSignal,
  ): Promise<T> {
    return githubGraphql<T>({
      endpoint: graphqlEndpoint(repo.host, this.config.apiUrl),
      token,
      query,
      variables,
      timeoutMs: this.config.timeoutMs,
      userAgent: USER_AGENT,
      signal,
      ...(this.deps.fetchImpl ? { fetchImpl: this.deps.fetchImpl } : {}),
    })
  }

  async summary(
    input: { readonly force: boolean; readonly full?: boolean },
    signal: AbortSignal,
  ): Promise<SummaryResponse> {
    if (this.parsed.errors.length > 0) {
      return summaryResponse({
        config: this.config,
        status: "error",
        message: `Configuration error: ${this.parsed.errors[0]}`,
      })
    }
    if (!this.config.enabled) {
      return summaryResponse({ config: this.config, status: "disabled" })
    }

    const detection = await this.detect(signal)
    if (detection.status === "no-git") {
      return summaryResponse({ config: this.config, status: "no-git", message: "Not a git repository" })
    }
    if (detection.status === "no-remote") {
      return summaryResponse({ config: this.config, status: "no-remote", message: "No git remote" })
    }
    if (detection.status === "malformed-remote") {
      return summaryResponse({
        config: this.config,
        status: "no-remote",
        message: "The git remote is not a supported GitHub URL",
      })
    }
    if (detection.status === "unsupported-host") {
      return summaryResponse({
        config: this.config,
        status: "unsupported-host",
        message: `Host is not in the allowlist: ${detection.host}`,
      })
    }

    const repo = detection.repo
    const repository = repoRef(repo)
    const auth = await resolveAuth(this.ctx, this.config, repo.host, signal, { force: input.force })
    if (!auth.token) {
      return summaryResponse({
        config: this.config,
        status: "no-auth",
        message: "GitHub token not set",
        repository,
      })
    }

    const token = auth.token
    const branch = repo.branch ?? ""
    const key = `${this.repoKey(repo)}#${branch}#${tokenFingerprint(token)}`

    try {
      const hit = await this.cache.get({
        key,
        ttlMs: this.config.refreshSeconds * 1000,
        staleMs: this.config.staleSeconds,
        force: input.force,
        load: async () => {
          const body = await this.graphql<unknown>(
            repo,
            token,
            SIDEBAR_QUERY,
            {
              owner: repo.owner,
              name: repo.name,
              branch,
              hasBranch: this.config.branchPr && branch.length > 0,
              prLimit: this.config.fetchLimit,
              issueLimit: this.config.fetchLimit,
            },
            signal,
          )
          const normalized = normalizeSidebar(body, repository, this.config)
          if (!normalized.ok) throw new NotFoundError()
          return {
            selected: { ...normalized.data, branch },
            full: { ...normalized.full, branch },
            isPrivate: normalized.isPrivate,
          }
        },
      })

      const effectiveRepo: RepoRef = { ...repository, isPrivate: hit.value.isPrivate }
      this.lastSummary.set(this.repoKey(repo), {
        data: hit.value.full,
        isPrivate: hit.value.isPrivate,
        fetchedAt: hit.fetchedAt,
      })
      return summaryResponse({
        config: this.config,
        status: hit.stale ? "stale" : "ready",
        message: hit.stale ? "Showing cached data" : "",
        repository: effectiveRepo,
        data: input.full === true ? hit.value.full : hit.value.selected,
        fetchedAt: hit.fetchedAt,
      })
    } catch (error) {
      if (signal.aborted) throw error

      if (error instanceof NotFoundError) {
        return summaryResponse({
          config: this.config,
          status: "not-found",
          message: "Repository not found or no access",
          repository,
        })
      }

      if (error instanceof GithubRequestError) {
        if (error.code === "unauthorized" || error.code === "forbidden") {
          invalidateAuthCache(this.ctx.location.directory, repo.host)
          return summaryResponse({
            config: this.config,
            status: "unauthorized",
            message:
              error.code === "unauthorized" ? "GitHub token is invalid" : "GitHub denied access to this repository",
            repository,
          })
        }
        if (error.code === "not-found") {
          return summaryResponse({
            config: this.config,
            status: "not-found",
            message: "Repository not found or no access",
            repository,
          })
        }
        if (error.code === "rate-limited") {
          return summaryResponse({
            config: this.config,
            status: "rate-limited",
            message: "GitHub rate limit reached",
            repository,
            ...(error.retryAt ? { retryAt: error.retryAt } : {}),
          })
        }
        if (error.code === "network") {
          return summaryResponse({
            config: this.config,
            status: "network",
            message: "GitHub is unreachable",
            repository,
          })
        }
      }

      return summaryResponse({
        config: this.config,
        status: "error",
        message: "GitHub request failed",
        repository,
      })
    }
  }

  private cachedItem(
    repo: DetectedRepo,
    kind: LaunchKind,
    number: number,
  ): LaunchPullItem | LaunchIssueItem | undefined {
    const summary = this.lastSummary.get(this.repoKey(repo))
    if (!summary) return undefined
    const data = summary.data
    if (kind === "pull") {
      const pull: PullView | undefined =
        data.pulls.find((entry) => entry.number === number) ??
        (data.branchPr?.number === number ? data.branchPr : undefined)
      if (!pull) return undefined
      return {
        kind: "pull",
        number: pull.number,
        title: pull.title,
        body: "",
        author: pull.author,
        url: pull.url,
        headRefName: pull.headRefName,
        headRefOid: "",
        baseRefName: "",
        isCrossRepository: pull.isCrossRepository,
        headRepositoryOwner: pull.headRepositoryOwner,
        isDraft: pull.isDraft,
        state: "",
        merge: pull.merge,
        ci: pull.ci,
        comments: pull.comments,
        reviews: pull.reviews,
        defaultBranch: data.defaultBranch,
      }
    }

    const issue: IssueView | undefined = data.issues.find((entry) => entry.number === number)
    if (!issue) return undefined
    return {
      kind: "issue",
      number: issue.number,
      title: issue.title,
      body: "",
      author: issue.author,
      url: issue.url,
      assignees: issue.assignees,
      labels: issue.labels,
      comments: issue.comments,
      state: "",
      defaultBranch: data.defaultBranch,
    }
  }

  async prepare(
    input: { readonly kind: LaunchKind; readonly number: number },
    signal: AbortSignal,
  ): Promise<LaunchResult> {
    if (this.parsed.errors.length > 0) {
      return launchFailure(input.kind, input.number, "disabled", `Configuration error: ${this.parsed.errors[0]}`)
    }
    if (!this.config.enabled || !this.config.actions.enabled) {
      return launchFailure(input.kind, input.number, "disabled", "GitHub actions are disabled in configuration.")
    }

    const detection = await this.detect(signal)
    if (detection.status !== "ok") {
      const code =
        detection.status === "no-git"
          ? "no-git"
          : detection.status === "no-remote" || detection.status === "malformed-remote"
            ? "no-remote"
            : detection.status === "unsupported-host"
              ? "unsupported-host"
              : "disabled"
      const message =
        detection.status === "no-git"
          ? "Not a git repository"
          : detection.status === "no-remote" || detection.status === "malformed-remote"
            ? detection.status === "malformed-remote"
              ? "The git remote is not a supported GitHub URL"
              : "No git remote"
            : detection.status === "unsupported-host"
              ? `Host is not in the allowlist: ${detection.host}`
              : "Could not resolve the repository"
      return launchFailure(input.kind, input.number, code, message)
    }

    const repo = detection.repo
    const cached = this.lastSummary.get(this.repoKey(repo))
    let isPrivate = cached?.isPrivate ?? false
    let repository = repoRef(repo, isPrivate)

    let item: LaunchPullItem | LaunchIssueItem | undefined

    const auth = await resolveAuth(this.ctx, this.config, repo.host, signal)
    if (auth.token) {
      try {
        const body = await this.graphql<unknown>(
          repo,
          auth.token,
          input.kind === "pull" ? LAUNCH_PULL_QUERY : LAUNCH_ISSUE_QUERY,
          { owner: repo.owner, name: repo.name, number: input.number },
          signal,
        )
        const normalized =
          input.kind === "pull"
            ? normalizeLaunchPull(body, repository, input.number)
            : normalizeLaunchIssue(body, repository, input.number)
        if (normalized.ok) {
          item = normalized.item
          isPrivate = normalized.isPrivate
          repository = repoRef(repo, isPrivate)
        } else {
          return launchFailure(input.kind, input.number, "not-found", "Item not found or no access", repository)
        }
      } catch (error) {
        if (signal.aborted) throw error
        // A body-query failure must not block a launch that can proceed from
        // the cached summary or a ref-only checkout.
      }
    }

    if (!item) item = this.cachedItem(repo, input.kind, input.number)

    return prepareLaunch({
      ctx: this.ctx,
      config: this.config,
      repo,
      kind: input.kind,
      number: input.number,
      item,
      isPrivate,
      signal,
      ...(this.deps.env ? { env: this.deps.env } : {}),
    })
  }
}
