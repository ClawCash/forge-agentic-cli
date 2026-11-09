import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { readFileSync } from "node:fs"
import { createServer } from "node:http"
import { test } from "node:test"
import { domainsIn, hookOutput } from "../app/public/hook.mjs"

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

function run(input, api, host = "claude") {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["app/public/hook.mjs", host], {
      env: { ...process.env, AGENT_REVIEWS_API: api },
    })
    let stdout = ""
    child.stdout.on("data", (chunk) => (stdout += chunk))
    child.on("close", (code) => resolve({ code, stdout }))
    child.stdin.end(input)
  })
}

async function fakeApi(respond) {
  const bodies = []
  const server = createServer((req, res) => {
    let body = ""
    req.on("data", (chunk) => (body += chunk))
    req.on("end", () => {
      bodies.push({ url: req.url, body })
      respond(res)
    })
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    bodies,
    close: () => server.close(),
  }
}

const EVENT = JSON.stringify({
  tool_name: TOOL,
  tool_input: { query: "my secret plan" },
  tool_response: [{ type: "text", text }],
})

test("adds the ratings and sends only the domains", async () => {
  const api = await fakeApi((res) => {
    res.setHeader("Content-Type", "application/json")
    res.end(JSON.stringify({ text: "Agent Reviews: rated" }))
  })
  const { code, stdout } = await run(EVENT, api.url)
  api.close()
  assert.equal(code, 0)
  assert.equal(
    JSON.parse(stdout).hookSpecificOutput.additionalContext,
    "Agent Reviews: rated"
  )
  assert.equal(api.bodies[0].url, "/v1/brief")
  assert.deepEqual(JSON.parse(api.bodies[0].body), { domains: DOMAINS })
  assert.doesNotMatch(api.bodies[0].body, /secret/)
})

test("stays silent when our API fails or is unreachable", async () => {
  const api = await fakeApi((res) => {
    res.statusCode = 500
    res.end("{}")
  })
  const failed = await run(EVENT, api.url)
  api.close()
  assert.deepEqual(failed, { code: 0, stdout: "" })
  const unreachable = await run(EVENT, "http://127.0.0.1:9")
  assert.deepEqual(unreachable, { code: 0, stdout: "" })
})

test("makes no request for other tools or broken input", async () => {
  const api = await fakeApi((res) => res.end("{}"))
  const other = JSON.stringify({ tool_name: "Bash", tool_response: text })
  assert.deepEqual(await run(other, api.url), { code: 0, stdout: "" })
  assert.deepEqual(await run("not json", api.url), { code: 0, stdout: "" })
  assert.deepEqual(await run("", api.url), { code: 0, stdout: "" })
  api.close()
  assert.equal(api.bodies.length, 0)
})

test("the install guide's matchers fit the search tools and nothing else", () => {
  const guide = readFileSync("app/public/HOOK.md", "utf8")
  const matchers = [...guide.matchAll(/"matcher": "([^"]+)"/g)]
    .map((m) => m[1])
    .filter((m) => m.length > 20)
  assert.equal(matchers.length, 3)
  const [claude, codex, cursor] = matchers.map((m) => new RegExp(m))
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
})
