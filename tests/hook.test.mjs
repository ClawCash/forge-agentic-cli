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

test("the install guide's matchers fit the wallets' tools and nothing else", () => {
  const guide = readFileSync("app/public/HOOK.md", "utf8")
  const matchers = [...guide.matchAll(/"matcher": "(.+)"/g)].map((m) => m[1])
  assert.equal(matchers.length, 3)
  const [claude, codex, cursor] = matchers.map((m) => new RegExp(m))
  for (const matcher of [claude, codex]) {
    assert.ok(matcher.test("mcp__agentcash__search"))
    assert.ok(matcher.test("mcp__plugin_agentcash_agentcash__search"))
    assert.ok(matcher.test("mcp__agentcash__discover_api_endpoints"))
    assert.ok(matcher.test("mcp__payments-mcp__bazaar_search"))
    assert.ok(!matcher.test("mcp__notion__search"))
    assert.ok(!matcher.test("mcp__agentcash__fetch"))
  }
  assert.ok(cursor.test("MCP:bazaar_search"))
  assert.ok(!cursor.test("MCP:fetch"))
})
