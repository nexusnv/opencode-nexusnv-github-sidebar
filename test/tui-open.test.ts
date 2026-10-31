import { describe, expect, test } from "bun:test"
import { openExternal, openLinksMode, openWithFeedback, safeExternalUrl, shouldUseOsc8 } from "../src/tui/open"
import { fakeTui } from "./helpers/tui"

describe("link policy", () => {
  test("accepts only the documented modes", () => {
    expect(openLinksMode("browser")).toBe("browser")
    expect(openLinksMode("osc8")).toBe("osc8")
    expect(openLinksMode("auto")).toBe("auto")
    expect(openLinksMode("nonsense")).toBe("auto")
    expect(openLinksMode(undefined)).toBe("auto")
    expect(openLinksMode(7)).toBe("auto")
  })

  test("switches to OSC 8 over SSH unless the mode is explicit", () => {
    expect(shouldUseOsc8("osc8", {})).toBe(true)
    expect(shouldUseOsc8("browser", { SSH_CONNECTION: "1 2 3 4" })).toBe(false)
    expect(shouldUseOsc8("auto", {})).toBe(false)
    expect(shouldUseOsc8("auto", { SSH_CONNECTION: "1 2 3 4" })).toBe(true)
    expect(shouldUseOsc8("auto", { SSH_TTY: "/dev/pts/1" })).toBe(true)
  })

  test("rejects anything that is not a canonical credential-free HTTPS URL", () => {
    expect(safeExternalUrl("https://github.com/acme/widgets/pull/7")).toBe("https://github.com/acme/widgets/pull/7")
    expect(safeExternalUrl("https://example.com")).toBe("https://example.com/")
    expect(safeExternalUrl("http://github.com/acme/widgets")).toBeUndefined()
    expect(safeExternalUrl("javascript:alert(1)")).toBeUndefined()
    expect(safeExternalUrl("file:///etc/passwd")).toBeUndefined()
    expect(safeExternalUrl("https://user:secret@example.com/x")).toBeUndefined()
    expect(safeExternalUrl("https://example.com@evil.example/x")).toBeUndefined()
    expect(safeExternalUrl("not a url")).toBeUndefined()
    expect(safeExternalUrl(undefined)).toBeUndefined()
    expect(safeExternalUrl({ href: "https://example.com" })).toBeUndefined()
    expect(safeExternalUrl(`https://example.com/${"a".repeat(2_048)}`)).toBeUndefined()
  })
})

describe("openExternal", () => {
  test("does not spawn an opener in OSC 8 mode", async () => {
    let spawned = 0
    const result = await openExternal("https://github.com/acme/widgets", "osc8", {
      opener: async () => {
        spawned++
      },
      env: {},
    })
    expect(result).toEqual({ ok: true })
    expect(spawned).toBe(0)
  })

  test("opens the canonical URL in browser mode", async () => {
    const opened: string[] = []
    const result = await openExternal("https://example.com", "browser", {
      opener: async (url) => {
        opened.push(url)
      },
      env: {},
    })
    expect(result).toEqual({ ok: true })
    expect(opened).toEqual(["https://example.com/"])
  })

  test("never hands an unsafe URL to the opener", async () => {
    let spawned = 0
    const result = await openExternal("http://example.com", "browser", {
      opener: async () => {
        spawned++
      },
      env: {},
    })
    expect(result.ok).toBe(false)
    expect(spawned).toBe(0)
  })

  test("reports opener failures without throwing", async () => {
    const result = await openExternal("https://example.com", "browser", {
      opener: async () => {
        throw new Error("no browser here")
      },
      env: {},
    })
    expect(result).toEqual({ ok: false, reason: "no browser here" })
  })
})

describe("openWithFeedback", () => {
  test("stays quiet when the link opens", async () => {
    const fake = fakeTui()
    const opened = await openWithFeedback(fake.context, "https://example.com", "browser", {
      opener: async () => undefined,
      env: {},
    })
    expect(opened).toBe(true)
    expect(fake.calls.toasts).toHaveLength(0)
  })

  test("shows the URL when the opener fails", async () => {
    const fake = fakeTui()
    const opened = await openWithFeedback(fake.context, "https://example.com", "browser", {
      opener: async () => {
        throw new Error("blocked")
      },
      env: {},
    })
    expect(opened).toBe(false)
    expect(fake.calls.toasts).toHaveLength(1)
    expect(fake.calls.toasts[0]).toMatchObject({ variant: "error" })
    expect(JSON.stringify(fake.calls.toasts[0])).toContain("https://example.com")
  })

  test("rejects unsafe links before spawning", async () => {
    const fake = fakeTui()
    let spawned = 0
    const opened = await openWithFeedback(fake.context, "javascript:alert(1)", "browser", {
      opener: async () => {
        spawned++
      },
      env: {},
    })
    expect(opened).toBe(false)
    expect(spawned).toBe(0)
    expect(fake.calls.toasts).toHaveLength(1)
  })
})
