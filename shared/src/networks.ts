import type { Address, Chain } from "viem"
import { arcTestnet } from "viem/chains"

// Networks the CLI will pay on, with the stablecoin it accepts there.
export interface PaymentNetwork {
  id: string
  label: string
  chain: Chain
  defaultRpcUrl: string
  usdc: Address
  usdcDecimals: number
  explorerTx: (hash: string) => string
}

export const PAYMENT_NETWORKS: Record<string, PaymentNetwork> = {
  "eip155:5042002": {
    id: "eip155:5042002",
    label: "Arc testnet",
    chain: arcTestnet,
    defaultRpcUrl: "https://rpc.testnet.arc.io",
    usdc: "0x3600000000000000000000000000000000000000",
    usdcDecimals: 6,
    explorerTx: (hash) => `https://explorer.testnet.arc.io/tx/${hash}`,
  },
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
