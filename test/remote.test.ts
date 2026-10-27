import { describe, expect, test } from "bun:test"
import {
  graphqlEndpoint,
  isHostAllowed,
  normalizeAllowlistHost,
  parseRemoteUrl,
  redactUrlCredentials,
} from "../src/shared/remote"

describe("parseRemoteUrl", () => {
  const cases: Array<[string, string, string, string]> = [
    ["git@github.com:owner/repo.git", "github.com", "owner", "repo"],
    ["github.com:owner/repo.git", "github.com", "owner", "repo"],
    ["git@github.com:owner/repo", "github.com", "owner", "repo"],
    ["ssh://git@github.com/owner/repo.git", "github.com", "owner", "repo"],
    ["ssh://git@github.com:2222/owner/repo.git", "github.com", "owner", "repo"],
    ["https://github.com/owner/repo.git", "github.com", "owner", "repo"],
    ["https://user:token@github.com/owner/repo.git", "github.com", "owner", "repo"],
    ["https://www.github.com/owner/repo", "github.com", "owner", "repo"],
    ["git@ghe.example.com:team/repo.git", "ghe.example.com", "team", "repo"],
  ]

  for (const [input, host, owner, name] of cases) {
    test(`parses ${input}`, () => {
      const parsed = parseRemoteUrl(input)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) return
      expect(parsed.value.host).toBe(host)
      expect(parsed.value.owner).toBe(owner)
      expect(parsed.value.name).toBe(name)
      expect(parsed.value.url).toBe(`https://${host}/${owner}/${name}`)
    })
  }

  const rejected = [
    "",
    "   ",
    "file:///tmp/repo",
    "https://github.com/owner/repo/extra",
    "https://github.com/owner",
    "https://github.com/owner/repo?x=1",
    "https://github.com/owner/repo#readme",
    "git@github.com:owner/../repo.git",
    "git@github.com:owner/..",
    "/tmp/repo",
    "C:\\repo",
    "https://github.com/own er/repo",
  ]

  for (const input of rejected) {
    test(`rejects ${JSON.stringify(input)}`, () => {
      expect(parseRemoteUrl(input).ok).toBe(false)
    })
  }
})

describe("host allowlist", () => {
  test("normalizes bare hosts and rejects schemes, ports, paths, and credentials", () => {
    expect(normalizeAllowlistHost("GitHub.com")).toBe("github.com")
    expect(normalizeAllowlistHost("ghe.example.com.")).toBe("ghe.example.com")
    expect(normalizeAllowlistHost("localhost")).toBe("localhost")
    expect(normalizeAllowlistHost("https://github.com")).toBeUndefined()
    expect(normalizeAllowlistHost("github.com:443")).toBeUndefined()
    expect(normalizeAllowlistHost("github.com/owner")).toBeUndefined()
    expect(normalizeAllowlistHost("user@github.com")).toBeUndefined()
    expect(normalizeAllowlistHost("github")).toBeUndefined()
    expect(normalizeAllowlistHost("")).toBeUndefined()
    expect(normalizeAllowlistHost(42)).toBeUndefined()
  })

  test("compares hosts exactly", () => {
    expect(isHostAllowed("github.com", ["github.com"])).toBe(true)
    expect(isHostAllowed("ghe.example.com", ["github.com"])).toBe(false)
    expect(isHostAllowed("GitHub.com", ["github.com"])).toBe(true)
  })
})

test("derives the GraphQL endpoint for GitHub and GHES", () => {
  expect(graphqlEndpoint("github.com")).toBe("https://api.github.com/graphql")
  expect(graphqlEndpoint("ghe.example.com")).toBe("https://ghe.example.com/api/graphql")
  expect(graphqlEndpoint("ghe.example.com", "https://ghe.example.com/custom/graphql")).toBe(
    "https://ghe.example.com/custom/graphql",
  )
})

test("redacts inline credentials in diagnostics", () => {
  expect(redactUrlCredentials("https://user:token@github.com/owner/repo.git")).toBe(
    "https://***@github.com/owner/repo.git",
  )
  expect(redactUrlCredentials("git@github.com:owner/repo.git")).toBe("git@github.com:owner/repo.git")
})
