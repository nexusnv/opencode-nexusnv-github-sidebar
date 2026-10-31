import type { Context } from "@opencode/plugin/tui/context"
import type { SessionInfo } from "@opencode/client"
import { GithubSidebarRpc } from "../rpc.js"
import { isLaunchResult } from "../shared/contract.js"
import { requireRpcLocation } from "../shared/location.js"
import type { EffectiveView, LaunchKind, RepoRef } from "../shared/types.js"
import { sessionTitle } from "./format.js"
import { openWithFeedback, type OpenLinks } from "./open.js"

export interface GithubLink {
  readonly host: string
  readonly repo: string
  readonly kind: LaunchKind
  readonly number: number
}

export interface LaunchItem {
  readonly kind: LaunchKind
  readonly number: number
  readonly title: string
  readonly url: string
}

export type LaunchOutcome =
  | { readonly status: "browser"; readonly opened: boolean }
  | { readonly status: "focused"; readonly sessionID: string }
  | { readonly status: "created"; readonly sessionID: string }
  | { readonly status: "cancelled" }
  | { readonly status: "failed"; readonly message: string }

export interface LaunchOptions {
  readonly openLinks?: OpenLinks
  readonly signal?: AbortSignal
  /** Injected for tests; production uses the platform opener. */
  readonly opener?: (url: string) => Promise<unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function messageOf(cause: unknown): string {
  if (cause instanceof Error && cause.message) return cause.message
  if (typeof cause === "string" && cause) return cause
  return "Unknown error"
}

function toastError(context: Context, title: string, message: string): void {
  context.ui.toast.show({ title, message, variant: "error" })
}

function openBrowser(context: Context, url: string, options: LaunchOptions): Promise<boolean> {
  return openWithFeedback(context, url, options.openLinks ?? "auto", options.opener ? { opener: options.opener } : {})
}

/**
 * Read the durable link written at launch time. Session metadata is inherited
 * by children and forks, which is why every lookup also filters to roots.
 */
export function readGithubLink(metadata: unknown): GithubLink | undefined {
  if (!isRecord(metadata)) return undefined
  const link = metadata.githubSidebar
  if (!isRecord(link)) return undefined
  if (typeof link.host !== "string" || !link.host) return undefined
  if (typeof link.repo !== "string" || !link.repo) return undefined
  if (link.kind !== "pull" && link.kind !== "issue") return undefined
  if (typeof link.number !== "number" || !Number.isInteger(link.number) || link.number <= 0) return undefined
  return { host: link.host, repo: link.repo, kind: link.kind, number: link.number }
}

async function rootSessions(context: Context): Promise<readonly SessionInfo[]> {
  const location = requireRpcLocation(context)
  const info = await context.client.location.get({ location })
  const response = await context.client.session.list({
    project: info.project.id,
    parentID: null,
    archived: false,
    limit: 100,
    order: "desc",
  })
  return response.data.filter((session) => !session.parentID)
}

function matches(link: GithubLink | undefined, repo: RepoRef, kind: LaunchKind, number: number): boolean {
  return link?.host === repo.host && link.repo === repo.nameWithOwner && link.kind === kind && link.number === number
}

/**
 * Most recent root session linked to this repository item. The link is
 * repo-level rather than clone-level, so a session created in one checkout can
 * be focused from another checkout of the same remote.
 */
export async function findLinkedSession(
  context: Context,
  repo: RepoRef,
  kind: LaunchKind,
  number: number,
): Promise<SessionInfo | undefined> {
  const sessions = await rootSessions(context)
  return sessions
    .filter((session) => matches(readGithubLink(session.metadata), repo, kind, number))
    .toSorted((a, b) => (b.time.updated ?? 0) - (a.time.updated ?? 0))[0]
}

/** Keys (`pull/7`) for the linked-session markers in the rows. */
export async function loadLinkedKeys(context: Context, repo: RepoRef): Promise<ReadonlySet<string>> {
  const sessions = await rootSessions(context)
  const keys = new Set<string>()
  for (const session of sessions) {
    const link = readGithubLink(session.metadata)
    if (!link || link.host !== repo.host || link.repo !== repo.nameWithOwner) continue
    keys.add(`${link.kind}/${link.number}`)
  }
  return keys
}

/**
 * Focus a root session. Tabs can be disabled; the router is the documented
 * fallback and does not depend on the tab UI being present.
 *
 * Focus is best-effort UI state derived from a click handler. A host UI
 * failure must not become an unhandled rejection, so both paths are guarded.
 */
export function focusSession(context: Context, sessionID: string): boolean {
  try {
    if (context.ui.tabs.focus(sessionID)) return true
  } catch {
    // Fall through to the router.
  }
  try {
    context.ui.router.navigate({ type: "session", sessionID })
    return true
  } catch {
    return false
  }
}

function launchMetadata(
  repo: RepoRef,
  item: LaunchItem,
  prepared: {
    readonly url: string
    readonly branch: string
    readonly base: string
    readonly worktree: string
    readonly subpath: string
    readonly sessionDirectory: string
  },
) {
  return {
    githubSidebar: {
      host: repo.host,
      repo: repo.nameWithOwner,
      kind: item.kind,
      number: item.number,
      url: prepared.url || item.url,
      branch: prepared.branch,
      base: prepared.base,
      worktree: prepared.worktree,
      subpath: prepared.subpath,
      directory: prepared.sessionDirectory,
    },
  }
}

/**
 * Primary click on a row.
 *
 * This function is the TUI's complete launch path: focus a linked session,
 * otherwise ask the server to prepare the checkout and context, then create and
 * focus the session. It never runs git and never sends a remote path over RPC.
 */
export async function launchItem(
  context: Context,
  repo: RepoRef,
  item: LaunchItem,
  actions: EffectiveView["actions"],
  options: LaunchOptions = {},
): Promise<LaunchOutcome> {
  // Read-only mode is a true dashboard: every primary click opens the browser
  // and no session lookup, dialog, RPC, or session creation runs.
  if (!actions.enabled) {
    return { status: "browser", opened: await openBrowser(context, item.url, options) }
  }

  let linked: SessionInfo | undefined
  try {
    linked = await findLinkedSession(context, repo, item.kind, item.number)
  } catch {
    // A lookup failure must not block creating a new session.
  }
  if (linked) {
    focusSession(context, linked.id)
    return { status: "focused", sessionID: linked.id }
  }

  if (actions.confirm) {
    const kindLabel = item.kind === "pull" ? "pull request" : "issue"
    const target =
      actions.worktree && (item.kind === "pull" || actions.issueWorktree)
        ? "a new worktree and OpenCode session"
        : "an OpenCode session in the current workspace"
    let confirmed: boolean | undefined
    try {
      confirmed = await context.ui.dialog.confirm({
        title: "Open in OpenCode",
        message: `${repo.nameWithOwner}\n${kindLabel} #${item.number} · ${item.title}\n\nCreate ${target}?`,
        label: { confirm: "Create", cancel: "Cancel" },
      })
    } catch (cause) {
      const message = messageOf(cause)
      toastError(context, "Could not open the confirmation dialog", message)
      return { status: "failed", message }
    }
    if (!confirmed) return { status: "cancelled" }
  }

  const rpc = context.client.rpc(GithubSidebarRpc)
  let prepared: unknown
  try {
    prepared = await rpc.prepareLaunch(
      { kind: item.kind, number: item.number },
      { location: requireRpcLocation(context), ...(options.signal ? { signal: options.signal } : {}) },
    )
  } catch (cause) {
    if (options.signal?.aborted) return { status: "failed", message: "Cancelled" }
    const message = messageOf(cause)
    toastError(context, "Could not prepare the checkout", message)
    return { status: "failed", message }
  }

  if (!isLaunchResult(prepared)) {
    const message = "The server returned an invalid launch response"
    toastError(context, "Could not open in OpenCode", message)
    return { status: "failed", message }
  }
  if (!prepared.ok) {
    toastError(context, "Could not open in OpenCode", prepared.message || prepared.code)
    return { status: "failed", message: prepared.message || prepared.code }
  }

  let session: SessionInfo
  try {
    session = await context.client.session.create({
      title: sessionTitle(item.kind, item.number, prepared.title || item.title),
      location: { directory: prepared.sessionDirectory },
      metadata: launchMetadata(repo, item, prepared),
    })
  } catch (cause) {
    const message = messageOf(cause)
    toastError(context, "Could not create the OpenCode session", message)
    return { status: "failed", message }
  }

  // The worktree entry is already stored by the server, so retrying reuses it.
  if (prepared.context.trim()) {
    try {
      await context.client.session.synthetic({
        sessionID: session.id,
        text: prepared.context,
        description: prepared.description || sessionTitle(item.kind, item.number, prepared.title),
        metadata: {
          source: "github-sidebar",
          kind: item.kind,
          number: item.number,
          url: prepared.url || item.url,
        },
        resume: false,
      })
    } catch (cause) {
      context.ui.toast.show({
        title: "Session created without GitHub context",
        message: messageOf(cause),
        variant: "warning",
      })
    }
  }

  try {
    await context.data.session.sync(session.id)
  } catch {
    // The data store will pick the session up on its next sync.
  }

  if (actions.focusTabs) focusSession(context, session.id)
  return { status: "created", sessionID: session.id }
}
