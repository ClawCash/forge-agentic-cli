import assert from "node:assert/strict"
import { test } from "node:test"
import { fingerprintOf } from "../app/public/verify-review.mjs"
import { createApp } from "../server/src/index.ts"
import { BASE, USDC_BASE } from "../server/src/v1/chains.ts"
import { memoryApiReviewStore } from "../server/src/v1/store.ts"

// A review as first filed never changes: its author can add updates, and a
// refund the chain confirms can be attached by the author or the API's owner.

const PAID_AT = new Date("2026-11-24T15:05:51Z")
const AGENT_WALLET = "0x26eb3ad54c12fc7133a2b2b6eddc0692d94ebcea"
const tx = (n) => `0x${String(n).repeat(64).slice(0, 64)}`
const REFUNDS = {
  [tx(1)]: { status: "found", amount: 20000n, refundedAt: new Date("2026-11-24T15:40:23Z") },
  [tx(2)]: { status: "found", amount: 10000n, refundedAt: new Date("2026-11-24T15:40:23Z") },
  [tx(3)]: { status: "found", amount: 20000n, refundedAt: new Date("2026-11-24T14:00:00Z") },
  [tx(4)]: { status: "found", amount: 20000n, refundedAt: new Date("2026-11-25T10:00:00Z") },
}

const json = (body, headers = {}) => ({
  method: "POST",
  headers: { "Content-Type": "application/json", ...headers },
  body: JSON.stringify(body),
})
const bearer = (token) => ({ Authorization: `Bearer ${token}` })

function setup() {
  const store = memoryApiReviewStore()
  const inbox = []
  const txt = new Map()
  const lookups = []
  const app = createApp(null, {
    v1: {
      store,
      baseUrl: "https://reviews.test",
      secret: "test-secret-test-secret-test-secret-00",
      readTerms: async () => ({ live: true, status: 200, protocols: [], accepts: [] }),
      findPayments: async () => [],
      findRefund: async (args) => {
        lookups.push(args)
        return REFUNDS[args.transaction] ?? { status: "not_found" }
      },
      sendCode: async (email, code, purpose = "signup") => inbox.push({ email, code, purpose }),
      resolveTxt: async (name) => {
        if (!txt.has(name)) throw new Error("ENOTFOUND")
        return [[txt.get(name)]]
      },
    },
  })
  return { app, store, inbox, txt, lookups }
}

async function agentKey(ctx, email = "agent@example.com") {
  await ctx.app.request("/v1/auth/start", json({ email }))
  const { code } = ctx.inbox.at(-1)
  const { api_key } = await (await ctx.app.request("/v1/auth/verify", json({ email, code }))).json()
  const user = (await ctx.store.listUsers()).find((u) => u.email === email)
  return { key: api_key, userId: user.id }
}

async function addReview(ctx, overrides = {}) {
  const n = (await ctx.store.listRecent(1000)).length + 1
  return ctx.store.insert({
    id: `rev_${n}`,
    domain: "api.example.com",
    path: "/v1/news",
    url: "https://api.example.com/v1/news",
    task: "news",
    language: null,
    format: null,
    result: "none",
    listing: "overstated",
    satisfaction: "not_satisfied",
    satisfactionFrom: "agent",
    problems: ["paid_no_result"],
    checked: "against_source",
    payAgain: "if_no_alternative",
    tries: 1,
    taskDescription: "Find recent news on a topic",
    promised: "Ranked recent news items",
    delivered: "No items, and the receipt showed no refund",
    note: "Charged and returned nothing.",
    noteStatus: "clean",
    wallet: AGENT_WALLET,
    network: BASE,
    paymentReference: `${BASE}:0x${String(n).padStart(64, "0")}`,
    asset: USDC_BASE,
    amountAtomic: "20000",
    priceUsd: 0.02,
    paidAt: PAID_AT,
    proofMethod: "siwx",
    userId: null,
    outputHash: null,
    outputStatus: 200,
    outputType: "application/json",
    outputBytes: 900,
    advertisedFields: null,
    outputShape: null,
    latencyMs: 4000,
    ...overrides,
  })
}

async function served(ctx, id) {
  const page = await (await ctx.app.request("/v1/services/api.example.com?limit=50")).json()
  return page.reviews.find((review) => review.id === id)
}

const find = (value, key) => {
  if (!value || typeof value !== "object") return undefined
  if (key in value) return value[key]
  for (const child of Object.values(value)) {
    const found = find(child, key)
    if (found !== undefined) return found
  }
  return undefined
}

test("the agent that wrote a review can update it, and the first version stays fingerprinted", async () => {
  const ctx = setup()
  const author = await agentKey(ctx)
  const other = await agentKey(ctx, "other@example.com")
  await addReview(ctx, { userId: author.userId })
  const before = await served(ctx, "rev_1")
  assert.equal(fingerprintOf(before), before.fingerprint)

  const update = (body, key = author.key) =>
    ctx.app.request("/v1/reviews/rev_1/update", json(body, key ? { "X-Reviews-Key": key } : {}))

  assert.equal((await update({ note: "x y z" }, null)).status, 401)
  assert.equal((await update({ note: "Refunded later." }, other.key)).status, 403)
  assert.equal((await update({})).status, 400)
  assert.equal((await ctx.app.request("/v1/reviews/rev_404/update", json({ note: "Hello there" }, { "X-Reviews-Key": author.key }))).status, 404)
  assert.equal((await update({ delivered: "See https://evil.example now" })).status, 400)

  const res = await update({
    note: "Refunded in full 35 minutes later.",
    problems: ["incomplete"],
    helpfulness: "somewhat",
  })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.updated, true)
  assert.equal(body.note_published, true)
  assert.deepEqual(body.review.problems, ["incomplete"])
  assert.equal(body.review.satisfaction, "partly")

  const after = await served(ctx, "rev_1")
  assert.equal(after.note, "Refunded in full 35 minutes later.")
  assert.deepEqual(after.problems, ["incomplete"])
  assert.equal(after.result, "none")
  assert.deepEqual(after.original.problems, ["paid_no_result"])
  assert.equal(after.original.note, "Charged and returned nothing.")
  assert.equal(after.updates, 1)
  assert.ok(after.updated_at)
  // Same fingerprint as first published, and anyone can still recompute it.
  assert.equal(after.fingerprint, before.fingerprint)
  assert.equal(fingerprintOf(after), after.fingerprint)
  const log = await (await ctx.app.request("/v1/fingerprints")).json()
  assert.equal(log.reviews[0].fingerprint, before.fingerprint)

  // A failed output receipt still can't become a success.
  await addReview(ctx, { userId: author.userId, outputStatus: 500 })
  const failed = await ctx.app.request("/v1/reviews/rev_2/update", json({ result: "full" }, { "X-Reviews-Key": author.key }))
  assert.equal(failed.status, 400)

  for (let i = 0; i < 4; i++) assert.equal((await update({ note: `Update number ${i}` })).status, 200)
  assert.equal((await update({ note: "One too many" })).status, 409)
})

test("a refund is checked on chain before it counts", async () => {
  const ctx = setup()
  const author = await agentKey(ctx)
  await addReview(ctx, { userId: author.userId })
  const refund = (transaction) =>
    ctx.app.request("/v1/reviews/rev_1/update", json({ refund_transaction: transaction }, { "X-Reviews-Key": author.key }))

  assert.equal((await refund("0x1234")).status, 400)
  assert.equal((await refund(tx(5))).status, 404)
  const partial = await refund(tx(2))
  assert.equal(partial.status, 400)
  assert.match((await partial.json()).error, /sends back \$0.01, but the call cost \$0.02/)
  assert.equal((await refund(tx(3))).status, 400)
  assert.deepEqual(ctx.lookups.at(-1), { network: BASE, transaction: tx(3), asset: USDC_BASE, to: AGENT_WALLET })

  const ok = await refund(tx(1))
  assert.equal(ok.status, 200)
  const body = await ok.json()
  assert.equal(body.refund_verified, true)
  assert.equal(body.updated, false)
  const review = await served(ctx, "rev_1")
  assert.equal(review.refund.verified, true)
  assert.equal(review.refund.amount_usd, 0.02)
  assert.equal(review.refund.minutes_after_payment, 35)
  assert.equal(review.refund.added_by, "reviewer")
  assert.equal(review.refund.transaction_url, `https://basescan.org/tx/${tx(1)}`)
  // Still didn't work, but it no longer counts as keeping the money.
  assert.equal(review.result, "none")
  assert.deepEqual(review.problems, [])
  assert.deepEqual(review.original.problems, ["paid_no_result"])
  assert.equal(fingerprintOf(review), review.fingerprint)
  const page = await (await ctx.app.request("/v1/services/api.example.com")).json()
  assert.equal(find(page, "charged_no_result"), 0)

  assert.equal((await refund(tx(4))).status, 409)
})

test("an API's verified owner can attach a refund, only to reviews of their API", async () => {
  const ctx = setup()
  await addReview(ctx)
  await addReview(ctx, { domain: "api.other.com", url: "https://api.other.com/v1/news" })
  await addReview(ctx)

  await ctx.app.request("/v1/merchant/start", json({ email: "owner@example.com" }))
  const { code } = ctx.inbox.at(-1)
  const { token } = await (await ctx.app.request("/v1/merchant/verify", json({ email: "owner@example.com", code }))).json()
  const claim = await (await ctx.app.request("/v1/merchant/claims", json({ domain: "api.example.com" }, bearer(token)))).json()
  const attach = (body) => ctx.app.request("/v1/merchant/claims/api.example.com/refunds", json(body, bearer(token)))

  assert.equal((await attach({ review_id: "rev_1", transaction: tx(1) })).status, 403)
  ctx.txt.set(claim.verification.dns.name, claim.verification.dns.value)
  await ctx.app.request("/v1/merchant/claims/api.example.com/check", json({}, bearer(token)))

  assert.equal((await attach({ review_id: "rev_2", transaction: tx(1) })).status, 404)
  const ok = await attach({ review_id: "rev_1", transaction: tx(1) })
  assert.equal(ok.status, 201)
  const body = await ok.json()
  assert.equal(body.refund.added_by, "provider")
  assert.equal(body.refund.amount_usd, 0.02)
  // One refund backs one review.
  assert.equal((await attach({ review_id: "rev_3", transaction: tx(1) })).status, 409)

  const review = await served(ctx, "rev_1")
  assert.equal(review.refund.added_by, "provider")
  assert.equal(review.note, "Charged and returned nothing.")
  assert.equal(review.updates, 0)
  assert.equal(fingerprintOf(review), review.fingerprint)
  const events = await ctx.store.merchantEvents(20)
  assert.equal(events.find((e) => e.kind === "refund_attached").detail, "/v1/news · $0.02")
})
