/** @jsxImportSource @opentui/solid */
import { createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import type { RGBA } from "@opentui/core"

/**
 * A line of text that scrolls like a marquee on mouse hover when it is longer
 * than the available width. Short text renders as-is with no ellipsis.
 *
 * Long titles (pull requests, issues) are shown from the start by default.
 * Hovering the row scrolls the text left-to-right so the rest becomes visible,
 * similar to the opencode native session name and the opencode-prs plugin.
 */
export function Marquee(props: {
  readonly text: string
  readonly fg?: RGBA
  /** Available width in cells. Defaults to a conservative sidebar width. */
  readonly width?: number
}) {
  const [hovered, setHovered] = createSignal(false)
  const [offset, setOffset] = createSignal(0)
  const width = props.width ?? 32

  const scroll = createMemo(() => {
    const text = props.text
    if (!hovered() || text.length <= width) return text
    const padded = text + "   " + text
    const start = offset() % (text.length + 3)
    return padded.slice(start, start + width)
  })

  createEffect(() => {
    if (!hovered()) {
      setOffset(0)
      return
    }
    const text = props.text
    if (text.length <= width) return
    const handle = setInterval(() => {
      setOffset((current) => (current + 1) % (text.length + 3))
    }, 120)
    onCleanup(() => clearInterval(handle))
  })

  return (
    <text
      wrapMode="none"
      {...(props.fg ? { fg: props.fg } : {})}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
    >
      {scroll()}
    </text>
  )
}
