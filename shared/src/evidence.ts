import { getTransaction, type MirrorDeps } from "./hedera.ts"

// What a paying agent claims happened: account `from` paid account `to`
// exactly `amount` of token `token` in Hedera transaction `transactionId`.
export interface PaymentClaim {
  transactionId: string
  token: string
  from: string
  to: string
  amount: bigint
}

export type PaymentEvidence =
  | { status: "verified"; consensusTimestamp: string }
  | { status: "unverified"; reason: string }

export interface EvidenceDeps extends MirrorDeps {
  // The mirror node trails consensus by a few seconds, so lookups retry.
  attempts?: number
  delayMs?: number
}

// Checks the claim against the Hedera mirror node: the transaction succeeded
// and moved exactly `amount` of the token out of `from` and into `to`. This
// binds the payment to the payer's account, so a review can later require
// that the reviewer is the account that paid.
export async function checkPayment(
  claim: PaymentClaim,
  deps: EvidenceDeps
): Promise<PaymentEvidence> {
  const attempts = deps.attempts ?? 8
  let lastReason = "Transaction not found on the mirror node"
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, deps.delayMs ?? 2000))
    }
    let transactions
    try {
      transactions = await getTransaction(claim.transactionId, deps)
    } catch (error) {
      lastReason = (error as Error).message
      continue
    }
    if (transactions.length === 0) continue
    for (const tx of transactions) {
      if (tx.result !== "SUCCESS") {
        lastReason = `Transaction result ${tx.result}`
        continue
      }
      const net = (account: string) =>
        (tx.token_transfers ?? [])
          .filter((t) => t.token_id === claim.token && t.account === account)
          .reduce((sum, t) => sum + BigInt(t.amount), 0n)
      if (net(claim.from) === -claim.amount && net(claim.to) === claim.amount) {
        return {
          status: "verified",
          consensusTimestamp: tx.consensus_timestamp,
        }
      }
      lastReason = "No matching USDC transfer from the payer to the merchant"
    }
    return { status: "unverified", reason: lastReason }
  }
  return { status: "unverified", reason: lastReason }
}
