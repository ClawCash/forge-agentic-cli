import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createInterface } from "node:readline"
import { setTimeout as wait } from "node:timers/promises"
import { test } from "node:test"
import {
  briefFrom,
  domainsIn,
  remember,
  taskOf,
  walletOf,
  withRatings,
} from "../app/public/wrap.mjs"
import { brief, ratingsFile } from "../server/src/v1/brief.ts"

// Trimmed from a real AgentCash search result.
const SEARCH_RESULT = {
  success: true,
  results: {
    version: 1,
    results: [
      {
        method: "GET",
        path: "/x402/web-search",
        summary: "See https://not-an-api.example/docs for details",
        origin: { url: "https://4yearcycle.com", title: "Catalog" },
      },
      {
        method: "POST",
        path: "/api/exa/search",
        origin: { url: "https://www.stableenrich.dev" },
      },
    ],
    query: "my secret plan",
  },
}
const DOMAINS = ["4yearcycle.com", "stableenrich.dev"]
const TOOL = "mcp__agentcash__search"
const text = JSON.stringify(SEARCH_RESULT)

// Reading search answers

test("reads the APIs however the wallet wraps its answer", () => {
  const blocks = [{ type: "text", text }]
  for (const tool_response of [
    blocks,
    { content: blocks },
    SEARCH_RESULT,
    text,
  ]) {
    assert.deepEqual(domainsIn({ tool_name: TOOL, tool_response }), DOMAINS)
  }
})

test("reads AgentCash's endpoint list and Coinbase's search", () => {
  assert.deepEqual(
    domainsIn({
      tool_name: "mcp__agentcash__discover_api_endpoints",
      tool_response: { origin: "https://stableenrich.dev", endpoints: [{}] },
    }),
    ["stableenrich.dev"]
  )
  assert.deepEqual(
    domainsIn({
      tool_name: "mcp__payments-mcp__bazaar_search",
      tool_response: { resources: [{ resource: "https://a.example/run" }] },
    }),
    ["a.example"]
  )
})

test("ignores every other tool and every other address", () => {
  assert.deepEqual(
    domainsIn({ tool_name: "mcp__notion__search", tool_response: SEARCH_RESULT }),
    []
  )
  assert.deepEqual(
    domainsIn({
      tool_name: TOOL,
      tool_response: { path: "/x", origin: { url: "http://plain.example" } },
    }),
    []
  )
  assert.deepEqual(
    domainsIn({
      tool_name: "mcp__railway__list_services",
      tool_response: {
        services: [{ url: "https://internal.example", integration: "x" }],
      },
    }),
    []
  )
})

test("reads Coinbase's MCP tools and hosted Bazaar", () => {
  for (const tool of ["bazaar_search", "bazaar_list"]) {
    assert.deepEqual(
      domainsIn({
        tool_name: `mcp__payments-mcp__${tool}`,
        tool_response: { items: [{ resource: "https://a.example/run" }] },
      }),
      ["a.example"]
    )
  }
  const terms = (extra) => ({ accepts: [], x402Version: 2, ...extra })
  assert.deepEqual(
    domainsIn({
      tool_name: "mcp__bazaar__search_resources",
      tool_response: {
        structuredContent: {
          tools: [
            {
              name: "x402_post_https___api_exa_ai_search_596ef3bcab7ffc59_ps",
              _meta: {
                "x402/payment-required": terms({
                  extensions: {
                    agentkit: { info: { uri: "https://api.exa.ai/search" } },
                  },
                }),
              },
            },
            {
              name: "x402_get_https___stabletravel_dev_api_flightaware_airports",
              _meta: { "x402/payment-required": terms() },
            },
            { name: "something_else", _meta: {} },
          ],
        },
      },
    }),
    ["api.exa.ai", "stabletravel.dev"]
  )
})

test("reads pay.sh and the MPP directory", () => {
  assert.deepEqual(
    domainsIn({
      tool_name: "mcp__pay__search_skills",
      tool_response: {
        providers: [
          { fqn: "a/b", service_url: "https://x402.api.agentmail.to" },
        ],
      },
    }),
    ["x402.api.agentmail.to"]
  )
  const service = (url, extra) => ({
    id: "x",
    url,
    integration: "third-party",
    ...extra,
  })
  const mpp = (tool, structuredContent) => ({
    tool_name: `mcp__mpp-services__${tool}`,
    tool_response: {
      content: [{ type: "text", text: "Returned 2" }],
      structuredContent,
    },
  })
  assert.deepEqual(
    domainsIn(
      mpp("search_services", {
        services: [
          service("https://aisa.one"),
          service("https://apex-db.org", {
            serviceUrl: "https://api.apex-db.org",
          }),
        ],
      })
    ),
    ["aisa.one", "api.apex-db.org"]
  )
  assert.deepEqual(
    domainsIn(
      mpp("recommend_services", {
        recommendations: [{ service: service("https://brave.com/search") }],
      })
    ),
    ["brave.com"]
  )
  assert.deepEqual(
    domainsIn(
      mpp("search_offers", {
        offers: [{ path: "/x", service: service("https://efts.sec.gov") }],
      })
    ),
    ["efts.sec.gov"]
  )
})

test("reads Tempo Wallet and the other MPP clients", () => {
  assert.deepEqual(
    domainsIn({
      tool_name: "mcp__tempo-wallet__services_search",
      tool_response: {
        services: [
          { url: "https://a.example", service_url: "https://api.a.example" },
        ],
      },
    }),
    ["api.a.example"]
  )
  assert.deepEqual(
    domainsIn({
      tool_name: "mcp__pitstop__list_mpp_services",
      tool_response: { services: [{ url: "https://b.example" }] },
    }),
    ["b.example"]
  )
  assert.deepEqual(
    domainsIn({
      tool_name: "mcp__thirdweb__listPayableServices",
      tool_response: { items: [{ resource: "https://c.example/x" }] },
    }),
    ["c.example"]
  )
  assert.deepEqual(
    domainsIn({
      tool_name: "mcp__boltzpay__boltzpay_discover",
      tool_response: [{ type: "text", text: "1. Name\nhttps://d.example/x" }],
    }),
    ["d.example"]
  )
})

test("reads other x402 directories, including plain text", () => {
  assert.deepEqual(
    domainsIn({
      tool_name: "mcp__x402-discovery__x402_discover",
      tool_response: [
        {
          type: "text",
          text: "Found 2 services matching 'x'\n1. **A** [gold]\nEndpoint: https://a.example/run\nPrice: $0.01\nSee https://docs.example/a\n2. **B**\n   Endpoint: https://b.example/run\nresolved_via: x402-discovery | https://x402-discovery-api.onrender.com",
        },
      ],
    }),
    ["a.example", "b.example"]
  )
  assert.deepEqual(
    domainsIn({
      tool_name: "mcp__x402search__search_x402_apis",
      tool_response: { results: [{ url: "https://c.example/run" }] },
    }),
    ["c.example"]
  )
})

test("finds each wallet's search tools from the command that starts it, and nothing else", () => {
  const searches = (words, tool) => {
    const found = new Map()
    remember(found, walletOf(words), {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: tool, arguments: {} },
    })
    return found.size === 1
  }
  for (const [words, tool] of [
    [["npx", "-y", "agentcash@latest"], "search"],
    [["npx", "-y", "agentcash@latest"], "discover_api_endpoints"],
    [["/usr/local/bin/agentcash", "mcp"], "search"],
    [["npx", "@coinbase/payments-mcp"], "bazaar_search"],
    [["https://api.cdp.coinbase.com/platform/v2/x402/discovery/mcp"], "search_resources"],
    [["https://mpp.dev/mcp/services"], "search_services"],
    [["tempo", "wallet", "mcp"], "services_search"],
    [["npx", "some-pitstop-mcp"], "list_mpp_services"],
  ]) {
    assert.ok(searches(words, tool), `${words.join(" ")} ${tool}`)
  }
  for (const [words, tool] of [
    [["npx", "-y", "agentcash@latest"], "fetch"],
    [["npx", "@coinbase/payments-mcp"], "make_http_request_with_x402"],
    [["npx", "@notionhq/notion-mcp-server"], "search"],
    [["railway", "mcp"], "list_services"],
  ]) {
    assert.ok(!searches(words, tool), `${words.join(" ")} ${tool}`)
  }
})

test("payment calls are never remembered, and a cancelled search is forgotten", () => {
  const found = new Map()
  const wallet = walletOf(["npx", "-y", "agentcash@latest"])
  const call = (id, name) => ({
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name, arguments: { url: "https://a.example", query: "x" } },
  })
  remember(found, wallet, [call(1, "fetch"), call(2, "search")])
  assert.deepEqual([...found.keys()], [2])
  remember(found, wallet, {
    jsonrpc: "2.0",
    method: "notifications/cancelled",
    params: { requestId: 2 },
  })
  assert.equal(found.size, 0)
  const answer = `{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":${JSON.stringify(text)}}]}}`
  assert.equal(withRatings(found, answer), answer)
})

// Ratings

const DETAILS = "4.5/5 from 3 agents, about 80% likely to work"
const TEXT = [
  "Agent Reviews, from agents that paid for these APIs:",
  `- 4yearcycle.com: ${DETAILS}`,
  "No reviews yet for 1 of 2 APIs in these results.",
  "See what each one promised and delivered with get_api_reviews.",
].join("\n")
const ratings = (extra) => ({
  version: 1,
  generated_at: new Date().toISOString(),
  rated: { "4yearcycle.com": DETAILS },
  down: [],
  ...extra,
})

test("the wrapper and the API word a brief the same way", () => {
  const rating = (extra) => ({
    stars: 3.3,
    buyers: 2,
    verdict: "unknown",
    outcomes: { full: 1, partial: 2, none: 0, not_checked: 0 },
    charged_no_result: 0,
    last_reviewed_at: "2026-11-09T10:00:00.000Z",
    schema_match: null,
    listing_accuracy: null,
    cost_per_success_usd: null,
    top_problem: "incomplete",
    ...extra,
  })
  const none = rating({ stars: null })
  for (const entries of [
    [
      { domain: "a.example", rating: rating(), down: false },
      { domain: "b.example", rating: none, down: false },
      { domain: "c.example", rating: none, down: true },
    ],
    [
      {
        domain: "a.example",
        rating: rating({
          buyers: 4,
          verdict: "avoid",
          charged_no_result: 2,
          schema_match: { all_fields_returned: 1, checked: 3, missing: ["a"] },
          listing_accuracy: { accurate: 1, overstated: 1, misleading: 0 },
          cost_per_success_usd: 0.031,
          top_problem: "paid_no_result",
        }),
        down: true,
      },
    ],
    [{ domain: "b.example", rating: none, down: false }],
  ]) {
    assert.equal(
      briefFrom(
        ratingsFile(entries),
        entries.map((entry) => entry.domain)
      ),
      brief(entries).text
    )
  }
})

test("uses the rating for the task at hand when there is one", () => {
  const file = ratings({
    rated: { "a.example": "overall" },
    tasks: { "a.example": { enrichment: "for enrichment" } },
  })
  assert.match(briefFrom(file, ["a.example"]), /- a\.example: overall/)
  assert.match(
    briefFrom(file, ["a.example"], "enrichment"),
    /- a\.example, enrichment: for enrichment/
  )
  assert.match(
    briefFrom(file, ["a.example"], "weather"),
    /- a\.example: overall/
  )
})

test("works out the task from the search, on this machine", () => {
  for (const [query, task] of [
    ["find work emails from LinkedIn profiles", "enrichment"],
    ["scrape a product page", "web-scrape"],
    ["latest news about a launch", "web-search"],
    ["bitcoin token price", "token-price"],
    ["generate an image of a cat", "image-generation"],
    ["something unrelated", null],
  ]) {
    assert.equal(taskOf({ tool_input: { query } }), task, query)
  }
  assert.equal(taskOf({}), null)
})

test("a listed site finds reviews filed under its API host", () => {
  const file = ratings({ rated: { "api.aisa.one": DETAILS } })
  assert.match(briefFrom(file, ["aisa.one"]), /aisa\.one: 4\.5\/5/)
  assert.doesNotMatch(briefFrom(file, ["isa.one"]), /4\.5\/5/)
  assert.doesNotMatch(briefFrom(file, ["constructor"]), /function/)
})

// Running in front of a wallet

const WALLET = [process.execPath, "tests/fixtures/fake-agentcash-wallet.mjs"]

function ratingsPath(content) {
  const file = join(mkdtempSync(join(tmpdir(), "reviews-")), "ratings.json")
  if (content) writeFileSync(file, JSON.stringify(content))
  return file
}

const makeOld = (file) => {
  const old = new Date(Date.now() - 3_600_000)
  utimesSync(file, old, old)
}

async function until(condition) {
  for (let i = 0; i < 80 && !condition(); i++) await wait(50)
  assert.ok(condition(), "timed out")
}

function wrap(args, { file = ratingsPath(), url = "http://127.0.0.1:9/" } = {}) {
  const child = spawn(process.execPath, ["app/public/wrap.mjs", ...args], {
    env: {
      ...process.env,
      AGENT_REVIEWS_RATINGS: file,
      AGENT_REVIEWS_RATINGS_URL: url,
      FAKE_SEARCH: text,
    },
  })
  const lines = []
  let stderr = ""
  child.stderr.on("data", (chunk) => (stderr += chunk))
  createInterface({ input: child.stdout }).on("line", (line) => lines.push(line))
  const exited = new Promise((resolve) => child.on("close", resolve))
  return {
    lines,
    stderr: () => stderr,
    send: (message) =>
      child.stdin.write(
        `${typeof message === "string" ? message : JSON.stringify(message)}\n`
      ),
    async reply(id) {
      await until(() => lines.some((line) => JSON.parse(line).id === id))
      return lines.find((line) => JSON.parse(line).id === id)
    },
    end: () => (child.stdin.end(), exited),
    exited,
  }
}

const search = (id, name = "search") => ({
  jsonrpc: "2.0",
  id,
  method: "tools/call",
  params: { name, arguments: { query: "my secret plan" } },
})

async function fakeSite(respond) {
  const requests = []
  const server = createServer((req, res) => {
    let body = ""
    req.on("data", (chunk) => (body += chunk))
    req.on("end", () => {
      requests.push({ method: req.method, url: req.url, body, headers: req.headers })
      respond(res, body)
    })
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  return {
    url: `http://127.0.0.1:${server.address().port}/`,
    requests,
    close: () => server.close(),
  }
}

test("adds ratings to a wallet's search answer from the local file, with no network call", async () => {
  const site = await fakeSite((res) => res.end("{}"))
  const wallet = wrap(WALLET, { file: ratingsPath(ratings()), url: site.url })
  wallet.send(search(1))
  const { result } = JSON.parse(await wallet.reply(1))
  assert.deepEqual(result.content, [
    { type: "text", text },
    { type: "text", text: TEXT },
  ])
  assert.equal(await wallet.end(), 0)
  await wait(300)
  site.close()
  assert.equal(site.requests.length, 0)
})

test("everything else passes through byte for byte, both ways", async () => {
  const wallet = wrap(WALLET, { file: ratingsPath(ratings()) })
  const sent = [
    `{"jsonrpc":"2.0","id":"a","method":"tools/list"}`,
    JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "fetch", arguments: { url: "https://4yearcycle.com/x402/web-search", body: text } },
    }),
  ]
  for (const line of sent) wallet.send(line)
  wallet.send(`{"jsonrpc":"2.0","method":"notifications/initialized"}`)
  wallet.send(search(3, "broken"))
  for (const [id, line] of [["a", sent[0]], [2, sent[1]]]) {
    assert.equal(
      await wallet.reply(id),
      `{"jsonrpc":"2.0",  "id":${JSON.stringify(id)},  "result":{"echo":${JSON.stringify(line)}}}`
    )
  }
  assert.equal(
    await wallet.reply(3),
    `{"jsonrpc":"2.0","id":3,"result":{"isError":true,"content":[{"type":"text","text":${JSON.stringify(text)}}]}}`
  )
  await wallet.end()
  assert.equal(wallet.lines.length, 3)
})

test("a search doesn't wait when the file needs refreshing", async () => {
  const file = ratingsPath(ratings())
  makeOld(file)
  const newer = ratings({ rated: { "new.example": DETAILS } })
  const site = await fakeSite((res) => {
    setTimeout(() => res.end(JSON.stringify(newer)), 1500)
  })
  const wallet = wrap(WALLET, { file, url: site.url })
  wallet.send({ jsonrpc: "2.0", id: 0, method: "ping" })
  await wallet.reply(0)
  const started = Date.now()
  wallet.send(search(1))
  const { result } = JSON.parse(await wallet.reply(1))
  assert.ok(Date.now() - started < 1000, "the search waited for the download")
  assert.equal(result.content.at(-1).text, TEXT)
  await until(() => readFileSync(file, "utf8").includes("new.example"))
  await wallet.end()
  site.close()
  assert.deepEqual(
    site.requests.map(({ method, url, body }) => ({ method, url, body })),
    [{ method: "GET", url: "/", body: "" }]
  )
})

test("with no file it adds nothing, and fetches one for next time", async () => {
  const file = ratingsPath()
  const site = await fakeSite((res) => res.end(JSON.stringify(ratings())))
  const wallet = wrap(WALLET, { file, url: site.url })
  wallet.send(search(1))
  assert.equal(JSON.parse(await wallet.reply(1)).result.content.length, 1)
  await until(() => existsSync(file))
  await wallet.end()
  site.close()
})

test("a failed refresh keeps the last good file and isn't retried at once", async () => {
  for (const reply of [
    (res) => {
      res.statusCode = 500
      res.end("{}")
    },
    (res) => res.end("not json"),
    (res) => res.end(JSON.stringify({ version: 1 })),
  ]) {
    const file = ratingsPath(ratings())
    const before = readFileSync(file, "utf8")
    makeOld(file)
    const site = await fakeSite(reply)
    const wallet = wrap(WALLET, { file, url: site.url })
    wallet.send(search(1))
    wallet.send(search(2))
    const first = JSON.parse(await wallet.reply(1))
    await wallet.reply(2)
    await wait(400)
    await wallet.end()
    site.close()
    assert.equal(first.result.content.at(-1).text, TEXT)
    assert.equal(readFileSync(file, "utf8"), before)
    assert.equal(site.requests.length, 1)
  }
})

test("very old ratings aren't shown", async () => {
  const old = new Date(Date.now() - 8 * 86_400_000).toISOString()
  const wallet = wrap(WALLET, { file: ratingsPath(ratings({ generated_at: old })) })
  wallet.send(search(1))
  assert.equal(JSON.parse(await wallet.reply(1)).result.content.length, 1)
  await wallet.end()
})

test("stops when the wallet stops, with its exit code", async () => {
  const wallet = wrap(WALLET)
  wallet.send({ jsonrpc: "2.0", method: "quit" })
  assert.equal(await wallet.exited, 3)
  assert.equal(await wrap(WALLET).end(), 0)
})

test("says so when the wallet can't start", async () => {
  const wallet = wrap(["agent-reviews-no-such-wallet-command"])
  assert.equal(await wallet.exited, 1)
  assert.match(wallet.stderr(), /couldn't start agent-reviews-no-such-wallet-command/)
})

test("wraps a remote wallet server over HTTP", async () => {
  const server = await fakeSite((res, body) => {
    const message = JSON.parse(body)
    if (message.id === undefined) {
      res.statusCode = 202
      return res.end()
    }
    if (message.method === "initialize") {
      res.setHeader("Mcp-Session-Id", "session-1")
      res.setHeader("Content-Type", "application/json")
      return res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: { protocolVersion: "2025-06-18", capabilities: {} },
        })
      )
    }
    if (message.method === "tools/call") {
      res.setHeader("Content-Type", "text/event-stream")
      return res.end(
        `event: message\ndata: ${JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: { content: [{ type: "text", text }] },
        })}\n\n`
      )
    }
    res.statusCode = 500
    res.end()
  })
  const wallet = wrap([`${server.url}agentcash/mcp`], {
    file: ratingsPath(ratings()),
  })
  wallet.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })
  await wallet.reply(1)
  wallet.send({ jsonrpc: "2.0", method: "notifications/initialized" })
  wallet.send(search(2))
  assert.equal(
    JSON.parse(await wallet.reply(2)).result.content.at(-1).text,
    TEXT
  )
  wallet.send({ jsonrpc: "2.0", id: 3, method: "resources/list" })
  const failed = JSON.parse(await wallet.reply(3))
  assert.equal(failed.error.code, -32000)
  assert.match(failed.error.message, /HTTP 500/)
  await wallet.end()
  server.close()
  const later = server.requests.slice(1)
  assert.equal(later.length, 3)
  for (const { headers } of later) {
    assert.equal(headers["mcp-session-id"], "session-1")
    assert.equal(headers["mcp-protocol-version"], "2025-06-18")
  }
  assert.equal(wallet.lines.length, 3)
})
