import { Plugin } from "@opencode/plugin"
import { parseConfig } from "./config.js"
import { GithubSidebarRpc } from "./rpc.js"
import { GithubSidebarService } from "./server/service.js"
import { parseLaunchInput, parseSummaryInput } from "./shared/contract.js"
import { SERVER_PLUGIN_ID } from "./shared/ids.js"

export { SERVER_PLUGIN_ID } from "./shared/ids.js"

/**
 * Server half of the plugin.
 *
 * The server owns repository detection, auth resolution, GitHub GraphQL,
 * caching, and all git/worktree work. The TUI only receives normalized,
 * sanitized rows and launch context; it never sees a token or a raw remote.
 */
export default Plugin.define({
  id: SERVER_PLUGIN_ID,

  async setup(ctx) {
    const parsed = parseConfig(ctx.options)

    await ctx.integration.transform((editor) => {
      editor.update(SERVER_PLUGIN_ID, (integration) => {
        integration.name = "GitHub (sidebar)"
      })
      editor.method.update({
        integrationID: SERVER_PLUGIN_ID,
        method: { type: "env", names: parsed.config.tokenEnv },
      })
      editor.method.update({
        integrationID: SERVER_PLUGIN_ID,
        method: { type: "key", label: "GitHub personal access token" },
      })
    })

    const service = new GithubSidebarService(ctx, parsed)
    const registration = await ctx.rpc.register(GithubSidebarRpc, {
      health: async () => ({
        ok: true,
        plugin: SERVER_PLUGIN_ID,
        location: ctx.location.directory,
      }),
      summary: async (input, call) => service.summary(parseSummaryInput(input), call.signal),
      prepareLaunch: async (input, call) => service.prepare(parseLaunchInput(input), call.signal),
    })

    return async () => {
      await registration.dispose()
    }
  },
})
