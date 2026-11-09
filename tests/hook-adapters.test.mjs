import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { createServer } from "node:http"
import { after, before, test } from "node:test"
import { promisify } from "node:util"
import { AgentReviews } from "../app/public/agent-reviews-opencode.js"

// Runs each agent's adapter against the real hook script and a fake API.

const RESULT = JSON.stringify({
  results: { results: [{ path: "/x", origin: { url: "https://a.example" } }] },
})
const LINE = "Agent Reviews: rated"
let requests = 0
let fail = false
let server

before(async () => {
  server = createServer((req, res) => {
    req.resume()
    req.on("end", () => {
      requests += 1
      res.statusCode = fail ? 500 : 200
      res.end(JSON.stringify({ text: LINE }))
    })
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  process.env.AGENT_REVIEWS_API = `http://127.0.0.1:${server.address().port}`
  process.env.AGENT_REVIEWS_HOOK = "app/public/hook.mjs"
})
after(() => server.close())

const opencode = async (tool, args, output) => {
  const hooks = await AgentReviews()
  await hooks["tool.execute.after"](
    { tool, sessionID: "s", callID: "c", args },
    output
  )
  return output
}

test("OpenCode gets ratings on a wallet's MCP search", async () => {
  const output = await opencode(
    "agentcash_search",
    {},
    { title: "", output: RESULT, metadata: {} }
  )
  assert.equal(output.output, `${RESULT}\n\n${LINE}`)
})

test("OpenCode gets ratings on a shell wallet search", async () => {
  const output = await opencode(
    "bash",
    { command: "npx awal bazaar search news" },
    { title: "", output: "https://a.example/x\n---", metadata: {} }
  )
  assert.ok(output.output.endsWith(LINE))
})

// OpenCode hands MCP tools the raw result and builds the text from it afterwards.
test("OpenCode gets ratings when the result is MCP content", async () => {
  const output = await opencode(
    "payments-mcp_bazaar_search",
    {},
    {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            items: [{ resource: "https://a.example/x" }],
          }),
        },
      ],
    }
  )
  assert.deepEqual(output.content.at(-1), { type: "text", text: LINE })
})

test("OpenCode leaves other tools and failures alone", async () => {
  const before = requests
  const other = await opencode(
    "bash",
    { command: "ls" },
    { title: "", output: "https://a.example", metadata: {} }
  )
  assert.equal(other.output, "https://a.example")
  const unrelated = await opencode(
    "notion_fetch",
    {},
    { title: "", output: RESULT, metadata: {} }
  )
  assert.equal(unrelated.output, RESULT)
  assert.equal(requests, before)
  fail = true
  const failed = await opencode(
    "agentcash_search",
    {},
    { title: "", output: RESULT, metadata: {} }
  )
  fail = false
  assert.equal(failed.output, RESULT)
})

const HERMES = String.raw`
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("agent_reviews", "app/public/hermes/__init__.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
hooks = {}
module.register(type("Ctx", (), {"register_hook": lambda self, name, fn: hooks.setdefault(name, fn)})())
print(json.dumps(hooks["transform_tool_result"](**json.loads(sys.argv[1]))))
`

// Must not block: the fake API runs in this process.
const hermes = async (call) => {
  const { stdout } = await promisify(execFile)(
    "python3",
    ["-I", "-c", HERMES, JSON.stringify(call)],
    { env: process.env }
  )
  return JSON.parse(stdout)
}

test("Hermes gets ratings on a wallet's MCP search", async () => {
  const result = await hermes({
    tool_name: "mcp__agentcash__search",
    args: {},
    result: JSON.stringify({ result: RESULT }),
  })
  assert.equal(JSON.parse(result).agent_reviews, LINE)
})

test("Hermes gets ratings on a shell wallet search", async () => {
  const result = await hermes({
    tool_name: "terminal",
    args: { command: "awal bazaar search news" },
    result: JSON.stringify({
      output: "https://a.example/x\n---",
      exit_code: 0,
    }),
  })
  assert.equal(JSON.parse(result).agent_reviews, LINE)
})

test("Hermes leaves other tools and failures alone", async () => {
  const before = requests
  assert.equal(
    await hermes({
      tool_name: "terminal",
      args: { command: "ls" },
      result: "{}",
    }),
    null
  )
  assert.equal(
    await hermes({
      tool_name: "mcp__notion__search",
      args: {},
      result: RESULT,
    }),
    null
  )
  assert.equal(requests, before)
  fail = true
  assert.equal(
    await hermes({
      tool_name: "mcp__agentcash__search",
      args: {},
      result: RESULT,
    }),
    null
  )
  fail = false
})
