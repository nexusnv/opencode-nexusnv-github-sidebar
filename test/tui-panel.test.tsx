import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { KeymapCommand, PanelInput } from "@opencode/plugin/tui/context"
import { GithubPanel, PanelCommands } from "../src/tui/panel"
import {
  effectiveView,
  fakeTui,
  issueView,
  launchResult,
  pullView,
  sessionInfo,
  summaryData,
  summaryResponse,
} from "./helpers/tui"

function panelInput(overrides: Partial<PanelInput> = {}): PanelInput {
  return {
    name: "github",
    sessionID: "ses-root",
    width: 100,
    presentation: "panel",
    focused: true,
    focus() {},
    close() {},
    toggleFullscreen() {},
    ...overrides,
  }
}

function command(commands: readonly KeymapCommand[], bind: string): KeymapCommand | undefined {
  return commands.find((entry) => typeof entry.bind === "string" && entry.bind.split(",").includes(bind))
}

async function renderPanel(fake: ReturnType<typeof fakeTui>, panel = panelInput(), width = 100, height = 30) {
  return testRender(() => <GithubPanel context={fake.context} panel={panel} />, { width, height })
}

describe("GithubPanel", () => {
  test("renders every fetched row and reports truncation from true totals", async () => {
    const fake = fakeTui({
      summary: async () =>
        summaryResponse({
          data: summaryData({
            pulls: [
              pullView({ number: 7 }),
              pullView({ number: 8, title: "Second pull", isMine: false, author: "other" }),
            ],
            issues: [issueView({ number: 9 })],
            totals: { pulls: 1_250, issues: 2_513 },
          }),
        }),
    })
    const app = await renderPanel(fake)
    try {
      const frame = await app.waitForFrame((value) => value.includes("GitHub"))
      expect(fake.calls.summary[0]?.input).toEqual({ force: false, full: true })
      expect(frame).toContain("#7 Fix the widget")
      expect(frame).toContain("#8 Second pull")
      expect(frame).toContain("#9 Widget request")
      expect(frame).toContain("Pull requests (1,250)")
      expect(frame).toContain("Issues (2,513)")
      expect(frame).toContain("2 shown of 1,250 open")
      expect(frame).toContain("1 shown of 2,513 open")
      expect(frame).toContain("mine")
      expect(frame).toContain("[all]")
      expect(frame).toContain("j/k move")
    } finally {
      await app.dispose()
    }
  })

  test("navigates rows, filters by mine, and launches the selected item", async () => {
    const fake = fakeTui({
      summary: async () =>
        summaryResponse({
          data: summaryData({
            pulls: [
              pullView({ number: 7 }),
              pullView({ number: 8, title: "Second pull", isMine: false, author: "other" }),
            ],
            issues: [issueView({ number: 9 })],
            totals: { pulls: 1_250, issues: 2_513 },
          }),
        }),
      prepareLaunch: async () => launchResult(),
    })
    const app = await renderPanel(fake)
    try {
      await app.waitForFrame((value) => value.includes("#7 Fix the widget"))

      command(fake.keymapCommands(), "j")?.run()
      await app.renderOnce()
      command(fake.keymapCommands(), "enter")?.run()
      await app.waitFor(() => fake.calls.prepare.length === 1)
      expect(fake.calls.prepare[0]?.input).toEqual({ kind: "pull", number: 8 })

      command(fake.keymapCommands(), "m")?.run()
      await app.renderOnce()
      const filtered = app.captureCharFrame()
      expect(filtered).toContain("#7 Fix the widget")
      expect(filtered).not.toContain("Second pull")
      expect(filtered).not.toContain("Widget request")
      expect(filtered).toContain("1 mine of 1,250 open")

      command(fake.keymapCommands(), "enter")?.run()
      await app.waitFor(() => fake.calls.prepare.length === 2)
      expect(fake.calls.prepare[1]?.input).toEqual({ kind: "pull", number: 7 })

      command(fake.keymapCommands(), "a")?.run()
      await app.renderOnce()
      command(fake.keymapCommands(), "j")?.run()
      command(fake.keymapCommands(), "j")?.run()
      await app.renderOnce()
      command(fake.keymapCommands(), "enter")?.run()
      await app.waitFor(() => fake.calls.prepare.length === 3)
      expect(fake.calls.prepare[2]?.input).toEqual({ kind: "issue", number: 9 })
    } finally {
      await app.dispose()
    }
  })

  test("opens the selected item in the browser and refreshes", async () => {
    const fake = fakeTui({ summary: async () => summaryResponse({ data: summaryData() }) })
    const app = await renderPanel(fake)
    try {
      await app.waitForFrame((value) => value.includes("#7 Fix the widget"))
      command(fake.keymapCommands(), "o")?.run()
      await app.renderOnce()
      expect(fake.calls.toasts).toHaveLength(0)
      command(fake.keymapCommands(), "r")?.run()
      await app.waitFor(() => fake.calls.summary.length === 2)
      expect(fake.calls.summary[1]?.input).toEqual({ force: true, full: true })
    } finally {
      await app.dispose()
    }
  })

  test("hides in child sessions, other panel names, and disabled views", async () => {
    const child = fakeTui({
      sessions: new Map([["ses-child", sessionInfo({ id: "ses-child", parentID: "ses-root" })]]),
      summary: async () => summaryResponse(),
    })
    const childApp = await renderPanel(child, panelInput({ sessionID: "ses-child" }))
    try {
      await childApp.waitForFrame((value) => value.includes("GitHub is not available in child sessions."))
      expect(child.calls.summary).toHaveLength(0)
    } finally {
      await childApp.dispose()
    }

    const other = fakeTui({ summary: async () => summaryResponse() })
    const otherApp = await renderPanel(other, panelInput({ name: "diff" }))
    try {
      await otherApp.renderOnce()
      expect(otherApp.captureCharFrame()).not.toContain("GitHub")
      expect(other.calls.summary).toHaveLength(0)
    } finally {
      await otherApp.dispose()
    }

    const disabled = fakeTui({
      summary: async () => summaryResponse({ status: "disabled", data: undefined, view: effectiveView() }),
    })
    const disabledApp = await renderPanel(disabled)
    try {
      const frame = await disabledApp.waitForFrame((value) => value.includes("GitHub is disabled for this project."))
      expect(frame).not.toContain("acme/widgets")
      expect(frame).not.toContain("Pull requests")
    } finally {
      await disabledApp.dispose()
    }
  })
})

describe("PanelCommands", () => {
  test("toggles the panel and refuses routes without a session", async () => {
    let route: { type: "session"; sessionID: string } | { type: "home" } = { type: "session", sessionID: "ses-root" }
    const fake = fakeTui({ route: () => route })

    const app = await testRender(() => <PanelCommands context={fake.context} />, { width: 40, height: 10 })
    try {
      await app.renderOnce()
      const toggle = () => fake.keymapCommands().find((entry) => entry.id === "github.panel.open")
      expect(toggle()?.bind).toBe("ctrl+shift+g")
      toggle()?.run()
      await app.renderOnce()
      expect(fake.calls.panelOpen).toEqual([{ name: "github", options: undefined }])

      toggle()?.run()
      await app.renderOnce()
      expect(fake.calls.panelClose).toHaveLength(1)

      route = { type: "home" }
      toggle()?.run()
      await app.renderOnce()
      expect(fake.calls.panelOpen).toHaveLength(1)
      expect(fake.calls.toasts).toContainEqual({ message: "Open a session first", variant: "warning" })
    } finally {
      await app.dispose()
    }
  })
})
