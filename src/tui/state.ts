import type { Context } from "@opencode/plugin/tui/context"
import { createEffect, createSignal, on, onCleanup } from "solid-js"
import { GithubSidebarRpc } from "../rpc.js"
import { isSummaryResponse } from "../shared/contract.js"
import { SERVER_PLUGIN_ID } from "../shared/ids.js"
import { requireRpcLocation } from "../shared/location.js"
import type { RepoRef, SectionName, SummaryResponse } from "../shared/types.js"
import { loadLinkedKeys } from "./launch.js"

export type SidebarStatus = "loading" | "ready" | "error"

export interface HealthResult {
  readonly ok: boolean
  readonly plugin: string
  readonly location: string
}

/**
 * The RPC contract uses portable JSON Schema, so its client return type is
 * `unknown`. Validate the small health payload at the boundary instead of
 * asserting a shape the server did not actually send.
 */
export function isHealthResult(value: unknown): value is HealthResult {
  if (typeof value !== "object" || value === null) return false
  const result = value as Record<string, unknown>
  return typeof result.ok === "boolean" && typeof result.plugin === "string" && typeof result.location === "string"
}

/**
 * Ask the server half for health and prove that the answer came from the
 * location this sidebar is rendering. A response from another location must
 * never turn the gate green.
 */
export async function checkHealth(context: Context, signal: AbortSignal): Promise<SidebarStatus> {
  const location = requireRpcLocation(context)
  const result = await context.client.rpc(GithubSidebarRpc).health({}, { location, signal })

  if (!isHealthResult(result)) return "error"
  if (result.plugin !== SERVER_PLUGIN_ID) return "error"
  if (result.location !== location.directory) return "error"
  return result.ok ? "ready" : "error"
}

export interface SidebarState {
  readonly gate: () => SidebarStatus
  readonly summary: () => SummaryResponse | undefined
  readonly requestError: () => string | undefined
  readonly refreshing: () => boolean
  readonly linked: () => ReadonlySet<string>
  readonly collapsed: () => readonly SectionName[]
  readonly refresh: (force?: boolean) => void
  readonly toggleSection: (section: SectionName) => void
}

function sameDirectory(left: string | undefined, right: string | undefined): boolean {
  return Boolean(left && right && left === right)
}

function messageOf(cause: unknown): string {
  if (cause instanceof Error && cause.message) return cause.message
  return "GitHub request failed"
}

/**
 * All sidebar lifecycle state in one place:
 *
 * - the location-scoped health gate;
 * - summary fetch, force refresh, polling, and transport errors;
 * - branch/idle refresh triggers filtered to this location and root session;
 * - linked-session markers, which are advisory and never fail the sidebar;
 * - collapsed sections, kept in memory for the TUI session.
 */
export function createSidebarState(context: Context): SidebarState {
  const [gate, setGate] = createSignal<SidebarStatus>("loading")
  const [summary, setSummary] = createSignal<SummaryResponse>()
  const [requestError, setRequestError] = createSignal<string>()
  const [refreshing, setRefreshing] = createSignal(false)
  const [linked, setLinked] = createSignal<ReadonlySet<string>>(new Set<string>())
  const [collapsed, setCollapsed] = createSignal<readonly SectionName[]>([])

  let summaryController: AbortController | undefined
  let linkedController: AbortController | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let collapsedInitialized = false

  function clearTimer(): void {
    if (timer === undefined) return
    clearTimeout(timer)
    timer = undefined
  }

  function schedule(seconds: number): void {
    clearTimer()
    const delay = Math.max(15, Number.isFinite(seconds) ? Math.trunc(seconds) : 60) * 1_000
    timer = setTimeout(() => {
      timer = undefined
      void refresh(false)
    }, delay)
  }

  async function refreshLinked(repo: RepoRef | undefined): Promise<void> {
    if (!repo) return
    linkedController?.abort()
    const controller = new AbortController()
    linkedController = controller
    try {
      const keys = await loadLinkedKeys(context, repo)
      if (!controller.signal.aborted) setLinked(keys)
    } catch {
      // Markers are a convenience. A failed session list must not replace the
      // GitHub data with an error state.
    }
  }

  function applySummary(next: SummaryResponse): void {
    setSummary(next)
    setRequestError(undefined)
    if (!collapsedInitialized) {
      setCollapsed(next.view.display.collapsed)
      collapsedInitialized = true
    }
    schedule(next.view.refreshSeconds)
    void refreshLinked(next.repository)
  }

  async function refresh(force = false): Promise<void> {
    if (!context.location?.directory) return
    summaryController?.abort()
    const controller = new AbortController()
    summaryController = controller
    if (force) setRefreshing(true)

    try {
      const result = await context.client
        .rpc(GithubSidebarRpc)
        .summary({ force }, { location: requireRpcLocation(context), signal: controller.signal })
      if (controller.signal.aborted) return
      if (!isSummaryResponse(result)) throw new TypeError("The server returned an invalid summary response")
      applySummary(result)
    } catch (cause) {
      if (controller.signal.aborted) return
      setRequestError(messageOf(cause))
      schedule(summary()?.view.refreshSeconds ?? 30)
    } finally {
      if (summaryController === controller) {
        summaryController = undefined
        setRefreshing(false)
      }
    }
  }

  function reset(): void {
    summaryController?.abort()
    linkedController?.abort()
    clearTimer()
    setSummary(undefined)
    setRequestError(undefined)
    setRefreshing(false)
    setLinked(new Set<string>())
    setCollapsed([])
    collapsedInitialized = false
  }

  createEffect(
    on(
      () => context.location,
      (location) => {
        const controller = new AbortController()
        onCleanup(() => controller.abort())

        reset()
        setGate("loading")
        if (!location?.directory) return

        void (async () => {
          try {
            const status = await checkHealth(context, controller.signal)
            if (controller.signal.aborted) return
            if (status !== "ready") {
              setGate("error")
              return
            }
            setGate("ready")
            await refresh(false)
          } catch {
            if (!controller.signal.aborted) setGate("error")
          }
        })()
      },
    ),
  )

  const offBranch = context.data.on("vcs.branch.updated", (event) => {
    if (!sameDirectory(event.location?.directory, context.location?.directory)) return
    void refresh(true)
  })
  const offIdle = context.data.on("session.idle", (event) => {
    if (!sameDirectory(event.location?.directory, context.location?.directory)) return
    if (context.data.session.get(event.data.sessionID)?.parentID) return
    void refresh(false)
    void refreshLinked(summary()?.repository)
  })

  onCleanup(() => {
    offBranch()
    offIdle()
    reset()
  })

  return {
    gate,
    summary,
    requestError,
    refreshing,
    linked,
    collapsed,
    refresh: (force = false) => void refresh(force),
    toggleSection: (section) => {
      const current = collapsed()
      setCollapsed(current.includes(section) ? current.filter((entry) => entry !== section) : [...current, section])
      collapsedInitialized = true
    },
  }
}
