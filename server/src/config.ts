import type { Hex } from "viem"

export interface ServerConfig {
  // Public origin used in 402 responses and ERC-8004 registration files.
  baseUrl: string
  arcRpcUrl: string
  // The demo merchant: owns both services' ERC-8004 identities, receives
  // their payments, and pays gas to settle them on Arc.
  sellerPrivateKey: Hex
  // ERC-8004 agent IDs, known once the services are registered (Phase 3).
  agentIds: { a?: string; b?: string }
}

export function loadConfig(env = process.env): ServerConfig {
  const sellerPrivateKey = env.SERVICE_OWNER_PRIVATE_KEY
  if (!sellerPrivateKey || !/^0x[0-9a-fA-F]{64}$/.test(sellerPrivateKey)) {
    throw new Error(
      "SERVICE_OWNER_PRIVATE_KEY must be a 0x-prefixed private key"
    )
  }
  const baseUrl =
    env.PUBLIC_BASE_URL ??
    (env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${env.RAILWAY_PUBLIC_DOMAIN}`
      : `http://localhost:${env.PORT ?? 8787}`)
  return {
    baseUrl: baseUrl.replace(/\/$/, ""),
    arcRpcUrl: env.ARC_RPC_URL ?? "https://rpc.testnet.arc.io",
    sellerPrivateKey: sellerPrivateKey as Hex,
    agentIds: {
      a: env.DEMO_API_A_AGENT_ID || undefined,
      b: env.DEMO_API_B_AGENT_ID || undefined,
    },
  }
}
