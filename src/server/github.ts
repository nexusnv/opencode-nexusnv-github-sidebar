export type GithubErrorCode = "unauthorized" | "forbidden" | "not-found" | "rate-limited" | "network" | "graphql"

export class GithubRequestError extends Error {
  readonly code: GithubErrorCode
  readonly retryAt: string | undefined

  constructor(code: GithubErrorCode, message: string, retryAt?: string) {
    super(message)
    this.name = "GithubRequestError"
    this.code = code
    this.retryAt = retryAt
  }
}

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export interface GithubRequest {
  readonly endpoint: string
  readonly token: string
  readonly query: string
  readonly variables: Readonly<Record<string, unknown>>
  readonly timeoutMs: number
  readonly userAgent: string
  readonly signal?: AbortSignal
  readonly fetchImpl?: FetchLike
}

const GENERIC_MESSAGES: Readonly<Record<GithubErrorCode, string>> = {
  unauthorized: "GitHub token is invalid or lacks access",
  forbidden: "GitHub denied the request",
  "not-found": "Repository or item not found",
  "rate-limited": "GitHub rate limit reached",
  network: "GitHub is unreachable",
  graphql: "GitHub returned an unexpected response",
}

function retryTime(headers: Headers): string {
  const retryAfter = headers.get("retry-after")
  if (retryAfter) {
    const seconds = Number(retryAfter)
    if (Number.isFinite(seconds) && seconds >= 0) return new Date(Date.now() + seconds * 1000).toISOString()
    const date = new Date(retryAfter)
    if (!Number.isNaN(date.getTime())) return date.toISOString()
  }
  const reset = headers.get("x-ratelimit-reset")
  if (reset) {
    const seconds = Number(reset)
    if (Number.isFinite(seconds) && seconds > 0) return new Date(seconds * 1000).toISOString()
  }
  return ""
}

function errorCodes(body: unknown): string[] {
  if (typeof body !== "object" || body === null) return []
  const errors = (body as { errors?: unknown }).errors
  if (!Array.isArray(errors)) return []
  return errors.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return []
    const type = (entry as { type?: unknown }).type
    const message = (entry as { message?: unknown }).message
    return [typeof type === "string" ? type : "", typeof message === "string" ? message : ""]
  })
}

function classifyGraphql(body: unknown): GithubRequestError {
  const entries = errorCodes(body)
  const joined = entries.join(" ").toLowerCase()
  if (joined.includes("rate limit") || joined.includes("ratelimited")) {
    return new GithubRequestError("rate-limited", GENERIC_MESSAGES["rate-limited"])
  }
  if (joined.includes("bad credentials") || joined.includes("could not resolve to a repository")) {
    return new GithubRequestError("not-found", GENERIC_MESSAGES["not-found"])
  }
  return new GithubRequestError("graphql", GENERIC_MESSAGES.graphql)
}

/**
 * Minimal GraphQL transport. Always POST, always HTTPS, never follow a
 * redirect, and always keep the token in the Authorization header only.
 */
export async function githubGraphql<T>(request: GithubRequest): Promise<T> {
  const endpoint = new URL(request.endpoint)
  if (endpoint.protocol !== "https:") {
    throw new GithubRequestError("graphql", "GitHub endpoint must use HTTPS")
  }

  const fetchImpl = request.fetchImpl ?? fetch
  const timeout = AbortSignal.timeout(request.timeoutMs)
  const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout

  let response: Response
  try {
    response = await fetchImpl(request.endpoint, {
      method: "POST",
      headers: {
        authorization: `bearer ${request.token}`,
        "content-type": "application/json",
        accept: "application/json",
        "user-agent": request.userAgent,
      },
      body: JSON.stringify({ query: request.query, variables: request.variables }),
      redirect: "error",
      signal,
    })
  } catch (error) {
    if (request.signal?.aborted) throw error
    throw new GithubRequestError("network", GENERIC_MESSAGES.network)
  }

  if (!response.ok) {
    const retryAt = response.status === 403 || response.status === 429 ? retryTime(response.headers) : ""
    if (response.status === 401) throw new GithubRequestError("unauthorized", GENERIC_MESSAGES.unauthorized)
    if (response.status === 404) throw new GithubRequestError("not-found", GENERIC_MESSAGES["not-found"])
    if (response.status === 429) {
      throw new GithubRequestError("rate-limited", GENERIC_MESSAGES["rate-limited"], retryAt)
    }
    if (response.status === 403) {
      const remaining = response.headers.get("x-ratelimit-remaining")
      if (remaining === "0" || retryAt) {
        throw new GithubRequestError("rate-limited", GENERIC_MESSAGES["rate-limited"], retryAt)
      }
      throw new GithubRequestError("forbidden", GENERIC_MESSAGES.forbidden)
    }
    if (response.status >= 500) throw new GithubRequestError("network", GENERIC_MESSAGES.network)
    throw new GithubRequestError("graphql", GENERIC_MESSAGES.graphql)
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new GithubRequestError("graphql", GENERIC_MESSAGES.graphql)
  }

  if (typeof body !== "object" || body === null) {
    throw new GithubRequestError("graphql", GENERIC_MESSAGES.graphql)
  }

  const data = (body as { data?: unknown }).data
  if (data === null || data === undefined) {
    throw classifyGraphql(body)
  }

  // GitHub can return HTTP 200 with both partial data and errors. Keep the
  // data; normalization already tolerates missing connections.
  return data as T
}
