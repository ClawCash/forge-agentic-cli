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
  error?: string
}

export type ReadTerms = (url: string) => Promise<PaymentTerms>

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

function sampleValue(schema: any, depth: number): unknown {
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
    return schema.minItems > 0 ? [sampleValue(schema.items, depth + 1)] : []
  }
  if (schema?.type === "object") return sampleObject(schema, depth + 1)
  return "x"
}

function sampleObject(schema: any, depth = 0) {
  if (depth > MAX_SAMPLE_DEPTH) return {}
  const required: string[] = Array.isArray(schema?.required)
    ? schema.required
    : []
  return Object.fromEntries(
    required.map((name) => [
      name,
      sampleValue(schema.properties?.[name], depth),
    ])
  )
}

// Builds a request the seller's own API spec says is valid, for sellers that
// check their input before they quote a price.
function sampleRequest(spec: any, url: string) {
  const target = new URL(url)
  const route = spec?.paths?.[target.pathname]
  if (route?.post) {
    const content = route.post.requestBody?.content?.["application/json"]
    if (!content) return null
    const body = JSON.stringify(
      content.example ?? content.schema?.example ?? sampleObject(content.schema)
    )
    return body.length <= MAX_SAMPLE_BYTES
      ? { url, method: "POST", body }
      : null
  }
  if (!Array.isArray(route?.get?.parameters)) return null
  for (const parameter of route.get.parameters) {
    if (parameter?.in === "query" && parameter.required) {
      const value = parameter.example ?? sampleValue(parameter.schema, 0)
      target.searchParams.set(parameter.name, String(value))
    }
  }
  return target.href.length <= MAX_SAMPLE_BYTES
    ? { url: target.href, method: "GET" }
    : null
}

export function termsReader(
  fetcher: typeof fetch = fetch,
  assertPublic: (url: string) => Promise<void> = assertPublicHttps
): ReadTerms {
  const cache = new Map<string, { at: number; terms: PaymentTerms }>()

  async function readSpec(url: string) {
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
    }
  }

  return async (url) => {
    const cached = cache.get(url)
    if (cached && Date.now() - cached.at < 300_000) return cached.terms
    try {
      await assertPublic(url)
      // Many paid routes only answer POST, and most return 402 before they
      // look at the body.
      const viaGet = await attempt(url, "GET")
      let terms = viaGet
      if (terms.status !== 402) terms = await attempt(url, "POST")
      if (terms.status !== 402 && [viaGet, terms].some(rejectedInput)) {
        const spec = await readSpec(url).catch(() => null)
        const sample = spec && sampleRequest(spec, url)
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
