import type { Chain } from "viem"
import { hederaTestnet } from "viem/chains"

// The network everything runs on: x402 payments in USDC (an HTS token), and
// ERC-8004 identities and reviews through Hedera's EVM JSON-RPC relay.
export interface PaymentNetwork {
  id: string
  label: string
  usdc: string
  usdcDecimals: number
  mirrorNode: string
  evmChain: Chain
  evmRpcUrl: string
  transactionUrl: (transactionId: string) => string
}

export const HEDERA_TESTNET: PaymentNetwork = {
  id: "hedera:testnet",
  label: "Hedera testnet",
  usdc: "0.0.429274",
  usdcDecimals: 6,
  mirrorNode: "https://testnet.mirrornode.hedera.com",
  evmChain: hederaTestnet,
  evmRpcUrl: "https://testnet.hashio.io/api",
  transactionUrl: (id) => `https://hashscan.io/testnet/transaction/${id}`,
}

export const PAYMENT_NETWORKS: Record<string, PaymentNetwork> = {
  [HEDERA_TESTNET.id]: HEDERA_TESTNET,
}

export function formatUsdc(amount: bigint, decimals: number) {
  const scale = 10n ** BigInt(decimals)
  const whole = amount / scale
  const fraction = (amount % scale).toString().padStart(decimals, "0")
  const trimmed = fraction.replace(/0+$/, "").padEnd(2, "0")
  return `${whole}.${trimmed}`
}

export function parseUsd(value: string, decimals: number) {
  if (!/^\d+(\.\d+)?$/.test(value))
    throw new Error(`Not a dollar amount: ${value}`)
  const [whole, fraction = ""] = value.split(".")
  if (fraction.length > decimals) {
    throw new Error(`Too many decimals in ${value}`)
  }
  return (
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt(fraction.padEnd(decimals, "0"))
  )
}
