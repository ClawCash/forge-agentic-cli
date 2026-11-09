import {
  createPublicClient,
  type Hex,
  http,
  isAddressEqual,
  isHash,
  parseAbiItem,
} from "viem"

// Proof of real use. A review is only accepted when the wallet that wrote it
// has a settled payment to the address the API charges to, so everything here
// reads public chain data and nothing ever moves money.

export const BASE = "eip155:8453"
export const TEMPO = "eip155:4217"
export const SOLANA = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"

export const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
const USDC_SOLANA = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
const USDC_TEMPO = "0x20C000000000000000000000b9537d11c60E8b50"
const PATH_USD_TEMPO = "0x20c0000000000000000000000000000000000000"

// Dollar stablecoins with 6 decimals. Anything else has no known USD price.
const USD_ASSETS = new Set(
  [USDC_BASE, USDC_SOLANA, USDC_TEMPO, PATH_USD_TEMPO].map((a) =>
    a.toLowerCase()
  )
)

export function priceUsd(asset: string, amount: bigint): number | null {
  return USD_ASSETS.has(asset.toLowerCase()) ? Number(amount) / 1e6 : null
}

export interface PaymentTarget {
  network: string
  asset: string
  payTo: string
}

export interface FoundPayment extends PaymentTarget {
  // Unique per settled payment: one payment backs at most one review.
  reference: string
  transaction: string
  amount: bigint
  paidAt: Date
}

export interface FindPayments {
  (args: {
    wallet: string
    target: PaymentTarget
    transaction?: string
    since: Date
  }): Promise<FoundPayment[]>
}

export class ChainUnavailableError extends Error {}

const TRANSFER = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)"
)

const isEvm = (value: string) => /^0x[0-9a-fA-F]{40}$/.test(value)

function evmFinder(network: string, rpcUrl: string, blockSpan: bigint) {
  const client = createPublicClient({ transport: http(rpcUrl) })

  async function paidAt(blockNumber: bigint) {
    const block = await client.getBlock({ blockNumber })
    return new Date(Number(block.timestamp) * 1000)
  }

  function asPayment(
    target: PaymentTarget,
    hash: string,
    amount: bigint,
    at: Date
  ): FoundPayment {
    return {
      ...target,
      reference: `${network}:${hash.toLowerCase()}`,
      transaction: hash,
      amount,
      paidAt: at,
    }
  }

  // A receipt shows exactly what moved, so a given hash needs one lookup.
  async function byTransaction(
    wallet: string,
    target: PaymentTarget,
    hash: Hex
  ) {
    const receipt = await client
      .getTransactionReceipt({ hash })
      .catch(() => null)
    if (!receipt || receipt.status !== "success") return []
    const topic = `0x000000000000000000000000`
    const from = `${topic}${wallet.slice(2).toLowerCase()}`
    const to = `${topic}${target.payTo.slice(2).toLowerCase()}`
    const amount = receipt.logs
      .filter(
        (log) =>
          isAddressEqual(log.address, target.asset as Hex) &&
          log.topics[0] ===
            "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" &&
          log.topics[1]?.toLowerCase() === from &&
          log.topics[2]?.toLowerCase() === to
      )
      .reduce((sum, log) => sum + BigInt(log.data), 0n)
    if (amount === 0n) return []
    return [asPayment(target, hash, amount, await paidAt(receipt.blockNumber))]
  }

  // Clients that hide the transaction hash: scan newest first, in windows the
  // public RPC allows, and stop at the first window with payments.
  async function scan(wallet: string, target: PaymentTarget, since: Date) {
    let high = await client.getBlockNumber()
    for (let window = 0; window < 32 && high > 0n; window++) {
      const low = high > blockSpan ? high - blockSpan + 1n : 0n
      const logs = await client.getLogs({
        address: target.asset as Hex,
        event: TRANSFER,
        args: { from: wallet as Hex, to: target.payTo as Hex },
        fromBlock: low,
        toBlock: high,
      })
      if (logs.length > 0) {
        const payments = await Promise.all(
          logs
            .slice(-20)
            .reverse()
            .map(async (log) =>
              asPayment(
                target,
                log.transactionHash,
                log.args.value ?? 0n,
                await paidAt(log.blockNumber)
              )
            )
        )
        return payments.filter((payment) => payment.paidAt >= since)
      }
      const oldest = await paidAt(low)
      if (oldest < since) return []
      high = low - 1n
    }
    return []
  }

  const find: FindPayments = async ({ wallet, target, transaction, since }) => {
    if (!isEvm(wallet) || !isEvm(target.payTo) || !isEvm(target.asset)) {
      return []
    }
    try {
      if (transaction) {
        if (!isHash(transaction)) return []
        const found = await byTransaction(wallet, target, transaction)
        return found.filter((payment) => payment.paidAt >= since)
      }
      return await scan(wallet, target, since)
    } catch (error) {
      throw new ChainUnavailableError(
        `${network} lookup failed: ${(error as Error).message.split("\n")[0]}`
      )
    }
  }
  return find
}

function solanaFinder(rpcUrl: string, fetcher: typeof fetch) {
  async function rpc(method: string, params: unknown[]) {
    const res = await fetcher(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error(`Solana RPC returned HTTP ${res.status}`)
    const body = (await res.json()) as { result?: any; error?: unknown }
    if (body.error) throw new Error(JSON.stringify(body.error).slice(0, 200))
    return body.result
  }

  // Token balance changes show what the wallet paid and what the seller got.
  async function payment(
    wallet: string,
    target: PaymentTarget,
    signature: string
  ): Promise<FoundPayment | null> {
    const tx = await rpc("getTransaction", [
      signature,
      { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 },
    ])
    if (!tx || tx.meta?.err) return null
    const delta = (owner: string): bigint => {
      const balance = (list: any[] = []): bigint =>
        list
          .filter((b) => b.owner === owner && b.mint === target.asset)
          .reduce(
            (sum: bigint, b: any) => sum + BigInt(b.uiTokenAmount.amount),
            0n
          )
      return (
        balance(tx.meta.postTokenBalances) - balance(tx.meta.preTokenBalances)
      )
    }
    const received = delta(target.payTo)
    if (received <= 0n || delta(wallet) >= 0n) return null
    return {
      ...target,
      reference: `${SOLANA}:${signature}`,
      transaction: signature,
      amount: received,
      paidAt: new Date(tx.blockTime * 1000),
    }
  }

  const find: FindPayments = async ({ wallet, target, transaction, since }) => {
    if (isEvm(wallet) || isEvm(target.payTo)) return []
    try {
      if (transaction) {
        const found = await payment(wallet, target, transaction)
        return found && found.paidAt >= since ? [found] : []
      }
      const accounts = await rpc("getTokenAccountsByOwner", [
        wallet,
        { mint: target.asset },
        { encoding: "jsonParsed" },
      ])
      const found: FoundPayment[] = []
      for (const account of accounts?.value ?? []) {
        const signatures = await rpc("getSignaturesForAddress", [
          account.pubkey,
          { limit: 25 },
        ])
        for (const { signature, blockTime, err } of signatures) {
          if (err || blockTime * 1000 < since.getTime()) continue
          const match = await payment(wallet, target, signature)
          if (match) found.push(match)
          if (found.length >= 10) return found
        }
      }
      return found
    } catch (error) {
      throw new ChainUnavailableError(
        `Solana lookup failed: ${(error as Error).message.split("\n")[0]}`
      )
    }
  }
  return find
}

export function chainFinder(
  env: Record<string, string | undefined> = process.env,
  fetcher: typeof fetch = fetch
): FindPayments {
  const finders: Record<string, FindPayments> = {
    [BASE]: evmFinder(
      BASE,
      env.BASE_RPC_URL ?? "https://base-rpc.publicnode.com",
      50_000n
    ),
    [TEMPO]: evmFinder(
      TEMPO,
      env.TEMPO_RPC_URL ?? "https://rpc.tempo.xyz",
      100_000n
    ),
    [SOLANA]: solanaFinder(
      env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com",
      fetcher
    ),
  }
  return async (args) => finders[args.target.network]?.(args) ?? []
}
