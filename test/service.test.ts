import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseConfig } from "../src/config"
import { runGit } from "../src/shared/git"
import { GithubSidebarService, type ServiceContext } from "../src/server/service"

const roots: string[] = []

async function git(args: string[], cwd: string): Promise<string> {
  return runGit(args, cwd, { timeoutMs: 15_000 })
}

async function tempRepo(remote?: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "github-sidebar-service-"))
  roots.push(directory)
  await git(["init", "-b", "main"], directory)
  await writeFile(join(directory, "file.txt"), "x\n")
  await git(["add", "."], directory)
  await git(["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "init"], directory)
  if (remote) await git(["remote", "add", "origin", remote], directory)
  return directory
}

function context(directory: string): ServiceContext {
  return {
    location: { directory, project: { id: "project-1", directory } },
    integration: {
      connection: {
        active: async () => undefined,
        resolve: async () => undefined,
      },
      get: async () => ({ data: { connections: [] } }),
    },
    worktree: {
      list: async () => [],
      create: async () => {
        throw new Error("not used")
      },
      remove: async () => {},
    },
    storage: {
      get: async () => undefined,
      set: async () => {},
    },
  }
}

const pullNode = {
  number: 1,
  title: "Fix the widget",
  url: "https://evil.example/attacker",
  isDraft: false,
  isCrossRepository: false,
  headRefName: "fix",
  headRepositoryOwner: { login: "me" },
  author: { login: "me" },
  mergeable: "MERGEABLE",
  mergeStateStatus: "CLEAN",
  reviewDecision: null,
  updatedAt: "2026-10-01T10:00:00Z",
  comments: { totalCount: 0 },
  reviews: { totalCount: 0 },
  statusCheckRollup: { state: "SUCCESS" },
}

const issueNode = {
  number: 2,
  title: "Widget request",
  updatedAt: "2026-10-02T10:00:00Z",
  author: { login: "other" },
  assignees: { nodes: [] },
  comments: { totalCount: 0 },
  labels: { nodes: [] },
}

function summaryBody() {
  return {
    viewer: { login: "me" },
    rateLimit: { cost: 1, remaining: 4000, resetAt: "2026-10-27T07:00:00Z" },
    repository: {
      isPrivate: true,
      defaultBranchRef: { name: "main" },
      pullRequests: { totalCount: 1, nodes: [pullNode] },
      branchPr: { nodes: [] },
      issues: { totalCount: 1, nodes: [issueNode] },
    },
  }
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  })
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("GithubSidebarService.summary", () => {
  test("returns ready data and never exposes the token", async () => {
    const directory = await tempRepo("git@github.com:acme/widgets.git")
    let authorization = ""
    const service = new GithubSidebarService(context(directory), parseConfig({ token: "secret-token" }), {
      fetchImpl: async (_input, init) => {
        const headers = (init?.headers ?? {}) as Record<string, string>
        authorization = String(headers.authorization)
        return jsonResponse({ data: summaryBody() })
      },
    })
    const result = await service.summary({ force: false }, new AbortController().signal)
    expect(result.status).toBe("ready")
    expect(result.repository?.isPrivate).toBe(true)
    expect(result.repository?.nameWithOwner).toBe("acme/widgets")
    expect(result.data?.pulls[0]?.url).toBe("https://github.com/acme/widgets/pull/1")
    expect(result.data?.issues[0]?.title).toBe("Widget request")
    expect(result.view.refreshSeconds).toBe(60)
    expect(authorization).toBe("bearer secret-token")
    expect(JSON.stringify(result)).not.toContain("secret-token")
  })

  test("serves the cache until refreshSeconds and honors force", async () => {
    const directory = await tempRepo("git@github.com:acme/widgets.git")
    const time = { value: 1_000_000, now: () => time.value }
    let calls = 0
    const service = new GithubSidebarService(
      context(directory),
      parseConfig({ token: "secret-token", refreshSeconds: 60, staleSeconds: 0 }),
      {
        now: time.now,
        fetchImpl: async () => {
          calls++
          return jsonResponse({ data: summaryBody() })
        },
      },
    )
    const signal = new AbortController().signal
    expect((await service.summary({ force: false }, signal)).status).toBe("ready")
    expect((await service.summary({ force: false }, signal)).status).toBe("ready")
    expect(calls).toBe(1)

    time.value += 60_001
    expect((await service.summary({ force: false }, signal)).status).toBe("ready")
    expect(calls).toBe(2)

    expect((await service.summary({ force: true }, signal)).status).toBe("ready")
    expect(calls).toBe(3)
  })

  test("serves full rows from the same cached snapshot", async () => {
    const directory = await tempRepo("git@github.com:acme/widgets.git")
    let calls = 0
    const nodes = Array.from({ length: 6 }, (_, index) => ({
      ...pullNode,
      number: 100 + index,
      title: `Pull ${index}`,
      author: { login: "other" },
    }))
    const body = summaryBody()
    body.repository.pullRequests.totalCount = 6
    body.repository.pullRequests.nodes = nodes

    const service = new GithubSidebarService(
      context(directory),
      parseConfig({ token: "secret-token", scope: "auto", autoAllThreshold: 1, pulls: { limit: 2 } }),
      {
        fetchImpl: async () => {
          calls++
          return jsonResponse({ data: body })
        },
      },
    )
    const signal = new AbortController().signal

    const bounded = await service.summary({ force: false }, signal)
    const full = await service.summary({ force: false, full: true }, signal)

    expect(calls).toBe(1)
    expect(bounded.data?.pulls).toHaveLength(2)
    expect(full.data?.pulls).toHaveLength(6)
    expect(full.data?.totals.pulls).toBe(6)
  })

  test("serves stale data when a refresh fails inside staleSeconds", async () => {
    const directory = await tempRepo("git@github.com:acme/widgets.git")
    const time = { value: 1_000_000, now: () => time.value }
    let fail = false
    const service = new GithubSidebarService(
      context(directory),
      parseConfig({ token: "secret-token", refreshSeconds: 60, staleSeconds: 300 }),
      {
        now: time.now,
        fetchImpl: async () => {
          if (fail) throw new Error("offline")
          return jsonResponse({ data: summaryBody() })
        },
      },
    )
    const signal = new AbortController().signal
    const first = await service.summary({ force: false }, signal)
    expect(first.status).toBe("ready")

    fail = true
    time.value += 120_000
    const stale = await service.summary({ force: false }, signal)
    expect(stale.status).toBe("stale")
    expect(stale.data?.pulls[0]?.number).toBe(1)

    time.value += 300_000
    const failed = await service.summary({ force: false }, signal)
    expect(failed.status).toBe("network")
  })

  test.each([
    ["no-git", async () => mkdtemp(join(tmpdir(), "github-sidebar-nogit-"))],
    ["no-remote", async () => tempRepo()],
    ["no-remote", async () => tempRepo("/tmp/not-a-github-remote")],
    ["unsupported-host", async () => tempRepo("git@gitlab.com:acme/widgets.git")],
  ] as const)("maps repository detection to %s", async (expected, make) => {
    const directory = await make()
    if (!directory.startsWith(tmpdir())) roots.push(directory)
    const service = new GithubSidebarService(context(directory), parseConfig({ token: "secret-token" }), {
      fetchImpl: async () => {
        throw new Error("must not fetch")
      },
    })
    const result = await service.summary({ force: false }, new AbortController().signal)
    expect(result.status).toBe(expected)
  })

  test("returns disabled before touching the repository", async () => {
    const service = new GithubSidebarService(context("/does/not/exist"), parseConfig({ enabled: false }), {
      fetchImpl: async () => {
        throw new Error("must not fetch")
      },
    })
    expect((await service.summary({ force: false }, new AbortController().signal)).status).toBe("disabled")
  })

  test("returns a configuration error before touching the repository", async () => {
    const service = new GithubSidebarService(context("/does/not/exist"), parseConfig({ hosts: ["https://bad"] }), {
      fetchImpl: async () => {
        throw new Error("must not fetch")
      },
    })
    const result = await service.summary({ force: false }, new AbortController().signal)
    expect(result.status).toBe("error")
    expect(result.message).toContain("Configuration error")
  })

  test("reports no-auth when no credential source is available", async () => {
    const directory = await tempRepo("git@github.com:acme/widgets.git")
    const service = new GithubSidebarService(context(directory), parseConfig({ allowGhCli: false }), {
      fetchImpl: async () => {
        throw new Error("must not fetch")
      },
    })
    const result = await service.summary({ force: false }, new AbortController().signal)
    expect(result.status).toBe("no-auth")
    expect(result.repository?.nameWithOwner).toBe("acme/widgets")
  })

  test.each([
    [401, "unauthorized"],
    [403, "unauthorized"],
    [404, "not-found"],
    [500, "network"],
  ] as const)("maps HTTP %i to %s", async (statusCode, expected) => {
    const directory = await tempRepo("git@github.com:acme/widgets.git")
    const service = new GithubSidebarService(context(directory), parseConfig({ token: "secret-token" }), {
      fetchImpl: async () => jsonResponse({ message: "error" }, statusCode),
    })
    const result = await service.summary({ force: false }, new AbortController().signal)
    expect(result.status).toBe(expected)
  })

  test("maps a rate-limit response and preserves retry timing", async () => {
    const directory = await tempRepo("git@github.com:acme/widgets.git")
    const service = new GithubSidebarService(context(directory), parseConfig({ token: "secret-token" }), {
      fetchImpl: async () => jsonResponse({ message: "rate limited" }, 429, { "retry-after": "120" }),
    })
    const result = await service.summary({ force: false }, new AbortController().signal)
    expect(result.status).toBe("rate-limited")
    expect(result.retryAt).not.toBe("")
  })

  test("maps a GraphQL repository-not-found body to not-found", async () => {
    const directory = await tempRepo("git@github.com:acme/widgets.git")
    const service = new GithubSidebarService(context(directory), parseConfig({ token: "secret-token" }), {
      fetchImpl: async () =>
        jsonResponse({
          data: null,
          errors: [{ type: "NOT_FOUND", message: "Could not resolve to a Repository with the name 'acme/widgets'." }],
        }),
    })
    const result = await service.summary({ force: false }, new AbortController().signal)
    expect(result.status).toBe("not-found")
  })
})

describe("GithubSidebarService.prepare", () => {
  test("launches in the current workspace when worktrees are disabled", async () => {
    const directory = await tempRepo("git@github.com:acme/widgets.git")
    let query = ""
    const service = new GithubSidebarService(
      context(directory),
      parseConfig({ token: "secret-token", actions: { worktree: false } }),
      {
        fetchImpl: async (_input, init) => {
          query = String(init?.body)
          return jsonResponse({
            data: {
              repository: {
                isPrivate: true,
                defaultBranchRef: { name: "main" },
                pullRequest: {
                  ...pullNode,
                  body: "PR body",
                  state: "OPEN",
                  baseRefName: "main",
                  headRefOid: "abc",
                },
              },
            },
          })
        },
      },
    )
    const result = await service.prepare({ kind: "pull", number: 1 }, new AbortController().signal)
    expect(result.ok).toBe(true)
    expect(result.code).toBe("ok")
    expect(result.sessionDirectory).toBe(directory)
    expect(result.worktree).toBe("")
    expect(result.repository.isPrivate).toBe(true)
    expect(result.context).toContain("PR body")
    expect(result.context).toContain("left untouched")
    expect(query).toContain("LaunchPullContext")
  })

  test("returns not-found when a PR number resolves to no PR", async () => {
    const directory = await tempRepo("git@github.com:acme/widgets.git")
    const service = new GithubSidebarService(context(directory), parseConfig({ token: "secret-token" }), {
      fetchImpl: async () => jsonResponse({ data: { repository: { pullRequest: null } } }),
    })
    const result = await service.prepare({ kind: "pull", number: 1 }, new AbortController().signal)
    expect(result.ok).toBe(false)
    expect(result.code).toBe("not-found")
  })

  test("refuses a pull request number on the issue path", async () => {
    const directory = await tempRepo("git@github.com:acme/widgets.git")
    const service = new GithubSidebarService(context(directory), parseConfig({ token: "secret-token" }), {
      fetchImpl: async () =>
        jsonResponse({
          data: {
            repository: {
              issueOrPullRequest: { __typename: "PullRequest", number: 1 },
            },
          },
        }),
    })
    const result = await service.prepare({ kind: "issue", number: 1 }, new AbortController().signal)
    expect(result.ok).toBe(false)
    expect(result.code).toBe("not-found")
  })

  test("returns disabled when the plugin or actions are off", async () => {
    const directory = await tempRepo("git@github.com:acme/widgets.git")
    const disabled = new GithubSidebarService(context(directory), parseConfig({ enabled: false }), {
      fetchImpl: async () => {
        throw new Error("must not fetch")
      },
    })
    expect((await disabled.prepare({ kind: "pull", number: 1 }, new AbortController().signal)).code).toBe("disabled")

    const noActions = new GithubSidebarService(context(directory), parseConfig({ actions: { enabled: false } }), {
      fetchImpl: async () => {
        throw new Error("must not fetch")
      },
    })
    expect((await noActions.prepare({ kind: "pull", number: 1 }, new AbortController().signal)).code).toBe("disabled")
  })
})
