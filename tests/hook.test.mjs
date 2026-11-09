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
import { setTimeout as wait } from "node:timers/promises"
import { test } from "node:test"
import { briefFrom, domainsIn, hookOutput } from "../app/public/hook.mjs"
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

test("reads the APIs however the host wraps the result", () => {
  const blocks = [{ type: "text", text }]
  for (const event of [
    { tool_name: TOOL, tool_response: blocks },
    { tool_name: TOOL, tool_response: { content: blocks } },
    { tool_name: TOOL, tool_response: SEARCH_RESULT },
    { tool_name: TOOL, tool_response: text },
    {
      tool_name: "MCP:search",
      tool_output: JSON.stringify({ content: blocks }),
    },
  ]) {
    assert.deepEqual(domainsIn(event), DOMAINS)
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
    domainsIn({
      tool_name: "mcp__notion__search",
      tool_response: SEARCH_RESULT,
    }),
    []
  )
  // Cursor doesn't name the server, so another tool can be called search.
  assert.deepEqual(
    domainsIn({
      tool_name: "MCP:search",
      tool_output: JSON.stringify({
        results: [{ url: "https://private.example/page", path: "/page" }],
      }),
    }),
    []
  )
  assert.deepEqual(
    domainsIn({
      tool_name: TOOL,
      tool_response: { path: "/x", origin: { url: "http://plain.example" } },
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

const shell = (command, stdout, name = "Bash") => ({
  tool_name: name,
  tool_input: { command },
  tool_response: { stdout, stderr: "", interrupted: false },
})

test("reads wallet search commands run from the shell", () => {
  const awalJson = JSON.stringify({
    items: [{ resource: "https://a.example/x" }],
  })
  assert.deepEqual(
    domainsIn(shell('npx awal@latest bazaar search "news" --json', awalJson)),
    ["a.example"]
  )
  assert.deepEqual(
    domainsIn(
      shell(
        'awal bazaar search "news"',
        "Found 2 results\n\nhttps://a.example/x\nA news API\nPrice: $0.01\n---\nhttps://b.example/y\n---"
      )
    ),
    ["a.example", "b.example"]
  )
  assert.deepEqual(
    domainsIn(
      shell(
        'cd /tmp && npx -y agentcash search "web"',
        JSON.stringify({ success: true, data: SEARCH_RESULT })
      )
    ),
    DOMAINS
  )
  assert.deepEqual(
    domainsIn(
      shell(
        "pay skills search gemini --json",
        JSON.stringify([{ service_url: "https://p.example" }])
      )
    ),
    ["p.example"]
  )
  assert.deepEqual(
    domainsIn(
      shell(
        'tempo wallet -t services --search "web"',
        "services[2]{id,url}:\n  aisa,https://aisa.one\n  fal,https://fal.mpp.tempo.xyz"
      )
    ),
    ["aisa.one", "fal.mpp.tempo.xyz"]
  )
})

test("reads Cursor's and Codex's shell results", () => {
  const stdout = "https://a.example/x\n---"
  assert.deepEqual(
    domainsIn({
      tool_name: "Shell",
      tool_input: { command: "awal bazaar search q" },
      tool_output: JSON.stringify({ exitCode: 0, stdout }),
    }),
    ["a.example"]
  )
  assert.deepEqual(
    domainsIn({
      tool_name: "Bash",
      tool_input: { command: "awal bazaar search q" },
      tool_response: stdout,
    }),
    ["a.example"]
  )
})

test("ignores shell commands that aren't a wallet search", () => {
  const stdout = "https://private.example/page"
  for (const line of [
    "curl https://private.example/page",
    'grep "awal bazaar search" notes.txt',
    "echo awal bazaar search",
    "agentcash fetch https://a.example",
    "git log --grep=search",
  ]) {
    assert.deepEqual(domainsIn(shell(line, stdout)), [], line)
  }
})

test("other servers' tools with the same names are ignored", () => {
  assert.deepEqual(
    domainsIn({
      tool_name: "mcp__railway__list_services",
      tool_response: {
        services: [{ url: "https://internal.example", integration: "x" }],
      },
    }),
    []
  )
  assert.deepEqual(
    domainsIn({
      tool_name: "MCP:list_services",
      tool_output: JSON.stringify({
        services: [{ url: "https://internal.example" }],
      }),
    }),
    []
  )
  assert.deepEqual(
    domainsIn({
      tool_name: "MCP:search_resources",
      tool_output: JSON.stringify({ resource: "https://internal.example" }),
    }),
    []
  )
})

test("reads Grok's events", () => {
  assert.deepEqual(
    domainsIn({ toolName: "agentcash__search", toolResult: SEARCH_RESULT }),
    DOMAINS
  )
  assert.deepEqual(
    domainsIn({
      toolName: "run_terminal_command",
      toolInput: { command: "awal bazaar search q" },
      toolResult: {
        type: "Bash",
        exit_code: 0,
        output_for_prompt: "https://a.example/x\n---",
      },
    }),
    ["a.example"]
  )
  assert.deepEqual(
    domainsIn({ toolName: "notion__search", toolResult: SEARCH_RESULT }),
    []
  )
})

test("speaks each host's format", () => {
  assert.deepEqual(hookOutput("cursor", "hi"), { additional_context: "hi" })
  for (const host of ["claude", "codex"]) {
    assert.deepEqual(hookOutput(host, "hi"), {
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: "hi",
      },
    })
  }
})

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

function ratingsPath(content) {
  const file = join(mkdtempSync(join(tmpdir(), "reviews-")), "ratings.json")
  if (content) writeFileSync(file, JSON.stringify(content))
  return file
}

const makeOld = (file) => {
  const old = new Date(Date.now() - 3_600_000)
  utimesSync(file, old, old)
}

function run(input, { file, url = "http://127.0.0.1:9/", host = "claude" }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["app/public/hook.mjs", host], {
      env: {
        ...process.env,
        AGENT_REVIEWS_RATINGS: file,
        AGENT_REVIEWS_RATINGS_URL: url,
      },
    })
    let stdout = ""
    child.stdout.on("data", (chunk) => (stdout += chunk))
    child.on("close", (code) => resolve({ code, stdout }))
    child.stdin.end(input)
  })
}

async function fakeSite(respond) {
  const requests = []
  const server = createServer((req, res) => {
    let body = ""
    req.on("data", (chunk) => (body += chunk))
    req.on("end", () => {
      requests.push({ method: req.method, url: req.url, body })
      respond(res)
    })
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  return {
    url: `http://127.0.0.1:${server.address().port}/`,
    requests,
    close: () => server.close(),
  }
}

async function until(condition) {
  for (let i = 0; i < 80 && !condition(); i++) await wait(50)
  assert.ok(condition(), "timed out")
}

const EVENT = JSON.stringify({
  tool_name: TOOL,
  tool_input: { query: "my secret plan" },
  tool_response: [{ type: "text", text }],
})

test("adds ratings from the local file with no network call", async () => {
  const site = await fakeSite((res) => res.end("{}"))
  const { code, stdout } = await run(EVENT, {
    file: ratingsPath(ratings()),
    url: site.url,
  })
  await wait(300)
  site.close()
  assert.equal(code, 0)
  assert.equal(JSON.parse(stdout).hookSpecificOutput.additionalContext, TEXT)
  assert.equal(site.requests.length, 0)
})

test("a search doesn't wait when the file needs refreshing", async () => {
  const file = ratingsPath(ratings())
  makeOld(file)
  const newer = ratings({ rated: { "new.example": DETAILS } })
  const site = await fakeSite((res) => {
    setTimeout(() => res.end(JSON.stringify(newer)), 1500)
  })
  const started = Date.now()
  const { stdout } = await run(EVENT, { file, url: site.url })
  assert.ok(Date.now() - started < 1000, "the search waited for the download")
  assert.equal(JSON.parse(stdout).hookSpecificOutput.additionalContext, TEXT)
  await until(() => readFileSync(file, "utf8").includes("new.example"))
  site.close()
  assert.deepEqual(site.requests, [{ method: "GET", url: "/", body: "" }])
})

test("with no file it says nothing, and fetches one for next time", async () => {
  const file = ratingsPath()
  const site = await fakeSite((res) => res.end(JSON.stringify(ratings())))
  assert.deepEqual(await run(EVENT, { file, url: site.url }), {
    code: 0,
    stdout: "",
  })
  await until(() => existsSync(file))
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
    const first = await run(EVENT, { file, url: site.url })
    await run(EVENT, { file, url: site.url })
    await wait(400)
    site.close()
    assert.equal(
      JSON.parse(first.stdout).hookSpecificOutput.additionalContext,
      TEXT
    )
    assert.equal(readFileSync(file, "utf8"), before)
    assert.equal(site.requests.length, 1)
  }
})

test("very old ratings aren't shown", async () => {
  const old = new Date(Date.now() - 8 * 86_400_000).toISOString()
  const file = ratingsPath(ratings({ generated_at: old }))
  assert.deepEqual(await run(EVENT, { file }), { code: 0, stdout: "" })
})

test("prints plain text for agents with their own adapter", async () => {
  const file = ratingsPath(ratings())
  const { stdout } = await run(EVENT, { file, host: "plain" })
  assert.equal(stdout, TEXT)
})

test("does nothing for other tools or broken input", async () => {
  const file = ratingsPath()
  const site = await fakeSite((res) => res.end("{}"))
  const other = JSON.stringify({ tool_name: "Bash", tool_response: text })
  for (const input of [other, "not json", ""]) {
    assert.deepEqual(await run(input, { file, url: site.url }), {
      code: 0,
      stdout: "",
    })
  }
  await wait(300)
  site.close()
  assert.equal(site.requests.length, 0)
  assert.ok(!existsSync(file))
})

test("the hook and the API word a brief the same way", () => {
  const rating = (extra) => ({
    stars: 3.3,
    buyers: 2,
    works_for_task: 0.62,
    verdict: "unknown",
    listing_accuracy: null,
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
          buyers: 1,
          verdict: "avoid",
          listing_accuracy: { accurate: 1, overstated: 1, misleading: 0 },
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

test("a listed site finds reviews filed under its API host", () => {
  const file = ratings({ rated: { "api.aisa.one": DETAILS } })
  assert.match(briefFrom(file, ["aisa.one"]), /aisa\.one: 4\.5\/5/)
  assert.doesNotMatch(briefFrom(file, ["isa.one"]), /4\.5\/5/)
  assert.doesNotMatch(briefFrom(file, ["constructor"]), /function/)
})

test("the install guide's matchers fit the search tools and nothing else", () => {
  const guide = readFileSync("app/public/HOOK.md", "utf8")
  const matchers = [...guide.matchAll(/"matcher": "([^"]+)"/g)]
    .map((m) => m[1])
    .filter((m) => m.includes("agentcash") || m.startsWith("^MCP:"))
  assert.equal(matchers.length, 4)
  const [claude, codex, cursor, grok] = matchers.map((m) => new RegExp(m))
  for (const matcher of [claude, codex]) {
    for (const name of [
      "mcp__agentcash__search",
      "mcp__plugin_agentcash_agentcash__search",
      "mcp__agentcash__discover_api_endpoints",
      "mcp__payments-mcp__bazaar_search",
      "mcp__payments-mcp__bazaar_list",
      "mcp__bazaar__search_resources",
      "mcp__pay__search_skills",
      "mcp__mpp-services__search_services",
      "mcp__mpp-services__recommend_services",
      "mcp__x402search__search_x402_apis",
      "mcp__x402-discovery__x402_discover",
      "mcp__402index__search",
    ]) {
      assert.ok(matcher.test(name), name)
    }
    for (const name of [
      "mcp__notion__search",
      "mcp__agentcash__fetch",
      "mcp__railway__list_services",
      "mcp__agent-reviews__search_apis",
      "mcp__payments-mcp__make_http_request_with_x402",
    ]) {
      assert.ok(!matcher.test(name), name)
    }
  }
  for (const name of [
    "MCP:bazaar_search",
    "MCP:search_skills",
    "MCP:search_services",
    "MCP:search_x402_apis",
  ]) {
    assert.ok(cursor.test(name), name)
  }
  assert.ok(!cursor.test("MCP:fetch"))
  for (const name of [
    "agentcash__search",
    "payments-mcp__bazaar_search",
    "mpp-services__search_services",
  ]) {
    assert.ok(grok.test(name), name)
  }
  assert.ok(!grok.test("notion__search"))
  assert.ok(!grok.test("agentcash__fetch"))
})
