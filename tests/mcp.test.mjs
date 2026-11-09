import assert from "node:assert/strict"
import { test } from "node:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { ExactEvmScheme } from "@x402/evm/exact/client"
import { createSIWxClientExtension } from "@x402/extensions/sign-in-with-x"
import { wrapFetchWithPayment, x402Client, x402HTTPClient } from "@x402/fetch"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { createApp } from "../server/src/index.ts"
import { BASE, USDC_BASE } from "../server/src/v1/chains.ts"
import { memoryApiReviewStore } from "../server/src/v1/store.ts"

// Runs the real MCP client against the real routes.

const BASE_URL = "https://reviews.test"
const ENDPOINT = "https://stableenrich.dev/api/people/search"
const SELLER = "0x1111111111111111111111111111111111111111"
const REVIEW = {
  url: ENDPOINT,
  task: "enrichment",
  result: "full",
  listing: "accurate",
  satisfaction: "satisfied",
  note: "Current profiles.",
}

let n = 0
const payment = () => ({
  network: BASE,
  asset: USDC_BASE,
  payTo: SELLER,
  reference: `${BASE}:0x${String(++n).padStart(64, "0")}`,
  transaction: `0x${String(n).padStart(64, "0")}`,
  amount: 10_000n,
  paidAt: new Date(),
})

async function setup(fetcher) {
  const store = memoryApiReviewStore()
  const inbox = []
  const app = createApp(null, {
    v1: {
      store,
      baseUrl: BASE_URL,
      secret: "test-secret-test-secret-test-secret-00",
      readTerms: async () => ({
        live: true,
        status: 402,
        protocols: ["x402"],
        accepts: [
          { network: BASE, asset: USDC_BASE, payTo: SELLER, amount: "10000" },
        ],
      }),
      findPayments: async () => [payment()],
      sendCode: async (email, code) => inbox.push({ email, code }),
      fetch: fetcher,
    },
  })
  const appFetch = (input, init) => app.fetch(new Request(input, init))
  const client = new Client({ name: "test-agent", version: "1.0.0" })
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${BASE_URL}/mcp`), {
      fetch: appFetch,
    })
  )
  const call = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args })
    let data = result.content[0].text
    try {
      data = JSON.parse(data)
    } catch {}
    return { data, isError: Boolean(result.isError) }
  }
  return { app, appFetch, store, inbox, client, call }
}

async function signUp({ call, inbox }) {
  const email = "agent@example.com"
  assert.equal((await call("sign_up", { email })).data.sent, true)
  const { data } = await call("verify_code", {
    email,
    code: inbox.at(-1).code,
  })
  return data.api_key
}

test("an agent is told when to act, and sees the tools", async () => {
  const { client } = await setup()
  assert.match(client.getInstructions(), /Check before you pay/)
  const { tools } = await client.listTools()
  assert.deepEqual(tools.map((t) => t.name).sort(), [
    "check_apis",
    "get_api_reviews",
    "prepare_review",
    "probe_api",
    "search_apis",
    "sign_up",
    "top_apis",
    "verify_code",
  ])
})

test("checking needs no signup", async () => {
  const { call } = await setup()
  const { data, isError } = await call("check_apis", {
    urls: [ENDPOINT],
    task: "enrichment",
  })
  assert.equal(isError, false)
  assert.equal(data.results[0].verdict, "unknown")
  assert.equal(data.results[0].domain, "stableenrich.dev")
})

test("search, probe and the leaderboard answer through the tools", async () => {
  const fetcher = async () =>
    Response.json({
      resources: [
        {
          resource: "https://new.example/search",
          accepts: [{ amount: "10000", asset: USDC_BASE }],
        },
      ],
    })
  const { call } = await setup(fetcher)
  const found = await call("search_apis", { query: "web search", limit: 5 })
  assert.equal(found.data.results[0].url, "https://new.example/search")
  const probed = await call("probe_api", { url: ENDPOINT })
  assert.equal(probed.data.paid, true)
  const board = await call("top_apis")
  assert.deepEqual(board.data.top, [])
})

test("a review prepared by the tool is accepted through a real wallet client", async () => {
  const context = await setup()
  const { call, appFetch } = context
  const api_key = await signUp(context)
  assert.match(api_key, /^ark_/)

  const prepared = await call("prepare_review", { ...REVIEW, api_key })
  assert.equal(prepared.data.ready, true)
  assert.match(prepared.data.how_to_send.awal, /--max-amount 1/)
  const { request } = prepared.data

  const account = privateKeyToAccount(generatePrivateKey())
  const wallet = new x402Client().register(
    "eip155:*",
    new ExactEvmScheme(account)
  )
  wallet.registerExtension(createSIWxClientExtension({ signers: [account] }))
  const paying = wrapFetchWithPayment(appFetch, new x402HTTPClient(wallet))
  const res = await paying(request.url, {
    method: request.method,
    headers: request.headers,
    body: JSON.stringify(request.body),
  })
  assert.equal(res.status, 201, await res.clone().text())

  const board = await call("top_apis")
  assert.equal(board.data.top[0].domain, "stableenrich.dev")
  assert.equal(board.data.recent[0].note, "Current profiles.")
  const reviews = await call("get_api_reviews", {
    domain: "stableenrich.dev",
    endpoint: "/api/people/search",
  })
  assert.equal(reviews.data.reviews.length, 1)
})

test("without a key, prepare_review says to sign up first", async () => {
  const { call } = await setup()
  const { data } = await call("prepare_review", REVIEW)
  assert.equal(data.ready, false)
  assert.match(data.next, /sign_up/)
})

test("an invalid review is refused before anything is sent", async () => {
  const { call } = await setup()
  const { data, isError } = await call("prepare_review", {
    ...REVIEW,
    url: "http://not-https.example/x",
    problems: ["made_up_problem"],
  })
  assert.equal(isError, true)
  assert.equal(data.error, "Invalid review")
})

test("a single quote in a note can't break the awal command", async () => {
  const { call } = await setup()
  const { data } = await call("prepare_review", {
    ...REVIEW,
    api_key: "ark_x",
    note: "It's fine",
  })
  assert.match(data.how_to_send.awal, /It'\\''s fine/)
})

test("tool calls share the API's limits and are tracked as MCP use", async () => {
  const { call, store } = await setup()
  await call("check_apis", { urls: [ENDPOINT] })
  await new Promise((resolve) => setImmediate(resolve))
  const [event] = await store.listUsage()
  assert.equal(event.kind, "check")
  assert.match(event.client, /^mcp/)
  for (let i = 0; i < 20; i++) await call("probe_api", { url: ENDPOINT })
  const limited = await call("probe_api", { url: ENDPOINT })
  assert.equal(limited.isError, true)
  assert.match(limited.data.error, /Too many/)
})

test("the endpoint has no session stream to open", async () => {
  const { app } = await setup()
  assert.equal((await app.request("/mcp")).status, 405)
})
