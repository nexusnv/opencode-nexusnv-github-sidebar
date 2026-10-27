import { beforeEach, describe, expect, test } from "bun:test"
import type { ConnectionInfo } from "@opencode/client"
import { parseConfig } from "../src/config"
import { invalidateAuthCache, resolveAuth, tokenFingerprint, type AuthContext } from "../src/server/auth"

const config = parseConfig({ allowGhCli: false }).config

const connection = { type: "credential", id: "cred", label: "test", method: "key" } as unknown as ConnectionInfo

function authContext(options: {
  directory?: string
  active?: () => Promise<ConnectionInfo | undefined>
  resolve?: (connection: ConnectionInfo) => Promise<unknown>
  connections?: readonly ConnectionInfo[]
}): AuthContext {
  return {
    location: { directory: options.directory ?? "/project" },
    integration: {
      connection: {
        active: options.active ?? (async () => undefined),
        resolve: options.resolve ?? (async () => undefined),
      },
      get: async () => ({ data: { connections: options.connections ?? [] } }),
    },
  }
}

beforeEach(() => {
  invalidateAuthCache()
})

describe("resolveAuth", () => {
  test("prefers the explicit option token", async () => {
    const result = await resolveAuth(
      authContext({
        active: async () => connection,
        resolve: async () => ({ type: "key", key: "integration-token" }),
      }),
      parseConfig({ token: "option-token", allowGhCli: false }).config,
      "github.com",
    )
    expect(result).toEqual({ token: "option-token", source: "option" })
  })

  test("uses the active integration key", async () => {
    const result = await resolveAuth(
      authContext({
        active: async () => connection,
        resolve: async () => ({ type: "key", key: "integration-token" }),
      }),
      config,
      "github.com",
    )
    expect(result).toEqual({ token: "integration-token", source: "integration" })
  })

  test("uses an active OAuth access token", async () => {
    const result = await resolveAuth(
      authContext({
        active: async () => connection,
        resolve: async () => ({ type: "oauth", access: "oauth-token" }),
      }),
      config,
      "github.com",
    )
    expect(result.token).toBe("oauth-token")
  })

  test("falls back to the full connection list when active resolution fails", async () => {
    const result = await resolveAuth(
      authContext({
        connections: [connection],
        active: async () => {
          throw new Error("not registered")
        },
        resolve: async () => ({ type: "key", key: "listed-token" }),
      }),
      config,
      "github.com",
    )
    expect(result).toEqual({ token: "listed-token", source: "integration" })
  })

  test("ignores malformed credentials and returns none", async () => {
    const result = await resolveAuth(
      authContext({
        active: async () => connection,
        resolve: async () => ({ type: "key", key: "bad token" }),
      }),
      config,
      "github.com",
    )
    expect(result).toEqual({ token: undefined, source: "none" })
  })

  test("returns none when no integration or CLI source is available", async () => {
    const result = await resolveAuth(authContext({}), config, "github.com")
    expect(result).toEqual({ token: undefined, source: "none" })
  })

  test("does not leak a cached token across locations", async () => {
    let token = "token-a"
    const ctx = authContext({
      directory: "/project-a",
      active: async () => connection,
      resolve: async () => ({ type: "key", key: token }),
    })
    expect((await resolveAuth(ctx, config, "github.com")).token).toBe("token-a")

    token = "token-b"
    const other = await resolveAuth(
      authContext({
        directory: "/project-b",
        active: async () => connection,
        resolve: async () => ({ type: "key", key: token }),
      }),
      config,
      "github.com",
    )
    expect(other.token).toBe("token-b")

    const firstAgain = await resolveAuth(ctx, config, "github.com")
    expect(firstAgain.token).toBe("token-a")
  })

  test("force invalidates the cached token for the location", async () => {
    let token = "first"
    const ctx = authContext({
      active: async () => connection,
      resolve: async () => ({ type: "key", key: token }),
    })
    expect((await resolveAuth(ctx, config, "github.com")).token).toBe("first")
    token = "second"
    expect((await resolveAuth(ctx, config, "github.com")).token).toBe("first")
    expect((await resolveAuth(ctx, config, "github.com", undefined, { force: true })).token).toBe("second")
  })
})

describe("tokenFingerprint", () => {
  test("is stable, bounded, and non-reversible", () => {
    const a = tokenFingerprint("secret-token")
    expect(a).toBe(tokenFingerprint("secret-token"))
    expect(a).not.toContain("secret")
    expect(a).toHaveLength(16)
    expect(tokenFingerprint(undefined)).toBe("none")
  })
})
