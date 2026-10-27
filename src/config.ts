/* oxlint-disable eslint/no-control-regex -- option validation rejects control characters */
import { normalizeAllowlistHost } from "./shared/remote.js"
import type { EffectiveView, Glyphs, Scope, SectionName } from "./shared/types.js"

export interface GithubSidebarConfig {
  readonly enabled: boolean
  readonly hosts: readonly string[]
  readonly remote: string
  readonly branchPr: boolean
  readonly scope: Scope
  readonly autoAllThreshold: number
  readonly mine: {
    readonly pulls: "author"
    readonly issues: "assignee" | "author" | "either"
  }
  readonly fetchLimit: number
  readonly pulls: { readonly enabled: boolean; readonly limit: number }
  readonly issues: { readonly enabled: boolean; readonly limit: number; readonly labels: number }
  readonly actions: {
    readonly enabled: boolean
    readonly confirm: boolean
    readonly worktree: boolean
    readonly issueWorktree: boolean
    readonly branchPrefix: { readonly pr: string; readonly issue: string }
    readonly context: "full" | "summary" | "none"
    readonly bodyLimitBytes: number
    readonly fetchTimeoutMs: number
    readonly reuseWorktree: boolean
    readonly focusTabs: boolean
  }
  readonly refreshSeconds: number
  readonly staleSeconds: number
  readonly timeoutMs: number
  readonly token: string | undefined
  readonly tokenEnv: readonly string[]
  readonly allowGhCli: boolean
  readonly apiUrl: string | undefined
  readonly display: {
    readonly header: boolean
    readonly totals: boolean
    readonly order: readonly SectionName[]
    readonly collapsed: readonly SectionName[]
    readonly glyphs: Glyphs
    readonly showUnavailable: boolean
  }
  readonly debug: boolean
}

export interface ParsedConfig {
  readonly config: GithubSidebarConfig
  /** Configuration mistakes that must block remote calls rather than silently degrade. */
  readonly errors: readonly string[]
}

export const DEFAULT_CONFIG: GithubSidebarConfig = {
  enabled: true,
  hosts: ["github.com"],
  remote: "origin",
  branchPr: true,
  scope: "auto",
  autoAllThreshold: 30,
  mine: { pulls: "author", issues: "either" },
  fetchLimit: 50,
  pulls: { enabled: true, limit: 8 },
  issues: { enabled: true, limit: 5, labels: 1 },
  actions: {
    enabled: true,
    confirm: false,
    worktree: true,
    issueWorktree: true,
    branchPrefix: { pr: "pr-", issue: "issue-" },
    context: "full",
    bodyLimitBytes: 8192,
    fetchTimeoutMs: 60_000,
    reuseWorktree: true,
    focusTabs: true,
  },
  refreshSeconds: 60,
  staleSeconds: 300,
  timeoutMs: 10_000,
  token: undefined,
  tokenEnv: ["GH_TOKEN", "GITHUB_TOKEN"],
  allowGhCli: true,
  apiUrl: undefined,
  display: {
    header: true,
    totals: true,
    order: ["pulls", "issues"],
    collapsed: [],
    glyphs: "unicode",
    showUnavailable: false,
  },
  debug: false,
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

function integer(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

function text(value: unknown, fallback: string, maxLength = 200): string {
  if (typeof value !== "string") return fallback
  return value.trim().slice(0, maxLength) || fallback
}

function oneOf<Value extends string>(value: unknown, allowed: readonly Value[], fallback: Value): Value {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as Value) : fallback
}

function sections(value: unknown, fallback: readonly SectionName[]): readonly SectionName[] {
  if (!Array.isArray(value)) return fallback
  const result: SectionName[] = []
  for (const entry of value) {
    if ((entry === "pulls" || entry === "issues") && !result.includes(entry)) result.push(entry)
  }
  if (result.length === 0 && value.length > 0) return fallback
  return result
}

function envNames(value: unknown, fallback: readonly string[], errors: string[]): readonly string[] {
  if (!Array.isArray(value)) return fallback
  const names: string[] = []
  for (const entry of value) {
    if (typeof entry !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(entry)) {
      errors.push("tokenEnv must contain valid environment variable names")
      continue
    }
    if (!names.includes(entry)) names.push(entry)
  }
  return names.length > 0 ? names : fallback
}

function branchPrefix(value: unknown, fallback: string, errors: string[], option: string): string {
  if (typeof value !== "string") return fallback
  const prefix = value.trim()
  if (!prefix) return fallback
  if (
    prefix.length > 32 ||
    /[\s~^:?*[\\\u0000-\u001f\u007f]/.test(prefix) ||
    prefix.startsWith("-") ||
    prefix.includes("..") ||
    prefix.includes("@{") ||
    prefix.endsWith("/") ||
    prefix.endsWith(".")
  ) {
    errors.push(`${option} is not a valid git branch prefix`)
    return fallback
  }
  return prefix
}

function apiUrl(value: unknown, hosts: readonly string[], errors: string[]): string | undefined {
  if (value === undefined || value === null || value === "") return undefined
  if (typeof value !== "string") {
    errors.push("apiUrl must be a string")
    return undefined
  }
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    errors.push("apiUrl must be a valid absolute URL")
    return undefined
  }
  if (url.protocol !== "https:") {
    errors.push("apiUrl must use https")
    return undefined
  }
  if (url.username || url.password || url.search || url.hash) {
    errors.push("apiUrl must not contain credentials, a query, or a fragment")
    return undefined
  }
  const host = normalizeAllowlistHost(url.hostname)
  if (!host || !hosts.includes(host)) {
    errors.push("apiUrl host must be listed in hosts")
    return undefined
  }
  return url.toString()
}

export function parseConfig(options: Readonly<Record<string, unknown>> | undefined): ParsedConfig {
  const source = record(options)
  const errors: string[] = []

  const rawHosts = Array.isArray(source.hosts) ? source.hosts : undefined
  const hosts: string[] = []
  if (rawHosts) {
    for (const entry of rawHosts) {
      const host = normalizeAllowlistHost(entry)
      if (!host) {
        errors.push("hosts entries must be bare lowercase hostnames without a scheme, port, or path")
        continue
      }
      if (!hosts.includes(host)) hosts.push(host)
    }
  }
  if (hosts.length === 0) hosts.push(...DEFAULT_CONFIG.hosts)

  const remoteRaw = text(source.remote, DEFAULT_CONFIG.remote, 64)
  const remote = /^[A-Za-z0-9._-]+$/.test(remoteRaw) && !remoteRaw.startsWith("-") ? remoteRaw : DEFAULT_CONFIG.remote
  if (remote !== remoteRaw) errors.push("remote must be a git remote name without whitespace")

  const mine = record(source.mine)
  const pullsConfig = record(source.pulls)
  const issuesConfig = record(source.issues)
  const actions = record(source.actions)
  const prefixes = record(actions.branchPrefix)
  const display = record(source.display)

  const rawToken = source.token
  let token: string | undefined
  if (typeof rawToken === "string" && rawToken.trim()) {
    token = rawToken.trim()
    if (/[\s\u0000-\u001f\u007f]/.test(token)) {
      errors.push("token contains whitespace or control characters")
      token = undefined
    }
  }

  const config: GithubSidebarConfig = {
    enabled: bool(source.enabled, DEFAULT_CONFIG.enabled),
    hosts,
    remote,
    branchPr: bool(source.branchPr, DEFAULT_CONFIG.branchPr),
    scope: oneOf(source.scope, ["auto", "mine", "all"] as const, DEFAULT_CONFIG.scope),
    autoAllThreshold: integer(source.autoAllThreshold, 0, 500, DEFAULT_CONFIG.autoAllThreshold),
    mine: {
      pulls: "author",
      issues: oneOf(mine.issues, ["assignee", "author", "either"] as const, DEFAULT_CONFIG.mine.issues),
    },
    fetchLimit: integer(source.fetchLimit, 1, 100, DEFAULT_CONFIG.fetchLimit),
    pulls: {
      enabled: bool(pullsConfig.enabled, DEFAULT_CONFIG.pulls.enabled),
      limit: integer(pullsConfig.limit, 1, 100, DEFAULT_CONFIG.pulls.limit),
    },
    issues: {
      enabled: bool(issuesConfig.enabled, DEFAULT_CONFIG.issues.enabled),
      limit: integer(issuesConfig.limit, 1, 100, DEFAULT_CONFIG.issues.limit),
      labels: integer(issuesConfig.labels, 0, 3, DEFAULT_CONFIG.issues.labels),
    },
    actions: {
      enabled: bool(actions.enabled, DEFAULT_CONFIG.actions.enabled),
      confirm: bool(actions.confirm, DEFAULT_CONFIG.actions.confirm),
      worktree: bool(actions.worktree, DEFAULT_CONFIG.actions.worktree),
      issueWorktree: bool(actions.issueWorktree, DEFAULT_CONFIG.actions.issueWorktree),
      branchPrefix: {
        pr: branchPrefix(prefixes.pr, DEFAULT_CONFIG.actions.branchPrefix.pr, errors, "actions.branchPrefix.pr"),
        issue: branchPrefix(
          prefixes.issue,
          DEFAULT_CONFIG.actions.branchPrefix.issue,
          errors,
          "actions.branchPrefix.issue",
        ),
      },
      context: oneOf(actions.context, ["full", "summary", "none"] as const, DEFAULT_CONFIG.actions.context),
      bodyLimitBytes: integer(actions.bodyLimitBytes, 1024, 65_536, DEFAULT_CONFIG.actions.bodyLimitBytes),
      fetchTimeoutMs: integer(actions.fetchTimeoutMs, 5_000, 120_000, DEFAULT_CONFIG.actions.fetchTimeoutMs),
      reuseWorktree: bool(actions.reuseWorktree, DEFAULT_CONFIG.actions.reuseWorktree),
      focusTabs: bool(actions.focusTabs, DEFAULT_CONFIG.actions.focusTabs),
    },
    refreshSeconds: integer(source.refreshSeconds, 15, 3_600, DEFAULT_CONFIG.refreshSeconds),
    staleSeconds: integer(source.staleSeconds, 0, 3_600, DEFAULT_CONFIG.staleSeconds),
    timeoutMs: integer(source.timeoutMs, 1_000, 60_000, DEFAULT_CONFIG.timeoutMs),
    token,
    tokenEnv: envNames(source.tokenEnv, DEFAULT_CONFIG.tokenEnv, errors),
    allowGhCli: bool(source.allowGhCli, DEFAULT_CONFIG.allowGhCli),
    apiUrl: apiUrl(source.apiUrl, hosts, errors),
    display: {
      header: bool(display.header, DEFAULT_CONFIG.display.header),
      totals: bool(display.totals, DEFAULT_CONFIG.display.totals),
      order:
        Array.isArray(display.order) && display.order.length === 0
          ? []
          : sections(display.order, DEFAULT_CONFIG.display.order),
      collapsed: sections(display.collapsed, DEFAULT_CONFIG.display.collapsed),
      glyphs: oneOf(display.glyphs, ["unicode", "ascii"] as const, DEFAULT_CONFIG.display.glyphs),
      showUnavailable: bool(display.showUnavailable, DEFAULT_CONFIG.display.showUnavailable),
    },
    debug: bool(source.debug, DEFAULT_CONFIG.debug),
  }

  return { config, errors }
}

export function effectiveView(config: GithubSidebarConfig): EffectiveView {
  return {
    scope: config.scope,
    autoAllThreshold: config.autoAllThreshold,
    pulls: { enabled: config.pulls.enabled, limit: config.pulls.limit },
    issues: { enabled: config.issues.enabled, limit: config.issues.limit, labels: config.issues.labels },
    actions: {
      enabled: config.actions.enabled,
      confirm: config.actions.confirm,
      worktree: config.actions.worktree,
      issueWorktree: config.actions.issueWorktree,
      focusTabs: config.actions.focusTabs,
    },
    display: {
      header: config.display.header,
      totals: config.display.totals,
      order: config.display.order,
      collapsed: config.display.collapsed,
      glyphs: config.display.glyphs,
      showUnavailable: config.display.showUnavailable,
    },
    refreshSeconds: config.refreshSeconds,
  }
}
