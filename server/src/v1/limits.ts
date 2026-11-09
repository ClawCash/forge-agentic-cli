// Per-client request limits for the free API. Counts live in memory, which is
// enough for one replica; a restart only resets them.

const WINDOW_MS = 60_000
const MAX_TRACKED = 50_000

// Railway sets X-Real-IP itself. The left of X-Forwarded-For is whatever the
// caller sent, so only its last entry, added by the nearest proxy, is used.
export function clientIp(header: (name: string) => string | undefined) {
  return (
    header("x-real-ip")?.trim() ||
    header("x-forwarded-for")?.split(",").at(-1)?.trim() ||
    "local"
  )
}

export function rateLimiter(now: () => number = Date.now) {
  const windows = new Map<string, { count: number; resetAt: number }>()

  return function hit(key: string, limit: number) {
    const time = now()
    if (windows.size >= MAX_TRACKED) {
      for (const [k, w] of windows) if (w.resetAt <= time) windows.delete(k)
      // Everything is still live: forget it all rather than grow without end.
      if (windows.size >= MAX_TRACKED) windows.clear()
    }
    let window = windows.get(key)
    if (!window || window.resetAt <= time) {
      window = { count: 0, resetAt: time + WINDOW_MS }
      windows.set(key, window)
    }
    window.count += 1
    return {
      allowed: window.count <= limit,
      retryAfterSeconds: Math.ceil((window.resetAt - time) / 1000),
    }
  }
}
