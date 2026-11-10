import { lookup } from "node:dns/promises"
import { isIP } from "node:net"
import { Challenge } from "mppx"
import { BASE, type PaymentTarget, SOLANA, TEMPO } from "./chains.ts"

// Reads what an API charges from its own unpaid 402 response. Now that there
// is no onchain registry, the live 402 is what ties an endpoint to the address
// a payment has to reach.

export interface PaymentTerms {
  live: boolean
  status: number | null
  protocols: string[]
  accepts: (PaymentTarget & { amount: string | null })[]
  // The top-level fields the seller says a successful response contains.
  advertised?: string[]
  error?: string
}

export interface SampleRequest {
  url: string
  method: string
  body?: string
}

export type ReadTerms = (
  url: string,
  sample?: SampleRequest
) => Promise<PaymentTerms>

// Looks up a directory's example request for one endpoint.
export type FindListing = (url: string) => Promise<SampleRequest | undefined>

// A review is filed against an endpoint and rolled up to its domain.
export function locate(input: string) {
  const url = new URL(/^[a-z]+:\/\//i.test(input) ? input : `https://${input}`)
  // "www." only merges for grouping: the URL itself must stay fetchable.
  const domain = url.hostname.toLowerCase().replace(/^www\./, "")
  const path = url.pathname.replace(/\/+$/, "")
  return { domain, path, url: `https://${url.host.toLowerCase()}${path}` }
}

const X402_V1_NETWORKS: Record<string, string> = {
  base: BASE,
  solana: SOLANA,
  tempo: TEMPO,
}

function isPrivateAddress(address: string) {
  if (address.includes(":")) {
    const low = address.toLowerCase()
    return (
      low === "::1" ||
      low === "::" ||
      low.startsWith("fc") ||
      low.startsWith("fd") ||
      low.startsWith("fe8") ||
      low.startsWith("::ffff:")
    )
  }
  const [a, b] = address.split(".").map(Number)
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  )
}

// These URLs come from strangers, so a review must never be able to make the
// server call its own private network.
export async function assertPublicHttps(value: string) {
  const url = new URL(value)
  if (url.protocol !== "https:") throw new Error("Only https URLs are read")
  const host = url.hostname.replace(/^\[|\]$/g, "")
  if (isIP(host) || !host.includes(".") || /\.(local|internal)$/i.test(host)) {
    throw new Error("Only public hostnames are read")
  }
  const addresses = await lookup(host, { all: true })
  if (addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error("Only public hostnames are read")
  }
}

function fromX402(required: any): PaymentTerms["accepts"] {
  if (!Array.isArray(required?.accepts)) return []
  return required.accepts.flatMap((accept: any) => {
    const network = X402_V1_NETWORKS[accept.network] ?? accept.network
    if (!accept.payTo || !accept.asset || !network) return []
    return [
      {
        network,
        asset: accept.asset,
        payTo: accept.payTo,
        amount: accept.amount ?? accept.maxAmountRequired ?? null,
      },
    ]
  })
}

function fromMpp(headers: Headers): PaymentTerms["accepts"] {
  if (!headers.get("www-authenticate")?.toLowerCase().includes("payment")) {
    return []
  }
  let challenges: any[]
  try {
    challenges = Challenge.fromHeadersList(headers)
  } catch {
    return []
  }
  return challenges.flatMap((challenge) => {
    const { amount, currency, recipient, methodDetails } = challenge.request
    if (!recipient || !currency) return []
    const network =
      challenge.method === "tempo"
        ? `eip155:${methodDetails?.chainId ?? 4217}`
        : challenge.method === "evm"
          ? `eip155:${methodDetails?.chainId}`
          : challenge.method === "solana"
            ? SOLANA
            : null
    return network
      ? [{ network, asset: currency, payTo: recipient, amount: amount ?? null }]
      : []
  })
}

function decodeHeader(value: string | null) {
  if (!value) return null
  try {
    return JSON.parse(Buffer.from(value, "base64").toString("utf8"))
  } catch {
    return null
  }
}

const rejectedInput = (terms: PaymentTerms) =>
  terms.status === 400 || terms.status === 422

const MAX_SPEC_BYTES = 16_000_000
const MAX_SAMPLE_BYTES = 16_000
const MAX_SAMPLE_DEPTH = 4
const SAMPLE_FRESH_MS = 24 * 60 * 60_000
const MAX_CACHED_SAMPLES = 2000

const MAX_REF_HOPS = 8

// Follows a "#/components/..." pointer within the same spec. Anything else,
// including a pointer to another document, gives no schema.
function deref(spec: any, node: any) {
  for (let hop = 0; hop < MAX_REF_HOPS; hop++) {
    if (typeof node?.$ref !== "string") return node
    if (!node.$ref.startsWith("#/")) return undefined
    node = node.$ref
      .slice(2)
      .split("/")
      .map((key: string) => key.replace(/~1/g, "/").replace(/~0/g, "~"))
      .reduce(
        (at: any, key: string) =>
          at && typeof at === "object" && Object.hasOwn(at, key)
            ? at[key]
            : undefined,
        spec
      )
  }
  return undefined
}

function sampleValue(spec: any, raw: any, depth: number): unknown {
  const schema = deref(spec, raw)
  if (schema?.example !== undefined) return schema.example
  if (schema?.default !== undefined) return schema.default
  if (Array.isArray(schema?.enum)) return schema.enum[0]
  if (schema?.format === "uri" || schema?.format === "url") {
    return "https://example.com"
  }
  if (schema?.format === "email") return "reviews@example.com"
  if (schema?.type === "number" || schema?.type === "integer") {
    return schema.minimum ?? 1
  }
  if (schema?.type === "boolean") return false
  if (schema?.type === "array") {
    return schema.minItems > 0
      ? [sampleValue(spec, schema.items, depth + 1)]
      : []
  }
  if (schema?.type === "object") return sampleObject(spec, schema, depth + 1)
  return "x"
}

function sampleObject(spec: any, raw: any, depth = 0) {
  if (depth > MAX_SAMPLE_DEPTH) return {}
  const schema = deref(spec, raw)
  const required: string[] = Array.isArray(schema?.required)
    ? schema.required
    : []
  return Object.fromEntries(
    required.map((name) => [
      name,
      sampleValue(spec, schema.properties?.[name], depth),
    ])
  )
}

// Builds a request the seller's own API spec says is valid, for sellers that
// check their input before they quote a price.
function sampleRequest(spec: any, url: string) {
  const target = new URL(url)
  const route = spec?.paths?.[target.pathname]
  if (route?.post) {
    const content = deref(spec, route.post.requestBody)?.content?.[
      "application/json"
    ]
    if (!content) return null
    const schema = deref(spec, content.schema)
    const body = JSON.stringify(
      content.example ?? schema?.example ?? sampleObject(spec, schema)
    )
    return body.length <= MAX_SAMPLE_BYTES
      ? { url, method: "POST", body }
      : null
  }
  if (!Array.isArray(route?.get?.parameters)) return null
  for (const raw of route.get.parameters) {
    const parameter = deref(spec, raw)
    if (parameter?.in === "query" && parameter.required) {
      const value = parameter.example ?? sampleValue(spec, parameter.schema, 0)
      target.searchParams.set(parameter.name, String(value))
    }
  }
  return target.href.length <= MAX_SAMPLE_BYTES
    ? { url: target.href, method: "GET" }
    : null
}

// A sample may change the body or the query, never which endpoint is asked:
// the terms that name the recipient have to come from the API under review.
function forEndpoint(
  sample: SampleRequest | null | undefined,
  url: string
): SampleRequest | undefined {
  if (!sample) return undefined
  try {
    return locate(sample.url).url === locate(url).url ? sample : undefined
  } catch {
    return undefined
  }
}

const FIELD_NAME = /^[\w.$\[\]-]{1,64}$/
const MAX_ADVERTISED_FIELDS = 40
const MAX_CACHED_SPECS = 2000

const cleanFields = (names: unknown[]) =>
  names
    .filter((n): n is string => typeof n === "string" && FIELD_NAME.test(n))
    .slice(0, MAX_ADVERTISED_FIELDS)

function advertisedIn(required: any) {
  const bazaar = required?.extensions?.bazaar
  const example = bazaar?.info?.output?.example
  if (example && typeof example === "object" && !Array.isArray(example)) {
    return cleanFields(Object.keys(example))
  }
  return cleanFields(
    Object.keys(
      bazaar?.schema?.properties?.output?.properties?.example?.properties ?? {}
    )
  )
}

async function fetchSpec(fetcher: typeof fetch, url: string) {
  const res = await fetcher(`${new URL(url).origin}/openapi.json`, {
    redirect: "manual",
    headers: { Accept: "application/json", "User-Agent": "agent-reviews/1" },
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
    if (size > MAX_SPEC_BYTES) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"))
}

// Required fields when the spec names them, because optional ones may
// legitimately be absent from a response.
function fieldsFromSpec(spec: any, url: string) {
  const route = spec?.paths?.[new URL(url).pathname]
  const schema = (route?.post ?? route?.get)?.responses?.["200"]?.content?.[
    "application/json"
  ]?.schema
  if (Array.isArray(schema?.required) && schema.required.length > 0) {
    return cleanFields(schema.required)
  }
  return cleanFields(Object.keys(schema?.properties ?? {}))
}

export function advertisedReader(
  fetcher: typeof fetch = fetch,
  assertPublic: (url: string) => Promise<void> = assertPublicHttps
) {
  const cache = new Map<string, { at: number; fields: string[] }>()
  return async (url: string) => {
    const known = cache.get(url)
    if (known && Date.now() - known.at < SAMPLE_FRESH_MS) return known.fields
    await assertPublic(url)
    const spec = await fetchSpec(fetcher, url).catch(() => null)
    const fields = spec ? fieldsFromSpec(spec, url) : []
    if (cache.size >= MAX_CACHED_SPECS) cache.clear()
    cache.set(url, { at: Date.now(), fields })
    return fields
  }
}

export function termsReader(
  fetcher: typeof fetch = fetch,
  assertPublic: (url: string) => Promise<void> = assertPublicHttps,
  { specs = true, listings }: { specs?: boolean; listings?: FindListing } = {}
): ReadTerms {
  const cache = new Map<string, { at: number; terms: PaymentTerms }>()
  const specSamples = new Map<
    string,
    { at: number; sample: SampleRequest | null }
  >()

  // Specs can be many megabytes, so each endpoint's sample is built once a day.
  async function sampleFromSpec(url: string) {
    const known = specSamples.get(url)
    if (known && Date.now() - known.at < SAMPLE_FRESH_MS) return known.sample
    const spec = await fetchSpec(fetcher, url).catch(() => null)
    const sample = spec ? sampleRequest(spec, url) : null
    if (specSamples.size >= MAX_CACHED_SAMPLES) specSamples.clear()
    specSamples.set(url, { at: Date.now(), sample })
    return sample
  }

  async function attempt(
    url: string,
    method: string,
    body = "{}"
  ): Promise<PaymentTerms> {
    const res = await fetcher(url, {
      method,
      redirect: "manual",
      headers: {
        Accept: "application/json",
        "User-Agent": "agent-reviews/1",
        ...(method === "POST" && { "Content-Type": "application/json" }),
      },
      ...(method === "POST" && { body }),
      signal: AbortSignal.timeout(8000),
    })
    if (res.status !== 402) {
      return { live: res.ok, status: res.status, protocols: [], accepts: [] }
    }
    const required =
      decodeHeader(res.headers.get("payment-required")) ??
      (await res
        .clone()
        .json()
        .catch(() => null))
    const x402 = fromX402(required)
    const mpp = fromMpp(res.headers)
    return {
      live: true,
      status: 402,
      protocols: [
        ...(x402.length ? ["x402"] : []),
        ...(mpp.length ? ["mpp"] : []),
      ],
      accepts: [...x402, ...mpp],
      advertised: advertisedIn(required),
    }
  }

  return async (url, listed) => {
    const cached = cache.get(url)
    if (cached && Date.now() - cached.at < 300_000) return cached.terms
    try {
      await assertPublic(url)
      const given = forEndpoint(listed, url)
      if (given) {
        // One request, when a directory has said what a valid call looks like.
        const direct = await attempt(given.url, given.method, given.body)
        if (direct.status === 402 || (direct.status ?? 0) >= 500) {
          if (direct.accepts.length > 0) {
            cache.set(url, { at: Date.now(), terms: direct })
          }
          return direct
        }
      }
      // Many paid routes only answer POST, and most return 402 before they
      // look at the body.
      const viaGet = await attempt(url, "GET")
      const viaPost =
        viaGet.status === 402 ? viaGet : await attempt(url, "POST")
      let terms = viaPost
      // Some check their input before they quote, so they need a valid
      // request: first one built from their own spec, then the example in
      // their directory listing. The price and recipient still come from
      // their own 402.
      const rejected = [viaGet, viaPost].some(rejectedInput)
      if (specs && rejected && terms.status !== 402) {
        const sample = forEndpoint(await sampleFromSpec(url), url)
        if (sample)
          terms = await attempt(sample.url, sample.method, sample.body)
      }
      if (listings && !given && rejected && terms.status !== 402) {
        const sample = forEndpoint(
          await listings(url).catch(() => undefined),
          url
        )
        if (sample)
          terms = await attempt(sample.url, sample.method, sample.body)
      }
      if (terms.accepts.length > 0) cache.set(url, { at: Date.now(), terms })
      return terms
    } catch (error) {
      return {
        live: false,
        status: null,
        protocols: [],
        accepts: [],
        error: (error as Error).message.split("\n")[0],
      }
    }
  }
}
