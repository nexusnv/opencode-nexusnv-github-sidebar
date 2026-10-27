import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { Context } from "@opencode/plugin/tui/context"
import { createSignal } from "solid-js"
import { GithubSidebarRpc } from "../src/rpc"
import { MissingLocationError } from "../src/shared/location"
import { Sidebar, SidebarReady, checkHealth } from "../src/tui"

type HealthOptions = {
  readonly location: { readonly directory: string }
  readonly signal: AbortSignal
}

type HealthCall = (input: unknown, options: HealthOptions) => Promise<unknown>

function fakeContext(
  location: () => { directory: string; workspaceID?: string; project?: unknown } | undefined,
  health: HealthCall,
): Context {
  return {
    get location() {
      return location()
    },
    client: {
      rpc: (contract: unknown) => {
        expect(contract).toBe(GithubSidebarRpc)
        return { health }
      },
    },
  } as unknown as Context
}

test("renders the ready sidebar marker at 36 columns", async () => {
  const app = await testRender(() => <SidebarReady status="ready" />, { width: 36, height: 3 })

  try {
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("GitHub")
  } finally {
    app.renderer.destroy()
  }
})

test("renders nothing before the server is ready", async () => {
  const app = await testRender(() => <SidebarReady status="loading" />, { width: 36, height: 3 })

  try {
    await app.renderOnce()
    expect(app.captureCharFrame()).not.toContain("GitHub")
  } finally {
    app.renderer.destroy()
  }
})

test("renders an explicit marker when the server is unavailable", async () => {
  const app = await testRender(() => <SidebarReady status="error" />, { width: 36, height: 3 })

  try {
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("GitHub unavailable")
  } finally {
    app.renderer.destroy()
  }
})

test("checkHealth sends only the wire location and verifies the reply", async () => {
  const controller = new AbortController()
  const calls: HealthOptions[] = []
  const context = fakeContext(
    () => ({ directory: "/work/repo", project: { id: "project" } }),
    async (_input, options) => {
      calls.push(options)
      return { ok: true, plugin: "github-sidebar", location: "/work/repo" }
    },
  )

  expect(await checkHealth(context, controller.signal)).toBe("ready")
  expect(calls).toHaveLength(1)
  expect(calls[0]?.location).toEqual({ directory: "/work/repo" })
  expect(calls[0]?.signal).toBe(controller.signal)
})

test("checkHealth rejects a reply from another location", async () => {
  const context = fakeContext(
    () => ({ directory: "/work/one" }),
    async () => ({ ok: true, plugin: "github-sidebar", location: "/work/two" }),
  )

  expect(await checkHealth(context, new AbortController().signal)).toBe("error")
})

test("checkHealth rejects a reply from another plugin", async () => {
  const context = fakeContext(
    () => ({ directory: "/work/one" }),
    async () => ({ ok: true, plugin: "someone-else", location: "/work/one" }),
  )

  expect(await checkHealth(context, new AbortController().signal)).toBe("error")
})

test("checkHealth rejects malformed or negative replies", async () => {
  const malformed = fakeContext(
    () => ({ directory: "/work/one" }),
    async () => ({ ok: "yes", plugin: "github-sidebar", location: "/work/one" }),
  )
  const negative = fakeContext(
    () => ({ directory: "/work/one" }),
    async () => ({ ok: false, plugin: "github-sidebar", location: "/work/one" }),
  )

  expect(await checkHealth(malformed, new AbortController().signal)).toBe("error")
  expect(await checkHealth(negative, new AbortController().signal)).toBe("error")
})

test("checkHealth refuses a missing location", async () => {
  const context = fakeContext(
    () => undefined,
    async () => ({ ok: true, plugin: "github-sidebar", location: "/work/one" }),
  )

  await expect(checkHealth(context, new AbortController().signal)).rejects.toThrow(MissingLocationError)
})

test("Sidebar waits for a location, rechecks on change, and resets to loading", async () => {
  const [location, setLocation] = createSignal<{ directory: string } | undefined>(undefined)
  const calls: string[] = []
  let releaseSecond: ((value: unknown) => void) | undefined
  const context = fakeContext(
    () => location(),
    (_input, options) => {
      calls.push(options.location.directory)
      if (options.location.directory === "/work/two") {
        return new Promise((resolve) => {
          releaseSecond = resolve
        })
      }
      return Promise.resolve({ ok: true, plugin: "github-sidebar", location: options.location.directory })
    },
  )

  const app = await testRender(() => <Sidebar context={context} />, { width: 40, height: 3 })
  try {
    await app.renderOnce()
    expect(calls).toEqual([])
    expect(app.captureCharFrame()).not.toContain("GitHub")

    setLocation({ directory: "/work/one" })
    await Bun.sleep(0)
    await app.renderOnce()
    expect(calls).toEqual(["/work/one"])
    expect(app.captureCharFrame()).toContain("GitHub")

    setLocation({ directory: "/work/two" })
    await Bun.sleep(0)
    await app.renderOnce()
    expect(calls).toEqual(["/work/one", "/work/two"])
    expect(app.captureCharFrame()).not.toContain("GitHub")

    releaseSecond?.({ ok: true, plugin: "github-sidebar", location: "/work/two" })
    await Bun.sleep(0)
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("GitHub")
  } finally {
    app.renderer.destroy()
  }
})

test("Sidebar rechecks when the workspace changes with the same directory", async () => {
  const [location, setLocation] = createSignal<{ directory: string; workspaceID: string } | undefined>({
    directory: "/work/one",
    workspaceID: "workspace-one",
  })
  const calls: string[] = []
  const context = fakeContext(
    () => location(),
    async (_input, options) => {
      calls.push(options.location.directory)
      return { ok: true, plugin: "github-sidebar", location: options.location.directory }
    },
  )

  const app = await testRender(() => <Sidebar context={context} />, { width: 40, height: 3 })
  try {
    await Bun.sleep(0)
    await app.renderOnce()
    expect(calls).toEqual(["/work/one"])

    setLocation({ directory: "/work/one", workspaceID: "workspace-two" })
    await Bun.sleep(0)
    await app.renderOnce()
    expect(calls).toEqual(["/work/one", "/work/one"])
    expect(app.captureCharFrame()).toContain("GitHub")
  } finally {
    app.renderer.destroy()
  }
})

test("Sidebar stays blank and makes no RPC while the location is missing", async () => {
  const calls: string[] = []
  const context = fakeContext(
    () => undefined,
    async (_input, options) => {
      calls.push(options.location.directory)
      return { ok: true, plugin: "github-sidebar", location: options.location.directory }
    },
  )
  const app = await testRender(() => <Sidebar context={context} />, { width: 40, height: 3 })

  try {
    await app.renderOnce()
    await Bun.sleep(10)
    await app.renderOnce()
    expect(calls).toEqual([])
    expect(app.captureCharFrame().trim()).toBe("")
  } finally {
    app.renderer.destroy()
  }
})

test("Sidebar shows unavailable when the health RPC rejects", async () => {
  const context = fakeContext(
    () => ({ directory: "/work/one" }),
    async () => {
      throw new Error("server unavailable")
    },
  )
  const app = await testRender(() => <Sidebar context={context} />, { width: 40, height: 3 })

  try {
    await Bun.sleep(0)
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("GitHub unavailable")
  } finally {
    app.renderer.destroy()
  }
})

test("Sidebar shows unavailable when the reply comes from another location", async () => {
  const context = fakeContext(
    () => ({ directory: "/work/one" }),
    async () => ({ ok: true, plugin: "github-sidebar", location: "/work/two" }),
  )
  const app = await testRender(() => <Sidebar context={context} />, { width: 40, height: 3 })

  try {
    await app.renderOnce()
    await Bun.sleep(0)
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("GitHub unavailable")
  } finally {
    app.renderer.destroy()
  }
})

test("Sidebar aborts the in-flight health call on cleanup", async () => {
  let signal: AbortSignal | undefined
  const context = fakeContext(
    () => ({ directory: "/work/one" }),
    (_input, options) => {
      signal = options.signal
      return new Promise(() => undefined)
    },
  )
  const app = await testRender(() => <Sidebar context={context} />, { width: 40, height: 3 })

  await app.renderOnce()
  expect(signal?.aborted).toBe(false)

  app.renderer.destroy()
  expect(signal?.aborted).toBe(true)
})
