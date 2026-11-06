import { type Address, erc20Abi, type Hex, parseEventLogs } from "viem"

// What a paying agent claims happened: `from` paid `to` exactly `amount` of
// `asset` in transaction `txHash`.
export interface PaymentClaim {
  txHash: Hex
  asset: Address
  from: Address
  to: Address
  amount: bigint
}

export type PaymentEvidence =
  | { status: "verified"; blockNumber: string }
  | { status: "unverified"; reason: string }

interface ReceiptReader {
  getTransactionReceipt(args: { hash: Hex }): Promise<{
    status: "success" | "reverted"
    blockNumber: bigint
    logs: Parameters<typeof parseEventLogs>[0]["logs"]
  }>
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

// Checks the claim against the chain: the transaction succeeded and emitted
// a matching USDC Transfer. This binds the payment to the payer's address, so
// a review can later require that the reviewer is the wallet that paid.
export async function checkPayment(
  client: ReceiptReader,
  claim: PaymentClaim
): Promise<PaymentEvidence> {
  let receipt
  try {
    receipt = await client.getTransactionReceipt({ hash: claim.txHash })
  } catch (error) {
    return {
      status: "unverified",
      reason: `No receipt for ${claim.txHash}: ${(error as Error).message.split("\n")[0]}`,
    }
  }
  if (receipt.status !== "success") {
    return { status: "unverified", reason: "Transaction reverted" }
  }
  const transfers = parseEventLogs({
    abi: erc20Abi,
    eventName: "Transfer",
    logs: receipt.logs,
  })
  const match = transfers.find(
    (log) =>
      same(log.address, claim.asset) &&
      same(log.args.from, claim.from) &&
      same(log.args.to, claim.to) &&
      log.args.value === claim.amount
  )
  return match
    ? { status: "verified", blockNumber: receipt.blockNumber.toString() }
    : {
        status: "unverified",
        reason: "No matching USDC transfer from the payer to the merchant",
      }
}
