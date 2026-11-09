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

export function termsReader(fetcher: typeof fetch = fetch): ReadTerms {
  const cache = new Map<string, { at: number; terms: PaymentTerms }>()

  async function attempt(url: string, method: string): Promise<PaymentTerms> {
    const res = await fetcher(url, {
      method,
      redirect: "manual",
      headers: {
        Accept: "application/json",
        "User-Agent": "agent-reviews/1",
        ...(method === "POST" && { "Content-Type": "application/json" }),
      },
      ...(method === "POST" && { body: "{}" }),
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
      await assertPublicHttps(url)
      // Many paid routes only answer POST, and most return 402 before they
      // look at the body.
      let terms = await attempt(url, "GET")
      if (terms.status !== 402) terms = await attempt(url, "POST")
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
