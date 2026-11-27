import { assertPublicHttps, type ReadTerms } from "./terms.ts"

// Finds an API's paid endpoints from what it publishes about itself: its
// OpenAPI spec (with x-payment-info, as AgentCash and MPP directories read
// it) and its /.well-known/x402 list. A provider then picks which to seed.

export interface FoundEndpoint {
  url: string
  path: string
  methods: string[]
  summary: string | null
  price_usd: number | null
  // "listed" when the spec states the price, "live" when the API's own 402 did.
  price_source: "listed" | "live" | null
  protocols: string[]
}

export interface Discovery {
  endpoints: FoundEndpoint[]
  sources: string[]
  // Paths like /items/{id} can't be called without a value, so they're left out.
  skipped_templated: number
}

export type DiscoverEndpoints = (domain: string) => Promise<Discovery>

const MAX_DOC_BYTES = 4_000_000
const MAX_ENDPOINTS = 200
const MAX_LIVE_CHECKS = 15
const FRESH_MS = 5 * 60_000
const METHODS = ["get", "post", "put", "patch", "delete"] as const

async function readJson(fetcher: typeof fetch, url: string) {
  const res = await fetcher(url, {
    redirect: "manual",
    headers: { Accept: "application/json", "User-Agent": "402reviews/1" },
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok || !res.body) return null
  const chunks: Uint8Array[] = []
  let size = 0
  const reader = res.body.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > MAX_DOC_BYTES) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"))
  } catch {
    return null
  }
}

const dollars = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value
  // Only decimal strings: "10000" may be base units of a token, not dollars.
  if (typeof value === "string" && /^\d+\.\d+$/.test(value.trim())) return Number(value)
  return null
}
const isDollar = (currency: unknown) =>
  currency === undefined || (typeof currency === "string" && /^(usd|usdc|usdc\.e)$/i.test(currency))

// What the spec says one call costs, in dollars, when it says it plainly.
export function listedPrice(op: any): number | null {
  const direct = dollars(op?.["x-price-usd"])
  if (direct !== null) return direct
  const info = op?.["x-payment-info"]
  if (!info || typeof info !== "object") return null
  if (info.price && isDollar(info.price.currency)) {
    const price = dollars(info.price.amount)
    if (price !== null) return price
  }
  if (isDollar(info.currency)) {
    const price = dollars(info.amount)
    if (price !== null) return price
  }
  const offers: any[] = Array.isArray(info.offers) ? info.offers : []
  const prices = offers
    .filter((offer) => isDollar(offer?.currency))
    .map((offer) => dollars(offer?.amount))
    .filter((price): price is number => price !== null)
  return prices.length ? Math.min(...prices) : null
}

export function listedProtocols(op: any): string[] {
  const info = op?.["x-payment-info"] ?? op?.["x-payment"]
  const found = new Set<string>()
  const protocols: any[] = Array.isArray(info?.protocols) ? info.protocols : []
  for (const entry of protocols) {
    const names = typeof entry === "string" ? [entry] : Object.keys(entry ?? {})
    for (const name of names) {
      if (/x402/i.test(name)) found.add("x402")
      if (/mpp|tempo|stripe/i.test(name)) found.add("mpp")
    }
  }
  if (Array.isArray(info?.offers) && info.offers.length) found.add("mpp")
  return [...found]
}

const isPaid = (op: any) =>
  !!op && (op["x-payment-info"] || op["x-payment"] || op["x-price-usd"] !== undefined)

// Paid operations in an OpenAPI document, one entry per path.
export function fromSpec(spec: any, origin: string) {
  let prefix = ""
  const server = spec?.servers?.[0]?.url
  if (typeof server === "string") {
    try {
      const url = new URL(server, origin)
      if (url.origin === origin) prefix = url.pathname.replace(/\/+$/, "")
    } catch {
      // A server URL that doesn't parse: paths are taken as they are.
    }
  }
  const found = new Map<string, FoundEndpoint>()
  let templated = 0
  const paths = spec?.paths && typeof spec.paths === "object" ? spec.paths : {}
  for (const [rawPath, route] of Object.entries<any>(paths)) {
    const ops = METHODS.filter((method) => isPaid(route?.[method]))
    if (ops.length === 0) continue
    const path = `${prefix}${rawPath}`.replace(/\/+$/, "") || "/"
    if (path.includes("{")) {
      templated += 1
      continue
    }
    const priced = ops.map((method) => listedPrice(route[method])).filter((p): p is number => p !== null)
    const op = route[ops.includes("post") ? "post" : ops[0]]
    const summary = typeof op?.summary === "string" ? op.summary : typeof op?.description === "string" ? op.description : null
    found.set(path, {
      url: `${origin}${path}`,
      path,
      methods: ops.map((method) => method.toUpperCase()),
      summary: summary ? summary.replace(/\s+/g, " ").trim().slice(0, 160) : null,
      price_usd: priced.length ? Math.min(...priced) : null,
      price_source: priced.length ? "listed" : null,
      protocols: [...new Set(ops.flatMap((method) => listedProtocols(route[method])))],
    })
  }
  return { endpoints: [...found.values()], templated }
}

// URLs from /.well-known/x402: { resources: ["https://..." | "/path" | { url }] }.
export function fromWellKnown(doc: any, origin: string) {
  const resources: any[] = Array.isArray(doc?.resources) ? doc.resources : Array.isArray(doc) ? doc : []
  const urls: string[] = []
  for (const entry of resources) {
    const raw = typeof entry === "string" ? entry : typeof entry?.url === "string" ? entry.url : typeof entry?.resource === "string" ? entry.resource : null
    if (!raw) continue
    try {
      const url = new URL(raw, origin)
      if (url.origin === origin && !url.pathname.includes("{")) urls.push(`${origin}${url.pathname.replace(/\/+$/, "") || "/"}`)
    } catch {
      // Not a URL: skipped.
    }
  }
  return [...new Set(urls)]
}

const priceFrom = (terms: Awaited<ReturnType<ReadTerms>>, priceUsd: (asset: string, amount: bigint) => number | null) => {
  const prices = terms.accepts.flatMap((accept) =>
    accept.amount && /^\d+$/.test(accept.amount)
      ? [priceUsd(accept.asset, BigInt(accept.amount))].filter((p): p is number => p !== null)
      : []
  )
  return prices.length ? Math.min(...prices) : null
}

export function endpointDiscoverer({
  readTerms,
  priceUsd,
  fetcher = fetch,
  assertPublic = assertPublicHttps,
}: {
  readTerms: ReadTerms
  priceUsd: (asset: string, amount: bigint) => number | null
  fetcher?: typeof fetch
  assertPublic?: (url: string) => Promise<void>
}): DiscoverEndpoints {
  const cache = new Map<string, { at: number; found: Discovery }>()
  return async (domain) => {
    const known = cache.get(domain)
    if (known && Date.now() - known.at < FRESH_MS) return known.found
    const origin = `https://${domain}`
    await assertPublic(origin)
    const [spec, wellKnown] = await Promise.all([
      readJson(fetcher, `${origin}/openapi.json`).catch(() => null),
      readJson(fetcher, `${origin}/.well-known/x402`).catch(() => null),
    ])
    const sources: string[] = []
    const byPath = new Map<string, FoundEndpoint>()
    let templated = 0
    if (spec) {
      const parsed = fromSpec(spec, origin)
      templated = parsed.templated
      for (const endpoint of parsed.endpoints) byPath.set(endpoint.path, endpoint)
      sources.push("openapi.json")
    }
    if (wellKnown) {
      for (const url of fromWellKnown(wellKnown, origin)) {
        const path = new URL(url).pathname
        if (!byPath.has(path)) {
          byPath.set(path, { url, path, methods: [], summary: null, price_usd: null, price_source: null, protocols: [] })
        }
      }
      sources.push(".well-known/x402")
    }
    const endpoints = [...byPath.values()].slice(0, MAX_ENDPOINTS)
    // Endpoints the spec doesn't price: ask the API itself, a few at a time.
    const unpriced = endpoints.filter((endpoint) => endpoint.price_usd === null).slice(0, MAX_LIVE_CHECKS)
    let next = 0
    await Promise.all(
      Array.from({ length: 5 }, async () => {
        while (next < unpriced.length) {
          const endpoint = unpriced[next++]
          const terms = await readTerms(endpoint.url).catch(() => null)
          if (!terms || terms.status !== 402) continue
          endpoint.price_usd = priceFrom(terms, priceUsd)
          endpoint.price_source = endpoint.price_usd === null ? null : "live"
          if (endpoint.protocols.length === 0) endpoint.protocols = terms.protocols
        }
      })
    )
    endpoints.sort((a, b) => a.path.localeCompare(b.path))
    const found = { endpoints, sources, skipped_templated: templated }
    if (cache.size > 500) cache.clear()
    cache.set(domain, { at: Date.now(), found })
    return found
  }
}
