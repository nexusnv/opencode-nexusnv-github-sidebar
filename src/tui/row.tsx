/** @jsxImportSource @opentui/solid */
import type { Context } from "@opencode/plugin/tui/context"
import { Show } from "solid-js"
import type { JSX } from "@opentui/solid"
import type { IssueView, PullView } from "../shared/types.js"
import { CI_META, MERGE_LABEL } from "../shared/status.js"
import { authorLabel, ciColor, formatCount, mergeColor, type GlyphSet, type StatusColors } from "./format.js"
import { Marquee } from "./marquee.js"
import { openWithFeedback, safeExternalUrl, type OpenLinks } from "./open.js"

interface MouseLike {
  readonly button: number
  stopPropagation(): void
}

/**
 * Secondary action: open the canonical GitHub URL.
 *
 * The rendered `<a>` carries the URL for terminals using OSC 8; the click
 * handler exists for `browser` mode and for terminals that report clicks.
 */
export function BrowserAction(props: {
  readonly context: Context
  readonly url: string
  readonly mode: OpenLinks
  readonly label: string
}) {
  const open = (event: MouseLike) => {
    if (event.button !== 0) return
    event.stopPropagation()
    void openWithFeedback(props.context, props.url, props.mode)
  }
  const href = () => safeExternalUrl(props.url)

  return (
    <text flexShrink={0} fg={props.context.theme.text.faint} onMouseUp={open}>
      <Show when={href()} fallback={props.label}>
        {(url) => <a href={url()}>{props.label}</a>}
      </Show>
    </text>
  )
}

export function Row(props: {
  readonly context: Context
  readonly onActivate: () => void
  readonly id?: string | undefined
  readonly selected?: boolean | undefined
  readonly children: JSX.Element
}) {
  return (
    <box
      {...(props.id ? { id: props.id } : {})}
      flexDirection="column"
      minWidth={0}
      backgroundColor={props.selected ? props.context.theme.background.raised.high : "transparent"}
      onMouseUp={(event: MouseLike) => {
        if (event.button !== 0) return
        props.onActivate()
      }}
    >
      {props.children}
    </box>
  )
}

function pullDetailRest(pull: PullView, viewer: string): string {
  const author = pull.isMine && viewer ? viewer : pull.author
  return [`${formatCount(pull.comments)}c`, `${formatCount(pull.reviews)}r`, authorLabel(author)].join(" · ")
}

export function PullRow(props: {
  readonly context: Context
  readonly pull: PullView
  readonly viewer: string
  readonly branchNumber: number | undefined
  readonly linked: boolean
  readonly glyphs: GlyphSet
  readonly mode: OpenLinks
  readonly marker: string
  readonly id?: string | undefined
  readonly selected?: boolean | undefined
  readonly onActivate: () => void
}) {
  const theme = props.context.theme
  const colors: StatusColors = {
    success: theme.text.feedback.success.base,
    error: theme.text.feedback.error.base,
    warning: theme.text.feedback.warning.base,
    info: theme.text.feedback.info.base,
    faint: theme.text.faint,
  }
  const branch = () => props.branchNumber === props.pull.number
  const markerColor = () => {
    if (branch()) return theme.text.action.primary.base
    if (props.linked) return theme.text.feedback.success.base
    return theme.text.muted
  }
  const ciFg = ciColor(props.pull.ci, colors)
  const mergeFg = mergeColor(props.pull.merge, colors)

  return (
    <Row context={props.context} onActivate={props.onActivate} id={props.id} selected={props.selected}>
      <box flexDirection="row" minWidth={0}>
        <text flexShrink={0} fg={markerColor()}>
          {props.marker}{" "}
        </text>
        <box flexGrow={1} flexShrink={1} minWidth={0}>
          <Marquee text={`#${props.pull.number} ${props.pull.title}`} fg={theme.hue.accent[500]} />
        </box>
        <BrowserAction context={props.context} url={props.pull.url} mode={props.mode} label={props.glyphs.browser} />
      </box>
      <box flexDirection="row" minWidth={0}>
        <text fg={ciFg} wrapMode="none" truncate>
          {props.glyphs.ci[props.pull.ci]} {CI_META[props.pull.ci].label}
        </text>
        <text fg={theme.text.muted} wrapMode="none" truncate>
          {" · "}
        </text>
        <text fg={mergeFg} wrapMode="none" truncate>
          {MERGE_LABEL[props.pull.merge]}
        </text>
        <text fg={theme.text.muted} wrapMode="none" truncate>
          {" · "}
          {pullDetailRest(props.pull, props.viewer)}
        </text>
      </box>
    </Row>
  )
}

export function IssueRow(props: {
  readonly context: Context
  readonly issue: IssueView
  readonly viewer: string
  readonly labels: number
  readonly linked: boolean
  readonly glyphs: GlyphSet
  readonly mode: OpenLinks
  readonly marker: string
  readonly id?: string | undefined
  readonly selected?: boolean | undefined
  readonly onActivate: () => void
}) {
  const theme = props.context.theme
  const markerColor = () => {
    if (props.linked) return theme.text.feedback.success.base
    return theme.text.muted
  }

  return (
    <Row context={props.context} onActivate={props.onActivate} id={props.id} selected={props.selected}>
      <box flexDirection="row" minWidth={0}>
        <text flexShrink={0} fg={markerColor()}>
          {props.marker}{" "}
        </text>
        <box flexGrow={1} flexShrink={1} minWidth={0}>
          <Marquee text={`#${props.issue.number} ${props.issue.title}`} fg={theme.hue.accent[500]} />
        </box>
        <BrowserAction context={props.context} url={props.issue.url} mode={props.mode} label={props.glyphs.browser} />
      </box>
      <text fg={theme.text.muted} wrapMode="none" truncate>
        {"  "}
        {issueDetailRest(props.issue, props.viewer, props.labels)}
      </text>
    </Row>
  )
}

function issueDetailRest(issue: IssueView, viewer: string, maxLabels: number): string {
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

function viewerMatches(value: string, viewer: string): boolean {
  return viewer.length > 0 && value.toLowerCase() === viewer.toLowerCase()
}

export function SectionHeader(props: {
  readonly context: Context
  readonly title: string
  readonly onToggle: () => void
}) {
  return (
    <box
      minWidth={0}
      onMouseUp={(event: MouseLike) => {
        if (event.button !== 0) return
        props.onToggle()
      }}
    >
      <text fg={props.context.theme.text.base} wrapMode="none" truncate>
        <b>{props.title}</b>
      </text>
    </box>
  )
}

export function MoreRow(props: { readonly context: Context; readonly label: string }) {
  return (
    <text fg={props.context.theme.text.faint} wrapMode="none" truncate>
      {props.label}
    </text>
  )
}

export function EmptyRow(props: { readonly context: Context; readonly label: string }) {
  return (
    <text fg={props.context.theme.text.muted} wrapMode="none" truncate>
      {props.label}
    </text>
  )
}
