/** @jsxImportSource @opentui/solid */
import type { Context } from "@opencode/plugin/tui/context"
import { Show } from "solid-js"
import type { JSX } from "@opentui/solid"
import type { IssueView, PullView } from "../shared/types.js"
import { issueDetail, pullDetail, type GlyphSet } from "./format.js"
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
  readonly children: JSX.Element
}) {
  return (
    <box
      flexDirection="column"
      minWidth={0}
      onMouseUp={(event: MouseLike) => {
        if (event.button !== 0) return
        props.onActivate()
      }}
    >
      {props.children}
    </box>
  )
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
  readonly onActivate: () => void
}) {
  const theme = props.context.theme
  const branch = () => props.branchNumber === props.pull.number
  const color = () => {
    if (branch()) return theme.text.action.primary.base
    if (props.linked) return theme.text.feedback.success.base
    return theme.text.muted
  }

  return (
    <Row context={props.context} onActivate={props.onActivate}>
      <box flexDirection="row" minWidth={0}>
        <text flexShrink={0} fg={color()}>
          {props.marker}{" "}
        </text>
        <text flexGrow={1} flexShrink={1} minWidth={0} wrapMode="none" truncate fg={theme.text.base}>
          #{props.pull.number} {props.pull.title}
        </text>
        <BrowserAction context={props.context} url={props.pull.url} mode={props.mode} label={props.glyphs.browser} />
      </box>
      <text fg={theme.text.muted} wrapMode="none" truncate>
        {"  "}
        {pullDetail(props.pull, props.viewer, props.glyphs)}
      </text>
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
  readonly onActivate: () => void
}) {
  const theme = props.context.theme
  const color = () => {
    if (props.linked) return theme.text.feedback.success.base
    return theme.text.muted
  }

  return (
    <Row context={props.context} onActivate={props.onActivate}>
      <box flexDirection="row" minWidth={0}>
        <text flexShrink={0} fg={color()}>
          {props.marker}{" "}
        </text>
        <text flexGrow={1} flexShrink={1} minWidth={0} wrapMode="none" truncate fg={theme.text.base}>
          #{props.issue.number} {props.issue.title}
        </text>
        <BrowserAction context={props.context} url={props.issue.url} mode={props.mode} label={props.glyphs.browser} />
      </box>
      <text fg={theme.text.muted} wrapMode="none" truncate>
        {"  "}
        {issueDetail(props.issue, props.viewer, props.labels)}
      </text>
    </Row>
  )
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
