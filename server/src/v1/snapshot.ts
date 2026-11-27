import { AsyncLocalStorage } from "node:async_hooks"
import {
  AMENDABLE,
  type ApiReview,
  type ApiReviewStore,
  applyAmendments,
} from "./store.ts"

// Answers as of a past moment, for benchmarks that need the review data to
// stay put while they run (Prompt to Outcome reads a frozen snapshot this
// way). A request sets the moment with ?as_of= or X-As-Of; within it, every
// list of reviews leaves out reviews, updates and refunds made later.

export const asOfScope = new AsyncLocalStorage<Date>()

// A past ISO time, or null when the value isn't one.
export function parseAsOf(value: string | undefined | null): Date | null {
  if (!value || value.length > 40) return null
  const at = new Date(value)
  if (Number.isNaN(at.getTime()) || at.getTime() > Date.now()) return null
  return at
}

// The review as first filed, without any updates or refunds.
function asFiled(row: ApiReview): ApiReview {
  if (!row.amended) return row
  const { amended, ...rest } = row
  const first = { ...rest } as ApiReview
  for (const field of AMENDABLE) {
    ;(first as Record<string, unknown>)[field] = amended.original[field]
  }
  return first
}

export function asOfAware(store: ApiReviewStore): ApiReviewStore {
  const atMoment = async (rows: ApiReview[]) => {
    const at = asOfScope.getStore()
    if (!at) return rows
    const kept = rows.filter((row) => row.createdAt <= at).map(asFiled)
    if (kept.length === 0) return kept
    const { updates, refunds } = await store.amendmentsFor(kept.map((row) => row.id))
    return applyAmendments(
      kept,
      updates.filter((update) => update.createdAt <= at),
      refunds.filter((refund) => refund.createdAt <= at)
    )
  }
  return {
    ...store,
    listByDomains: async (domains) => atMoment(await store.listByDomains(domains)),
    listBySubdomains: async (domains) => atMoment(await store.listBySubdomains(domains)),
    listByTask: async (task) => atMoment(await store.listByTask(task)),
    listRecent: async (limit) => atMoment(await store.listRecent(limit)),
    async getReview(id) {
      const row = await store.getReview(id)
      return row ? ((await atMoment([row]))[0] ?? null) : null
    },
    async listPaymentFailures(domains) {
      const at = asOfScope.getStore()
      const reports = await store.listPaymentFailures(domains)
      return at ? reports.filter((report) => report.createdAt <= at) : reports
    },
  }
}
