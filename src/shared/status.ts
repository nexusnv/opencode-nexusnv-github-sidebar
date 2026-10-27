import type { Ci, Merge } from "./types.js"

/**
 * GitHub enum values are not stable API surface on GHES (and GitHub adds
 * values over time). Map known values and downgrade everything else to
 * `unknown` instead of throwing or rendering a raw server string.
 */

export function mapCi(state: unknown): Ci {
  if (state === null || state === undefined || state === "") return "none"
  switch (state) {
    case "SUCCESS":
      return "pass"
    case "FAILURE":
    case "ERROR":
      return "fail"
    case "PENDING":
      return "run"
    case "EXPECTED":
      return "wait"
    default:
      return "unknown"
  }
}

export interface MergeSignals {
  readonly isDraft: boolean | undefined
  readonly mergeable: unknown
  readonly mergeStateStatus: unknown
  readonly reviewDecision: unknown
}

export function mapMerge(signals: MergeSignals): Merge {
  if (signals.isDraft) return "draft"
  if (signals.mergeable === "CONFLICTING" || signals.mergeStateStatus === "DIRTY") return "conflict"
  if (signals.reviewDecision === "CHANGES_REQUESTED") return "changes"
  if (signals.mergeStateStatus === "BLOCKED") return "blocked"
  if (signals.mergeStateStatus === "BEHIND") return "behind"
  if (signals.mergeStateStatus === "UNSTABLE") return "unstable"
  if (signals.reviewDecision === "REVIEW_REQUIRED") return "review"
  if (signals.mergeStateStatus === "CLEAN") return "ready"
  if (signals.mergeStateStatus === "HAS_HOOKS") return "hooks"
  if (signals.mergeable === "MERGEABLE") return "mergeable"
  return "unknown"
}

export interface CiMeta {
  readonly glyph: string
  readonly ascii: string
  readonly label: string
}

export const CI_META: Readonly<Record<Ci, CiMeta>> = {
  pass: { glyph: "✓", ascii: "v", label: "pass" },
  fail: { glyph: "✗", ascii: "x", label: "fail" },
  run: { glyph: "…", ascii: ".", label: "run" },
  wait: { glyph: "!", ascii: "!", label: "wait" },
  none: { glyph: "–", ascii: "-", label: "no checks" },
  unknown: { glyph: "?", ascii: "?", label: "unknown" },
}

export const MERGE_LABEL: Readonly<Record<Merge, string>> = {
  ready: "ready",
  blocked: "blocked",
  changes: "changes",
  conflict: "conflict",
  behind: "behind",
  unstable: "ci",
  review: "review",
  draft: "draft",
  hooks: "hooks",
  mergeable: "mergeable",
  unknown: "…",
}
