/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import { Show } from "solid-js"
import { GithubPanel, PanelCommands } from "./tui/panel.js"
import { Sidebar } from "./tui/sidebar.js"
import { TUI_PLUGIN_ID } from "./shared/ids.js"

export { TUI_PLUGIN_ID } from "./shared/ids.js"
export { Sidebar } from "./tui/sidebar.js"
export { GithubPanel, openGithubPanel, PanelCommands } from "./tui/panel.js"
export { checkHealth, isHealthResult, type HealthResult, type SidebarStatus } from "./tui/state.js"

/**
 * TUI half of the plugin.
 *
 * Registers one additive `sidebar.content` claim plus the full-list
 * `session.panel` claim and its global open command. The sidebar renders the
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
    context.ui.slot({
      append: "session.panel",
      render: (panel) => (
        <Show when={panel.name === "github"}>
          <GithubPanel context={context} panel={panel} />
        </Show>
      ),
    })
    context.ui.slot({
      append: "app",
      render: () => <PanelCommands context={context} />,
    })
  },
})
