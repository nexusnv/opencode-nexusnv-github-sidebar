import { describe, expect, test } from "bun:test"
import server from "../src/index"
import { GithubSidebarRpc } from "../src/rpc"
import tui from "../src/tui"
import { SERVER_PLUGIN_ID, TUI_PLUGIN_ID } from "../src/shared/ids"

type ServerContext = Parameters<typeof server.setup>[0]
type TuiContext = Parameters<typeof tui.setup>[0]

interface IntegrationRecord {
  readonly id: string
  readonly apply: (integration: { name?: string }) => void
}

interface MethodRecord {
  readonly integrationID: string
  readonly method: unknown
}

function fakeServerContext(location = "/work/repo") {
  const integrations: IntegrationRecord[] = []
  const methods: MethodRecord[] = []
  let registered: { readonly dispose: () => Promise<void> } | undefined
  let health: ((input: unknown, context: unknown) => Promise<unknown>) | undefined
  let disposed = false

  const context = {
    location: { directory: location },
    integration: {
      transform: async (transform: (editor: unknown) => void) => {
        transform({
          update: (id: string, apply: (integration: { name?: string }) => void) => {
            integrations.push({ id, apply })
          },
          method: {
            update: (method: MethodRecord) => {
              methods.push(method)
            },
          },
        })
      },
    },
    rpc: {
      register: async (
        contract: unknown,
        handlers: { readonly health: (input: unknown, context: unknown) => Promise<unknown> },
      ) => {
        expect(contract).toBe(GithubSidebarRpc)
        health = handlers.health
        registered = {
          dispose: async () => {
            disposed = true
          },
        }
        return registered
      },
    },
  }

  return {
    context: context as unknown as ServerContext,
    integrations,
    methods,
    health: () => health,
    disposed: () => disposed,
  }
}

describe("server plugin setup", () => {
  test("registers the GitHub integration and credential methods", async () => {
    const fixture = fakeServerContext()
    await server.setup(fixture.context)

    expect(fixture.integrations).toHaveLength(1)
    const integration = { name: "" }
    fixture.integrations[0]?.apply(integration)
    expect(integration.name).toBe("GitHub (sidebar)")

    expect(fixture.methods).toContainEqual({
      integrationID: SERVER_PLUGIN_ID,
      method: { type: "env", names: ["GH_TOKEN", "GITHUB_TOKEN"] },
    })
    expect(fixture.methods).toContainEqual({
      integrationID: SERVER_PLUGIN_ID,
      method: { type: "key", label: "GitHub personal access token" },
    })
  })

  test("serves health for the server location and disposes its registration", async () => {
    const fixture = fakeServerContext("/srv/project")
    const cleanup = await server.setup(fixture.context)
    const health = fixture.health()

    expect(health).toBeFunction()
    expect(await health?.({}, {})).toEqual({ ok: true, plugin: SERVER_PLUGIN_ID, location: "/srv/project" })

    await cleanup?.()
    expect(fixture.disposed()).toBe(true)
  })
})

describe("TUI plugin setup", () => {
  test("appends additive sidebar, panel, and command claims", () => {
    const claims: Array<{ append?: string; replace?: string; render: unknown }> = []
    const context = {
      ui: {
        slot: (claim: { append?: string; replace?: string; render: unknown }) => {
          claims.push(claim)
          return () => undefined
        },
      },
    } as unknown as TuiContext

    tui.setup(context)

    expect(claims).toHaveLength(3)
    expect(claims.map((claim) => claim.append)).toEqual(["sidebar.content", "session.panel", "app"])
    for (const claim of claims) {
      expect(claim.replace).toBeUndefined()
      expect(claim.render).toBeFunction()
    }
  })

  test("uses the canonical identifier", () => {
    expect(tui.id).toBe(TUI_PLUGIN_ID)
  })
})
