import type { SessionInfo } from "@opencode/client"
import type { Context, KeymapCommand, KeymapLayer } from "@opencode/plugin/tui/context"
import { createSignal } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { SERVER_PLUGIN_ID } from "../../src/shared/ids"
import type {
  EffectiveView,
  IssueView,
  LaunchResult,
  PullView,
  RepoRef,
  SummaryData,
  SummaryResponse,
} from "../../src/shared/types"

/**
 * Minimal fake of the TUI host context.
 *
 * Only the members the sidebar actually uses are modelled. Everything the test
 * does not override resolves to a usable default, and every outbound call is
 * recorded so tests can assert the TUI boundary as well as the rendered output.
 */

export interface RpcCallOptions {
  readonly location?: { readonly directory: string }
  readonly signal?: AbortSignal
}

export type LaunchInput = { readonly kind: "pull" | "issue"; readonly number: number }

export interface FakeCalls {
  readonly contracts: unknown[]
  readonly health: Array<{ input: unknown; options: RpcCallOptions | undefined }>
  readonly summary: Array<{ input: unknown; options: RpcCallOptions | undefined }>
  readonly prepare: Array<{ input: unknown; options: RpcCallOptions | undefined }>
  readonly locationGet: unknown[]
  readonly listSessions: unknown[]
  readonly created: unknown[]
  readonly synthetic: unknown[]
  readonly sync: string[]
  readonly confirms: unknown[]
  readonly alerts: unknown[]
  readonly toasts: unknown[]
  readonly focused: string[]
  readonly navigated: unknown[]
  readonly panelOpen: Array<{ name: string; options: unknown }>
  readonly panelClose: unknown[]
}

export interface FakeTuiOptions {
  readonly directory?: string
  /** Supply a reactive accessor to drive health-gate/location-reset tests. */
  readonly location?: () => { readonly directory: string } | undefined
  readonly openLinks?: string
  readonly health?: (input: unknown, options: RpcCallOptions) => Promise<unknown>
  readonly summary?: (input: unknown, options: RpcCallOptions) => Promise<unknown>
  readonly prepareLaunch?: (input: unknown, options: RpcCallOptions) => Promise<unknown>
  readonly getLocation?: (input: unknown) => Promise<unknown>
  readonly listSessions?: (input: unknown) => Promise<unknown>
  readonly createSession?: (input: unknown) => Promise<unknown>
  readonly synthetic?: (input: unknown) => Promise<unknown>
  readonly confirm?: (input: unknown) => Promise<boolean | undefined>
  readonly focusTab?: (sessionID: string) => boolean
  readonly navigate?: (input: unknown) => void
  readonly sessions?: ReadonlyMap<string, SessionInfo>
  /** Current router destination; defaults to the `ses-root` session. */
  readonly route?: { readonly type: "session"; readonly sessionID: string } | { readonly type: "home" }
}

export interface FakeTui {
  readonly context: Context
  readonly calls: FakeCalls
  /** Raw reactive stores keyed by `context.storage.store` key. */
  readonly storage: ReadonlyMap<string, unknown>
  /** Evaluates every registered keymap layer and returns the reachable commands. */
  readonly keymapCommands: () => readonly KeymapCommand[]
  readonly emit: (type: string, event: unknown) => void
  readonly setLocation: (next: { readonly directory: string } | undefined) => void
}

export function sessionInfo(overrides: Record<string, unknown> = {}): SessionInfo {
  const id = typeof overrides.id === "string" ? overrides.id : "session-1"
  return {
    id,
    projectID: "project-1",
    parentID: undefined,
    title: "Session",
    cost: 0,
    tokens: {},
    metadata: {},
    time: { created: 0, updated: 0 },
    location: { directory: "/work/repo" },
    ...overrides,
  } as unknown as SessionInfo
}

export function repoRef(overrides: Partial<RepoRef> = {}): RepoRef {
  return {
    host: "github.com",
    owner: "acme",
    name: "widgets",
    nameWithOwner: "acme/widgets",
    url: "https://github.com/acme/widgets",
    isPrivate: false,
    ...overrides,
  }
}

export function pullView(overrides: Partial<PullView> = {}): PullView {
  return {
    number: 7,
    title: "Fix the widget",
    url: "https://github.com/acme/widgets/pull/7",
    isDraft: false,
    isCrossRepository: false,
    headRefName: "fix-widget",
    headRepositoryOwner: "acme",
    author: "me",
    isMine: true,
    comments: 3,
    reviews: 1,
    ci: "pass",
    merge: "ready",
    updatedAt: "2026-10-01T10:00:00Z",
    ...overrides,
  }
}

export function issueView(overrides: Partial<IssueView> = {}): IssueView {
  return {
    number: 9,
    title: "Widget request",
    url: "https://github.com/acme/widgets/issues/9",
    author: "other",
    assignees: [],
    isMine: false,
    comments: 2,
    labels: ["enhancement"],
    updatedAt: "2026-10-02T10:00:00Z",
    ...overrides,
  }
}

export function effectiveView(
  overrides: {
    readonly scope?: EffectiveView["scope"]
    readonly autoAllThreshold?: number
    readonly pulls?: Partial<EffectiveView["pulls"]>
    readonly issues?: Partial<EffectiveView["issues"]>
    readonly actions?: Partial<EffectiveView["actions"]>
    readonly display?: Partial<EffectiveView["display"]>
    readonly refreshSeconds?: number
  } = {},
): EffectiveView {
  return {
    scope: overrides.scope ?? "auto",
    autoAllThreshold: overrides.autoAllThreshold ?? 100,
    pulls: { enabled: true, limit: 10, ...overrides.pulls },
    issues: { enabled: true, limit: 10, labels: 1, ...overrides.issues },
    actions: {
      enabled: true,
      confirm: false,
      worktree: true,
      issueWorktree: true,
      focusTabs: true,
      ...overrides.actions,
    },
    display: {
      header: true,
      totals: true,
      order: ["pulls", "issues"],
      collapsed: [],
      glyphs: "unicode",
      showUnavailable: true,
      ...overrides.display,
    },
    refreshSeconds: overrides.refreshSeconds ?? 60,
  }
}

export function summaryData(overrides: Partial<SummaryData> = {}): SummaryData {
  return {
    viewer: "me",
    branch: "main",
    defaultBranch: "main",
    pulls: [pullView()],
    issues: [issueView()],
    totals: { pulls: 1, issues: 1 },
    ...overrides,
  }
}

export function summaryResponse(
  overrides: {
    readonly status?: SummaryResponse["status"]
    readonly message?: string
    readonly view?: EffectiveView
    readonly repository?: RepoRef | undefined
    readonly data?: SummaryData | undefined
    readonly fetchedAt?: number
    readonly retryAt?: string
  } = {},
): SummaryResponse {
  const repository = Object.hasOwn(overrides, "repository") ? overrides.repository : repoRef()
  const data = Object.hasOwn(overrides, "data") ? overrides.data : summaryData()
  return {
    status: overrides.status ?? "ready",
    message: overrides.message ?? "",
    view: overrides.view ?? effectiveView(),
    ...(repository ? { repository } : {}),
    ...(data ? { data } : {}),
    fetchedAt: overrides.fetchedAt ?? 1_700_000_000_000,
    retryAt: overrides.retryAt ?? "",
  }
}

export function launchResult(overrides: Partial<LaunchResult> = {}): LaunchResult {
  return {
    ok: true,
    code: "ok",
    message: "",
    kind: "pull",
    number: 7,
    repository: {
      host: "github.com",
      nameWithOwner: "acme/widgets",
      url: "https://github.com/acme/widgets",
      isPrivate: false,
    },
    title: "Fix the widget",
    url: "https://github.com/acme/widgets/pull/7",
    branch: "pr-7",
    base: "main",
    worktree: "/work/worktrees/pr-7",
    subpath: "",
    sessionDirectory: "/work/worktrees/pr-7",
    reused: false,
    context: "GitHub context",
    description: "PR #7 · Fix the widget",
    ...overrides,
  }
}

export function fakeTheme() {
  const color = "#aabbcc"
  return {
    text: {
      base: color,
      muted: color,
      faint: color,
      action: { primary: { base: color } },
      feedback: {
        success: { base: color },
        error: { base: color },
        warning: { base: color },
        info: { base: color },
      },
    },
  }
}

export function fakeTui(options: FakeTuiOptions = {}): FakeTui {
  const defaultDirectory = options.directory ?? "/work/repo"
  const [internalLocation, setLocation] = createSignal<{ readonly directory: string } | undefined>({
    directory: defaultDirectory,
  })
  const location = options.location ?? internalLocation

  const calls: FakeCalls = {
    contracts: [],
    health: [],
    summary: [],
    prepare: [],
    locationGet: [],
    listSessions: [],
    created: [],
    synthetic: [],
    sync: [],
    confirms: [],
    alerts: [],
    toasts: [],
    focused: [],
    navigated: [],
    panelOpen: [],
    panelClose: [],
  }

  const listeners = new Map<string, Set<(event: unknown) => void>>()
  const sessions = options.sessions ?? new Map<string, SessionInfo>()
  interface FakeStoreEntry {
    readonly value: object
    readonly update: (mutation: (draft: object) => void) => Promise<void>
  }
  const stores = new Map<string, FakeStoreEntry>()
  const layers = new Set<() => KeymapLayer>()
  const [panel, setPanel] = createSignal<{ readonly name: string; readonly sessionID: string }>()
  const route = () => options.route ?? { type: "session" as const, sessionID: "ses-root" }

  const storage = {
    store<Value extends object>(key: string, storeOptions: { readonly initial: Value }) {
      const existing = stores.get(key)
      if (existing) return [existing.value, existing.update] as const
      const [value, setValue] = createStore<Value>(structuredClone(storeOptions.initial))
      const update = async (mutation: (draft: Value) => void) => {
        setValue(produce(mutation))
      }
      stores.set(key, { value, update: update as FakeStoreEntry["update"] })
      return [value, update] as const
    },
    memory<Value>(key: string, memoryOptions: { readonly initial: Value }) {
      const existing = stores.get(key)
      if (existing) return [existing.value, () => undefined] as const
      stores.set(key, { value: memoryOptions.initial as object, update: async () => undefined })
      return [memoryOptions.initial, () => undefined] as const
    },
  }

  const getLocation =
    options.getLocation ??
    (async (input: unknown) => {
      const wire = (input as { location?: { directory?: string } } | undefined)?.location?.directory
      const directory = wire ?? location()?.directory ?? defaultDirectory
      return { directory, project: { id: "project-1", directory, canonical: directory } }
    })

  const listSessions =
    options.listSessions ??
    (async (input: unknown) => {
      calls.listSessions.push(input)
      const data = [...sessions.values()]
      return { data, cursor: {} }
    })

  const createSession =
    options.createSession ??
    (async (input: unknown) => {
      const directory = (input as { location?: { directory?: string } }).location?.directory ?? defaultDirectory
      return sessionInfo({ id: "session-created", location: { directory } })
    })

  const context = {
    options: { openLinks: options.openLinks ?? "osc8" },
    get location() {
      return location()
    },
    client: {
      rpc: (contract: unknown) => {
        calls.contracts.push(contract)
        return {
          health: async (input: unknown, callOptions: RpcCallOptions) => {
            calls.health.push({ input, options: callOptions })
            if (options.health) return options.health(input, callOptions)
            return { ok: true, plugin: SERVER_PLUGIN_ID, location: location()?.directory }
          },
          summary: async (input: unknown, callOptions: RpcCallOptions) => {
            calls.summary.push({ input, options: callOptions })
            if (options.summary) return options.summary(input, callOptions)
            return undefined
          },
          prepareLaunch: async (input: unknown, callOptions: RpcCallOptions) => {
            calls.prepare.push({ input, options: callOptions })
            if (options.prepareLaunch) return options.prepareLaunch(input, callOptions)
            return undefined
          },
        }
      },
      location: {
        get: async (input: unknown) => {
          calls.locationGet.push(input)
          return getLocation(input)
        },
      },
      session: {
        list: (input: unknown) => listSessions(input),
        create: async (input: unknown) => {
          calls.created.push(input)
          return createSession(input)
        },
        synthetic: async (input: unknown) => {
          calls.synthetic.push(input)
          if (options.synthetic) return options.synthetic(input)
          return undefined
        },
      },
    },
    data: {
      on: (type: string, handler: (event: unknown) => void) => {
        let handlers = listeners.get(type)
        if (!handlers) {
          handlers = new Set()
          listeners.set(type, handlers)
        }
        handlers.add(handler)
        return () => handlers.delete(handler)
      },
      session: {
        get: (sessionID: string) => sessions.get(sessionID),
        sync: async (sessionID: string) => {
          calls.sync.push(sessionID)
        },
      },
    },
    theme: fakeTheme(),
    storage,
    keymap: {
      layer: (factory: () => KeymapLayer) => {
        layers.add(factory)
      },
      dispatch: () => undefined,
      shortcuts: () => [],
      commands: () => keymapCommands(),
      pending: () => [],
      active: () => [],
      mode: { current: () => "base", push: () => () => undefined },
    },
    ui: {
      dialog: {
        alert: async (input: unknown) => {
          calls.alerts.push(input)
        },
        confirm: async (input: unknown) => {
          calls.confirms.push(input)
          if (options.confirm) return options.confirm(input)
          return true
        },
      },
      toast: {
        show: (input: unknown) => {
          calls.toasts.push(input)
        },
      },
      tabs: {
        focus: (sessionID: string) => {
          calls.focused.push(sessionID)
          if (options.focusTab) return options.focusTab(sessionID)
          return true
        },
      },
      router: {
        navigate: (input: unknown) => {
          calls.navigated.push(input)
          options.navigate?.(input)
        },
        current: () => route(),
      },
      panel: {
        open: (name: string, panelOptions?: unknown) => {
          calls.panelOpen.push({ name, options: panelOptions })
          const current = route()
          if (current.type !== "session") return false
          setPanel({ name, sessionID: current.sessionID })
          return true
        },
        close: () => {
          calls.panelClose.push(true)
          setPanel(undefined)
        },
        current: () => panel(),
      },
    },
  } as unknown as Context

  const keymapCommands = (): readonly KeymapCommand[] =>
    [...layers].flatMap((factory) => {
      const layer = factory()
      const enabled = typeof layer.enabled === "function" ? layer.enabled() : layer.enabled !== false
      return enabled ? (layer.commands ?? []) : []
    })

  return {
    context,
    calls,
    get storage() {
      return new Map([...stores].map(([key, entry]) => [key, entry.value] as const))
    },
    keymapCommands,
    emit: (type, event) => {
      for (const handler of listeners.get(type) ?? []) handler(event)
    },
    setLocation,
  }
}
