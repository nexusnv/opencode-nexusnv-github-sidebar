import { describe, expect, test } from "bun:test"
import {
  authorLabel,
  branchLabel,
  formatCount,
  formatRetryAt,
  glyphSet,
  issueDetail,
  issueStatusText,
  linkedKey,
  moreCount,
  pullDetail,
  rowMarker,
  sectionTitle,
  sessionTitle,
} from "../src/tui/format"
import { issueView, pullView } from "./helpers/tui"

const unicode = glyphSet("unicode")
const ascii = glyphSet("ascii")

describe("glyphs and counts", () => {
  test("exposes a single-cell unicode set and an ASCII fallback", () => {
    expect(unicode.branch).toBe("◆")
    expect(unicode.linked).toBe("●")
    expect(unicode.rule).toBe("─")
    expect(unicode.ci.pass).toBe("✓")
    expect(ascii.branch).toBe("*")
    expect(ascii.linked).toBe("o")
    expect(ascii.rule).toBe("-")
    expect(ascii.ci.pass).toBe("v")
  })

  test("keys linked sessions by kind and number", () => {
    expect(linkedKey("pull", 7)).toBe("pull/7")
    expect(linkedKey("issue", 9)).toBe("issue/9")
  })

  test("formats counts defensively", () => {
    expect(formatCount(0)).toBe("0")
    expect(formatCount(1_234_567)).toBe("1,234,567")
    expect(formatCount(-4)).toBe("0")
    expect(formatCount(Number.NaN)).toBe("0")
    expect(formatCount(Number.POSITIVE_INFINITY)).toBe("0")
  })

  test("clamps the more count", () => {
    expect(moreCount(100, 3)).toBe(97)
    expect(moreCount(3, 100)).toBe(0)
    expect(moreCount(Number.NaN, 3)).toBe(0)
  })
})

describe("row markers", () => {
  test("current branch wins over linked and unlinked", () => {
    expect(rowMarker({ number: 7, branchNumber: 7, linked: true, actionsEnabled: true, glyphs: unicode })).toBe(
      unicode.branch,
    )
  })

  test("shows linked and unlinked markers when actions are enabled", () => {
    expect(rowMarker({ number: 7, branchNumber: undefined, linked: true, actionsEnabled: true, glyphs: unicode })).toBe(
      unicode.linked,
    )
    expect(
      rowMarker({ number: 7, branchNumber: undefined, linked: false, actionsEnabled: true, glyphs: unicode }),
    ).toBe(unicode.unlinked)
  })

  test("hides markers in read-only mode except the branch marker", () => {
    expect(
      rowMarker({ number: 7, branchNumber: undefined, linked: true, actionsEnabled: false, glyphs: unicode }),
    ).toBe(" ")
    expect(rowMarker({ number: 7, branchNumber: 7, linked: true, actionsEnabled: false, glyphs: unicode })).toBe(
      unicode.branch,
    )
  })
})

describe("section titles", () => {
  test("uses the expanded and collapsed chevrons", () => {
    expect(sectionTitle({ section: "pulls", total: 3, collapsed: false, totals: true, glyphs: unicode })).toBe(
      "▾ Pull requests (3)",
    )
    expect(sectionTitle({ section: "pulls", total: 3, collapsed: true, totals: true, glyphs: unicode })).toBe(
      "▸ Pull requests (3)",
    )
    expect(sectionTitle({ section: "issues", total: 1_250, collapsed: false, totals: true, glyphs: unicode })).toBe(
      "▾ Issues (1,250)",
    )
  })

  test("omits totals when disabled", () => {
    expect(sectionTitle({ section: "issues", total: 10, collapsed: false, totals: false, glyphs: ascii })).toBe(
      "v Issues",
    )
  })
})

describe("row details", () => {
  test("renders author labels and the ghost fallback", () => {
    expect(authorLabel(" me ")).toBe("@me")
    expect(authorLabel("   ")).toBe("@ghost")
  })

  test("summarizes a pull request", () => {
    expect(pullDetail(pullView(), "me", unicode)).toBe("✓ pass · ready · 3c · 1r · @me")
    expect(pullDetail(pullView({ isMine: true, author: "someone" }), "", unicode)).toContain("@someone")
    expect(pullDetail(pullView({ ci: "none", merge: "draft" }), "me", unicode)).toContain("– no checks · draft")
  })

  test("bounds issue labels and flags assignment", () => {
    const issue = issueView({ labels: ["a", "b", "c"], assignees: ["ME"] })
    expect(issueDetail(issue, "me", 1)).toBe("2c · a · +2 · assigned")
    expect(issueDetail(issue, "other", 0)).toBe("2c · @other")
    expect(issueDetail(issue, "", 5)).toBe("2c · a · b · c · @other")
  })
})

describe("status text", () => {
  test("maps auth and repository failures to actionable text", () => {
    const render = (status: Parameters<typeof issueStatusText>[0]["status"], message = "") =>
      issueStatusText({ status, message, retryAt: "" })
    expect(render("no-auth")).toContain("/connect")
    expect(render("unauthorized")).toContain("invalid")
    expect(render("not-found")).toContain("not found")
    expect(render("network")).toContain("unreachable")
    expect(render("no-git")).toBe("Not a git repository")
    expect(render("no-remote")).toBe("No git remote")
    expect(render("unsupported-host")).toBe("Not a GitHub repository")
    expect(render("disabled")).toBe("")
    expect(render("error", "  boom  ")).toBe("boom")
    expect(render("error", "   ")).toBe("GitHub request failed")
  })

  test("formats the rate-limit retry without inventing a time", () => {
    expect(issueStatusText({ status: "rate-limited", message: "", retryAt: "" })).toBe("Rate limited")
    expect(issueStatusText({ status: "rate-limited", message: "", retryAt: "not-a-date" })).toBe("Rate limited")
    expect(
      issueStatusText({ status: "rate-limited", message: "", retryAt: "2026-10-27T07:05:00Z" }).startsWith(
        "Rate limited · retry ",
      ),
    ).toBe(true)
    expect(formatRetryAt("")).toBe("")
    expect(formatRetryAt("not-a-date")).toBe("")
  })
})

describe("labels", () => {
  test("builds a compact session title", () => {
    expect(sessionTitle("pull", 7, "  Fix\n the   widget  ")).toBe("PR #7 · Fix the widget")
    expect(sessionTitle("issue", 9, "")).toBe("Issue #9")
    expect(sessionTitle("issue", 9, "x".repeat(70))).toBe(`Issue #9 · ${"x".repeat(57)}...`)
  })

  test("names detached branches explicitly", () => {
    expect(branchLabel("main")).toBe("main")
    expect(branchLabel("  ")).toBe("detached")
  })
})
