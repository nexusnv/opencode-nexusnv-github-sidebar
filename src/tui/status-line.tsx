/** @jsxImportSource @opentui/solid */
import type { Context } from "@opencode/plugin/tui/context"
import type { SummaryResponse } from "../shared/types.js"
import { issueStatusText } from "./format.js"

interface MouseLike {
  readonly button: number
  stopPropagation(): void
}

function messageHint(): string {
  return [
    "Run /connect in OpenCode and choose GitHub (sidebar).",
    "You can also set GH_TOKEN or GITHUB_TOKEN on the server.",
    "",
    "The token stays on the server; the sidebar never receives it.",
  ].join("\n")
}

export function connectAlert(context: Context): void {
  // Alert failures are not actionable from a click handler; keep them from
  // surfacing as an unhandled rejection.
  void context.ui.dialog.alert({ title: "Connect GitHub", message: messageHint() }).catch(() => undefined)
}

/**
 * Auth, rate-limit, network, and repo states shared by the sidebar and the
 * full-list panel. Auth states open the connect dialog; retryable states call
 * `onRetry`.
 */
export function StatusLine(props: {
  readonly context: Context
  readonly status: SummaryResponse["status"]
  readonly message: string
  readonly retryAt: string
  readonly onRetry: () => void
}) {
  const theme = props.context.theme
  const text = () => issueStatusText({ status: props.status, message: props.message, retryAt: props.retryAt })
  const isAuth = () => props.status === "no-auth" || props.status === "unauthorized"

  return (
    <text
      fg={props.status === "error" || props.status === "network" ? theme.text.feedback.error.base : theme.text.muted}
      wrapMode="none"
      truncate
      onMouseUp={(event: MouseLike) => {
        if (event.button !== 0) return
        if (isAuth()) {
          connectAlert(props.context)
          return
        }
        if (props.status === "network" || props.status === "error" || props.status === "rate-limited") {
          props.onRetry()
        }
      }}
    >
      {text()}
    </text>
  )
}
