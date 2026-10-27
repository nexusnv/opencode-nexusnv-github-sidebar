import { describe, expect, test } from "bun:test"
import { parseConfig } from "../src/config"
import {
  normalizeIssue,
  normalizeLaunchIssue,
  normalizeLaunchPull,
  normalizePull,
  normalizeSidebar,
  sanitizeBody,
  sanitizeText,
  selectRows,
} from "../src/server/normalize"
import type { IssueView, PullView, RepoRef } from "../src/shared/types"

const repo: RepoRef = {
  host: "github.com",
  owner: "acme",
  name: "widgets",
  nameWithOwner: "acme/widgets",
  url: "https://github.com/acme/widgets",
  isPrivate: false,
}

const config = parseConfig({}).config

function pull(overrides: Record<string, unknown> = {}) {
  return {
    number: 1,
    title: "Fix the widget",
    url: "https://evil.example/attacker",
    isDraft: false,
    isCrossRepository: false,
    headRefName: "fix-widget",
    headRepositoryOwner: { login: "me" },
    author: { login: "me" },
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    reviewDecision: null,
    updatedAt: "2026-10-01T10:00:00Z",
    comments: { totalCount: 2 },
    reviews: { totalCount: 1 },
    statusCheckRollup: { state: "SUCCESS" },
    ...overrides,
  }
}

function issue(overrides: Record<string, unknown> = {}) {
  return {
    number: 2,
    title: "Widget request",
    updatedAt: "2026-10-02T10:00:00Z",
    author: { login: "other" },
    assignees: { nodes: [{ login: "me" }, { login: "other" }] },
    comments: { totalCount: 3 },
    labels: { nodes: [{ name: "enhancement" }, { name: "help wanted" }] },
    ...overrides,
  }
}

describe("sanitization", () => {
  test("removes terminal escapes and control characters from text", () => {
    expect(sanitizeText("\u001b[31mred\u001b[0m\n title\t")).toBe("red title")
    expect(sanitizeText("a\u0000b\u0007c")).toBe("abc")
    expect(sanitizeText("x".repeat(600))).toHaveLength(500)
    expect(sanitizeText(42)).toBe("")
  })

  test("keeps line structure in bodies but strips comments and escapes", () => {
    expect(sanitizeBody("\u001b[31mhello\u001b[0m\n<!-- hidden -->\n\n\nworld\r\n")).toBe("hello\n\nworld")
    expect(sanitizeBody(null)).toBe("")
  })
})

describe("normalizePull", () => {
  test("uses the canonical repository URL and viewer classification", () => {
    const value = normalizePull(pull(), "me", repo, config)
    expect(value?.url).toBe("https://github.com/acme/widgets/pull/1")
    expect(value?.isMine).toBe(true)
    expect(value?.ci).toBe("pass")
    expect(value?.merge).toBe("ready")
    expect(value?.comments).toBe(2)
  })

  test("marks other users' pull requests as not mine", () => {
    const value = normalizePull(pull({ author: { login: "other" } }), "me", repo, config)
    expect(value?.isMine).toBe(false)
  })

  test("drops rows with no usable number", () => {
    expect(normalizePull(pull({ number: 0 }), "me", repo, config)).toBeUndefined()
    expect(normalizePull(pull({ number: "1" }), "me", repo, config)).toBeUndefined()
  })
})

describe("normalizeIssue", () => {
  test("matches assignee or author according to config", () => {
    const either = normalizeIssue(issue(), "me", repo, config)
    expect(either?.isMine).toBe(true)
    expect(either?.assignees).toEqual(["me", "other"])
    expect(either?.labels).toEqual(["enhancement", "help wanted"])
    expect(either?.url).toBe("https://github.com/acme/widgets/issues/2")

    const assigneeOnly = normalizeIssue(issue(), "me", repo, parseConfig({ mine: { issues: "assignee" } }).config)
    expect(assigneeOnly?.isMine).toBe(true)

    const authorOnly = normalizeIssue(
      issue({ author: { login: "me" } }),
      "other",
      repo,
      parseConfig({ mine: { issues: "author" } }).config,
    )
    expect(authorOnly?.isMine).toBe(false)
  })
})

function sidebarBody(overrides: Record<string, unknown> = {}) {
  return {
    viewer: { login: "me" },
    rateLimit: { cost: 1, remaining: 4999, resetAt: "2026-10-27T06:00:00Z" },
    repository: {
      isPrivate: true,
      defaultBranchRef: { name: "main" },
      pullRequests: {
        totalCount: 50,
        nodes: [
          pull({ number: 1, author: { login: "other" } }),
          pull({ number: 2, author: { login: "me" } }),
          pull({ number: 3, author: { login: "other" } }),
        ],
      },
      branchPr: { nodes: [pull({ number: 9, author: { login: "other" }, headRefName: "current" })] },
      issues: {
        totalCount: 20,
        nodes: [
          issue({ number: 4, author: { login: "other" }, assignees: { nodes: [] } }),
          issue({ number: 5, author: { login: "me" } }),
        ],
      },
      ...overrides,
    },
  }
}

describe("normalizeSidebar", () => {
  test("returns totals, rate limit, and the repository privacy flag", () => {
    const result = normalizeSidebar(sidebarBody(), repo, config)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.isPrivate).toBe(true)
    expect(result.data.totals).toEqual({ pulls: 50, issues: 20 })
    expect(result.data.rateLimit).toEqual({ cost: 1, remaining: 4999, resetAt: "2026-10-27T06:00:00Z" })
    expect(result.data.branchPr?.number).toBe(9)
  })

  test("scope mine keeps viewer rows and the branch PR only", () => {
    const result = normalizeSidebar(sidebarBody(), repo, parseConfig({ scope: "mine" }).config)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.pulls.map((entry) => entry.number)).toEqual([9, 2])
    expect(result.data.issues.map((entry) => entry.number)).toEqual([5])
    expect(result.data.totals).toEqual({ pulls: 50, issues: 20 })
  })

  test("auto over threshold returns viewer rows plus bounded other rows", () => {
    const result = normalizeSidebar(
      sidebarBody(),
      repo,
      parseConfig({ scope: "auto", autoAllThreshold: 10, pulls: { limit: 1 }, issues: { limit: 1 } }).config,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Branch PR, then the viewer PR, then one other PR.
    expect(result.data.pulls.map((entry) => entry.number)).toEqual([9, 2, 1])
    expect(result.data.issues.map((entry) => entry.number)).toEqual([5, 4])
  })

  test("auto under threshold returns every fetched row", () => {
    const body = sidebarBody({
      branchPr: { nodes: [] },
      pullRequests: { totalCount: 2, nodes: [pull({ number: 1 }), pull({ number: 2 })] },
      issues: { totalCount: 1, nodes: [issue({ number: 3 })] },
    })
    const result = normalizeSidebar(body, repo, parseConfig({ scope: "auto", autoAllThreshold: 30 }).config)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.pulls).toHaveLength(2)
    expect(result.data.issues).toHaveLength(1)
  })

  test("scope all ignores the row limits but not fetchLimit (already applied by GraphQL)", () => {
    const result = normalizeSidebar(sidebarBody(), repo, parseConfig({ scope: "all" }).config)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // The branch PR is pinned even when it is outside the fetched top-N list.
    expect(result.data.pulls).toHaveLength(4)
    expect(result.data.pulls[0]?.number).toBe(9)
    expect(result.data.issues).toHaveLength(2)
  })

  test("a missing repository is a not-found result", () => {
    expect(normalizeSidebar({ viewer: { login: "me" } }, repo, config)).toEqual({
      ok: false,
      reason: "not-found",
    })
    expect(normalizeSidebar(null, repo, config)).toEqual({ ok: false, reason: "not-found" })
  })
})

describe("selectRows", () => {
  const mine = (number: number): PullView => ({
    number,
    title: `mine-${number}`,
    url: `https://github.com/acme/widgets/pull/${number}`,
    isDraft: false,
    isCrossRepository: false,
    headRefName: `mine-${number}`,
    headRepositoryOwner: "me",
    author: "me",
    isMine: true,
    comments: 0,
    reviews: 0,
    ci: "none",
    merge: "unknown",
    updatedAt: "",
  })
  const other = (number: number): PullView => ({ ...mine(number), author: "other", isMine: false })
  const issueRow = (number: number, isMine: boolean): IssueView => ({
    number,
    title: `issue-${number}`,
    url: `https://github.com/acme/widgets/issues/${number}`,
    author: isMine ? "me" : "other",
    assignees: [],
    isMine,
    comments: 0,
    labels: [],
    updatedAt: "",
  })

  test("bounded auto limits each other bucket independently", () => {
    const selected = selectRows({
      pulls: [other(1), mine(2), other(3)],
      issues: [issueRow(4, false), issueRow(5, true), issueRow(6, false)],
      pullsTotal: 100,
      issuesTotal: 100,
      branchPr: undefined,
      config: parseConfig({ scope: "auto", autoAllThreshold: 10, pulls: { limit: 1 }, issues: { limit: 2 } }).config,
    })
    expect(selected.pulls.map((entry) => entry.number)).toEqual([2, 1])
    expect(selected.issues.map((entry) => entry.number)).toEqual([5, 4, 6])
  })

  test("disabled sections return no rows", () => {
    const selected = selectRows({
      pulls: [mine(1)],
      issues: [issueRow(2, true)],
      pullsTotal: 1,
      issuesTotal: 1,
      branchPr: undefined,
      config: parseConfig({ pulls: { enabled: false }, issues: { enabled: false } }).config,
    })
    expect(selected.pulls).toEqual([])
    expect(selected.issues).toEqual([])
  })
})

describe("launch normalization", () => {
  const launchPullBody = {
    repository: {
      isPrivate: true,
      defaultBranchRef: { name: "main" },
      pullRequest: {
        ...pull({ number: 7 }),
        body: "hello\n<!-- hidden -->\nworld",
        state: "OPEN",
        baseRefName: "main",
        headRefOid: "abc123",
      },
    },
  }

  test("normalizes an authoritative pull request", () => {
    const result = normalizeLaunchPull(launchPullBody, repo, 7)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.isPrivate).toBe(true)
    expect(result.item.kind).toBe("pull")
    expect(result.item.body).toBe("hello\n\nworld")
    expect(result.item.state).toBe("OPEN")
  })

  test("rejects a mismatched or missing pull request", () => {
    expect(normalizeLaunchPull(launchPullBody, repo, 8).ok).toBe(false)
    expect(normalizeLaunchPull({ repository: {} }, repo, 7).ok).toBe(false)
  })

  test("normalizes an issue only when the union resolves to Issue", () => {
    const issueBody = {
      repository: {
        isPrivate: false,
        defaultBranchRef: { name: "main" },
        issueOrPullRequest: {
          __typename: "Issue",
          ...issue({ number: 8 }),
          body: "issue body",
          state: "OPEN",
        },
      },
    }
    const result = normalizeLaunchIssue(issueBody, repo, 8)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.item.kind).toBe("issue")

    const pullBody = {
      repository: { issueOrPullRequest: { __typename: "PullRequest", number: 8 } },
    }
    expect(normalizeLaunchIssue(pullBody, repo, 8).ok).toBe(false)
    expect(normalizeLaunchIssue({ repository: {} }, repo, 8).ok).toBe(false)
  })
})
