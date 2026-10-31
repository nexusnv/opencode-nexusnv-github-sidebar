import { describe, expect, test } from "bun:test"
import { CI_META, MERGE_LABEL, mapCi, mapMerge } from "../src/shared/status"

describe("mapCi", () => {
  test("maps known GitHub rollup states", () => {
    expect(mapCi("SUCCESS")).toBe("pass")
    expect(mapCi("FAILURE")).toBe("fail")
    expect(mapCi("ERROR")).toBe("fail")
    expect(mapCi("PENDING")).toBe("run")
    expect(mapCi("EXPECTED")).toBe("wait")
  })

  test("distinguishes no rollup from an unknown value", () => {
    expect(mapCi(null)).toBe("none")
    expect(mapCi(undefined)).toBe("none")
    expect(mapCi("")).toBe("none")
    expect(mapCi("NEUTRAL")).toBe("unknown")
    expect(mapCi("SOMETHING_NEW")).toBe("unknown")
    expect(mapCi(1)).toBe("unknown")
  })
})

describe("mapMerge", () => {
  const base = { isDraft: false, mergeable: "MERGEABLE", mergeStateStatus: "CLEAN", reviewDecision: null }

  test("precedence covers draft, conflicts, requested changes, and review", () => {
    expect(mapMerge({ ...base, isDraft: true })).toBe("draft")
    expect(mapMerge({ ...base, mergeable: "CONFLICTING" })).toBe("conflict")
    expect(mapMerge({ ...base, mergeStateStatus: "DIRTY" })).toBe("conflict")
    expect(mapMerge({ ...base, reviewDecision: "CHANGES_REQUESTED" })).toBe("changes")
    expect(mapMerge({ ...base, mergeStateStatus: "BLOCKED" })).toBe("blocked")
    expect(mapMerge({ ...base, mergeStateStatus: "BEHIND" })).toBe("behind")
    expect(mapMerge({ ...base, mergeStateStatus: "UNSTABLE" })).toBe("unstable")
    expect(mapMerge({ ...base, reviewDecision: "REVIEW_REQUIRED" })).toBe("review")
    expect(mapMerge({ ...base, mergeStateStatus: "CLEAN" })).toBe("ready")
    expect(mapMerge({ ...base, mergeStateStatus: "HAS_HOOKS" })).toBe("hooks")
    expect(mapMerge({ ...base, mergeStateStatus: "UNKNOWN", mergeable: "MERGEABLE" })).toBe("mergeable")
  })

  test("unknown values degrade instead of throwing", () => {
    expect(mapMerge({ ...base, mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN", reviewDecision: null })).toBe(
      "unknown",
    )
    expect(
      mapMerge({
        ...base,
        isDraft: undefined,
        mergeable: undefined,
        mergeStateStatus: undefined,
        reviewDecision: undefined,
      }),
    ).toBe("unknown")
  })
})

test("every normalized status has a glyph and label", () => {
  for (const value of ["pass", "fail", "run", "wait", "none", "unknown"] as const) {
    expect(CI_META[value].glyph.length).toBeGreaterThan(0)
    expect(CI_META[value].ascii.length).toBeGreaterThan(0)
    expect(CI_META[value].label.length).toBeGreaterThan(0)
  }
  for (const value of [
    "ready",
    "blocked",
    "changes",
    "conflict",
    "behind",
    "unstable",
    "review",
    "draft",
    "hooks",
    "mergeable",
    "unknown",
  ] as const) {
    expect(MERGE_LABEL[value].length).toBeGreaterThan(0)
  }
})
