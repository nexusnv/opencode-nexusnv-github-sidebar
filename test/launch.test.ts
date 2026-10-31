import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseConfig } from "../src/config"
import type { LaunchPullItem, LaunchIssueItem } from "../src/server/normalize"
import { prepareLaunch, type LaunchServerContext } from "../src/server/launch"
import type { DetectedRepo } from "../src/server/repo"
import { runGit } from "../src/shared/git"
import type { JsonValue } from "../src/shared/types"

const roots: string[] = []

async function git(args: string[], cwd: string): Promise<string> {
  return runGit(args, cwd, { timeoutMs: 15_000 })
}

async function commit(directory: string, message: string, file = "file.txt", content = message): Promise<void> {
  await writeFile(join(directory, file), content)
  await git(["add", "."], directory)
  await git(["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", message], directory)
}

interface Fixture {
  readonly root: string
  readonly local: string
  readonly worktrees: string
  readonly repo: DetectedRepo
  readonly context: LaunchServerContext
  readonly created: string[]
  readonly storage: Map<string, JsonValue>
}

async function fixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "github-sidebar-launch-"))
  roots.push(root)

  const bare = join(root, "remote.git")
  await git(["init", "--bare", "-b", "main", bare], root)

  const seed = join(root, "seed")
  await git(["init", "-b", "main", seed], root)
  await mkdir(join(seed, "packages", "app"), { recursive: true })
  await writeFile(join(seed, "packages", "app", "README.md"), "app\n")
  await commit(seed, "initial")
  await git(["remote", "add", "origin", bare], seed)
  await git(["push", "origin", "main"], seed)

  await git(["switch", "-c", "feature"], seed)
  await commit(seed, "feature work")
  await git(["push", "origin", "feature"], seed)
  await git(["push", "origin", "feature:refs/pull/7/head"], seed)

  const local = join(root, "work")
  await git(["clone", bare, local], root)

  const repo: DetectedRepo = {
    root: local,
    remote: "origin",
    branch: "main",
    defaultBranchHint: "main",
    host: "github.com",
    owner: "acme",
    name: "widgets",
    nameWithOwner: "acme/widgets",
    url: "https://github.com/acme/widgets",
  }

  const worktrees = join(root, "worktrees")
  await mkdir(worktrees, { recursive: true })
  const created: string[] = []
  const storage = new Map<string, JsonValue>()

  const context: LaunchServerContext = {
    location: {
      directory: local,
      project: { id: "project-1", directory: local },
    },
    worktree: {
      list: async () => created.map((directory) => ({ directory })),
      create: async (input) => {
        if (!input.from || !input.branch) throw new Error("missing worktree start ref")
        const directory = join(worktrees, `${input.name ?? "worktree"}-${created.length}`)
        await git(["worktree", "add", "--detach", directory, input.branch], input.from)
        created.push(directory)
        return { directory }
      },
      remove: async (input) => {
        await git(["worktree", "remove", input.directory], local)
        const index = created.indexOf(input.directory)
        if (index >= 0) created.splice(index, 1)
      },
    },
    storage: {
      get: async (key) => storage.get(key),
      set: async (key, value) => {
        storage.set(key, value)
      },
    },
  }

  return { root, local, worktrees, repo, context, created, storage }
}

const pullItem: LaunchPullItem = {
  kind: "pull",
  number: 7,
  title: "Add the feature",
  body: "feature body",
  author: "octocat",
  url: "https://github.com/acme/widgets/pull/7",
  headRefName: "feature",
  headRefOid: "abc123",
  baseRefName: "main",
  isCrossRepository: false,
  headRepositoryOwner: "acme",
  isDraft: false,
  state: "OPEN",
  merge: "ready",
  ci: "pass",
  comments: 1,
  reviews: 0,
  defaultBranch: "main",
}

const issueItem: LaunchIssueItem = {
  kind: "issue",
  number: 8,
  title: "Add docs",
  body: "docs body",
  author: "octocat",
  url: "https://github.com/acme/widgets/issues/8",
  assignees: [],
  labels: ["docs"],
  comments: 0,
  state: "OPEN",
  defaultBranch: "main",
}

function options(f: Fixture, overrides: Partial<Parameters<typeof prepareLaunch>[0]> = {}) {
  return {
    ctx: f.context,
    config: parseConfig({ allowGhCli: false }).config,
    repo: f.repo,
    kind: "pull" as const,
    number: 7,
    item: pullItem,
    isPrivate: false,
    signal: new AbortController().signal,
    ...overrides,
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("prepareLaunch", () => {
  test("fetches the PR ref, creates a worktree, branches, and stores reuse state", async () => {
    const f = await fixture()
    const result = await prepareLaunch(options(f))
    expect(result.ok).toBe(true)
    expect(result.code).toBe("ok")
    expect(result.branch).toBe("pr-7")
    expect(result.worktree).toBe(f.created[0]!)
    expect(result.sessionDirectory).toBe(f.created[0]!)
    expect(result.reused).toBe(false)
    expect(result.context).toContain("PR: #7 — Add the feature")
    expect(result.context).toContain("UNTRUSTED BODY")
    expect(result.description).toBe("PR #7 · Add the feature")
    expect(f.created).toHaveLength(1)
    expect(f.storage.size).toBe(1)

    const head = await git(["rev-parse", "HEAD"], result.worktree)
    const remoteHead = await git(["rev-parse", "refs/opencode/pr/7"], f.local)
    expect(head).toBe(remoteHead)

    const upstream = await git(["rev-parse", "--abbrev-ref", "pr-7@{upstream}"], result.worktree)
    expect(upstream).toBe("origin/feature")
  })

  test("reuses a stored worktree for the same item on the same branch", async () => {
    const f = await fixture()
    const first = await prepareLaunch(options(f))
    expect(first.ok).toBe(true)
    const second = await prepareLaunch(options(f))
    expect(second.ok).toBe(true)
    expect(second.reused).toBe(true)
    expect(second.worktree).toBe(first.worktree)
    expect(f.created).toHaveLength(1)
  })

  test("creates no worktree when the worktree gate is off", async () => {
    const f = await fixture()
    const result = await prepareLaunch(
      options(f, { config: parseConfig({ allowGhCli: false, actions: { worktree: false } }).config }),
    )
    expect(result.ok).toBe(true)
    expect(result.worktree).toBe("")
    expect(result.sessionDirectory).toBe(f.local)
    expect(result.branch).toBe("")
    expect(result.context).toContain("left untouched")
    expect(f.created).toHaveLength(0)
  })

  test("honors the issue-specific worktree gate", async () => {
    const f = await fixture()
    const result = await prepareLaunch(
      options(f, {
        kind: "issue",
        number: 8,
        item: issueItem,
        config: parseConfig({ allowGhCli: false, actions: { issueWorktree: false } }).config,
      }),
    )
    expect(result.ok).toBe(true)
    expect(result.worktree).toBe("")
    expect(f.created).toHaveLength(0)
  })

  test("launches an issue from the default branch", async () => {
    const f = await fixture()
    const result = await prepareLaunch(options(f, { kind: "issue", number: 8, item: issueItem }))
    expect(result.ok).toBe(true)
    expect(result.branch).toBe("issue-8")
    expect(result.base).toBe("main")
    expect(result.context).toContain("Issue: #8 — Add docs")
    expect(f.created).toHaveLength(1)
  })

  test("does not set an upstream for a fork PR and warns in context", async () => {
    const f = await fixture()
    const forkItem: LaunchPullItem = {
      ...pullItem,
      isCrossRepository: true,
      headRepositoryOwner: "forker",
      headRefName: "feature",
    }
    const result = await prepareLaunch(options(f, { item: forkItem }))
    expect(result.ok).toBe(true)
    expect(result.context).toContain("fork: forker")
    expect(result.context).toContain("No upstream was set automatically")

    const upstream = await git(["rev-parse", "--abbrev-ref", "pr-7@{upstream}"], result.worktree).catch(() => "")
    expect(upstream).toBe("")
  })

  test("returns fetch-failed when the PR ref cannot be fetched", async () => {
    const f = await fixture()
    const result = await prepareLaunch(options(f, { number: 99 }))
    expect(result.ok).toBe(false)
    expect(result.code).toBe("fetch-failed")
    expect(result.worktree).toBe("")
    expect(f.created).toHaveLength(0)
  })

  test("rejects a launch when actions are disabled", async () => {
    const f = await fixture()
    const result = await prepareLaunch(
      options(f, { config: parseConfig({ allowGhCli: false, actions: { enabled: false } }).config }),
    )
    expect(result.ok).toBe(false)
    expect(result.code).toBe("disabled")
    expect(f.created).toHaveLength(0)
  })

  test("maps a branch collision to a suffixed local branch", async () => {
    const f = await fixture()
    await git(["branch", "pr-7", "main"], f.local)
    const result = await prepareLaunch(options(f))
    expect(result.ok).toBe(true)
    expect(result.branch).toBe("pr-7-2")
  })

  test("maps the current checkout subpath into the new worktree", async () => {
    const f = await fixture()
    const nested = join(f.local, "packages", "app")
    const result = await prepareLaunch(
      options(f, {
        ctx: { ...f.context, location: { ...f.context.location, directory: nested } },
      }),
    )
    expect(result.ok).toBe(true)
    expect(result.subpath).toBe("packages/app")
    expect(result.sessionDirectory).toBe(join(result.worktree, "packages", "app"))
  })

  test("returns no-default-branch for an issue when the default branch is unknown", async () => {
    const f = await fixture()
    const result = await prepareLaunch(
      options(f, {
        kind: "issue",
        number: 8,
        item: { ...issueItem, defaultBranch: "" },
        repo: { ...f.repo, defaultBranchHint: null },
      }),
    )
    expect(result.ok).toBe(false)
    expect(result.code).toBe("no-default-branch")
  })
})
