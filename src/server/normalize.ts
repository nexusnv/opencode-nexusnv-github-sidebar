/* oxlint-disable eslint/no-control-regex -- sanitizers must strip control characters */
import type { GithubSidebarConfig } from "../config.js"
import { mapCi, mapMerge } from "../shared/status.js"
import type { Ci, IssueView, Merge, PullView, RateLimitView, RepoRef, SummaryData } from "../shared/types.js"

interface LoginNode {
  readonly login?: unknown
}

interface PullNode {
  readonly number?: unknown
  readonly title?: unknown
  readonly isDraft?: unknown
  readonly isCrossRepository?: unknown
  readonly headRefName?: unknown
  readonly headRefOid?: unknown
  readonly headRepositoryOwner?: LoginNode | null
  readonly author?: LoginNode | null
  readonly mergeable?: unknown
  readonly mergeStateStatus?: unknown
  readonly reviewDecision?: unknown
  readonly updatedAt?: unknown
  readonly comments?: { readonly totalCount?: unknown } | null
  readonly reviews?: { readonly totalCount?: unknown } | null
  readonly statusCheckRollup?: { readonly state?: unknown } | null
}

interface IssueNode {
  readonly number?: unknown
  readonly title?: unknown
  readonly updatedAt?: unknown
  readonly author?: LoginNode | null
  readonly assignees?: { readonly nodes?: readonly (LoginNode | null)[] | null } | null
  readonly comments?: { readonly totalCount?: unknown } | null
  readonly labels?: {
    readonly nodes?: readonly ({ readonly name?: unknown; readonly color?: unknown } | null)[] | null
  } | null
}

interface SidebarBody {
  readonly viewer?: LoginNode | null
  readonly rateLimit?: { readonly cost?: unknown; readonly remaining?: unknown; readonly resetAt?: unknown } | null
  readonly repository?: {
    readonly isPrivate?: unknown
    readonly defaultBranchRef?: { readonly name?: unknown } | null
    readonly pullRequests?: {
      readonly totalCount?: unknown
      readonly nodes?: readonly (PullNode | null)[] | null
    } | null
    readonly branchPr?: { readonly nodes?: readonly (PullNode | null)[] | null } | null
    readonly issues?: { readonly totalCount?: unknown; readonly nodes?: readonly (IssueNode | null)[] | null } | null
  } | null
}

const ANSI = /\u001B(?:\][^\u0007]*(?:\u0007|\u001B\\)|\[[0-?]*[ -/]*[@-~]|[@-_])/g
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g

export function stripAnsi(value: string): string {
  // The control class removes any incomplete escape sequence left behind.
  return value.replace(ANSI, "").replace(CONTROL, "")
}

export function sanitizeText(value: unknown, maxLength = 500): string {
  if (typeof value !== "string") return ""
  return stripAnsi(value).replace(/\s+/g, " ").trim().slice(0, maxLength)
}

/** Bodies keep line structure but lose terminal escapes and HTML comments. */
export function sanitizeBody(value: unknown): string {
  if (typeof value !== "string") return ""
  return stripAnsi(value)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

export function sanitizeLogin(value: unknown): string {
  if (typeof value !== "string") return ""
  const login = value.trim().slice(0, 100)
  return /^[A-Za-z0-9._[\]-]+$/.test(login) ? login : ""
}

export function safeCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return 0
  return Math.min(1_000_000_000, Math.trunc(value))
}

export function safeNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0
  return Math.trunc(value)
}

export function safeDate(value: unknown): string {
  if (typeof value !== "string") return ""
  const text = value.trim()
  return text.length <= 40 && /^[0-9T:.+Z-]+$/i.test(text) ? text : ""
}

export function safeUrl(value: unknown): string {
  if (typeof value !== "string") return ""
  if (/[\s\u0000-\u001f\u007f]/.test(value)) return ""
  try {
    const url = new URL(value)
    return url.protocol === "https:" ? url.toString() : ""
  } catch {
    return ""
  }
}

export function canonicalItemUrl(repo: RepoRef, kind: "pull" | "issue", number: number): string {
  return `${repo.url}/${kind === "pull" ? "pull" : "issues"}/${number}`
}

export function normalizePull(
  node: PullNode,
  viewer: string,
  repo: RepoRef,
  config: GithubSidebarConfig,
): PullView | undefined {
  const number = safeNumber(node.number)
  if (!number) return undefined
  const author = sanitizeLogin(node.author?.login)
  const status = node.statusCheckRollup?.state
  const merge: Merge = mapMerge({
    isDraft: node.isDraft === true,
    mergeable: node.mergeable,
    mergeStateStatus: node.mergeStateStatus,
    reviewDecision: node.reviewDecision,
  })

  return {
    number,
    title: sanitizeText(node.title) || `#${number}`,
    url: canonicalItemUrl(repo, "pull", number),
    isDraft: node.isDraft === true,
    isCrossRepository: node.isCrossRepository === true,
    headRefName: sanitizeText(node.headRefName, 200),
    headRepositoryOwner: sanitizeLogin(node.headRepositoryOwner?.login),
    author,
    isMine: config.mine.pulls === "author" && viewer !== "" && author === viewer,
    comments: safeCount(node.comments?.totalCount),
    reviews: safeCount(node.reviews?.totalCount),
    ci: mapCi(status),
    merge,
    updatedAt: safeDate(node.updatedAt),
  }
}

export function normalizeIssue(
  node: IssueNode,
  viewer: string,
  repo: RepoRef,
  config: GithubSidebarConfig,
): IssueView | undefined {
  const number = safeNumber(node.number)
  if (!number) return undefined
  const author = sanitizeLogin(node.author?.login)
  const assignees = (node.assignees?.nodes ?? [])
    .map((entry) => sanitizeLogin(entry?.login))
    .filter((login) => login.length > 0)
    .slice(0, 10)
  const labels = (node.labels?.nodes ?? [])
    .map((entry) => sanitizeText(entry?.name, 50))
    .filter((label) => label.length > 0)
    .slice(0, 3)
  const mineByAuthor = config.mine.issues !== "assignee" && viewer !== "" && author === viewer
  const mineByAssignee = config.mine.issues !== "author" && viewer !== "" && assignees.includes(viewer)

  return {
    number,
    title: sanitizeText(node.title) || `#${number}`,
    url: canonicalItemUrl(repo, "issue", number),
    author,
    assignees,
    isMine: mineByAuthor || mineByAssignee,
    comments: safeCount(node.comments?.totalCount),
    labels,
    updatedAt: safeDate(node.updatedAt),
  }
}

export type NormalizeSidebarResult =
  | { readonly ok: true; readonly data: SummaryData; readonly full: SummaryData; readonly isPrivate: boolean }
  | { readonly ok: false; readonly reason: "not-found" }

export interface SelectRowsOptions {
  readonly pulls: readonly PullView[]
  readonly issues: readonly IssueView[]
  readonly pullsTotal: number
  readonly issuesTotal: number
  readonly branchPr: PullView | undefined
  readonly config: GithubSidebarConfig
}

export interface SelectedRows {
  readonly pulls: readonly PullView[]
  readonly issues: readonly IssueView[]
}

export interface OrderedRows {
  readonly pulls: readonly PullView[]
  readonly issues: readonly IssueView[]
}

/**
 * Viewer rows first, then everything else. The branch PR is always kept and
 * deduped, even when it is not in the fetched top-N list.
 */
export function orderedRows(options: {
  readonly pulls: readonly PullView[]
  readonly issues: readonly IssueView[]
  readonly branchPr: PullView | undefined
}): OrderedRows {
  const branchNumber = options.branchPr?.number
  return {
    pulls: [
      ...(options.branchPr ? [options.branchPr] : []),
      ...options.pulls.filter((pull) => pull.number !== branchNumber && pull.isMine),
      ...options.pulls.filter((pull) => pull.number !== branchNumber && !pull.isMine),
    ],
    issues: [...options.issues.filter((issue) => issue.isMine), ...options.issues.filter((issue) => !issue.isMine)],
  }
}

/**
 * Apply scope and display limits. Viewer rows are never capped; the limits
 * only bound "other" rows. The branch PR is always kept, even when it is not
 * in the fetched top-N list.
 */
export function selectRows(options: SelectRowsOptions): SelectedRows {
  const branchNumber = options.branchPr?.number
  const { pulls: orderedPulls, issues: orderedIssues } = orderedRows(options)

  const bounded =
    options.config.scope === "mine" ||
    (options.config.scope === "auto" && options.pullsTotal + options.issuesTotal > options.config.autoAllThreshold)

  if (options.config.scope === "all" || !bounded) {
    return {
      pulls: options.config.pulls.enabled ? orderedPulls : [],
      issues: options.config.issues.enabled ? orderedIssues : [],
    }
  }

  if (options.config.scope === "mine") {
    return {
      pulls: options.config.pulls.enabled
        ? orderedPulls.filter((pull) => pull.isMine || pull.number === branchNumber)
        : [],
      issues: options.config.issues.enabled ? orderedIssues.filter((issue) => issue.isMine) : [],
    }
  }

  const otherPulls = orderedPulls.filter((pull) => !pull.isMine && pull.number !== branchNumber)
  const minePulls = orderedPulls.filter((pull) => pull.isMine || pull.number === branchNumber)
  const otherIssues = orderedIssues.filter((issue) => !issue.isMine)
  const mineIssues = orderedIssues.filter((issue) => issue.isMine)

  return {
    pulls: options.config.pulls.enabled ? [...minePulls, ...otherPulls.slice(0, options.config.pulls.limit)] : [],
    issues: options.config.issues.enabled ? [...mineIssues, ...otherIssues.slice(0, options.config.issues.limit)] : [],
  }
}

export function normalizeSidebar(input: unknown, repo: RepoRef, config: GithubSidebarConfig): NormalizeSidebarResult {
  const body = input as SidebarBody
  if (!body || typeof body !== "object" || !body.repository) return { ok: false, reason: "not-found" }

  const viewer = sanitizeLogin(body.viewer?.login)
  const rawPulls = (body.repository.pullRequests?.nodes ?? []).filter(
    (node): node is PullNode => node !== null && typeof node === "object",
  )
  const rawIssues = (body.repository.issues?.nodes ?? []).filter(
    (node): node is IssueNode => node !== null && typeof node === "object",
  )

  const pulls = rawPulls.flatMap((node) => {
    const pull = normalizePull(node, viewer, repo, config)
    return pull ? [pull] : []
  })
  const issues = rawIssues.flatMap((node) => {
    const issue = normalizeIssue(node, viewer, repo, config)
    return issue ? [issue] : []
  })

  const branchNode = (body.repository.branchPr?.nodes ?? []).find(
    (node): node is PullNode => node !== null && typeof node === "object",
  )
  const branchPr = branchNode ? normalizePull(branchNode, viewer, repo, config) : undefined

  const pullsTotal = safeCount(body.repository.pullRequests?.totalCount) || pulls.length
  const issuesTotal = safeCount(body.repository.issues?.totalCount) || issues.length

  const selected = selectRows({ pulls, issues, pullsTotal, issuesTotal, branchPr, config })
  const ordered = orderedRows({ pulls, issues, branchPr })

  const rateLimitRaw = body.rateLimit
  const rateLimit: RateLimitView | undefined = rateLimitRaw
    ? {
        cost: safeCount(rateLimitRaw.cost),
        remaining: safeCount(rateLimitRaw.remaining),
        resetAt: safeDate(rateLimitRaw.resetAt),
      }
    : undefined

  const shared = {
    viewer,
    branch: "",
    defaultBranch: sanitizeText(body.repository.defaultBranchRef?.name, 200),
    ...(branchPr ? { branchPr } : {}),
    totals: { pulls: pullsTotal, issues: issuesTotal },
    ...(rateLimit ? { rateLimit } : {}),
  }

  return {
    ok: true,
    isPrivate: body.repository.isPrivate === true,
    data: {
      ...shared,
      pulls: selected.pulls,
      issues: selected.issues,
    },
    full: {
      ...shared,
      pulls: config.pulls.enabled ? ordered.pulls : [],
      issues: config.issues.enabled ? ordered.issues : [],
    },
  }
}

export interface LaunchPullItem {
  readonly kind: "pull"
  readonly number: number
  readonly title: string
  readonly body: string
  readonly author: string
  readonly url: string
  readonly headRefName: string
  readonly headRefOid: string
  readonly baseRefName: string
  readonly isCrossRepository: boolean
  readonly headRepositoryOwner: string
  readonly isDraft: boolean
  readonly state: string
  readonly merge: Merge
  readonly ci: Ci
  readonly comments: number
  readonly reviews: number
  readonly defaultBranch: string
}

export interface LaunchIssueItem {
  readonly kind: "issue"
  readonly number: number
  readonly title: string
  readonly body: string
  readonly author: string
  readonly url: string
  readonly assignees: readonly string[]
  readonly labels: readonly string[]
  readonly comments: number
  readonly state: string
  readonly defaultBranch: string
}

export type LaunchItem = LaunchPullItem | LaunchIssueItem

interface LaunchPullBody {
  readonly repository?: {
    readonly isPrivate?: unknown
    readonly defaultBranchRef?: { readonly name?: unknown } | null
    readonly pullRequest?:
      | (PullNode & {
          readonly body?: unknown
          readonly baseRefName?: unknown
          readonly state?: unknown
        })
      | null
  } | null
}

interface LaunchIssueBody {
  readonly repository?: {
    readonly isPrivate?: unknown
    readonly defaultBranchRef?: { readonly name?: unknown } | null
    readonly issueOrPullRequest?: {
      readonly __typename?: unknown
      readonly body?: unknown
      readonly state?: unknown
      readonly number?: unknown
      readonly title?: unknown
      readonly url?: unknown
      readonly updatedAt?: unknown
      readonly author?: LoginNode | null
      readonly assignees?: { readonly nodes?: readonly (LoginNode | null)[] | null } | null
      readonly comments?: { readonly totalCount?: unknown } | null
      readonly labels?: { readonly nodes?: readonly ({ readonly name?: unknown } | null)[] | null } | null
    } | null
  } | null
}

export type NormalizeLaunchResult =
  | { readonly ok: true; readonly item: LaunchItem; readonly isPrivate: boolean }
  | { readonly ok: false; readonly reason: "not-found" }

export function normalizeLaunchPull(input: unknown, repo: RepoRef, number: number): NormalizeLaunchResult {
  const body = input as LaunchPullBody
  const node = body?.repository?.pullRequest
  if (!node || typeof node !== "object" || safeNumber(node.number) !== number) {
    return { ok: false, reason: "not-found" }
  }
  const author = sanitizeLogin(node.author?.login)
  const item: LaunchPullItem = {
    kind: "pull",
    number,
    title: sanitizeText(node.title) || `PR #${number}`,
    body: sanitizeBody(node.body),
    author,
    url: canonicalItemUrl(repo, "pull", number),
    headRefName: sanitizeText(node.headRefName, 200),
    headRefOid: sanitizeText(node.headRefOid, 100),
    baseRefName: sanitizeText(node.baseRefName, 200),
    isCrossRepository: node.isCrossRepository === true,
    headRepositoryOwner: sanitizeLogin(node.headRepositoryOwner?.login),
    isDraft: node.isDraft === true,
    state: sanitizeText(node.state, 20).toUpperCase(),
    merge: mapMerge({
      isDraft: node.isDraft === true,
      mergeable: node.mergeable,
      mergeStateStatus: node.mergeStateStatus,
      reviewDecision: node.reviewDecision,
    }),
    ci: mapCi(node.statusCheckRollup?.state),
    comments: safeCount(node.comments?.totalCount),
    reviews: safeCount(node.reviews?.totalCount),
    defaultBranch: sanitizeText(body.repository?.defaultBranchRef?.name, 200),
  }
  return { ok: true, item, isPrivate: body.repository?.isPrivate === true }
}

export function normalizeLaunchIssue(input: unknown, repo: RepoRef, number: number): NormalizeLaunchResult {
  const body = input as LaunchIssueBody
  const node = body?.repository?.issueOrPullRequest
  if (!node || typeof node !== "object" || node.__typename !== "Issue" || safeNumber(node.number) !== number) {
    return { ok: false, reason: "not-found" }
  }

  const assignees = (node.assignees?.nodes ?? [])
    .map((entry) => sanitizeLogin(entry?.login))
    .filter((login) => login.length > 0)
    .slice(0, 10)
  const labels = (node.labels?.nodes ?? [])
    .map((entry) => sanitizeText(entry?.name, 50))
    .filter((label) => label.length > 0)
    .slice(0, 10)

  return {
    ok: true,
    item: {
      kind: "issue",
      number,
      title: sanitizeText(node.title) || `Issue #${number}`,
      body: sanitizeBody(node.body),
      author: sanitizeLogin(node.author?.login),
      url: canonicalItemUrl(repo, "issue", number),
      assignees,
      labels,
      comments: safeCount(node.comments?.totalCount),
      state: sanitizeText(node.state, 20).toUpperCase(),
      defaultBranch: sanitizeText(body.repository?.defaultBranchRef?.name, 200),
    },
    isPrivate: body.repository?.isPrivate === true,
  }
}
