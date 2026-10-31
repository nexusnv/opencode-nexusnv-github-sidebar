/**
 * Stable values shared by the server, the RPC contract, and the TUI.
 *
 * Keep this file free of runtime dependencies where possible. The JSON Schemas
 * in `src/rpc.ts` mirror these types; a change here usually needs a matching
 * schema change.
 */

export type Ci = "pass" | "fail" | "run" | "wait" | "none" | "unknown"

export type Merge =
  | "ready"
  | "blocked"
  | "changes"
  | "conflict"
  | "behind"
  | "unstable"
  | "review"
  | "draft"
  | "hooks"
  | "mergeable"
  | "unknown"

export type Scope = "auto" | "mine" | "all"

export type Glyphs = "unicode" | "ascii"

export type SectionName = "pulls" | "issues"

export type SummaryStatus =
  | "ready"
  | "stale"
  | "disabled"
  | "no-git"
  | "no-remote"
  | "unsupported-host"
  | "no-auth"
  | "unauthorized"
  | "not-found"
  | "rate-limited"
  | "network"
  | "error"

export interface RepoRef {
  readonly host: string
  readonly owner: string
  readonly name: string
  readonly nameWithOwner: string
  readonly url: string
  readonly isPrivate: boolean
}

export interface PullView {
  readonly number: number
  readonly title: string
  readonly url: string
  readonly isDraft: boolean
  readonly isCrossRepository: boolean
  readonly headRefName: string
  readonly headRepositoryOwner: string
  readonly author: string
  readonly isMine: boolean
  readonly comments: number
  readonly reviews: number
  readonly ci: Ci
  readonly merge: Merge
  readonly updatedAt: string
}

export interface IssueView {
  readonly number: number
  readonly title: string
  readonly url: string
  readonly author: string
  readonly assignees: readonly string[]
  readonly isMine: boolean
  readonly comments: number
  readonly labels: readonly string[]
  readonly updatedAt: string
}

export interface EffectiveView {
  readonly scope: Scope
  readonly autoAllThreshold: number
  readonly pulls: { readonly enabled: boolean; readonly limit: number }
  readonly issues: { readonly enabled: boolean; readonly limit: number; readonly labels: number }
  readonly actions: {
    readonly enabled: boolean
    readonly confirm: boolean
    readonly worktree: boolean
    readonly issueWorktree: boolean
    readonly focusTabs: boolean
  }
  readonly display: {
    readonly header: boolean
    readonly totals: boolean
    readonly order: readonly SectionName[]
    readonly collapsed: readonly SectionName[]
    readonly glyphs: Glyphs
    readonly showUnavailable: boolean
  }
  readonly refreshSeconds: number
}

export interface RateLimitView {
  readonly cost: number
  readonly remaining: number
  readonly resetAt: string
}

export interface SummaryData {
  readonly viewer: string
  readonly branch: string
  readonly defaultBranch: string
  readonly branchPr?: PullView
  readonly pulls: readonly PullView[]
  readonly issues: readonly IssueView[]
  readonly totals: { readonly pulls: number; readonly issues: number }
  readonly rateLimit?: RateLimitView
}

export interface SummaryResponse {
  readonly status: SummaryStatus
  readonly message: string
  readonly view: EffectiveView
  readonly repository?: RepoRef
  readonly data?: SummaryData
  readonly fetchedAt: number
  readonly retryAt: string
}

export type LaunchKind = "pull" | "issue"

/** JSON-compatible value accepted by the host's plugin storage. */
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue }

export type LaunchCode =
  | "ok"
  | "disabled"
  | "no-git"
  | "no-remote"
  | "unsupported-host"
  | "worktree-disabled"
  | "no-default-branch"
  | "not-found"
  | "fetch-failed"
  | "worktree-failed"
  | "branch-failed"
  | "store-failed"

export interface LaunchRepository {
  readonly host: string
  readonly nameWithOwner: string
  readonly url: string
  readonly isPrivate: boolean
}

export interface LaunchResult {
  readonly ok: boolean
  readonly code: LaunchCode
  readonly message: string
  readonly kind: LaunchKind
  readonly number: number
  readonly repository: LaunchRepository
  readonly title: string
  readonly url: string
  readonly branch: string
  readonly base: string
  readonly worktree: string
  readonly subpath: string
  readonly sessionDirectory: string
  readonly reused: boolean
  readonly context: string
  readonly description: string
}

export const EMPTY_LAUNCH_REPOSITORY: LaunchRepository = {
  host: "",
  nameWithOwner: "",
  url: "",
  isPrivate: false,
}

export function emptyLaunchResult(kind: LaunchKind, number: number, code: LaunchCode, message: string): LaunchResult {
  return {
    ok: false,
    code,
    message,
    kind,
    number,
    repository: EMPTY_LAUNCH_REPOSITORY,
    title: "",
    url: "",
    branch: "",
    base: "",
    worktree: "",
    subpath: "",
    sessionDirectory: "",
    reused: false,
    context: "",
    description: "",
  }
}
