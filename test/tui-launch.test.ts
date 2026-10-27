import { describe, expect, test } from "bun:test"
import {
  findLinkedSession,
  focusSession,
  launchItem,
  loadLinkedKeys,
  readGithubLink,
  type LaunchItem,
} from "../src/tui/launch"
import { effectiveView, fakeTui, launchResult, repoRef, sessionInfo } from "./helpers/tui"

const repo = repoRef()

const item: LaunchItem = {
  kind: "pull",
  number: 7,
  title: "Fix the widget",
  url: "https://github.com/acme/widgets/pull/7",
}

const actions = effectiveView().actions

function titleOf(session: unknown): string | undefined {
  return (session as { title?: string }).title
}

describe("readGithubLink", () => {
  test("accepts only a complete durable link", () => {
    expect(
      readGithubLink({
        githubSidebar: { host: "github.com", repo: "acme/widgets", kind: "pull", number: 7 },
      }),
    ).toEqual({ host: "github.com", repo: "acme/widgets", kind: "pull", number: 7 })
  })

  test("rejects malformed metadata", () => {
    expect(readGithubLink(undefined)).toBeUndefined()
    expect(readGithubLink({})).toBeUndefined()
    expect(readGithubLink({ githubSidebar: null })).toBeUndefined()
    expect(
      readGithubLink({ githubSidebar: { host: "", repo: "acme/widgets", kind: "pull", number: 7 } }),
    ).toBeUndefined()
    expect(readGithubLink({ githubSidebar: { host: "github.com", repo: "", kind: "pull", number: 7 } })).toBeUndefined()
    expect(
      readGithubLink({ githubSidebar: { host: "github.com", repo: "acme/widgets", kind: "discussion", number: 7 } }),
    ).toBeUndefined()
    expect(
      readGithubLink({ githubSidebar: { host: "github.com", repo: "acme/widgets", kind: "pull", number: 0 } }),
    ).toBeUndefined()
    expect(
      readGithubLink({ githubSidebar: { host: "github.com", repo: "acme/widgets", kind: "pull", number: 1.5 } }),
    ).toBeUndefined()
  })
})

describe("linked sessions", () => {
  test("finds the most recent root session for the repository item", async () => {
    const sessions = new Map([
      [
        "ses-old",
        sessionInfo({
          id: "ses-old",
          time: { created: 1, updated: 10 },
          metadata: { githubSidebar: { host: "github.com", repo: "acme/widgets", kind: "pull", number: 7 } },
        }),
      ],
      [
        "ses-new",
        sessionInfo({
          id: "ses-new",
          time: { created: 2, updated: 20 },
          metadata: { githubSidebar: { host: "github.com", repo: "acme/widgets", kind: "pull", number: 7 } },
        }),
      ],
      [
        "ses-child",
        sessionInfo({
          id: "ses-child",
          parentID: "ses-new",
          time: { created: 3, updated: 30 },
          metadata: { githubSidebar: { host: "github.com", repo: "acme/widgets", kind: "pull", number: 7 } },
        }),
      ],
      [
        "ses-other",
        sessionInfo({
          id: "ses-other",
          time: { created: 4, updated: 40 },
          metadata: { githubSidebar: { host: "github.com", repo: "acme/other", kind: "pull", number: 7 } },
        }),
      ],
    ])
    const fake = fakeTui({ sessions })

    expect((await findLinkedSession(fake.context, repo, "pull", 7))?.id).toBe("ses-new")
    expect(fake.calls.listSessions[0]).toMatchObject({ project: "project-1", parentID: null, archived: false })
    expect(fake.calls.locationGet).toHaveLength(1)
  })

  test("matches the host as well as the repository", async () => {
    const sessions = new Map([
      [
        "ses-ghes",
        sessionInfo({
          id: "ses-ghes",
          metadata: { githubSidebar: { host: "github.example.com", repo: "acme/widgets", kind: "pull", number: 7 } },
        }),
      ],
    ])
    const fake = fakeTui({ sessions })
    expect(await findLinkedSession(fake.context, repo, "pull", 7)).toBeUndefined()
  })

  test("loads marker keys for this repository only", async () => {
    const sessions = new Map([
      [
        "ses-pull",
        sessionInfo({
          id: "ses-pull",
          metadata: { githubSidebar: { host: "github.com", repo: "acme/widgets", kind: "pull", number: 7 } },
        }),
      ],
      [
        "ses-issue",
        sessionInfo({
          id: "ses-issue",
          metadata: { githubSidebar: { host: "github.com", repo: "acme/widgets", kind: "issue", number: 9 } },
        }),
      ],
      [
        "ses-other",
        sessionInfo({
          id: "ses-other",
          metadata: { githubSidebar: { host: "github.com", repo: "acme/other", kind: "pull", number: 1 } },
        }),
      ],
      ["ses-unlinked", sessionInfo({ id: "ses-unlinked" })],
    ])
    const fake = fakeTui({ sessions })
    expect([...(await loadLinkedKeys(fake.context, repo))].toSorted()).toEqual(["issue/9", "pull/7"])
  })

  test("treats a failed session list as advisory", async () => {
    const fake = fakeTui({
      listSessions: async () => {
        throw new Error("list failed")
      },
    })
    expect(findLinkedSession(fake.context, repo, "pull", 7)).rejects.toThrow("list failed")
  })
})

describe("focusSession", () => {
  test("prefers tabs and falls back to the router", () => {
    const withTabs = fakeTui()
    expect(focusSession(withTabs.context, "ses-one")).toBe(true)
    expect(withTabs.calls.focused).toEqual(["ses-one"])
    expect(withTabs.calls.navigated).toHaveLength(0)

    const withoutTabs = fakeTui({ focusTab: () => false })
    expect(focusSession(withoutTabs.context, "ses-one")).toBe(true)
    expect(withoutTabs.calls.navigated).toEqual([{ type: "session", sessionID: "ses-one" }])
  })

  test("falls back when the tab UI throws", () => {
    const fake = fakeTui({
      focusTab: () => {
        throw new Error("tabs are gone")
      },
    })
    expect(focusSession(fake.context, "ses-one")).toBe(true)
    expect(fake.calls.navigated).toEqual([{ type: "session", sessionID: "ses-one" }])
  })

  test("reports a total focus failure instead of rejecting", () => {
    const fake = fakeTui({
      focusTab: () => {
        throw new Error("tabs are gone")
      },
      navigate: () => {
        throw new Error("router is gone")
      },
    })
    expect(focusSession(fake.context, "ses-one")).toBe(false)
  })
})

describe("launchItem", () => {
  test("read-only mode opens the browser and never touches sessions or RPC", async () => {
    const opened: string[] = []
    const fake = fakeTui()
    const outcome = await launchItem(
      fake.context,
      repo,
      item,
      { ...actions, enabled: false },
      { openLinks: "browser", opener: async (url) => opened.push(url) },
    )

    expect(outcome).toEqual({ status: "browser", opened: true })
    expect(opened).toEqual([item.url])
    expect(fake.calls.prepare).toHaveLength(0)
    expect(fake.calls.listSessions).toHaveLength(0)
    expect(fake.calls.created).toHaveLength(0)
    expect(fake.calls.confirms).toHaveLength(0)
  })

  test("read-only mode reports a failed browser spawn", async () => {
    const fake = fakeTui()
    const outcome = await launchItem(
      fake.context,
      repo,
      item,
      { ...actions, enabled: false },
      {
        openLinks: "browser",
        opener: async () => {
          throw new Error("blocked")
        },
      },
    )

    expect(outcome).toEqual({ status: "browser", opened: false })
    expect(fake.calls.toasts).toHaveLength(1)
  })

  test("focuses an existing linked session without preparing a checkout", async () => {
    const fake = fakeTui({
      sessions: new Map([
        [
          "ses-linked",
          sessionInfo({
            id: "ses-linked",
            metadata: { githubSidebar: { host: "github.com", repo: "acme/widgets", kind: "pull", number: 7 } },
          }),
        ],
      ]),
    })

    const outcome = await launchItem(fake.context, repo, item, actions)
    expect(outcome).toEqual({ status: "focused", sessionID: "ses-linked" })
    expect(fake.calls.focused).toEqual(["ses-linked"])
    expect(fake.calls.prepare).toHaveLength(0)
    expect(fake.calls.created).toHaveLength(0)
  })

  test("creates a worktree-backed session with synthetic context", async () => {
    const fake = fakeTui({
      prepareLaunch: async () => launchResult(),
    })

    const outcome = await launchItem(fake.context, repo, item, actions)
    expect(outcome).toEqual({ status: "created", sessionID: "session-created" })

    expect(fake.calls.prepare).toHaveLength(1)
    expect(fake.calls.prepare[0]?.input).toEqual({ kind: "pull", number: 7 })
    expect(fake.calls.prepare[0]?.options?.location).toEqual({ directory: "/work/repo" })

    expect(fake.calls.created).toHaveLength(1)
    const created = fake.calls.created[0] as {
      title: string
      location: { directory: string }
      metadata: { githubSidebar: Record<string, unknown> }
    }
    expect(created.title).toBe("PR #7 · Fix the widget")
    expect(created.location).toEqual({ directory: "/work/worktrees/pr-7" })
    expect(created.metadata.githubSidebar).toMatchObject({
      host: "github.com",
      repo: "acme/widgets",
      kind: "pull",
      number: 7,
      branch: "pr-7",
      base: "main",
      worktree: "/work/worktrees/pr-7",
      directory: "/work/worktrees/pr-7",
    })

    expect(fake.calls.synthetic).toHaveLength(1)
    expect(fake.calls.synthetic[0]).toMatchObject({
      sessionID: "session-created",
      text: "GitHub context",
      resume: false,
      metadata: { source: "github-sidebar", kind: "pull", number: 7 },
    })
    expect(fake.calls.sync).toEqual(["session-created"])
    expect(fake.calls.focused).toEqual(["session-created"])
  })

  test("does not send an empty synthetic message", async () => {
    const fake = fakeTui({ prepareLaunch: async () => launchResult({ context: "   " }) })
    await launchItem(fake.context, repo, item, actions)
    expect(fake.calls.synthetic).toHaveLength(0)
  })

  test("treats a broken confirmation dialog as a failure", async () => {
    const fake = fakeTui({
      confirm: async () => {
        throw new Error("dialog closed")
      },
      prepareLaunch: async () => launchResult(),
    })

    const outcome = await launchItem(fake.context, repo, item, { ...actions, confirm: true })
    expect(outcome).toEqual({ status: "failed", message: "dialog closed" })
    expect(fake.calls.toasts[0]).toMatchObject({ title: "Could not open the confirmation dialog" })
    expect(fake.calls.prepare).toHaveLength(0)
    expect(fake.calls.created).toHaveLength(0)
  })

  test("asks for confirmation before doing any work", async () => {
    let confirmed: unknown
    const fake = fakeTui({
      confirm: async (input) => {
        confirmed = input
        return false
      },
      prepareLaunch: async () => launchResult(),
    })

    const outcome = await launchItem(fake.context, repo, item, { ...actions, confirm: true })
    expect(outcome).toEqual({ status: "cancelled" })
    expect(confirmed).toMatchObject({ title: "Open in OpenCode" })
    expect(JSON.stringify(confirmed)).toContain("a new worktree and OpenCode session")
    expect(fake.calls.prepare).toHaveLength(0)
    expect(fake.calls.created).toHaveLength(0)
  })

  test("describes the current-workspace fallback for issues", async () => {
    let confirmed: unknown
    const fake = fakeTui({
      confirm: async (input) => {
        confirmed = input
        return false
      },
    })

    await launchItem(
      fake.context,
      repo,
      { ...item, kind: "issue", number: 9 },
      { ...actions, issueWorktree: false, confirm: true },
    )
    expect(JSON.stringify(confirmed)).toContain("an OpenCode session in the current workspace")
  })

  test("propagates a prepare RPC failure as a failed outcome", async () => {
    const fake = fakeTui({
      prepareLaunch: async () => {
        throw new Error("network down")
      },
    })
    const outcome = await launchItem(fake.context, repo, item, actions)
    expect(outcome).toEqual({ status: "failed", message: "network down" })
    expect(fake.calls.toasts[0]).toMatchObject({ title: "Could not prepare the checkout" })
    expect(fake.calls.created).toHaveLength(0)
  })

  test("rejects an invalid launch envelope", async () => {
    const fake = fakeTui({ prepareLaunch: async () => ({ ok: true }) })
    const outcome = await launchItem(fake.context, repo, item, actions)
    expect(outcome).toEqual({ status: "failed", message: "The server returned an invalid launch response" })
    expect(fake.calls.created).toHaveLength(0)
  })

  test("reports a typed launch failure without creating a session", async () => {
    const fake = fakeTui({
      prepareLaunch: async () => launchResult({ ok: false, code: "fetch-failed", message: "git fetch failed" }),
    })
    const outcome = await launchItem(fake.context, repo, item, actions)
    expect(outcome).toEqual({ status: "failed", message: "git fetch failed" })
    expect(fake.calls.created).toHaveLength(0)
  })

  test("reports session creation failures", async () => {
    const fake = fakeTui({
      prepareLaunch: async () => launchResult(),
      createSession: async () => {
        throw new Error("create failed")
      },
    })
    const outcome = await launchItem(fake.context, repo, item, actions)
    expect(outcome).toEqual({ status: "failed", message: "create failed" })
    expect(fake.calls.synthetic).toHaveLength(0)
    expect(fake.calls.toasts[0]).toMatchObject({ title: "Could not create the OpenCode session" })
  })

  test("keeps the session when synthetic context fails", async () => {
    const fake = fakeTui({
      prepareLaunch: async () => launchResult(),
      synthetic: async () => {
        throw new Error("synthetic failed")
      },
    })
    const outcome = await launchItem(fake.context, repo, item, actions)
    expect(outcome).toEqual({ status: "created", sessionID: "session-created" })
    expect(fake.calls.toasts[0]).toMatchObject({
      title: "Session created without GitHub context",
      variant: "warning",
    })
    expect(fake.calls.focused).toEqual(["session-created"])
  })

  test("honours focusTabs=false", async () => {
    const fake = fakeTui({ prepareLaunch: async () => launchResult() })
    await launchItem(fake.context, repo, item, { ...actions, focusTabs: false })
    expect(fake.calls.focused).toHaveLength(0)
    expect(fake.calls.navigated).toHaveLength(0)
  })

  test("continues when the linked-session lookup fails", async () => {
    const fake = fakeTui({
      listSessions: async () => {
        throw new Error("list failed")
      },
      prepareLaunch: async () => launchResult(),
    })
    const outcome = await launchItem(fake.context, repo, item, actions)
    expect(outcome).toEqual({ status: "created", sessionID: "session-created" })
  })

  test("uses the prepared title in the session name when present", async () => {
    const fake = fakeTui({
      prepareLaunch: async () => launchResult({ title: "Authoritative title" }),
    })
    await launchItem(fake.context, repo, item, actions)
    expect(titleOf(fake.calls.created[0])).toBe("PR #7 · Authoritative title")
  })
})
