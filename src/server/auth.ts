/* oxlint-disable eslint/no-control-regex -- control characters are rejected by design */
import type { ConnectionInfo } from "@opencode/client"
import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { sanitizedGitEnv } from "../shared/git.js"
import { SERVER_PLUGIN_ID } from "../shared/ids.js"
import type { GithubSidebarConfig } from "../config.js"

export type AuthSource = "option" | "integration" | "gh" | "none"

export interface AuthResolution {
  readonly token: string | undefined
  readonly source: AuthSource
}

/**
 * The host's credential value is intentionally typed as `unknown`: the TUI is
 * forbidden from reading it, and `auth.ts` extracts only a token-shaped string.
 * Keeping it opaque also prevents the schema's optional `metadata` from
 * leaking into this boundary.
 */
export interface AuthContext {
  readonly location: { readonly directory: string }
  readonly integration: {
    readonly connection: {
      active(integrationID: string): Promise<ConnectionInfo | undefined>
      resolve(connection: ConnectionInfo): Promise<unknown>
    }
    get(input: {
      readonly integrationID: string
      readonly location?: { readonly directory: string }
    }): Promise<{ readonly data: { readonly connections: readonly ConnectionInfo[] } }>
  }
}

interface CachedToken {
  readonly token: string
  readonly source: AuthSource
  readonly at: number
}

const TOKEN_TTL_MS = 5 * 60_000
const GH_TIMEOUT_MS = 2_500
const tokenCache = new Map<string, CachedToken>()

function cacheKey(directory: string, host: string): string {
  return `${directory}\u0000${host}`
}

/**
 * Drop cached tokens after an explicit refresh, `/connect`, or a 401.
 *
 * Tokens are cached per location as well as per host: two projects can resolve
 * different credentials for the same GitHub host, and a cached token from one
 * location must never be used for another.
 */
export function invalidateAuthCache(directory?: string, host?: string): void {
  if (directory && host) {
    tokenCache.delete(cacheKey(directory, host))
    return
  }
  if (host) {
    const suffix = `\u0000${host}`
    for (const key of tokenCache.keys()) {
      if (key.endsWith(suffix)) tokenCache.delete(key)
    }
    return
  }
  if (directory) {
    const prefix = `${directory}\u0000`
    for (const key of tokenCache.keys()) {
      if (key.startsWith(prefix)) tokenCache.delete(key)
    }
    return
  }
  tokenCache.clear()
}

/** Non-reversible cache key component. Never log or return this value. */
export function tokenFingerprint(token: string | undefined): string {
  if (!token) return "none"
  return createHash("sha256").update(token).digest("hex").slice(0, 16)
}

function validToken(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !/[\s\u0000-\u001f\u007f]/.test(value)
}

function credentialToken(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const credential = value as Record<string, unknown>
  if (credential.type === "key" && validToken(credential.key)) return credential.key
  if (credential.type === "oauth" && validToken(credential.access)) return credential.access
  return undefined
}

function runGhToken(host: string, signal?: AbortSignal): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      "gh",
      ["auth", "token", "--hostname", host, "--no-refresh"],
      {
        timeout: GH_TIMEOUT_MS,
        maxBuffer: 64 << 10,
        env: sanitizedGitEnv(),
        windowsHide: true,
        ...(signal ? { signal } : {}),
      },
      (error, stdout) => {
        if (error) {
          resolve(undefined)
          return
        }
        const token = stdout.trim()
        resolve(validToken(token) ? token : undefined)
      },
    )
  })
}

async function integrationToken(ctx: AuthContext): Promise<string | undefined> {
  try {
    const active = await ctx.integration.connection.active(SERVER_PLUGIN_ID)
    if (active) {
      const token = credentialToken(await ctx.integration.connection.resolve(active))
      if (token) return token
    }
  } catch {
    // Fall through to the full connection list.
  }

  try {
    const info = await ctx.integration.get({
      integrationID: SERVER_PLUGIN_ID,
      location: ctx.location,
    })
    for (const connection of info.data.connections) {
      try {
        const token = credentialToken(await ctx.integration.connection.resolve(connection))
        if (token) return token
      } catch {
        // A stale credential should not hide a later working connection.
      }
    }
  } catch {
    // The integration may not be registered yet; `gh` is the next fallback.
  }
  return undefined
}

/**
 * Resolve a token in a fixed order:
 *   1. explicit `token` option (CI/testing)
 *   2. the plugin-owned OpenCode integration (saved key, then env)
 *   3. `gh auth token --hostname <host>` on the server
 *
 * The token is cached in memory only. Callers must never include it in RPC
 * output, logs, git arguments, or synthetic context.
 */
export async function resolveAuth(
  ctx: AuthContext,
  config: GithubSidebarConfig,
  host: string,
  signal?: AbortSignal,
  options: { readonly force?: boolean } = {},
): Promise<AuthResolution> {
  const key = cacheKey(ctx.location.directory, host)
  if (options.force) invalidateAuthCache(ctx.location.directory, host)

  const cached = tokenCache.get(key)
  if (cached && Date.now() - cached.at < TOKEN_TTL_MS) {
    return { token: cached.token, source: cached.source }
  }

  if (config.token) return { token: config.token, source: "option" }

  const integrated = await integrationToken(ctx)
  if (integrated) {
    tokenCache.set(key, { token: integrated, source: "integration", at: Date.now() })
    return { token: integrated, source: "integration" }
  }

  if (config.allowGhCli) {
    const ghToken = await runGhToken(host, signal)
    if (ghToken) {
      tokenCache.set(key, { token: ghToken, source: "gh", at: Date.now() })
      return { token: ghToken, source: "gh" }
    }
  }

  return { token: undefined, source: "none" }
}
