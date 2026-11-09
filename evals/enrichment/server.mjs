import { appendFileSync, readFileSync } from "node:fs"
import { createInterface } from "node:readline"

// A small MCP server standing in for the market. It serves real, previously
// captured seller responses, so repeat runs cost no USDC.

const run = JSON.parse(readFileSync(process.env.MARKET_RUN, "utf8"))
const log = (entry) =>
  appendFileSync(process.env.MARKET_LOG, `${JSON.stringify(entry)}\n`)

const MAX_BODY = 16_000

const TOOLS = [
  {
    name: "search_apis",
    description: "List the paid APIs available for this task.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "call_api",
    description:
      "Call one of the listed APIs by its url. You are charged its price each time it returns a result.",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
      additionalProperties: false,
    },
  },
  {
    name: "finish",
    description:
      "Submit your final answer. Call this exactly once, at the end.",
    inputSchema: {
      type: "object",
      properties: { answer: { type: "string" } },
      required: ["answer"],
      additionalProperties: false,
    },
  },
]

function callTool(name, args) {
  if (name === "search_apis") {
    log({ tool: "search_apis" })
    return JSON.stringify({ results: run.listing })
  }
  if (name === "call_api") {
    const captured = run.responses[args.url]
    if (!captured) {
      log({ tool: "call_api", url: args.url, known: false, charged: 0 })
      return JSON.stringify({ error: "No such API in the list" })
    }
    log({
      tool: "call_api",
      url: args.url,
      known: true,
      charged: captured.charged,
      status: captured.status,
    })
    return JSON.stringify({
      status: captured.status,
      charged_usd: captured.charged,
      body: String(captured.body).slice(0, MAX_BODY),
    })
  }
  if (name === "finish") {
    log({ tool: "finish", answer: args.answer })
    return "Recorded."
  }
  throw new Error(`Unknown tool ${name}`)
}

const send = (message) =>
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`)

createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return
  const { id, method, params } = JSON.parse(line)
  if (method === "initialize") {
    send({
      id,
      result: {
        protocolVersion: params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "market", version: "1.0.0" },
      },
    })
  } else if (method === "tools/list") {
    send({ id, result: { tools: TOOLS } })
  } else if (method === "tools/call") {
    try {
      const text = callTool(params.name, params.arguments ?? {})
      send({ id, result: { content: [{ type: "text", text }] } })
    } catch (error) {
      send({
        id,
        result: {
          content: [{ type: "text", text: error.message }],
          isError: true,
        },
      })
    }
  } else if (id !== undefined) {
    send({ id, result: {} })
  }
})
