/** @jsxImportSource @opentui/solid */
import type { Context, PanelInput } from "@opencode/plugin/tui/context"
import type { ScrollBoxRenderable } from "@opentui/core"
import { For, Show, createEffect, createMemo, createSignal, on } from "solid-js"
import type {
  EffectiveView,
  IssueView,
  PullView,
  RepoRef,
  SectionName,
  SummaryData,
  SummaryResponse,
} from "../shared/types.js"
import { branchLabel, formatCount, glyphSet, linkedKey, rowMarker, sectionTitle, type GlyphSet } from "./format.js"
import { launchItem } from "./launch.js"
import { openLinksMode, openWithFeedback, type OpenLinks } from "./open.js"
import { IssueRow, PullRow } from "./row.js"
import { createSidebarState, type SidebarState } from "./state.js"
import { StatusLine } from "./status-line.js"

interface MouseLike {
  readonly button: number
  stopPropagation(): void
}

type PanelFilter = "mine" | "all"

type PanelRow =
  { readonly kind: "pull"; readonly pull: PullView } | { readonly kind: "issue"; readonly issue: IssueView }

type PanelEntry =
  | { readonly type: "header"; readonly key: string; readonly section: SectionName; readonly title: string }
  | {
      readonly type: "row"
      readonly key: string
      readonly section: SectionName
      readonly ordinal: number
      readonly row: PanelRow
    }
  | { readonly type: "empty"; readonly key: string; readonly label: string }
  | { readonly type: "more"; readonly key: string; readonly label: string }

const PANEL_NAME = "github"

/** Opens the full-list GitHub panel in the current session. */
export function openGithubPanel(context: Context): boolean {
  const current = context.ui.panel.current()
  if (current?.name === PANEL_NAME) {
    context.ui.panel.close()
    return true
  }
  return context.ui.panel.open(PANEL_NAME)
}

function rowNumber(row: PanelRow): number {
  return row.kind === "pull" ? row.pull.number : row.issue.number
}

function rowTitle(row: PanelRow): string {
  return row.kind === "pull" ? row.pull.title : row.issue.title
}

function rowUrl(row: PanelRow): string {
  return row.kind === "pull" ? row.pull.url : row.issue.url
}

function filterPulls(pulls: readonly PullView[], filter: PanelFilter, branchNumber: number | undefined): PullView[] {
  if (filter === "all") return [...pulls]
  return pulls.filter((pull) => pull.isMine || pull.number === branchNumber)
}

function filterIssues(issues: readonly IssueView[], filter: PanelFilter): IssueView[] {
  if (filter === "all") return [...issues]
  return issues.filter((issue) => issue.isMine)
}

function panelEntries(options: {
  readonly data: SummaryData
  readonly view: EffectiveView
  readonly filter: PanelFilter
  readonly glyphs: GlyphSet
}): PanelEntry[] {
  const entries: PanelEntry[] = []
  let ordinal = 0
  for (const section of options.view.display.order) {
    const enabled = section === "pulls" ? options.view.pulls.enabled : options.view.issues.enabled
    if (!enabled) continue
    const total = section === "pulls" ? options.data.totals.pulls : options.data.totals.issues
    const pulls =
      section === "pulls" ? filterPulls(options.data.pulls, options.filter, options.data.branchPr?.number) : []
    const issues = section === "issues" ? filterIssues(options.data.issues, options.filter) : []
    const shown = section === "pulls" ? pulls.length : issues.length
    entries.push({
      type: "header",
      key: `header-${section}`,
      section,
      title: sectionTitle({
        section,
        total,
        collapsed: false,
        totals: options.view.display.totals,
        glyphs: options.glyphs,
      }),
    })
    if (shown === 0) {
      entries.push({
        type: "empty",
        key: `empty-${section}`,
        label: emptyLabel(section, total, options.filter),
      })
    }
    for (const pull of pulls) {
      entries.push({
        type: "row",
        key: `pull-${pull.number}`,
        section,
        ordinal,
        row: { kind: "pull", pull },
      })
      ordinal += 1
    }
    for (const issue of issues) {
      entries.push({
        type: "row",
        key: `issue-${issue.number}`,
        section,
        ordinal,
        row: { kind: "issue", issue },
      })
      ordinal += 1
    }
    if (shown > 0 && shown < total) {
      entries.push({
        type: "more",
        key: `more-${section}`,
        label: truncationLabel(shown, total, options.filter),
      })
    }
  }
  return entries
}

function emptyLabel(section: SectionName, total: number, filter: PanelFilter): string {
  if (total === 0) return section === "pulls" ? "No open pull requests" : "No open issues"
  if (filter === "mine") return section === "pulls" ? "No pull requests authored by you" : "No issues authored by you"
  return section === "pulls" ? "No matching pull requests" : "No matching issues"
}

function truncationLabel(shown: number, total: number, filter: PanelFilter): string {
  const visible = `${formatCount(shown)} ${filter === "mine" ? "mine" : "shown"}`
  return `${visible} of ${formatCount(total)} open · open GitHub for the rest`
}

/**
 * Panel contribution. The host only mounts this slot while a panel is open;
 * another plugin's panel still mounts this component, so the name check keeps
 * its DOM and keymap layer out of the way.
 */
export function GithubPanel(props: { readonly context: Context; readonly panel: PanelInput }) {
  const isChild = createMemo(() => Boolean(props.context.data.session.get(props.panel.sessionID)?.parentID))

  return (
    <Show when={props.panel.name === PANEL_NAME}>
      <Show
        when={!isChild()}
        fallback={
          <text fg={props.context.theme.text.muted} wrapMode="none" truncate>
            GitHub is not available in child sessions.
          </text>
        }
      >
        <PanelBody context={props.context} panel={props.panel} />
      </Show>
    </Show>
  )
}

function PanelBody(props: { readonly context: Context; readonly panel: PanelInput }) {
  const state = createSidebarState(props.context, { full: true })
  const mode = openLinksMode(props.context.options.openLinks)
  const [filter, setFilter] = createSignal<PanelFilter>()
  const [selected, setSelected] = createSignal(0)
  let scroll: ScrollBoxRenderable | undefined

  const summary = () => state.summary()
  const view = () => summary()?.view
  const data = () => summary()?.data
  const glyphs = createMemo(() => glyphSet(view()?.display.glyphs ?? "unicode"))
  const effectiveFilter = (): PanelFilter => filter() ?? (view()?.scope === "mine" ? "mine" : "all")

  const entries = createMemo(() => {
    const currentData = data()
    const currentView = view()
    if (!currentData || !currentView) return []
    return panelEntries({ data: currentData, view: currentView, filter: effectiveFilter(), glyphs: glyphs() })
  })

  const rowEntries = createMemo(() =>
    entries().filter((entry): entry is Extract<PanelEntry, { readonly type: "row" }> => entry.type === "row"),
  )
  const selectedRow = () => rowEntries().find((entry) => entry.ordinal === selected())
  const setFilterAndReset = (next: PanelFilter) => {
    setFilter(next)
    setSelected(0)
  }

  const move = (delta: number) => {
    const count = rowEntries().length
    if (count === 0) return
    setSelected((current) => Math.max(0, Math.min(count - 1, current + delta)))
  }

  const activate = (row: PanelRow) => {
    const repository = summary()?.repository
    const currentView = view()
    if (!repository || !currentView) return
    void launchItem(
      props.context,
      repository,
      { kind: row.kind, number: rowNumber(row), title: rowTitle(row), url: rowUrl(row) },
      currentView.actions,
      { openLinks: mode },
    )
  }

  createEffect(
    on(
      () => entries().length,
      () => {
        const count = rowEntries().length
        if (count === 0) {
          setSelected(0)
          return
        }
        setSelected((current) => Math.min(current, count - 1))
      },
    ),
  )

  createEffect(
    on(
      () => [selected(), entries().length] as const,
      () => {
        const row = selectedRow()
        if (!row) return
        scroll?.scrollChildIntoView(`github-row-${row.ordinal}`)
      },
    ),
  )

  props.context.keymap.layer(() => ({
    enabled: () => props.panel.focused,
    commands: [
      {
        bind: "j,down",
        title: "Next GitHub item",
        group: "GitHub",
        run: () => move(1),
      },
      {
        bind: "k,up",
        title: "Previous GitHub item",
        group: "GitHub",
        run: () => move(-1),
      },
      {
        bind: "enter",
        title: "Launch selected GitHub item",
        group: "GitHub",
        run: () => {
          const row = selectedRow()?.row
          if (row) activate(row)
        },
      },
      {
        bind: "o",
        title: "Open selected GitHub item in the browser",
        group: "GitHub",
        run: () => {
          const row = selectedRow()?.row
          if (row) void openWithFeedback(props.context, rowUrl(row), mode)
        },
      },
      {
        bind: "r",
        title: "Refresh GitHub data",
        group: "GitHub",
        run: () => state.refresh(true),
      },
      {
        bind: "m",
        title: "Show only my GitHub items",
        group: "GitHub",
        run: () => setFilterAndReset("mine"),
      },
      {
        bind: "a",
        title: "Show all GitHub items",
        group: "GitHub",
        run: () => setFilterAndReset("all"),
      },
      {
        bind: "f",
        title: "Toggle GitHub panel fullscreen",
        group: "GitHub",
        run: () => props.panel.toggleFullscreen(),
      },
      {
        bind: "escape",
        title: "Close the GitHub panel",
        group: "GitHub",
        run: () => props.panel.close(),
      },
    ],
  }))

  return (
    <box width="100%" height="100%" flexDirection="column" backgroundColor={props.context.theme.background.raised.base}>
      <Show when={state.gate() === "loading"}>
        <box paddingLeft={1} paddingTop={1}>
          <text fg={props.context.theme.text.muted}>Loading GitHub…</text>
        </box>
      </Show>
      <Show when={state.gate() === "error"}>
        <box paddingLeft={1} paddingTop={1}>
          <text fg={props.context.theme.text.feedback.error.base}>GitHub unavailable</text>
        </box>
      </Show>
      <Show when={state.gate() === "ready" ? summary() : undefined}>
        {(current) => (
          <Show
            when={current().status !== "disabled"}
            fallback={
              <box paddingLeft={1} paddingTop={1}>
                <text fg={props.context.theme.text.muted} wrapMode="none" truncate>
                  GitHub is disabled for this project.
                </text>
              </box>
            }
          >
            <Show
              when={current().repository}
              fallback={
                <box paddingLeft={1} paddingTop={1}>
                  <text fg={props.context.theme.text.base}>
                    <b>GitHub</b>
                  </text>
                </box>
              }
            >
              <PanelHeader
                context={props.context}
                panel={props.panel}
                summary={current}
                glyphs={glyphs()}
                filter={effectiveFilter()}
                mode={mode}
                onFilter={setFilterAndReset}
                onRefresh={() => state.refresh(true)}
                refreshing={state.refreshing()}
              />
            </Show>
            <Show
              when={(current().status === "ready" || current().status === "stale") && data()}
              fallback={
                <box paddingLeft={1} paddingRight={1}>
                  <StatusLine
                    context={props.context}
                    status={current().status}
                    message={current().message}
                    retryAt={current().retryAt}
                    onRetry={() => state.refresh(true)}
                  />
                </box>
              }
            >
              <scrollbox ref={(value: ScrollBoxRenderable) => (scroll = value)} flexGrow={1} minHeight={0}>
                <PanelSections
                  context={props.context}
                  state={state}
                  entries={entries()}
                  selected={selected()}
                  mode={mode}
                  glyphs={glyphs()}
                  onSelect={setSelected}
                  onActivate={activate}
                />
              </scrollbox>
              <Show when={state.requestError()}>
                <box paddingLeft={1} paddingRight={1}>
                  <text
                    fg={props.context.theme.text.feedback.error.base}
                    wrapMode="none"
                    truncate
                    onMouseUp={(event: MouseLike) => {
                      if (event.button !== 0) return
                      state.refresh(true)
                    }}
                  >
                    {state.requestError()}
                  </text>
                </box>
              </Show>
              <PanelFooter context={props.context} />
            </Show>
          </Show>
        )}
      </Show>
      <Show when={state.gate() === "ready" && !summary()}>
        <box paddingLeft={1} paddingTop={1}>
          <text fg={props.context.theme.text.muted} wrapMode="none" truncate>
            {state.requestError() ?? "Loading GitHub…"}
          </text>
        </box>
      </Show>
    </box>
  )
}

function PanelHeader(props: {
  readonly context: Context
  readonly panel: PanelInput
  readonly summary: () => SummaryResponse
  readonly glyphs: GlyphSet
  readonly filter: PanelFilter
  readonly mode: OpenLinks
  readonly onFilter: (filter: PanelFilter) => void
  readonly onRefresh: () => void
  readonly refreshing: boolean
}) {
  const theme = props.context.theme
  const repo = () => props.summary().repository
  const data = () => props.summary().data
  const view = () => props.summary().view

  const subline = createMemo(() => {
    const parts: string[] = []
    const summaryData = data()
    if (summaryData) parts.push(branchLabel(summaryData.branch))
    const repoRef: RepoRef | undefined = repo()
    if (repoRef?.isPrivate) parts.push("private")
    if (props.summary().status === "stale") parts.push("stale")
    const remaining = summaryData?.rateLimit?.remaining
    if (remaining !== undefined && remaining < 200) parts.push(`${formatCount(remaining)} API left`)
    return parts.join(" · ")
  })

  const filterText = (value: PanelFilter) => (props.filter === value ? `[${value}]` : ` ${value} `)

  return (
    <box flexDirection="column" minWidth={0} flexShrink={0} paddingLeft={1} paddingRight={1} paddingTop={1}>
      <box flexDirection="row" minWidth={0} flexShrink={0}>
        <text flexShrink={0} fg={theme.text.muted}>
          GitHub{" "}
        </text>
        <Show when={repo()}>
          {(repository) => (
            <text
              flexGrow={1}
              flexShrink={1}
              minWidth={0}
              wrapMode="none"
              truncate
              fg={theme.text.base}
              onMouseUp={(event: MouseLike) => {
                if (event.button !== 0) return
                event.stopPropagation()
                void openWithFeedback(props.context, repository().url, props.mode)
              }}
            >
              <b>{repository().nameWithOwner}</b>
            </text>
          )}
        </Show>
        <text
          flexShrink={0}
          fg={props.filter === "mine" ? theme.text.action.primary.base : theme.text.muted}
          onMouseUp={(event: MouseLike) => {
            if (event.button !== 0) return
            event.stopPropagation()
            props.onFilter("mine")
          }}
        >
          {filterText("mine")}
        </text>
        <text
          flexShrink={0}
          fg={props.filter === "all" ? theme.text.action.primary.base : theme.text.muted}
          onMouseUp={(event: MouseLike) => {
            if (event.button !== 0) return
            event.stopPropagation()
            props.onFilter("all")
          }}
        >
          {filterText("all")}
        </text>
        <text
          flexShrink={0}
          fg={theme.text.muted}
          onMouseUp={(event: MouseLike) => {
            if (event.button !== 0) return
            event.stopPropagation()
            if (!props.refreshing) props.onRefresh()
          }}
        >
          {" "}
          {props.refreshing ? props.glyphs.busy : props.glyphs.refresh}
        </text>
        <text
          flexShrink={0}
          fg={theme.text.muted}
          onMouseUp={(event: MouseLike) => {
            if (event.button !== 0) return
            event.stopPropagation()
            props.panel.close()
          }}
        >
          {" "}
          ✕
        </text>
      </box>
      <Show when={subline()}>
        <text flexShrink={0} fg={theme.text.muted} wrapMode="none" truncate>
          {subline()}
        </text>
      </Show>
      <Show when={view().display.totals && data()}>
        {(summaryData) => (
          <text flexShrink={0} fg={theme.text.muted} wrapMode="none" truncate>
            {formatCount(summaryData().totals.pulls)} open pull requests · {formatCount(summaryData().totals.issues)}{" "}
            open issues
          </text>
        )}
      </Show>
    </box>
  )
}

function PanelSections(props: {
  readonly context: Context
  readonly state: SidebarState
  readonly entries: readonly PanelEntry[]
  readonly selected: number
  readonly mode: OpenLinks
  readonly glyphs: GlyphSet
  readonly onSelect: (ordinal: number) => void
  readonly onActivate: (row: PanelRow) => void
}) {
  const summary = () => props.state.summary()
  const data = () => summary()?.data
  const view = () => summary()?.view
  const branchNumber = () => data()?.branchPr?.number

  return (
    <box flexDirection="column" minWidth={0}>
      <For each={props.entries}>
        {(entry) => {
          if (entry.type === "header") {
            return (
              <box paddingLeft={1} paddingRight={1} paddingTop={1}>
                <text fg={props.context.theme.text.base} wrapMode="none" truncate>
                  <b>{entry.title}</b>
                </text>
              </box>
            )
          }
          if (entry.type === "empty" || entry.type === "more") {
            return (
              <box paddingLeft={3} paddingRight={1}>
                <text fg={props.context.theme.text.faint} wrapMode="none" truncate>
                  {entry.label}
                </text>
              </box>
            )
          }
          const row = entry.row
          const linked = () => props.state.linked().has(linkedKey(row.kind, rowNumber(row)))
          const selected = () => props.selected === entry.ordinal
          const activate = () => {
            props.onSelect(entry.ordinal)
            props.onActivate(row)
          }
          const marker = () =>
            rowMarker({
              number: rowNumber(row),
              branchNumber: branchNumber(),
              linked: linked(),
              actionsEnabled: view()?.actions.enabled ?? false,
              glyphs: props.glyphs,
            })
          return (
            <box paddingLeft={1} paddingRight={1}>
              <Show
                when={row.kind === "pull" ? row.pull : undefined}
                fallback={
                  <Show when={row.kind === "issue" ? row.issue : undefined}>
                    {(issue) => (
                      <IssueRow
                        context={props.context}
                        issue={issue()}
                        id={`github-row-${entry.ordinal}`}
                        selected={selected()}
                        viewer={data()?.viewer ?? ""}
                        labels={view()?.issues.labels ?? 0}
                        linked={linked()}
                        glyphs={props.glyphs}
                        mode={props.mode}
                        marker={marker()}
                        onActivate={activate}
                      />
                    )}
                  </Show>
                }
              >
                {(pull) => (
                  <PullRow
                    context={props.context}
                    pull={pull()}
                    id={`github-row-${entry.ordinal}`}
                    selected={selected()}
                    viewer={data()?.viewer ?? ""}
                    branchNumber={branchNumber()}
                    linked={linked()}
                    glyphs={props.glyphs}
                    mode={props.mode}
                    marker={marker()}
                    onActivate={activate}
                  />
                )}
              </Show>
            </box>
          )
        }}
      </For>
      <Show when={props.entries.length === 0}>
        <box paddingLeft={1}>
          <text fg={props.context.theme.text.muted}>No sections enabled</text>
        </box>
      </Show>
    </box>
  )
}

function PanelFooter(props: { readonly context: Context }) {
  return (
    <box flexShrink={0} paddingLeft={1} paddingRight={1} paddingBottom={1}>
      <text fg={props.context.theme.text.faint} wrapMode="none" truncate>
        j/k move · enter launch · o browser · r refresh · m mine · a all · f fullscreen · esc close
      </text>
    </box>
  )
}

/**
 * Global command surface for the panel. Registered on `app` so the shortcut
 * works from any route; it refuses routes without a session panel slot.
 */
export function PanelCommands(props: { readonly context: Context }) {
  props.context.keymap.layer(() => ({
    mode: "global",
    commands: [
      {
        id: "github.panel.open",
        title: "Toggle GitHub panel",
        description: "Open the full GitHub pull request and issue list for this session",
        group: "GitHub",
        bind: "ctrl+shift+g",
        palette: true,
        run() {
          const current = props.context.ui.panel.current()
          if (current?.name === PANEL_NAME) {
            props.context.ui.panel.close()
            return
          }
          const route = props.context.ui.router.current()
          if (route.type !== "session") {
            props.context.ui.toast.show({ message: "Open a session first", variant: "warning" })
            return
          }
          if (props.context.data.session.get(route.sessionID)?.parentID) {
            props.context.ui.toast.show({ message: "GitHub is not available in child sessions", variant: "warning" })
            return
          }
          if (!openGithubPanel(props.context)) {
            props.context.ui.toast.show({ message: "The session panel is not available", variant: "warning" })
          }
        },
      },
    ],
  }))

  return null
}
