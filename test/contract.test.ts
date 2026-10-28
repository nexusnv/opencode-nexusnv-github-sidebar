import { describe, expect, test } from "bun:test"
import {
  isEffectiveView,
  isIssueView,
  isLaunchResult,
  isPullView,
  isRepoRef,
  isSummaryResponse,
  parseLaunchInput,
  parseSummaryInput,
} from "../src/shared/contract"
import { effectiveView, issueView, launchResult, pullView, repoRef, summaryData, summaryResponse } from "./helpers/tui"

describe("input parsers", () => {
  test("accepts a summary input with an explicit force flag", () => {
    expect(parseSummaryInput({ force: true })).toEqual({ force: true, full: false })
    expect(parseSummaryInput({ force: false, full: true })).toEqual({ force: false, full: true })
    expect(() => parseSummaryInput({})).toThrow(TypeError)
    expect(() => parseSummaryInput({ force: "yes" })).toThrow(TypeError)
    expect(() => parseSummaryInput({ force: true, full: "yes" })).toThrow(TypeError)
    expect(() => parseSummaryInput(null)).toThrow(TypeError)
    expect(() => parseSummaryInput([])).toThrow(TypeError)
  })

  test("accepts only positive pull and issue numbers", () => {
    expect(parseLaunchInput({ kind: "pull", number: 7 })).toEqual({ kind: "pull", number: 7 })
    expect(parseLaunchInput({ kind: "issue", number: 9 })).toEqual({ kind: "issue", number: 9 })
    expect(() => parseLaunchInput({ kind: "discussion", number: 7 })).toThrow(TypeError)
    expect(() => parseLaunchInput({ kind: "pull", number: 0 })).toThrow(TypeError)
    expect(() => parseLaunchInput({ kind: "pull", number: -1 })).toThrow(TypeError)
    expect(() => parseLaunchInput({ kind: "pull", number: 1.5 })).toThrow(TypeError)
    expect(() => parseLaunchInput({ kind: "pull", number: "7" })).toThrow(TypeError)
    expect(() => parseLaunchInput(null)).toThrow(TypeError)
  })
})

describe("row validators", () => {
  test("accept valid rows and reject malformed rows", () => {
    expect(isPullView(pullView())).toBe(true)
    expect(isPullView({ ...pullView(), number: -1 })).toBe(false)
    expect(isPullView({ ...pullView(), ci: "green" })).toBe(false)
    expect(isPullView({ ...pullView(), merge: "maybe" })).toBe(false)
    expect(isPullView({ ...pullView(), title: undefined })).toBe(false)
    expect(isPullView({ ...pullView(), comments: 1.5 })).toBe(false)
    expect(isPullView(null)).toBe(false)

    expect(isIssueView(issueView())).toBe(true)
    expect(isIssueView({ ...issueView(), assignees: "me" })).toBe(false)
    expect(isIssueView({ ...issueView(), labels: [1] })).toBe(false)
    expect(isIssueView({ ...issueView(), isMine: 1 })).toBe(false)

    expect(isRepoRef(repoRef())).toBe(true)
    expect(isRepoRef({ ...repoRef(), isPrivate: "false" })).toBe(false)
    expect(isRepoRef({ ...repoRef(), url: undefined })).toBe(false)
  })
})

describe("view validator", () => {
  test("accepts the effective view produced by the server", () => {
    expect(isEffectiveView(effectiveView())).toBe(true)
  })

  test("rejects unknown sections, glyphs, and action flags", () => {
    expect(isEffectiveView(effectiveView({ display: { order: ["pulls", "discussions" as never] } }))).toBe(false)
    expect(isEffectiveView(effectiveView({ display: { glyphs: "emoji" as never } }))).toBe(false)
    expect(isEffectiveView(effectiveView({ actions: { confirm: "yes" as never } }))).toBe(false)
    expect(isEffectiveView(effectiveView({ issues: { labels: -1 } }))).toBe(false)
    expect(isEffectiveView(effectiveView({ refreshSeconds: -1 }))).toBe(false)
    expect(isEffectiveView(undefined)).toBe(false)
  })
})

describe("summary response validator", () => {
  test("accepts ready and error envelopes", () => {
    expect(isSummaryResponse(summaryResponse())).toBe(true)
    expect(
      isSummaryResponse({
        status: "no-auth",
        message: "GitHub token not set",
        view: effectiveView(),
        fetchedAt: 1,
        retryAt: "",
      }),
    ).toBe(true)
    expect(isSummaryResponse(summaryResponse({ status: "disabled", data: undefined, repository: undefined }))).toBe(
      true,
    )
  })

  test("rejects unknown statuses and malformed nested data", () => {
    expect(isSummaryResponse({ ...summaryResponse(), status: "teapot" })).toBe(false)
    expect(isSummaryResponse({ ...summaryResponse(), fetchedAt: undefined })).toBe(false)
    expect(isSummaryResponse({ ...summaryResponse(), view: undefined })).toBe(false)
    expect(isSummaryResponse(summaryResponse({ repository: repoRef({ host: "" }) }))).toBe(true)
    expect(
      isSummaryResponse(
        summaryResponse({
          data: summaryData({ pulls: [pullView({ number: Number.NaN })] }),
        }),
      ),
    ).toBe(false)
    expect(
      isSummaryResponse(
        summaryResponse({
          data: summaryData({ totals: { pulls: 1, issues: -1 } }),
        }),
      ),
    ).toBe(false)
  })

  test("accepts an omitted or well-formed rate limit", () => {
    expect(isSummaryResponse(summaryResponse({ data: summaryData() }))).toBe(true)
    expect(
      isSummaryResponse(
        summaryResponse({
          data: summaryData({ rateLimit: { cost: 1, remaining: 4_000, resetAt: "2026-10-27T07:00:00Z" } }),
        }),
      ),
    ).toBe(true)
    expect(
      isSummaryResponse(
        summaryResponse({
          data: summaryData({ rateLimit: { cost: 1, remaining: -1, resetAt: "" } }),
        }),
      ),
    ).toBe(false)
  })
})

describe("launch result validator", () => {
  test("accepts success and typed failure envelopes", () => {
    expect(isLaunchResult(launchResult())).toBe(true)
    expect(isLaunchResult(launchResult({ ok: false, code: "fetch-failed", message: "failed" }))).toBe(true)
  })

  test("rejects unknown codes, kinds, and malformed repository data", () => {
    expect(isLaunchResult(launchResult({ code: "exploded" as never }))).toBe(false)
    expect(isLaunchResult(launchResult({ kind: "discussion" as never }))).toBe(false)
    expect(isLaunchResult(launchResult({ number: -7 }))).toBe(false)
    expect(
      isLaunchResult(launchResult({ repository: { ...launchResult().repository, isPrivate: "no" as never } })),
    ).toBe(false)
    expect(isLaunchResult({ ...launchResult(), context: undefined })).toBe(false)
    expect(isLaunchResult(null)).toBe(false)
  })
})
