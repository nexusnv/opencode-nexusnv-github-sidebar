/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import { Sidebar } from "./tui/sidebar.js"
import { TUI_PLUGIN_ID } from "./shared/ids.js"

export { TUI_PLUGIN_ID } from "./shared/ids.js"
export { Sidebar } from "./tui/sidebar.js"
export { checkHealth, isHealthResult, type HealthResult, type SidebarStatus } from "./tui/state.js"

/**
 * TUI half of the plugin.
 *
 * Registers one additive `sidebar.content` claim. The sidebar renders the
 * repository header, rows, sections, states, and launch actions; it calls the
 * server through the project location and never reads credentials, files, or
 * worktrees directly.
 */
export default Plugin.define({
  id: TUI_PLUGIN_ID,
  setup(context) {
    context.ui.slot({
      append: "sidebar.content",
      render: (props) => <Sidebar context={context} sessionID={props.sessionID} />,
    })
  },
})
