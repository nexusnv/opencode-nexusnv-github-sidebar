import { describe, expect, test } from "bun:test"
import { SummaryCache } from "../src/server/cache"

function clock(start = 1_000_000) {
  let value = start
  return {
    now: () => value,
    advance: (ms: number) => {
      value += ms
    },
  }
}

describe("SummaryCache", () => {
  test("returns a fresh value until its TTL expires", async () => {
    const time = clock()
    const cache = new SummaryCache<number>(time.now)
    let loads = 0
    const load = async () => ++loads

    const first = await cache.get({ key: "k", ttlMs: 1_000, staleMs: 0, force: false, load })
    expect(first).toEqual({ value: 1, fetchedAt: time.now(), stale: false })

    const second = await cache.get({ key: "k", ttlMs: 1_000, staleMs: 0, force: false, load })
    expect(second.value).toBe(1)
    expect(loads).toBe(1)

    time.advance(1_001)
    const third = await cache.get({ key: "k", ttlMs: 1_000, staleMs: 0, force: false, load })
    expect(third.value).toBe(2)
    expect(loads).toBe(2)
  })

  test("force bypasses a fresh entry", async () => {
    const cache = new SummaryCache<number>(clock().now)
    let loads = 0
    const load = async () => ++loads
    await cache.get({ key: "k", ttlMs: 60_000, staleMs: 0, force: false, load })
    const forced = await cache.get({ key: "k", ttlMs: 60_000, staleMs: 0, force: true, load })
    expect(forced.value).toBe(2)
  })

  test("serves the last good value while it is within staleSeconds", async () => {
    const time = clock()
    const cache = new SummaryCache<number>(time.now)
    await cache.get({ key: "k", ttlMs: 1_000, staleMs: 60, force: false, load: async () => 1 })
    time.advance(10_000)

    const load = async () => {
      throw new Error("network")
    }
    const stale = await cache.get({ key: "k", ttlMs: 1_000, staleMs: 60, force: false, load })
    expect(stale.stale).toBe(true)
    expect(stale.value).toBe(1)

    // The short failure cache must not hide the same stale value on a repeat
    // refresh while the stale window is still open.
    const again = await cache.get({ key: "k", ttlMs: 1_000, staleMs: 60, force: false, load })
    expect(again.stale).toBe(true)
    expect(again.value).toBe(1)
  })

  test("does not serve stale data outside staleSeconds", async () => {
    const time = clock()
    const cache = new SummaryCache<number>(time.now)
    await cache.get({ key: "k", ttlMs: 1_000, staleMs: 5, force: false, load: async () => 1 })
    time.advance(10_000)

    await expect(
      cache.get({
        key: "k",
        ttlMs: 1_000,
        staleMs: 5,
        force: false,
        load: async () => {
          throw new Error("network")
        },
      }),
    ).rejects.toThrow("network")
  })

  test("caches a failure for a short period unless forced", async () => {
    const time = clock()
    const cache = new SummaryCache<number>(time.now)
    let loads = 0
    const load = async () => {
      loads++
      throw new Error("boom")
    }

    await expect(cache.get({ key: "k", ttlMs: 1_000, staleMs: 0, force: false, load })).rejects.toThrow("boom")
    await expect(cache.get({ key: "k", ttlMs: 1_000, staleMs: 0, force: false, load })).rejects.toThrow("boom")
    expect(loads).toBe(1)

    await expect(cache.get({ key: "k", ttlMs: 1_000, staleMs: 0, force: true, load })).rejects.toThrow("boom")
    expect(loads).toBe(2)
  })

  test("deduplicates concurrent loads", async () => {
    const cache = new SummaryCache<number>(clock().now)
    let loads = 0
    let release: (value: number) => void = () => {}
    const load = () => {
      loads++
      return new Promise<number>((resolve) => {
        release = resolve
      })
    }

    const first = cache.get({ key: "k", ttlMs: 1_000, staleMs: 0, force: false, load })
    const second = cache.get({ key: "k", ttlMs: 1_000, staleMs: 0, force: false, load })
    release(42)
    const [a, b] = await Promise.all([first, second])
    expect(loads).toBe(1)
    expect(a.value).toBe(42)
    expect(b.value).toBe(42)
  })

  test("keys are independent", async () => {
    const cache = new SummaryCache<number>(clock().now)
    await cache.get({ key: "a", ttlMs: 1_000, staleMs: 0, force: false, load: async () => 1 })
    const b = await cache.get({ key: "b", ttlMs: 1_000, staleMs: 0, force: false, load: async () => 2 })
    expect(b.value).toBe(2)
  })
})
