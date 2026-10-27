import { Rpc } from "@opencode/plugin/rpc"
import { RPC_ID } from "./shared/ids.js"

export { RPC_ID } from "./shared/ids.js"

/**
 * Location-scoped shared contract.
 *
 * `health` is the foundation vertical slice: it proves that the server half is
 * active for the location the TUI is displaying. The P0 data methods will be
 * added here without changing the transport or the location contract.
 */
export const GithubSidebarRpc = Rpc.define({
  id: RPC_ID,
  methods: {
    health: {
      input: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          plugin: { type: "string" },
          location: { type: "string" },
        },
        required: ["ok", "plugin", "location"],
        additionalProperties: false,
      },
    },
  },
  events: {},
})
