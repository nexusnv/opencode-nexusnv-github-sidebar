import { Plugin } from "@opencode/plugin"
import { GithubSidebarRpc } from "./rpc.js"
import { SERVER_PLUGIN_ID } from "./shared/ids.js"

export { SERVER_PLUGIN_ID } from "./shared/ids.js"

/**
 * Server half of the plugin.
 *
 * The foundation registers the plugin-owned credential integration and the
 * location-scoped `health` method. P0 adds repository detection, GitHub data,
 * caching, and launch RPCs on top of this setup.
 */
export default Plugin.define({
  id: SERVER_PLUGIN_ID,

  async setup(ctx) {
    await ctx.integration.transform((editor) => {
      editor.update(SERVER_PLUGIN_ID, (integration) => {
        integration.name = "GitHub (sidebar)"
      })
      editor.method.update({
        integrationID: SERVER_PLUGIN_ID,
        method: { type: "env", names: ["GH_TOKEN", "GITHUB_TOKEN"] },
      })
      editor.method.update({
        integrationID: SERVER_PLUGIN_ID,
        method: { type: "key", label: "GitHub personal access token" },
      })
    })

    const registration = await ctx.rpc.register(GithubSidebarRpc, {
      health: async () => ({
        ok: true,
        plugin: SERVER_PLUGIN_ID,
        location: ctx.location.directory,
      }),
    })

    return async () => {
      await registration.dispose()
    }
  },
})
