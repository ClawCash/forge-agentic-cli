import { randomUUID } from "node:crypto"
import {
  ChainUnavailableError,
  type FindRefund,
  priceUsd,
  transactionUrl,
} from "./chains.ts"
import {
  type ApiReview,
  type ApiReviewStore,
  RefundAlreadyUsedError,
  type ReviewRefund,
} from "./store.ts"

// A refund backs a review only when the chain shows the full price going back
// to the wallet that paid, after it paid. Who sends it doesn't matter: money
// returned is money returned.

export type RefundCheck =
  | { ok: true; refund: Omit<ReviewRefund, "createdAt"> }
  | { ok: false; status: 400 | 404 | 409 | 503; error: string }

const dollars = (asset: string, amount: bigint) => {
  const usd = priceUsd(asset, amount)
  return usd === null ? `${amount} units` : `$${usd}`
}

export async function checkRefund(
  findRefund: FindRefund,
  review: ApiReview,
  transaction: string,
  addedBy: "reviewer" | "provider"
): Promise<RefundCheck> {
  const hash = transaction.trim()
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) {
    return { ok: false, status: 400, error: "Send the refund's transaction hash: 0x and 64 hex characters." }
  }
  if (review.amended?.refund) {
    return { ok: false, status: 409, error: "This review already has a verified refund." }
  }
  const reference = `${review.network}:${hash.toLowerCase()}`
  if (reference === review.paymentReference) {
    return { ok: false, status: 400, error: "That's the payment itself, not a refund." }
  }
  let found
  try {
    found = await findRefund({
      network: review.network,
      transaction: hash,
      asset: review.asset,
      to: review.wallet,
    })
  } catch (error) {
    if (error instanceof ChainUnavailableError) {
      return { ok: false, status: 503, error: "Couldn't reach the chain to check the refund. Try again shortly." }
    }
    throw error
  }
  if (found.status === "unsupported") {
    return { ok: false, status: 400, error: "Refunds can be checked for payments on Base and Tempo so far." }
  }
  if (found.status === "not_found") {
    return {
      ok: false,
      status: 404,
      error: `That transaction doesn't send ${dollars(review.asset, BigInt(review.amountAtomic))} in the same token back to the wallet that paid (${review.wallet.slice(0, 6)}…${review.wallet.slice(-4)}).`,
    }
  }
  const paid = BigInt(review.amountAtomic)
  if (found.amount < paid) {
    return {
      ok: false,
      status: 400,
      error: `It sends back ${dollars(review.asset, found.amount)}, but the call cost ${dollars(review.asset, paid)}. Only full refunds are attached.`,
    }
  }
  if (found.refundedAt < review.paidAt) {
    return { ok: false, status: 400, error: "That transfer happened before the payment, so it isn't a refund of it." }
  }
  return {
    ok: true,
    refund: {
      id: `rf_${randomUUID()}`,
      reviewId: review.id,
      reference,
      amountAtomic: found.amount.toString(),
      refundedAt: found.refundedAt,
      addedBy,
    },
  }
}

// How a refund shows on a review.
export function refundView(review: ApiReview, refund: ReviewRefund) {
  const hash = refund.reference.split(":").at(-1) as string
  return {
    verified: true,
    amount_usd: priceUsd(review.asset, BigInt(refund.amountAtomic)),
    refunded_at: refund.refundedAt.toISOString(),
    minutes_after_payment: Math.max(
      0,
      Math.round((refund.refundedAt.getTime() - review.paidAt.getTime()) / 60_000)
    ),
    added_by: refund.addedBy,
    transaction: hash,
    transaction_url: transactionUrl(review.network, hash),
  }
}

// Checks and stores a refund for one review, then returns the review as it
// stands. `domain` limits it to reviews of an API the caller owns.
export async function attachRefund(
  deps: { store: ApiReviewStore; findRefund: FindRefund },
  args: {
    reviewId: string
    transaction: string
    addedBy: "reviewer" | "provider"
    domain?: string
    userId?: string
  }
): Promise<
  | { ok: true; review: ApiReview }
  | { ok: false; status: 400 | 403 | 404 | 409 | 503; error: string }
> {
  const review = await deps.store.getReview(args.reviewId)
  const ours =
    review &&
    (!args.domain ||
      review.domain === args.domain ||
      review.domain.endsWith(`.${args.domain}`))
  if (!review || !ours) {
    return { ok: false, status: 404, error: "No review with that id on this API." }
  }
  if (args.userId && review.userId !== args.userId) {
    return { ok: false, status: 403, error: "Only the agent that wrote a review can add to it." }
  }
  const checked = await checkRefund(deps.findRefund, review, args.transaction, args.addedBy)
  if (!checked.ok) return checked
  try {
    await deps.store.insertReviewRefund(checked.refund)
  } catch (error) {
    if (error instanceof RefundAlreadyUsedError) {
      return { ok: false, status: 409, error: error.message }
    }
    throw error
  }
  return { ok: true, review: (await deps.store.getReview(review.id)) as ApiReview }
}
