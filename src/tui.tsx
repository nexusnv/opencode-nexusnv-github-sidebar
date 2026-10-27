/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import type { Context } from "@opencode/plugin/tui/context"
import { Show, createEffect, createSignal, on, onCleanup } from "solid-js"
import { GithubSidebarRpc } from "./rpc.js"
import { requireRpcLocation } from "./shared/location.js"
import { SERVER_PLUGIN_ID, TUI_PLUGIN_ID } from "./shared/ids.js"

export { TUI_PLUGIN_ID } from "./shared/ids.js"

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

/**
 * Presentational foundation marker. P0 replaces this with the repository
 * header, rows, sections, refresh, and connect states.
 */
export function SidebarReady(props: { status: SidebarStatus | (() => SidebarStatus) }) {
  // Accept an accessor so a status signal actually propagates through the
  // component. Reading `props.status` once would freeze the marker at mount.
  const status = () => (typeof props.status === "function" ? props.status() : props.status)

  return (
    <box>
      <Show when={status() !== "loading"} fallback={<box />}>
        <text>
          <b>{status() === "ready" ? "GitHub" : "GitHub unavailable"}</b>
        </text>
      </Show>
    </box>
  )
}

export function Sidebar(props: { context: Context }) {
  const [status, setStatus] = createSignal<SidebarStatus>("loading")

  createEffect(
    on(
      // Track the whole location identity, not only the directory: a workspace
      // switch can reuse the same directory. The RPC wire still carries only
      // `{ directory }`, so the health reply itself is directory-keyed.
      () => props.context.location,
      (location) => {
        const controller = new AbortController()
        onCleanup(() => controller.abort())

        setStatus("loading")
        // A missing location is not an error here: the host may still be
        // resolving it. Never fall back to the server's default location.
        if (!location?.directory) return

        void checkHealth(props.context, controller.signal)
          .then((next) => {
            if (!controller.signal.aborted) setStatus(next)
          })
          .catch(() => {
            if (!controller.signal.aborted) setStatus("error")
          })
      },
    ),
  )

  return <SidebarReady status={status} />
}

/**
 * TUI half of the plugin.
 *
 * The foundation registers one additive `sidebar.content` claim and calls the
 * server `health` RPC through the project location. P0 builds the real sidebar
 * inside this component.
 */
export default Plugin.define({
  id: TUI_PLUGIN_ID,
  setup(context) {
    context.ui.slot({
      append: "sidebar.content",
      render: () => <Sidebar context={context} />,
    })
  },
})
