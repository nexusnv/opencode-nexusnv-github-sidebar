import { describe, expect, test } from "bun:test"
import { Host } from "@opencode/plugin/host"
import { resolve } from "node:path"

const root = resolve(import.meta.dir, "..")
const directoryEntrypoints = Host.resolve({ directory: root })
const packageEntrypoints = Host.resolve({ directory: root, name: "opencode-nexusnv-github-sidebar" })

const targets = [
  ["directory", directoryEntrypoints],
  ["package", packageEntrypoints],
] as const

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} entrypoint did not resolve`)
  return value
}

interface PluginModule {
  readonly default?: {
    readonly id?: unknown
    readonly setup?: unknown
  }
}

interface RpcModule {
  readonly GithubSidebarRpc?: {
    readonly id?: unknown
  }
}

describe("plugin host contract", () => {
  test("directory targets resolve all three entrypoints", () => {
    expect(directoryEntrypoints.server).toEndWith("/index.ts")
    expect(directoryEntrypoints.tui).toEndWith("/tui.tsx")
    expect(directoryEntrypoints.rpc).toEndWith("/rpc.ts")
  })

  test("package-name targets resolve all three entrypoints", () => {
    expect(packageEntrypoints.server).toEndWith("/src/index.ts")
    expect(packageEntrypoints.tui).toEndWith("/src/tui.tsx")
    expect(packageEntrypoints.rpc).toEndWith("/src/rpc.ts")
  })

  for (const [label, entrypoints] of targets) {
    test(`${label} server entrypoint exports a default plugin definition`, async () => {
      const module = (await Host.load(required(entrypoints.server, "server"))) as PluginModule

      expect(module.default?.id).toBe("github-sidebar")
      expect(typeof module.default?.setup).toBe("function")
    })

    test(`${label} TUI entrypoint exports a default plugin definition`, async () => {
      const module = (await Host.load(required(entrypoints.tui, "tui"))) as PluginModule

      expect(module.default?.id).toBe("github-sidebar.tui")
      expect(typeof module.default?.setup).toBe("function")
    })

    test(`${label} RPC entrypoint exports a portable contract`, async () => {
      const module = (await Host.load(required(entrypoints.rpc, "rpc"))) as RpcModule

      expect(module.GithubSidebarRpc?.id).toBe("github-sidebar")
    })
  }
})
