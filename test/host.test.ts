import { afterAll, describe, expect, test } from "bun:test"
import { Host } from "@opencode/plugin/host"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(import.meta.dir, "..")
const consumerRoot = mkdtempSync(join(tmpdir(), "github-sidebar-consumer-"))
const installedRoot = join(consumerRoot, "node_modules", "opencode-nexusnv-github-sidebar")
mkdirSync(join(consumerRoot, "node_modules"), { recursive: true })
symlinkSync(root, installedRoot, process.platform === "win32" ? "junction" : "dir")

const directoryEntrypoints = Host.resolve({ directory: root })
const packageEntrypoints = Host.resolve({ directory: consumerRoot, name: "opencode-nexusnv-github-sidebar" })

afterAll(() => rmSync(consumerRoot, { recursive: true, force: true }))

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

  test("package-name targets resolve the compiled entrypoints", () => {
    expect(packageEntrypoints.server).toEndWith("/dist/index.js")
    expect(packageEntrypoints.tui).toEndWith("/dist/tui.js")
    expect(packageEntrypoints.rpc).toEndWith("/dist/rpc.js")
  })

  test("package TUI entrypoint imports the host runtime explicitly", async () => {
    const path = required(packageEntrypoints.tui, "TUI entrypoint")
    const source = await Bun.file(path.startsWith("file:") ? fileURLToPath(path) : path).text()

    expect(source).toContain('from "@opentui/solid"')
    expect(source).not.toContain("@jsxImportSource")
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
