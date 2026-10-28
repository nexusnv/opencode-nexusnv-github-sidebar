/** @jsxImportSource @opentui/solid */
import type { Context } from "@opencode/plugin/tui/context"
import { For, Show, createMemo, type Accessor } from "solid-js"
import type { EffectiveView, IssueView, PullView, SectionName, SummaryData, SummaryResponse } from "../shared/types.js"
import {
  branchLabel,
  formatCount,
  glyphSet,
  issueStatusText,
  linkedKey,
  moreCount,
  rowMarker,
  sectionTitle,
  type GlyphSet,
} from "./format.js"
import { launchItem } from "./launch.js"
import { openLinksMode, openWithFeedback, type OpenLinks } from "./open.js"
import { openGithubPanel } from "./panel.js"
import { EmptyRow, IssueRow, MoreRow, PullRow, SectionHeader } from "./row.js"
import { createSidebarState, type SidebarState } from "./state.js"
import { StatusLine } from "./status-line.js"

interface MouseLike {
  readonly button: number
  stopPropagation(): void
}

export function Sidebar(props: { readonly context: Context; readonly sessionID?: string }) {
  const isChild = createMemo(() => {
    const sessionID = props.sessionID
    if (!sessionID) return false
    return Boolean(props.context.data.session.get(sessionID)?.parentID)
  })

  return (
    <Show when={!isChild()}>
      <SidebarBody context={props.context} />
    </Show>
  )
}

function SidebarBody(props: { readonly context: Context }) {
  const state = createSidebarState(props.context)
  const mode = openLinksMode(props.context.options.openLinks)
  return <SidebarContent context={props.context} state={state} mode={mode} />
}

function SidebarContent(props: { readonly context: Context; readonly state: SidebarState; readonly mode: OpenLinks }) {
  const theme = props.context.theme

  return (
    <box width="100%" flexDirection="column" gap={0}>
      <Show when={props.state.gate() === "loading"}>
        <text fg={theme.text.muted}>Loading GitHub…</text>
      </Show>
      <Show when={props.state.gate() === "error"}>
        <text fg={theme.text.feedback.error.base}>GitHub unavailable</text>
      </Show>
      <Show when={props.state.gate() === "ready" ? props.state.summary() : undefined}>
        {(summary) => <SummaryView context={props.context} state={props.state} mode={props.mode} summary={summary} />}
      </Show>
      <Show when={props.state.gate() === "ready" && !props.state.summary()}>
        <text fg={theme.text.muted}>{props.state.requestError() ?? "Loading GitHub…"}</text>
      </Show>
    </box>
  )
}

function SummaryView(props: {
  readonly context: Context
  readonly state: SidebarState
  readonly mode: OpenLinks
  readonly summary: Accessor<SummaryResponse>
}) {
  const theme = props.context.theme
  const view = () => props.summary().view
  const data = () => props.summary().data
  const status = () => props.summary().status
  const glyphs = createMemo(() => glyphSet(view().display.glyphs))

  const unavailable = () => status() === "no-git" || status() === "no-remote" || status() === "unsupported-host"
  const hasData = () => (status() === "ready" || status() === "stale") && data() !== undefined

  return (
    <Show when={status() !== "disabled"} fallback={<box />}>
      <Show
        when={!unavailable()}
        fallback={
          <Show when={view().display.showUnavailable}>
            <text fg={theme.text.muted} wrapMode="none" truncate>
              {issueStatusText({
                status: status(),
                message: props.summary().message,
                retryAt: props.summary().retryAt,
              })}
            </text>
          </Show>
        }
      >
        <Header
          context={props.context}
          state={props.state}
          summary={props.summary}
          mode={props.mode}
          glyphs={glyphs()}
        />
        <Show
          when={hasData() ? data() : undefined}
          fallback={
            <StatusLine
              context={props.context}
              status={status()}
              message={props.summary().message}
              retryAt={props.summary().retryAt}
              onRetry={() => props.state.refresh(true)}
            />
          }
        >
          {(summaryData) => (
            <Sections
              context={props.context}
              state={props.state}
              mode={props.mode}
              summary={props.summary}
              data={summaryData}
              glyphs={glyphs()}
            />
          )}
        </Show>
        <Show when={props.state.requestError()}>
          <text
            fg={theme.text.feedback.error.base}
            wrapMode="none"
            truncate
            onMouseUp={(event: MouseLike) => {
              if (event.button !== 0) return
              props.state.refresh(true)
            }}
          >
            {props.state.requestError()}
          </text>
        </Show>
      </Show>
    </Show>
  )
}

function Header(props: {
  readonly context: Context
  readonly state: SidebarState
  readonly summary: Accessor<SummaryResponse>
  readonly mode: OpenLinks
  readonly glyphs: GlyphSet
}) {
  const theme = props.context.theme
  const repo = () => props.summary().repository
  const data = () => props.summary().data
  const view = () => props.summary().view

  const subline = createMemo(() => {
    const parts: string[] = []
    const summaryData = data()
    if (summaryData) parts.push(branchLabel(summaryData.branch))
    if (summaryData && view().display.totals) {
      parts.push(`${formatCount(summaryData.totals.pulls)} PRs`)
      parts.push(`${formatCount(summaryData.totals.issues)} issues`)
    }
    if (repo()?.isPrivate) parts.push("private")
    if (props.summary().status === "stale") parts.push("stale")
    const remaining = summaryData?.rateLimit?.remaining
    if (remaining !== undefined && remaining < 200) parts.push(`${formatCount(remaining)} API left`)
    return parts.join(" · ")
  })

  return (
    <Show when={view().display.header && repo()}>
      <box flexDirection="column" minWidth={0}>
        <box flexDirection="row" minWidth={0}>
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
              const url = repo()?.url
              if (url) void openWithFeedback(props.context, url, props.mode)
            }}
          >
            <b>{repo()?.nameWithOwner}</b>
          </text>
          <text
            flexShrink={0}
            fg={theme.text.muted}
            onMouseUp={(event: MouseLike) => {
              if (event.button !== 0) return
              event.stopPropagation()
              openGithubPanel(props.context)
            }}
          >
            {props.glyphs.panel}
          </text>
          <text
            flexShrink={0}
            fg={theme.text.muted}
            onMouseUp={(event: MouseLike) => {
              if (event.button !== 0) return
              event.stopPropagation()
              if (!props.state.refreshing()) props.state.refresh(true)
            }}
          >
            {props.state.refreshing() ? props.glyphs.busy : props.glyphs.refresh}
          </text>
        </box>
        <Show when={subline()}>
          <text fg={theme.text.muted} wrapMode="none" truncate>
            {subline()}
          </text>
        </Show>
      </box>
    </Show>
  )
}

function Rule(props: { readonly context: Context; readonly glyphs: GlyphSet }) {
  return (
    <text fg={props.context.theme.text.faint} wrapMode="none" truncate>
      {props.glyphs.rule.repeat(200)}
    </text>
  )
}

function Sections(props: {
  readonly context: Context
  readonly state: SidebarState
  readonly mode: OpenLinks
  readonly summary: Accessor<SummaryResponse>
  readonly data: Accessor<SummaryData>
  readonly glyphs: GlyphSet
}) {
  const view = () => props.summary().view
  const repo = () => props.summary().repository
  const collapsed = (section: SectionName) => props.state.collapsed().includes(section)

  const activate = (kind: "pull" | "issue", item: PullView | IssueView) => {
    const repository = repo()
    if (!repository) return
    void launchItem(
      props.context,
      repository,
      { kind, number: item.number, title: item.title, url: item.url },
      view().actions,
      { openLinks: props.mode },
    )
  }

  return (
    <For each={view().display.order}>
      {(section) => (
        <Show when={section === "pulls" ? view().pulls.enabled : view().issues.enabled}>
          <Rule context={props.context} glyphs={props.glyphs} />
          <box flexDirection="column" minWidth={0}>
            <SectionHeader
              context={props.context}
              title={sectionTitle({
                section,
                total: section === "pulls" ? props.data().totals.pulls : props.data().totals.issues,
                collapsed: collapsed(section),
                totals: view().display.totals,
                glyphs: props.glyphs,
              })}
              onToggle={() => props.state.toggleSection(section)}
            />
            <Show when={!collapsed(section)}>
              <Show
                when={section === "pulls"}
                fallback={
                  <IssueRows
                    context={props.context}
                    mode={props.mode}
                    data={props.data()}
                    actions={view().actions}
                    labels={view().issues.labels}
                    linked={props.state.linked()}
                    glyphs={props.glyphs}
                    onActivate={activate}
                  />
                }
              >
                <PullRows
                  context={props.context}
                  mode={props.mode}
                  data={props.data()}
                  actions={view().actions}
                  linked={props.state.linked()}
                  glyphs={props.glyphs}
                  onActivate={activate}
                />
              </Show>
            </Show>
          </box>
        </Show>
      )}
    </For>
  )
}

function PullRows(props: {
  readonly context: Context
  readonly mode: OpenLinks
  readonly data: SummaryData
  readonly actions: EffectiveView["actions"]
  readonly linked: ReadonlySet<string>
  readonly glyphs: GlyphSet
  readonly onActivate: (kind: "pull", item: PullView) => void
}) {
  const branchNumber = () => props.data.branchPr?.number

  return (
    <>
      <Show when={props.data.pulls.length === 0}>
        <EmptyRow
          context={props.context}
          label={props.data.totals.pulls === 0 ? "No open pull requests" : "No matching pull requests"}
        />
      </Show>
      <For each={props.data.pulls}>
        {(pull) => {
          const linked = () => props.linked.has(linkedKey("pull", pull.number))
          return (
            <PullRow
              context={props.context}
              pull={pull}
              viewer={props.data.viewer}
              branchNumber={branchNumber()}
              linked={linked()}
              glyphs={props.glyphs}
              mode={props.mode}
              marker={rowMarker({
                number: pull.number,
                branchNumber: branchNumber(),
                linked: linked(),
                actionsEnabled: props.actions.enabled,
                glyphs: props.glyphs,
              })}
              onActivate={() => props.onActivate("pull", pull)}
            />
          )
        }}
      </For>
      <Show when={moreCount(props.data.totals.pulls, props.data.pulls.length) > 0}>
        <MoreRow
          context={props.context}
          label={`+ ${formatCount(moreCount(props.data.totals.pulls, props.data.pulls.length))} more`}
        />
      </Show>
    </>
  )
}

function IssueRows(props: {
  readonly context: Context
  readonly mode: OpenLinks
  readonly data: SummaryData
  readonly actions: EffectiveView["actions"]
  readonly labels: number
  readonly linked: ReadonlySet<string>
  readonly glyphs: GlyphSet
  readonly onActivate: (kind: "issue", item: IssueView) => void
}) {
  return (
    <>
      <Show when={props.data.issues.length === 0}>
        <EmptyRow
          context={props.context}
          label={props.data.totals.issues === 0 ? "No open issues" : "No matching issues"}
        />
      </Show>
      <For each={props.data.issues}>
        {(issue) => {
          const linked = () => props.linked.has(linkedKey("issue", issue.number))
          return (
            <IssueRow
              context={props.context}
              issue={issue}
              viewer={props.data.viewer}
              labels={props.labels}
              linked={linked()}
              glyphs={props.glyphs}
              mode={props.mode}
              marker={rowMarker({
                number: issue.number,
                branchNumber: undefined,
                linked: linked(),
                actionsEnabled: props.actions.enabled,
                glyphs: props.glyphs,
              })}
              onActivate={() => props.onActivate("issue", issue)}
            />
          )
        }}
      </For>
      <Show when={moreCount(props.data.totals.issues, props.data.issues.length) > 0}>
        <MoreRow
          context={props.context}
          label={`+ ${formatCount(moreCount(props.data.totals.issues, props.data.issues.length))} more`}
        />
      </Show>
    </>
  )
}
