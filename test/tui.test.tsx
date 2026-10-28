import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { GithubSidebarRpc } from "../src/rpc"
import { MissingLocationError } from "../src/shared/location"
import { Sidebar, checkHealth } from "../src/tui"
import {
  effectiveView,
  fakeTui,
  issueView,
  pullView,
  repoRef,
  sessionInfo,
  summaryData,
  summaryResponse,
} from "./helpers/tui"

async function renderSidebar(fake: ReturnType<typeof fakeTui>, sessionID = "ses-root", width = 40, height = 24) {
  return testRender(() => <Sidebar context={fake.context} sessionID={sessionID} />, { width, height })
}

describe("checkHealth", () => {
  test("accepts a matching server response", async () => {
    const fake = fakeTui()
    expect(await checkHealth(fake.context, new AbortController().signal)).toBe("ready")
    expect(fake.calls.health[0]?.options?.location).toEqual({ directory: "/work/repo" })
  })

  test("rejects mismatched plugins, locations, and shapes", async () => {
    for (const reply of [
      { ok: true, plugin: "other", location: "/work/repo" },
      { ok: true, plugin: "github-sidebar", location: "/work/other" },
      { ok: false, plugin: "github-sidebar", location: "/work/repo" },
      { ok: "yes", plugin: "github-sidebar", location: "/work/repo" },
    ]) {
      const fake = fakeTui({ health: async () => reply })
      expect(await checkHealth(fake.context, new AbortController().signal)).toBe("error")
    }
  })

  test("refuses to guess a missing location", async () => {
    const fake = fakeTui({ location: () => undefined })
    expect(checkHealth(fake.context, new AbortController().signal)).rejects.toBeInstanceOf(MissingLocationError)
    expect(fake.calls.health).toHaveLength(0)
  })
})

describe("Sidebar states", () => {
  test("shows a loading state while health is pending", async () => {
    const fake = fakeTui({ health: () => new Promise(() => undefined) })
    const app = await renderSidebar(fake)
    try {
      await app.renderOnce()
      expect(app.captureCharFrame()).toContain("Loading GitHub…")
    } finally {
      await app.dispose()
    }
  })

  test("shows an unavailable state when health fails", async () => {
    const fake = fakeTui({ health: async () => ({ ok: true, plugin: "other", location: "/work/repo" }) })
    const app = await renderSidebar(fake)
    try {
      await app.waitForFrame((frame) => frame.includes("GitHub unavailable"))
      expect(fake.calls.summary).toHaveLength(0)
    } finally {
      await app.dispose()
    }
  })

  test("renders the repository header, totals, rows, and more counts", async () => {
    const fake = fakeTui({
      summary: async () =>
        summaryResponse({
          data: summaryData({
            pulls: [pullView({ number: 7 }), pullView({ number: 8, title: "Second pull" })],
            issues: [issueView({ number: 9 })],
            totals: { pulls: 1_250, issues: 2_513 },
            rateLimit: { cost: 1, remaining: 42, resetAt: "2026-10-27T07:00:00Z" },
          }),
        }),
    })
    const app = await renderSidebar(fake, "ses-root", 100)
    try {
      const frame = await app.waitForFrame((value) => value.includes("acme/widgets"))
      expect(frame).toContain("main · 1,250 PRs · 2,513 issues · 42 API left")
      expect(frame).toContain("▾ Pull requests (1,250)")
      expect(frame).toContain("#7 Fix the widget")
      expect(frame).toContain("✓ pass · ready · 3c · 1r · @me")
      expect(frame).toContain("▾ Issues (2,513)")
      expect(frame).toContain("#9 Widget request")
      expect(frame).toContain("+ 1,248 more")
      expect(frame).toContain("+ 2,512 more")
    } finally {
      await app.dispose()
    }
  })

  test("renders empty sections", async () => {
    const fake = fakeTui({
      summary: async () =>
        summaryResponse({
          data: summaryData({ pulls: [], issues: [], totals: { pulls: 0, issues: 0 } }),
        }),
    })
    const app = await renderSidebar(fake)
    try {
      const frame = await app.waitForFrame((value) => value.includes("No open pull requests"))
      expect(frame).toContain("No open issues")
    } finally {
      await app.dispose()
    }
  })

  test("renders an auth status with a connect action", async () => {
    const fake = fakeTui({
      summary: async () => summaryResponse({ status: "no-auth", message: "GitHub token not set", data: undefined }),
    })
    const app = await renderSidebar(fake)
    try {
      const frame = await app.waitForFrame((value) => value.includes("GitHub token not set · /connect"))
      expect(frame).toContain("acme/widgets")

      await app.mockMouse.click(1, 1)
      await app.waitFor(() => fake.calls.alerts.length === 1)
      expect(fake.calls.alerts[0]).toMatchObject({ title: "Connect GitHub" })
      expect(JSON.stringify(fake.calls.alerts[0])).toContain("/connect")
    } finally {
      await app.dispose()
    }
  })

  test("hides unavailable repositories unless the view allows them", async () => {
    const hidden = fakeTui({
      summary: async () =>
        summaryResponse({
          status: "no-git",
          data: undefined,
          view: effectiveView({ display: { showUnavailable: false } }),
        }),
    })
    const hiddenApp = await renderSidebar(hidden)
    try {
      await hiddenApp.waitFor(() => hidden.calls.summary.length === 1)
      await hiddenApp.renderOnce()
      expect(hiddenApp.captureCharFrame()).not.toContain("Not a git repository")
    } finally {
      await hiddenApp.dispose()
    }

    const shown = fakeTui({
      summary: async () => summaryResponse({ status: "no-git", data: undefined }),
    })
    const shownApp = await renderSidebar(shown)
    try {
      await shownApp.waitForFrame((frame) => frame.includes("Not a git repository"))
    } finally {
      await shownApp.dispose()
    }
  })

  test("renders nothing when the plugin is disabled", async () => {
    const fake = fakeTui({
      summary: async () => summaryResponse({ status: "disabled", data: undefined }),
    })
    const app = await renderSidebar(fake)
    try {
      await app.waitFor(() => fake.calls.summary.length === 1)
      await app.renderOnce()
      const frame = app.captureCharFrame()
      expect(frame).not.toContain("acme/widgets")
      expect(frame).not.toContain("Loading GitHub")
      expect(frame).not.toContain("GitHub unavailable")
    } finally {
      await app.dispose()
    }
  })

  test("marks stale data without hiding it", async () => {
    const fake = fakeTui({
      summary: async () => summaryResponse({ status: "stale" }),
    })
    const app = await renderSidebar(fake)
    try {
      const frame = await app.waitForFrame((value) => value.includes("stale"))
      expect(frame).toContain("#7 Fix the widget")
    } finally {
      await app.dispose()
    }
  })

  test("collapses and expands a section on click", async () => {
    const fake = fakeTui({ summary: async () => summaryResponse() })
    const app = await renderSidebar(fake)
    try {
      const expanded = await app.waitForFrame((frame) => frame.includes("▾ Pull requests (1)"))
      expect(expanded).toContain("#7 Fix the widget")

      await app.mockMouse.click(4, 3)
      const collapsed = await app.waitForFrame((frame) => frame.includes("▸ Pull requests (1)"))
      expect(collapsed).not.toContain("#7 Fix the widget")

      await app.mockMouse.click(4, 3)
      await app.waitForFrame((frame) => frame.includes("▾ Pull requests (1)"))
    } finally {
      await app.dispose()
    }
  })

  test("persists section collapse across mounts and ignores later config defaults", async () => {
    const fake = fakeTui({
      summary: async () => summaryResponse({ view: effectiveView({ display: { collapsed: ["issues"] } }) }),
    })

    const first = await renderSidebar(fake)
    try {
      await first.waitForFrame((frame) => frame.includes("▸ Issues (1)"))
      await first.mockMouse.click(4, 3)
      await first.waitForFrame((frame) => frame.includes("▸ Pull requests (1)"))
    } finally {
      await first.dispose()
    }

    const preferences = () => fake.storage.get("preferences") as { initialized?: boolean; collapsed?: string[] }
    expect(preferences().initialized).toBe(true)
    expect(preferences().collapsed).toEqual(["issues", "pulls"])

    // A second mount must read storage, not reseed from `display.collapsed`.
    const second = await renderSidebar(fake)
    try {
      const frame = await second.waitForFrame((value) => value.includes("Pull requests (1)"))
      expect(frame).toContain("▸ Pull requests (1)")
      expect(frame).toContain("▸ Issues (1)")
      expect(frame).not.toContain("#7 Fix the widget")
    } finally {
      await second.dispose()
    }
  })

  test("forces a refresh when the refresh control is clicked", async () => {
    const fake = fakeTui({ summary: async () => summaryResponse() })
    const app = await renderSidebar(fake)
    try {
      await app.waitForFrame((frame) => frame.includes("acme/widgets"))
      await app.mockMouse.click(39, 0)
      await app.waitFor(() => fake.calls.summary.length === 2)
      expect(fake.calls.summary[0]?.input).toEqual({ force: false, full: false })
      expect(fake.calls.summary[1]?.input).toEqual({ force: true, full: false })
    } finally {
      await app.dispose()
    }
  })

  test("reloads when the project location changes", async () => {
    const fake = fakeTui({
      summary: async (_input, options) => {
        const two = options?.location?.directory === "/work/two"
        const name = two ? "two" : "one"
        return summaryResponse({ repository: repoRef({ name, nameWithOwner: `acme/${name}` }) })
      },
    })
    const app = await renderSidebar(fake)
    try {
      await app.waitForFrame((frame) => frame.includes("acme/one"))

      fake.setLocation({ directory: "/work/two" })
      await app.waitForFrame((frame) => frame.includes("acme/two"))
      expect(fake.calls.summary.length).toBeGreaterThanOrEqual(1)
    } finally {
      await app.dispose()
    }
  })

  test("does not fetch or render for child sessions", async () => {
    const fake = fakeTui({
      sessions: new Map([["ses-child", sessionInfo({ id: "ses-child", parentID: "ses-parent" })]]),
      summary: async () => summaryResponse(),
    })
    const app = await renderSidebar(fake, "ses-child")
    try {
      await app.renderOnce()
      const frame = app.captureCharFrame()
      expect(frame).not.toContain("acme/widgets")
      expect(frame).not.toContain("Loading GitHub")
      expect(fake.calls.health).toHaveLength(0)
      expect(fake.calls.summary).toHaveLength(0)
    } finally {
      await app.dispose()
    }
  })

  test("launches from a row click", async () => {
    const fake = fakeTui({
      summary: async () => summaryResponse(),
      prepareLaunch: async () => ({
        ok: true,
        code: "ok",
        message: "",
        kind: "pull",
        number: 7,
        repository: { host: "github.com", nameWithOwner: "acme/widgets", url: "", isPrivate: false },
        title: "Fix the widget",
        url: "https://github.com/acme/widgets/pull/7",
        branch: "pr-7",
        base: "main",
        worktree: "/work/worktrees/pr-7",
        subpath: "",
        sessionDirectory: "/work/worktrees/pr-7",
        reused: false,
        context: "GitHub context",
        description: "PR #7 · Fix the widget",
      }),
    })
    const app = await renderSidebar(fake)
    try {
      await app.waitForFrame((frame) => frame.includes("#7 Fix the widget"))
      await app.mockMouse.click(10, 4)
      await app.waitFor(() => fake.calls.created.length === 1)
      expect(fake.calls.prepare[0]?.input).toEqual({ kind: "pull", number: 7 })
      expect(fake.calls.synthetic[0]).toMatchObject({ resume: false, text: "GitHub context" })
      expect(fake.calls.focused).toEqual(["session-created"])
    } finally {
      await app.dispose()
    }
  })
})

describe("RPC contract", () => {
  test("uses the shared contract for every call", async () => {
    const fake = fakeTui({
      summary: async () => summaryResponse({ status: "disabled", data: undefined }),
    })
    const app = await renderSidebar(fake)
    try {
      await app.waitFor(() => fake.calls.summary.length === 1)
      expect(fake.calls.contracts.every((contract) => contract === GithubSidebarRpc)).toBe(true)
      expect(fake.calls.summary[0]?.options?.location).toEqual({ directory: "/work/repo" })
    } finally {
      await app.dispose()
    }
  })
})
