export interface CacheEntry<T> {
  readonly value: T
  readonly fetchedAt: number
  readonly expiresAt: number
}

export interface CacheHit<T> {
  readonly value: T
  readonly fetchedAt: number
  readonly stale: boolean
}

interface Failure {
  readonly error: unknown
  readonly until: number
}

const ERROR_TTL_MS = 15_000

/**
 * In-memory, per-location summary cache.
 *
 * - concurrent requests share one in-flight load
 * - `force` bypasses TTL and the short error cache
 * - a failed refresh can serve the last good value while it is younger than
 *   `staleSeconds`
 *
 * Nothing is persisted: private titles and merge state must not survive the
 * process.
 */
export class SummaryCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>()
  private readonly inFlight = new Map<string, Promise<T>>()
  private readonly failures = new Map<string, Failure>()
  private readonly now: () => number

  constructor(now: () => number = Date.now) {
    this.now = now
  }

  peek(key: string): CacheEntry<T> | undefined {
    return this.entries.get(key)
  }

  clear(): void {
    this.entries.clear()
    this.inFlight.clear()
    this.failures.clear()
  }

  async get(options: {
    readonly key: string
    readonly ttlMs: number
    readonly staleMs: number
    readonly force: boolean
    readonly load: () => Promise<T>
  }): Promise<CacheHit<T>> {
    const now = this.now()
    const entry = this.entries.get(options.key)
    if (!options.force && entry && entry.expiresAt > now) {
      return { value: entry.value, fetchedAt: entry.fetchedAt, stale: false }
    }

    const failure = this.failures.get(options.key)
    if (!options.force && failure && failure.until > now) {
      const previous = this.entries.get(options.key)
      if (previous && options.staleMs > 0 && now - previous.fetchedAt <= options.staleMs * 1000) {
        return { value: previous.value, fetchedAt: previous.fetchedAt, stale: true }
      }
      throw failure.error
    }

    const pending = this.inFlight.get(options.key)
    if (pending) {
      const value = await pending
      const hit = this.entries.get(options.key)
      return { value, fetchedAt: hit?.fetchedAt ?? this.now(), stale: false }
    }

    const load = options.load()
    this.inFlight.set(options.key, load)
    try {
      const value = await load
      const fetchedAt = this.now()
      this.entries.set(options.key, {
        value,
        fetchedAt,
        expiresAt: fetchedAt + options.ttlMs,
      })
      this.failures.delete(options.key)
      return { value, fetchedAt, stale: false }
    } catch (error) {
      this.failures.set(options.key, { error, until: this.now() + ERROR_TTL_MS })
      const previous = this.entries.get(options.key)
      if (previous && options.staleMs > 0 && this.now() - previous.fetchedAt <= options.staleMs * 1000) {
        return { value: previous.value, fetchedAt: previous.fetchedAt, stale: true }
      }
      throw error
    } finally {
      this.inFlight.delete(options.key)
    }
  }
}
