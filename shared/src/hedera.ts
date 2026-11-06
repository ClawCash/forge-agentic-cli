import { HEDERA_TESTNET } from "./networks.ts"

// Hedera mirror node lookups. Accounts here are created from ECDSA keys, so
// each account ID (0.0.x) has an EVM address alias derived from the same key:
// the key that pays (account ID) is the key that reviews (EVM address).

export interface MirrorDeps {
  fetch: typeof fetch
  mirrorNode?: string
}

async function mirrorGet(deps: MirrorDeps, path: string) {
  const base = deps.mirrorNode ?? HEDERA_TESTNET.mirrorNode
  const res = await deps.fetch(`${base}/api/v1${path}`, {
    headers: { Accept: "application/json" },
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Mirror node returned HTTP ${res.status}`)
  return (await res.json()) as Record<string, unknown>
}

export async function accountIdForAddress(
  evmAddress: string,
  deps: MirrorDeps
): Promise<string | null> {
  const account = await mirrorGet(deps, `/accounts/${evmAddress}`)
  return typeof account?.account === "string" ? account.account : null
}

export async function addressForAccountId(
  accountId: string,
  deps: MirrorDeps
): Promise<string | null> {
  const account = await mirrorGet(deps, `/accounts/${accountId}`)
  return typeof account?.evm_address === "string" ? account.evm_address : null
}

// "0.0.123@1700000000.000000001" → "0.0.123-1700000000-000000001"
export function mirrorTransactionId(transactionId: string) {
  const match = /^(\d+\.\d+\.\d+)@(\d+)\.(\d+)$/.exec(transactionId)
  if (!match) throw new Error(`Not a Hedera transaction ID: ${transactionId}`)
  return `${match[1]}-${match[2]}-${match[3]}`
}

export interface MirrorTransaction {
  result: string
  consensus_timestamp: string
  token_transfers?: { token_id: string; account: string; amount: number }[]
}

export async function getTransaction(
  transactionId: string,
  deps: MirrorDeps
): Promise<MirrorTransaction[]> {
  const body = await mirrorGet(
    deps,
    `/transactions/${mirrorTransactionId(transactionId)}`
  )
  return Array.isArray(body?.transactions)
    ? (body.transactions as MirrorTransaction[])
    : []
}
