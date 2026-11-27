import assert from "node:assert/strict"
import { test } from "node:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { createApp } from "../server/src/index.ts"
import { BASE, USDC_BASE } from "../server/src/v1/chains.ts"
import { memoryApiReviewStore } from "../server/src/v1/store.ts"

// Benchmarks read a frozen snapshot: ?as_of= leaves out reviews, updates and
// refunds made later. The MCP server's benchmark arms are read-only, and the
// search arm returns nothing from reviews.

const BASE_URL = "https://reviews.test"
const DIRECTORY = [
  { resource: "https://api.a.example/scrape", description: "Scrape any page", serviceName: "A", accepts: [{ asset: USDC_BASE, amount: "10000" }] },
  { resource: "https://api.b.example/scrape", description: "Page to markdown", serviceName: "B", accepts: [{ asset: USDC_BASE, amount: "20000" }] },
]

function setup() {
  const store = memoryApiReviewStore()
  const app = createApp(null, {
    v1: {
      store,
      baseUrl: BASE_URL,
      secret: "test-secret-test-secret-test-secret-00",
      readTerms: async () => ({ live: true, status: 200, protocols: [], accepts: [] }),
      findPayments: async () => [],
      sendCode: async () => {},
      fetch: async (url) =>
        String(url).includes("x402/discovery/search")
          ? Response.json({ resources: DIRECTORY })
          : new Response("not found", { status: 404 }),
    },
  })
  return { app, store }
}

let n = 0
async function review(store, overrides) {
  n += 1
  const row = await store.insert({
    id: `rev_${n}`,
    domain: "api.b.example",
    path: "/scrape",
    url: "https://api.b.example/scrape",
    task: "web-scrape",
    language: null,
    format: null,
    result: "full",
    listing: "accurate",
    satisfaction: "satisfied",
    satisfactionFrom: "agent",
    problems: [],
    checked: "against_source",
    payAgain: "yes",
    tries: 1,
    taskDescription: null,
    promised: null,
    delivered: null,
    note: `Review ${n}`,
    noteStatus: "clean",
    wallet: `0x${String(n).padStart(40, "0")}`,
    network: BASE,
    paymentReference: `${BASE}:0x${String(n).padStart(64, "0")}`,
    asset: USDC_BASE,
    amountAtomic: "20000",
    priceUsd: 0.02,
    paidAt: new Date(),
    proofMethod: "siwx",
    userId: "u_1",
    outputHash: null,
    outputStatus: 200,
    outputType: "application/json",
    outputBytes: 100,
    advertisedFields: null,
    outputShape: null,
    latencyMs: 1000,
    ...overrides,
  })
  return row
}

test("as_of answers from the reviews as they stood then", async () => {
  const { app, store } = setup()
  await review(store)
  const cut = new Date()
  await new Promise((resolve) => setTimeout(resolve, 5))
  await review(store, { note: "Made after the snapshot" })
  await store.insertReviewUpdate({
    id: "ru_1", reviewId: "rev_1", userId: "u_1", result: "none", listing: null, satisfaction: null,
    problems: null, payAgain: null, delivered: null, note: "Changed after the snapshot", noteStatus: "clean", createdAt: new Date(),
  })

  const live = await (await app.request("/v1/services/api.b.example")).json()
  assert.equal(live.reviews.length, 2)
  assert.equal(live.reviews.find((r) => r.id === "rev_1").note, "Changed after the snapshot")

  const then = await (await app.request(`/v1/services/api.b.example?as_of=${cut.toISOString()}`)).json()
  assert.equal(then.reviews.length, 1)
  assert.equal(then.reviews[0].note, "Review 1")
  assert.equal(then.reviews[0].result, "full")

  const byHeader = await (await app.request("/v1/services/api.b.example", { headers: { "X-As-Of": cut.toISOString() } })).json()
  assert.equal(byHeader.reviews.length, 1)

  assert.equal((await app.request("/v1/services/api.b.example?as_of=yesterday")).status, 400)
  assert.equal((await app.request(`/v1/services/api.b.example?as_of=${new Date(Date.now() + 86400000).toISOString()}`)).status, 400)
})

test("snapshot reads don't count as agents checking APIs", async () => {
  const { app, store } = setup()
  await review(store)
  const before = (await store.listUsage()).length
  await app.request(`/v1/check?task=web-scrape&url=${encodeURIComponent("https://api.b.example/scrape")}&as_of=${new Date().toISOString()}`)
  assert.equal((await store.listUsage()).length, before)
  await app.request(`/v1/check?task=web-scrape&url=${encodeURIComponent("https://api.b.example/scrape")}`)
  assert.equal((await store.listUsage()).length, before + 1)
})

test("plain search keeps the directory's order and nothing from reviews", async () => {
  const { app, store } = setup()
  await review(store)
  const ranked = await (await app.request("/v1/search?q=scrape&task=web-scrape")).json()
  assert.equal(ranked.results[0].url, "https://api.b.example/scrape")
  assert.ok(ranked.results[0].reviews)

  const plain = await (await app.request("/v1/search?q=scrape&task=web-scrape&plain=1")).json()
  assert.deepEqual(plain.results.map((r) => r.url), ["https://api.a.example/scrape", "https://api.b.example/scrape"])
  assert.deepEqual(Object.keys(plain.results[0]).sort(), ["description", "price_usd", "service", "url"])
  assert.equal(plain.results[1].price_usd, 0.02)
})

async function mcp(app, query) {
  const client = new Client({ name: "p2o-test", version: "1.0.0" })
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${BASE_URL}/mcp${query}`), {
      fetch: (input, init) => app.fetch(new Request(input, init)),
    })
  )
  return client
}

test("benchmark arms are read-only, and the search arm shows nothing from reviews", async () => {
  const { app, store } = setup()
  const cut = new Date()
  await new Promise((resolve) => setTimeout(resolve, 5))
  await review(store)
  const asOf = encodeURIComponent(cut.toISOString())

  const search = await mcp(app, `?as_of=${asOf}&arm=search`)
  assert.deepEqual((await search.listTools()).tools.map((t) => t.name), ["search_apis"])
  const found = JSON.parse((await search.callTool({ name: "search_apis", arguments: { query: "scrape a page" } })).content[0].text)
  assert.equal(found.results[0].url, "https://api.a.example/scrape")
  assert.equal(found.results[0].reviews, undefined)

  const reviews = await mcp(app, `?as_of=${asOf}&arm=reviews`)
  const names = (await reviews.listTools()).tools.map((t) => t.name).sort()
  for (const write of ["sign_up", "verify_code", "set_auto_review", "prepare_review", "report_payment_failure", "update_review"]) {
    assert.ok(!names.includes(write), write)
  }
  assert.ok(names.includes("check_apis") && names.includes("search_apis"))
  // The review made after the snapshot doesn't show.
  const checked = JSON.parse(
    (await reviews.callTool({ name: "check_apis", arguments: { urls: ["https://api.b.example/scrape"], task: "web-scrape" } })).content[0].text
  )
  assert.equal(checked.results[0].reviews, 0)
  assert.equal(checked.results[0].verdict, "unknown")
  const live = await (await app.request(`/v1/check?task=web-scrape&url=${encodeURIComponent("https://api.b.example/scrape")}`)).json()
  assert.equal(live.results[0].reviews, 1)

  const plainMcp = await app.request("/mcp?arm=search", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
  assert.equal(plainMcp.status, 400)
})
