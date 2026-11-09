import type { ApiReviewStore, EndpointHealth } from "./store.ts"
import {
  locate,
  type PaymentTerms,
  type ReadTerms,
  type SampleRequest,
} from "./terms.ts"

// Reviews are the product. This is a light background check, so a dead API can
// be ranked last and an unreviewed one can still have a page. An unpaid check
// only reaches the paywall: "live" means the API is answering, not that a paid
// call will do what it advertises.

const SWEEP_MS = 6 * 60 * 60_000
const FIRST_SWEEP_MS = 30_000
const MAX_TARGETS = 200
const MAX_PER_DOMAIN = 5
const CONCURRENCY = 4
const MAX_SAMPLE_BYTES = 16_000
const DIRECTORY =
  "https://api.cdp.coinbase.com/platform/v2/x402/discovery/search"

// The jobs agents pay for most.
const QUERIES = [
  "web search",
  "web scraping",
  "people enrichment",
  "company data",
  "email finder",
  "token price",
  "crypto market data",
  "news search",
  "social media data",
  "image generation",
  "speech transcription",
  "translation",
  "pdf extraction",
  "weather",
]

export interface HealthTarget {
  url: string
  payers: number
  sample?: SampleRequest
}

export function healthStatus(terms: PaymentTerms) {
  if (terms.accepts.length > 0) return "live"
  const status = terms.status
  if (status === null || status >= 500 || status === 404 || status === 410) {
    return "down"
  }
  return "unclear"
}

// The directory publishes a valid example request for most listings.
export function listingSample(resource: any): SampleRequest | undefined {
  const input = resource?.extensions?.bazaar?.info?.input
  const method = String(input?.method ?? "").toUpperCase()
  if (typeof resource?.resource !== "string") return undefined
  if (method === "POST" && input.body && typeof input.body === "object") {
    const body = JSON.stringify(input.body)
    if (body.length > MAX_SAMPLE_BYTES) return undefined
    return { url: locate(resource.resource).url, method, body }
  }
  if (method === "GET" && input.queryParams) {
    const url = new URL(locate(resource.resource).url)
    for (const [name, value] of Object.entries(input.queryParams)) {
      url.searchParams.set(name, String(value))
    }
    return url.href.length <= MAX_SAMPLE_BYTES
      ? { url: url.href, method }
      : undefined
  }
  return undefined
}

// Most-paid-for first, with a cap so one big catalog can't fill the list.
export function chooseTargets(resources: any[], reviewedUrls: string[]) {
  const listed = new Map<string, HealthTarget>()
  for (const resource of resources) {
    if (typeof resource?.resource !== "string") continue
    let url: string
    try {
      url = locate(resource.resource).url
    } catch {
      continue
    }
    if (!url.startsWith("https://") || listed.has(url)) continue
    listed.set(url, {
      url,
      payers: resource.quality?.l30DaysUniquePayers ?? 0,
      sample: listingSample(resource),
    })
  }
  const perDomain = new Map<string, number>()
  const chosen = [...listed.values()]
    .sort((a, b) => b.payers - a.payers)
    .filter((target) => {
      const { domain } = locate(target.url)
      const count = perDomain.get(domain) ?? 0
      perDomain.set(domain, count + 1)
      return count < MAX_PER_DOMAIN
    })
    .slice(0, MAX_TARGETS)
  const known = new Set(chosen.map((target) => target.url))
  // Anything already reviewed is always watched.
  const reviewed = reviewedUrls
    .filter((url) => !known.has(url))
    .map((url) => ({ url, payers: 0 }))
  return [...chosen, ...reviewed]
}

export function healthChecker(deps: {
  store: ApiReviewStore
  readTerms: ReadTerms
  fetch?: typeof fetch
}) {
  const fetcher = deps.fetch ?? fetch
  let running = false

  async function readDirectory() {
    const found: any[] = []
    for (const query of QUERIES) {
      try {
        const res = await fetcher(
          `${DIRECTORY}?${new URLSearchParams({ query, limit: "20" })}`,
          { signal: AbortSignal.timeout(10_000) }
        )
        if (!res.ok) continue
        const body = (await res.json()) as { resources?: any[] }
        found.push(...(body.resources ?? []))
      } catch {
        // One failed search shouldn't stop the others.
      }
    }
    return found
  }

  async function checkOne(target: HealthTarget) {
    const terms = await deps.readTerms(target.url, target.sample)
    await deps.store.saveHealth({
      url: target.url,
      domain: locate(target.url).domain,
      status: healthStatus(terms),
      checkedAt: new Date(),
    })
  }

  async function sweep() {
    if (running) return
    running = true
    try {
      const [resources, recent] = await Promise.all([
        readDirectory(),
        deps.store.listRecent(5000),
      ])
      const reviewed = [...new Set(recent.map((row) => locate(row.url).url))]
      const queue = chooseTargets(resources, reviewed)
      await Promise.all(
        Array.from({ length: CONCURRENCY }, async () => {
          for (let next = queue.shift(); next; next = queue.shift()) {
            await checkOne(next).catch(() => {})
          }
        })
      )
    } finally {
      running = false
    }
  }

  return {
    sweep,
    start() {
      const run = () => void sweep().catch(() => {})
      setTimeout(run, FIRST_SWEEP_MS).unref()
      setInterval(run, SWEEP_MS).unref()
    },
  }
}

export function healthView(row: EndpointHealth | undefined) {
  if (!row) return null
  return { status: row.status, checked_at: row.checkedAt.toISOString() }
}

// A domain is live if any endpoint is, and down only if every one is.
export function domainHealth(rows: EndpointHealth[]) {
  if (rows.length === 0) return null
  const statuses = new Set(rows.map((row) => row.status))
  const newest = Math.max(...rows.map((row) => row.checkedAt.getTime()))
  return {
    status: statuses.has("live")
      ? "live"
      : statuses.size === 1
        ? rows[0].status
        : "unclear",
    checked_at: new Date(newest).toISOString(),
  }
}
