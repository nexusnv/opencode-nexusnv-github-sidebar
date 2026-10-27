import { describe, expect, test } from "bun:test"
import { DEFAULT_CONFIG, effectiveView, parseConfig } from "../src/config"

describe("parseConfig", () => {
  test("returns defaults for missing options", () => {
    const { config, errors } = parseConfig(undefined)
    expect(errors).toEqual([])
    expect(config).toEqual(DEFAULT_CONFIG)
  })

  test("parses nested sections and clamps numeric ranges", () => {
    const { config, errors } = parseConfig({
      enabled: false,
      hosts: ["GitHub.com", "ghe.example.com", "github.com"],
      remote: "upstream",
      branchPr: false,
      scope: "mine",
      autoAllThreshold: 999,
      fetchLimit: 500,
      pulls: { enabled: false, limit: 0 },
      issues: { enabled: true, limit: 200, labels: 9 },
      actions: {
        confirm: true,
        worktree: false,
        issueWorktree: false,
        branchPrefix: { pr: "pull-", issue: "ticket-" },
        context: "summary",
        bodyLimitBytes: 10,
        fetchTimeoutMs: 1,
        reuseWorktree: false,
        focusTabs: false,
      },
      refreshSeconds: 1,
      staleSeconds: 0,
      timeoutMs: 100,
      display: {
        header: false,
        totals: false,
        order: ["issues", "issues", "pulls"],
        collapsed: ["issues"],
        glyphs: "ascii",
        showUnavailable: true,
      },
      debug: true,
    })
    expect(errors).toEqual([])
    expect(config.enabled).toBe(false)
    expect(config.hosts).toEqual(["github.com", "ghe.example.com"])
    expect(config.remote).toBe("upstream")
    expect(config.branchPr).toBe(false)
    expect(config.scope).toBe("mine")
    expect(config.autoAllThreshold).toBe(500)
    expect(config.fetchLimit).toBe(100)
    expect(config.pulls).toEqual({ enabled: false, limit: 1 })
    expect(config.issues).toEqual({ enabled: true, limit: 100, labels: 3 })
    expect(config.actions.confirm).toBe(true)
    expect(config.actions.worktree).toBe(false)
    expect(config.actions.issueWorktree).toBe(false)
    expect(config.actions.branchPrefix).toEqual({ pr: "pull-", issue: "ticket-" })
    expect(config.actions.context).toBe("summary")
    expect(config.actions.bodyLimitBytes).toBe(1024)
    expect(config.actions.fetchTimeoutMs).toBe(5000)
    expect(config.actions.reuseWorktree).toBe(false)
    expect(config.actions.focusTabs).toBe(false)
    expect(config.refreshSeconds).toBe(15)
    expect(config.staleSeconds).toBe(0)
    expect(config.timeoutMs).toBe(1000)
    expect(config.display).toEqual({
      header: false,
      totals: false,
      order: ["issues", "pulls"],
      collapsed: ["issues"],
      glyphs: "ascii",
      showUnavailable: true,
    })
    expect(config.debug).toBe(true)
  })

  test("falls back on invalid enum values without throwing", () => {
    const { config, errors } = parseConfig({
      scope: "nobody",
      tokenEnv: ["GH_TOKEN", "BAD-NAME", 7, "GITHUB_TOKEN"],
      actions: { context: "everything" },
      display: { glyphs: "emoji", order: ["stars"] },
      mine: { issues: "nobody" },
    })
    expect(config.scope).toBe("auto")
    expect(config.tokenEnv).toEqual(["GH_TOKEN", "GITHUB_TOKEN"])
    expect(config.actions.context).toBe("full")
    expect(config.display.glyphs).toBe("unicode")
    expect(config.display.order).toEqual(DEFAULT_CONFIG.display.order)
    expect(config.mine.issues).toBe("either")
    expect(errors).toContain("tokenEnv must contain valid environment variable names")
  })

  test("rejects invalid hosts, apiUrl, remote, and branch prefixes", () => {
    const { errors } = parseConfig({
      hosts: ["https://github.com", "github.com:443", "ghe.example.com"],
      apiUrl: "http://ghe.example.com/api/graphql",
      remote: "-bad remote",
      actions: { branchPrefix: { pr: "-bad", issue: "with space" } },
      token: "bad token",
    })
    expect(errors).toContain("hosts entries must be bare lowercase hostnames without a scheme, port, or path")
    expect(errors).toContain("apiUrl must use https")
    expect(errors).toContain("remote must be a git remote name without whitespace")
    expect(errors).toContain("actions.branchPrefix.pr is not a valid git branch prefix")
    expect(errors).toContain("actions.branchPrefix.issue is not a valid git branch prefix")
    expect(errors).toContain("token contains whitespace or control characters")
  })

  test("accepts an allowlisted HTTPS apiUrl without credentials or query", () => {
    const { config, errors } = parseConfig({
      hosts: ["ghe.example.com"],
      apiUrl: "https://ghe.example.com/custom/graphql",
    })
    expect(errors).toEqual([])
    expect(config.apiUrl).toBe("https://ghe.example.com/custom/graphql")
  })

  test("rejects an apiUrl on a host outside the allowlist", () => {
    const { errors } = parseConfig({
      hosts: ["github.com"],
      apiUrl: "https://evil.example.com/graphql",
    })
    expect(errors).toContain("apiUrl host must be listed in hosts")
  })
})

describe("effectiveView", () => {
  test("echoes the server-owned knobs the TUI is allowed to read", () => {
    const { config } = parseConfig({
      scope: "all",
      autoAllThreshold: 12,
      pulls: { limit: 3 },
      issues: { limit: 4, labels: 2 },
      actions: { confirm: true, worktree: false, issueWorktree: false, focusTabs: false },
      display: { header: false, totals: false, order: ["issues", "pulls"], collapsed: ["pulls"] },
      refreshSeconds: 90,
    })
    const view = effectiveView(config)
    expect(view).toEqual({
      scope: "all",
      autoAllThreshold: 12,
      pulls: { enabled: true, limit: 3 },
      issues: { enabled: true, limit: 4, labels: 2 },
      actions: { enabled: true, confirm: true, worktree: false, issueWorktree: false, focusTabs: false },
      display: {
        header: false,
        totals: false,
        order: ["issues", "pulls"],
        collapsed: ["pulls"],
        glyphs: "unicode",
        showUnavailable: false,
      },
      refreshSeconds: 90,
    })
  })
})
