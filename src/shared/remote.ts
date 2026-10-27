/* oxlint-disable eslint/no-control-regex -- sanitizers must match control characters */
export interface RemoteInfo {
  readonly host: string
  readonly owner: string
  readonly name: string
  readonly url: string
}

export type RemoteParseResult = { readonly ok: true; readonly value: RemoteInfo } | { readonly ok: false }

const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const OWNER_OR_NAME = /^[A-Za-z0-9._-]+$/
const SCHEME_WITH_AUTHORITY = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//
const SCP_LIKE = /^(?:[^@/\s]+@)?([^:/\s]+):(.+)$/

/**
 * Normalize an allowlist entry. This is deliberately strict: entries are
 * compared exactly against the host parsed from a remote URL, and a token is
 * only ever sent to a host that survived this check.
 */
export function normalizeAllowlistHost(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const input = value.trim().toLowerCase()
  if (input.length === 0 || input.length > 253) return undefined
  if (/[\s\u0000-\u001f\u007f/:*?#@[\]\\]/.test(input)) return undefined
  const host = input.replace(/\.$/, "")
  if (host === "localhost") return host
  const labels = host.split(".")
  if (labels.length < 2) return undefined
  if (!labels.every((label) => HOST_LABEL.test(label))) return undefined
  return host
}

function normalizeRemoteHost(raw: string): string | undefined {
  const host = raw.trim().toLowerCase().replace(/^\[/, "").replace(/\]$/, "").replace(/\.$/, "")
  if (!host) return undefined
  if (host === "www.github.com" || host === "ssh.github.com") return "github.com"
  if (host === "localhost") return host
  const labels = host.split(".")
  if (labels.length < 2) return undefined
  if (!labels.every((label) => HOST_LABEL.test(label))) return undefined
  return host
}

function repositoryPath(path: string): { owner: string; name: string } | undefined {
  const cleaned = path
    .trim()
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "")
  if (!cleaned) return undefined
  const segments = cleaned.split("/")
  if (segments.length !== 2) return undefined
  const [owner, name] = segments
  if (!owner || !name) return undefined
  if (owner === "." || owner === ".." || name === "." || name === "..") return undefined
  if (!OWNER_OR_NAME.test(owner) || !OWNER_OR_NAME.test(name)) return undefined
  return { owner, name }
}

/**
 * Parse every common GitHub remote form:
 *
 *   git@github.com:owner/repo.git
 *   github.com:owner/repo.git
 *   ssh://git@ghe.example.com:2222/owner/repo.git
 *   https://user:token@github.com/owner/repo.git
 *
 * Credentials in a remote URL are discarded; they are never used as an API
 * token. Anything that is not a host + exactly two path segments is rejected.
 */
export function parseRemoteUrl(raw: string): RemoteParseResult {
  const value = raw.trim()
  if (!value || /[\u0000-\u001f\u007f]/.test(value)) return { ok: false }

  let hostInput: string
  let path: string

  if (SCHEME_WITH_AUTHORITY.test(value)) {
    let url: URL
    try {
      url = new URL(value)
    } catch {
      return { ok: false }
    }
    if (url.protocol !== "https:" && url.protocol !== "http:" && url.protocol !== "ssh:") return { ok: false }
    if (url.search || url.hash) return { ok: false }
    if (url.username || url.password) {
      // The host is still usable; credentials are dropped by rebuilding the URL.
    }
    hostInput = url.hostname
    path = url.pathname
  } else {
    const match = SCP_LIKE.exec(value)
    if (!match) return { ok: false }
    const rawHost = match[1]
    const rawPath = match[2]
    if (!rawHost || !rawPath) return { ok: false }
    if (rawPath.startsWith("//")) return { ok: false }
    hostInput = rawHost
    path = rawPath
  }

  const host = normalizeRemoteHost(hostInput)
  const repository = repositoryPath(path)
  if (!host || !repository) return { ok: false }

  return {
    ok: true,
    value: {
      host,
      owner: repository.owner,
      name: repository.name,
      url: `https://${host}/${repository.owner}/${repository.name}`,
    },
  }
}

export function isHostAllowed(host: string, hosts: readonly string[]): boolean {
  return hosts.includes(host.toLowerCase())
}

export function graphqlEndpoint(host: string, apiUrl?: string): string {
  if (apiUrl) return apiUrl
  if (host === "github.com") return "https://api.github.com/graphql"
  return `https://${host}/api/graphql`
}

/** Defense in depth for diagnostics; never print a remote with inline credentials. */
export function redactUrlCredentials(value: string): string {
  return value.replace(/([A-Za-z][A-Za-z0-9+.-]*:\/\/)([^/@\s]+)@/g, "$1***@")
}
