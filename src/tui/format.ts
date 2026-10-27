import { CI_META, MERGE_LABEL } from "../shared/status.js"
import type { Ci, Glyphs, IssueView, LaunchKind, PullView, SectionName, SummaryStatus } from "../shared/types.js"

export interface GlyphSet {
  readonly branch: string
  readonly linked: string
  readonly unlinked: string
  readonly refresh: string
  readonly busy: string
  readonly browser: string
  readonly down: string
  readonly right: string
  readonly rule: string
  readonly ci: Readonly<Record<Ci, string>>
}

const ASCII_CI: Readonly<Record<Ci, string>> = {
  pass: CI_META.pass.ascii,
  fail: CI_META.fail.ascii,
  run: CI_META.run.ascii,
  wait: CI_META.wait.ascii,
  none: CI_META.none.ascii,
  unknown: CI_META.unknown.ascii,
}

const UNICODE_CI: Readonly<Record<Ci, string>> = {
  pass: CI_META.pass.glyph,
  fail: CI_META.fail.glyph,
  run: CI_META.run.glyph,
  wait: CI_META.wait.glyph,
  none: CI_META.none.glyph,
  unknown: CI_META.unknown.glyph,
}

export function glyphSet(mode: Glyphs): GlyphSet {
  if (mode === "ascii") {
    return {
      branch: "*",
      linked: "o",
      unlinked: "+",
      refresh: "r",
      busy: "...",
      browser: "b",
      down: "v",
      right: ">",
      rule: "-",
      ci: ASCII_CI,
    }
  }
  return {
    branch: "◆",
    linked: "●",
    unlinked: "+",
    refresh: "↻",
    busy: "…",
    browser: "↗",
    down: "▾",
    right: "▸",
    rule: "─",
    ci: UNICODE_CI,
  }
}

export function linkedKey(kind: LaunchKind, number: number): string {
  return `${kind}/${number}`
}

/**
 * Leading row marker: current branch PR, linked root session, or unlinked.
 * Markers are hidden when actions are off because primary click is read-only.
 */
export function rowMarker(options: {
  readonly number: number
  readonly branchNumber: number | undefined
  readonly linked: boolean
  readonly actionsEnabled: boolean
  readonly glyphs: GlyphSet
}): string {
  if (options.branchNumber === options.number) return options.glyphs.branch
  if (!options.actionsEnabled) return " "
  return options.linked ? options.glyphs.linked : options.glyphs.unlinked
}

export function formatCount(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "0"
  return Math.trunc(value).toLocaleString("en-US")
}

export function moreCount(total: number, shown: number): number {
  if (!Number.isFinite(total) || !Number.isFinite(shown)) return 0
  return Math.max(0, Math.trunc(total) - Math.trunc(shown))
}

export function sectionTitle(options: {
  readonly section: SectionName
  readonly total: number
  readonly collapsed: boolean
  readonly totals: boolean
  readonly glyphs: GlyphSet
}): string {
  const chevron = options.collapsed ? options.glyphs.right : options.glyphs.down
  const label = options.section === "pulls" ? "Pull requests" : "Issues"
  return options.totals ? `${chevron} ${label} (${formatCount(options.total)})` : `${chevron} ${label}`
}

export function authorLabel(login: string): string {
  const value = login.trim()
  return value ? `@${value}` : "@ghost"
}

function viewerMatches(value: string, viewer: string): boolean {
  return viewer.length > 0 && value.toLowerCase() === viewer.toLowerCase()
}

export function pullDetail(pull: PullView, viewer: string, glyphs: GlyphSet): string {
  const author = pull.isMine && viewer ? viewer : pull.author
  return [
    `${glyphs.ci[pull.ci]} ${CI_META[pull.ci].label}`,
    MERGE_LABEL[pull.merge],
    `${formatCount(pull.comments)}c`,
    `${formatCount(pull.reviews)}r`,
    authorLabel(author),
  ].join(" · ")
}

export function issueDetail(issue: IssueView, viewer: string, maxLabels: number): string {
  const labels = issue.labels.slice(0, Math.max(0, maxLabels))
  const extra = issue.labels.length - labels.length
  const owner = issue.assignees.some((login) => viewerMatches(login, viewer)) ? "assigned" : authorLabel(issue.author)
  // Label display is explicitly off; do not leak a hidden-label count.
  if (maxLabels <= 0) return [`${formatCount(issue.comments)}c`, owner].join(" · ")
  const parts = [`${formatCount(issue.comments)}c`, ...labels]
  if (extra > 0) parts.push(`+${extra}`)
  parts.push(owner)
  return parts.join(" · ")
}

export function issueStatusText(options: {
  readonly status: SummaryStatus
  readonly message: string
  readonly retryAt: string
}): string {
  if (options.status === "no-auth") return "GitHub token not set · /connect"
  if (options.status === "unauthorized") return "GitHub token invalid · /connect"
  if (options.status === "not-found") return "Repository not found or no access"
  if (options.status === "rate-limited") {
    const retry = formatRetryAt(options.retryAt)
    return retry ? `Rate limited · retry ${retry}` : "Rate limited"
  }
  if (options.status === "network") return "GitHub is unreachable · retry"
  if (options.status === "no-git") return "Not a git repository"
  if (options.status === "no-remote") return "No git remote"
  if (options.status === "unsupported-host") return "Not a GitHub repository"
  if (options.status === "disabled") return ""
  return options.message.trim() || "GitHub request failed"
}

export function formatRetryAt(value: string): string {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  try {
    return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(date)
  } catch {
    return ""
  }
}

export function sessionTitle(kind: LaunchKind, number: number, title: string): string {
  const prefix = kind === "pull" ? "PR" : "Issue"
  const clean = title.replace(/\s+/g, " ").trim()
  const clipped = clean.length > 60 ? `${clean.slice(0, 57)}...` : clean
  return clipped ? `${prefix} #${number} · ${clipped}` : `${prefix} #${number}`
}

export function branchLabel(branch: string): string {
  return branch.trim() || "detached"
}
