import type {
  Ci,
  EffectiveView,
  IssueView,
  LaunchKind,
  LaunchResult,
  Merge,
  PullView,
  RateLimitView,
  RepoRef,
  Scope,
  SectionName,
  SummaryData,
  SummaryResponse,
  SummaryStatus,
} from "./types.js"

/**
 * Runtime validation for values crossing the RPC boundary.
 *
 * The contract uses portable JSON Schema, so the generated client type is
 * `unknown`. These validators are intentionally hand-written and strict: a
 * malformed row should be dropped or turn into an error state, never rendered
 * as trusted text.
 */

export interface SummaryInput {
  readonly force: boolean
}

export interface LaunchInput {
  readonly kind: LaunchKind
  readonly number: number
}

export function parseSummaryInput(value: unknown): SummaryInput {
  if (!isRecord(value) || typeof value.force !== "boolean") {
    throw new TypeError("summary input must be { force: boolean }")
  }
  return { force: value.force }
}

export function parseLaunchInput(value: unknown): LaunchInput {
  if (!isRecord(value)) throw new TypeError("prepareLaunch input must be an object")
  const kind = value.kind
  const number = value.number
  if (kind !== "pull" && kind !== "issue") throw new TypeError("prepareLaunch.kind must be pull or issue")
  if (!isNonNegativeInteger(number) || number <= 0) {
    throw new TypeError("prepareLaunch.number must be a positive integer")
  }
  return { kind, number }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === "string"
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean"
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function isNonNegativeInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value >= 0
}

function isArrayOf<Value>(value: unknown, guard: (entry: unknown) => entry is Value): value is readonly Value[] {
  return Array.isArray(value) && value.every(guard)
}

const CI_VALUES: readonly Ci[] = ["pass", "fail", "run", "wait", "none", "unknown"]
const MERGE_VALUES: readonly Merge[] = [
  "ready",
  "blocked",
  "changes",
  "conflict",
  "behind",
  "unstable",
  "review",
  "draft",
  "hooks",
  "mergeable",
  "unknown",
]
const SCOPE_VALUES: readonly Scope[] = ["auto", "mine", "all"]
const SECTION_VALUES: readonly SectionName[] = ["pulls", "issues"]
const SUMMARY_STATUS_VALUES: readonly SummaryStatus[] = [
  "ready",
  "stale",
  "disabled",
  "no-git",
  "no-remote",
  "unsupported-host",
  "no-auth",
  "unauthorized",
  "not-found",
  "rate-limited",
  "network",
  "error",
]
const LAUNCH_CODE_VALUES: readonly LaunchResult["code"][] = [
  "ok",
  "disabled",
  "no-git",
  "no-remote",
  "unsupported-host",
  "worktree-disabled",
  "no-default-branch",
  "not-found",
  "fetch-failed",
  "worktree-failed",
  "branch-failed",
  "store-failed",
]

function isOneOf<Value extends string>(value: unknown, allowed: readonly Value[]): value is Value {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
}

export function isPullView(value: unknown): value is PullView {
  if (!isRecord(value)) return false
  return (
    isNonNegativeInteger(value.number) &&
    isString(value.title) &&
    isString(value.url) &&
    isBoolean(value.isDraft) &&
    isBoolean(value.isCrossRepository) &&
    isString(value.headRefName) &&
    isString(value.headRepositoryOwner) &&
    isString(value.author) &&
    isBoolean(value.isMine) &&
    isNonNegativeInteger(value.comments) &&
    isNonNegativeInteger(value.reviews) &&
    isOneOf<Ci>(value.ci, CI_VALUES) &&
    isOneOf<Merge>(value.merge, MERGE_VALUES) &&
    isString(value.updatedAt)
  )
}

export function isIssueView(value: unknown): value is IssueView {
  if (!isRecord(value)) return false
  return (
    isNonNegativeInteger(value.number) &&
    isString(value.title) &&
    isString(value.url) &&
    isString(value.author) &&
    isArrayOf(value.assignees, isString) &&
    isBoolean(value.isMine) &&
    isNonNegativeInteger(value.comments) &&
    isArrayOf(value.labels, isString) &&
    isString(value.updatedAt)
  )
}

export function isRepoRef(value: unknown): value is RepoRef {
  if (!isRecord(value)) return false
  return (
    isString(value.host) &&
    isString(value.owner) &&
    isString(value.name) &&
    isString(value.nameWithOwner) &&
    isString(value.url) &&
    isBoolean(value.isPrivate)
  )
}

function isRateLimit(value: unknown): value is RateLimitView {
  return (
    isRecord(value) &&
    isNonNegativeInteger(value.cost) &&
    isNonNegativeInteger(value.remaining) &&
    isString(value.resetAt)
  )
}

function isSectionList(value: unknown): value is readonly SectionName[] {
  return isArrayOf(value, (entry): entry is SectionName => isOneOf(entry, SECTION_VALUES))
}

export function isEffectiveView(value: unknown): value is EffectiveView {
  if (!isRecord(value)) return false
  const pulls = value.pulls
  const issues = value.issues
  const actions = value.actions
  const display = value.display
  return (
    isOneOf<Scope>(value.scope, SCOPE_VALUES) &&
    isNonNegativeInteger(value.autoAllThreshold) &&
    isRecord(pulls) &&
    isBoolean(pulls.enabled) &&
    isNonNegativeInteger(pulls.limit) &&
    isRecord(issues) &&
    isBoolean(issues.enabled) &&
    isNonNegativeInteger(issues.limit) &&
    isNonNegativeInteger(issues.labels) &&
    isRecord(actions) &&
    isBoolean(actions.enabled) &&
    isBoolean(actions.confirm) &&
    isBoolean(actions.worktree) &&
    isBoolean(actions.issueWorktree) &&
    isBoolean(actions.focusTabs) &&
    isRecord(display) &&
    isBoolean(display.header) &&
    isBoolean(display.totals) &&
    isSectionList(display.order) &&
    isSectionList(display.collapsed) &&
    (display.glyphs === "unicode" || display.glyphs === "ascii") &&
    isBoolean(display.showUnavailable) &&
    isNonNegativeInteger(value.refreshSeconds)
  )
}

function isSummaryData(value: unknown): value is SummaryData {
  if (!isRecord(value)) return false
  return (
    isString(value.viewer) &&
    isString(value.branch) &&
    isString(value.defaultBranch) &&
    (!Object.hasOwn(value, "branchPr") || isPullView(value.branchPr)) &&
    isArrayOf(value.pulls, isPullView) &&
    isArrayOf(value.issues, isIssueView) &&
    isRecord(value.totals) &&
    isNonNegativeInteger(value.totals.pulls) &&
    isNonNegativeInteger(value.totals.issues) &&
    (!Object.hasOwn(value, "rateLimit") || isRateLimit(value.rateLimit))
  )
}

export function isSummaryResponse(value: unknown): value is SummaryResponse {
  if (!isRecord(value)) return false
  return (
    isOneOf<SummaryStatus>(value.status, SUMMARY_STATUS_VALUES) &&
    isString(value.message) &&
    isEffectiveView(value.view) &&
    (!Object.hasOwn(value, "repository") || isRepoRef(value.repository)) &&
    (!Object.hasOwn(value, "data") || isSummaryData(value.data)) &&
    isFiniteNumber(value.fetchedAt) &&
    isString(value.retryAt)
  )
}

export function isLaunchResult(value: unknown): value is LaunchResult {
  if (!isRecord(value)) return false
  const repository = value.repository
  return (
    isBoolean(value.ok) &&
    isOneOf<LaunchResult["code"]>(value.code, LAUNCH_CODE_VALUES) &&
    isString(value.message) &&
    (value.kind === "pull" || value.kind === "issue") &&
    isNonNegativeInteger(value.number) &&
    isRecord(repository) &&
    isString(repository.host) &&
    isString(repository.nameWithOwner) &&
    isString(repository.url) &&
    isBoolean(repository.isPrivate) &&
    isString(value.title) &&
    isString(value.url) &&
    isString(value.branch) &&
    isString(value.base) &&
    isString(value.worktree) &&
    isString(value.subpath) &&
    isString(value.sessionDirectory) &&
    isBoolean(value.reused) &&
    isString(value.context) &&
    isString(value.description)
  )
}
