import assert from "node:assert/strict"
import { test } from "node:test"
import { createApp } from "../server/src/index.ts"
import { BASE, USDC_BASE } from "../server/src/v1/chains.ts"
import { memoryApiReviewStore } from "../server/src/v1/store.ts"

// The public totals on the site: real counts, cached for a minute.

let n = 0
const review = (domain, wallet, priceUsd) => ({
  id: `rev_${++n}`,
  domain,
  path: "/v1/search",
  url: `https://${domain}/v1/search`,
  task: "web-search",
  language: null,
  format: null,
  result: "full",
  listing: "accurate",
  satisfaction: "satisfied",
  satisfactionFrom: "agent",
  problems: [],
  checked: "against_source",
  payAgain: null,
  tries: 1,
  note: "Worked well.",
  noteStatus: "clean",
  wallet,
  network: BASE,
  paymentReference: `${BASE}:0x${String(n).padStart(64, "0")}`,
  asset: USDC_BASE,
  amountAtomic: "10000",
  priceUsd,
  paidAt: new Date(),
  proofMethod: "siwx",
})

test("stats count reviews, APIs, buyers, USDC paid, agent checks and tracked APIs", async () => {
  const store = memoryApiReviewStore()
  const app = createApp(null, {
    v1: {
      store,
      baseUrl: "https://reviews.test",
      secret: "test-secret-test-secret-test-secret-00",
      readTerms: async () => ({ live: true, status: 200, protocols: [], accepts: [] }),
      findPayments: async () => [],
    },
  })
  const a = `0x${"a".repeat(40)}`
  const b = `0x${"b".repeat(40)}`
  await store.insert(review("one.example.com", a, 0.01))
  await store.insert(review("one.example.com", b, 0.02))
  await store.insert(review("two.example.com", a, null))
  for (const kind of ["check", "search", "brief", "leaderboard", "service"]) {
    await store.recordUsage({ id: kind, userId: null, kind, task: null, domain: null, status: 200, client: null })
  }
  // The site's own pages and bare Node fetches aren't agents checking.
  for (const client of ["402reviews-site", "node"]) {
    await store.recordUsage({ id: client, userId: null, kind: "check", task: null, domain: null, status: 200, client })
  }
  for (const domain of ["one.example.com", "three.example.com", "four.example.com"]) {
    await store.saveHealth({ url: `https://${domain}/`, domain, status: "live", checkedAt: new Date() })
  }

  const res = await app.request("/v1/stats")
  assert.equal(res.status, 200)
  assert.match(res.headers.get("cache-control") ?? "", /max-age=60/)
  const stats = await res.json()
  assert.deepEqual(
    { ...stats, updated_at: undefined },
    { updated_at: undefined, reviews: 3, apis_reviewed: 2, buyers: 2, paid_usd: 0.03, checks: 3, apis_tracked: 3 }
  )

  // Cached: a new review shows up after the minute, not on the next request.
  await store.insert(review("two.example.com", b, 0.01))
  assert.equal((await (await app.request("/v1/stats")).json()).reviews, 3)
})
