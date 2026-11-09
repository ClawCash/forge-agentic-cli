import type { Hex } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { accountIdForAddress } from "../../shared/src/hedera.ts"

export interface ServerConfig {
  // Public origin used in 402 responses and ERC-8004 registration files.
  baseUrl: string
  // The demo merchant's Hedera account: owns both services' ERC-8004
  // identities and receives their payments.
  sellerAccountId: string
  // x402 facilitator that verifies and settles Hedera payments (and pays the
  // network fees).
  facilitatorUrl: string
  // ERC-8004 agent IDs on Hedera testnet, known once the services are
  // registered.
  agentIds: { a?: string; b?: string }
}

const HEDERA_ACCOUNT = /^0\.0\.\d+$/

export function publicBaseUrl(env: Record<string, string | undefined>) {
  const baseUrl =
    env.PUBLIC_BASE_URL ??
    (env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${env.RAILWAY_PUBLIC_DOMAIN}`
      : `http://localhost:${env.PORT ?? 8787}`)
  return baseUrl.replace(/\/$/, "")
}

// The seller's account ID comes from SERVICE_OWNER_HEDERA_ACCOUNT_ID, or is
// looked up on the mirror node from SERVICE_OWNER_PRIVATE_KEY's EVM address.
export async function loadConfig(
  env = process.env,
  deps: { fetch: typeof fetch } = { fetch }
): Promise<ServerConfig> {
  let sellerAccountId = env.SERVICE_OWNER_HEDERA_ACCOUNT_ID
  if (!sellerAccountId) {
    const key = env.SERVICE_OWNER_PRIVATE_KEY
    if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
      throw new Error(
        "Set SERVICE_OWNER_HEDERA_ACCOUNT_ID or SERVICE_OWNER_PRIVATE_KEY"
      )
    }
    const { address } = privateKeyToAccount(key as Hex)
    sellerAccountId = (await accountIdForAddress(address, deps)) ?? undefined
    if (!sellerAccountId) {
      throw new Error(
        `The service owner ${address} has no Hedera testnet account yet; send it testnet HBAR first`
      )
    }
  }
  if (!HEDERA_ACCOUNT.test(sellerAccountId)) {
    throw new Error(`Not a Hedera account ID: ${sellerAccountId}`)
  }
  return {
    baseUrl: publicBaseUrl(env),
    sellerAccountId,
    facilitatorUrl: env.X402_FACILITATOR_URL ?? "https://x402.org/facilitator",
    agentIds: {
      a: env.DEMO_API_A_AGENT_ID || undefined,
      b: env.DEMO_API_B_AGENT_ID || undefined,
    },
  }
}
