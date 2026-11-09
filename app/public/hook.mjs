#!/usr/bin/env node
// Agent Reviews: adds ratings to a wallet's API search results.
//
// It runs after a wallet's search tool, reads the domains of the APIs in the
// result, and adds one short line per API to what the agent sees. Those domains
// are all it ever sends: never your query, files, keys or wallet details.
// If anything goes wrong it stays silent, so it can't get in your agent's way.

import { realpathSync } from "node:fs"
import { pathToFileURL } from "node:url"

const API = process.env.AGENT_REVIEWS_API ?? "https://reviews-api.forgeintel.co"
const MAX_INPUT_BYTES = 4_000_000
const MAX_DOMAINS = 50
const MAX_DEPTH = 12
const MAX_TEXT = 4000
const TIMEOUT_MS = 2500

// Each wallet tool, and the only place in its result an API address is read.
const READERS = [
  [
    /^mcp__.*agentcash.*__search$|^MCP:search$/,
    (node) => (typeof node.path === "string" ? node.origin?.url : undefined),
  ],
  [
    /^mcp__.*agentcash.*__discover_api_endpoints$|^MCP:discover_api_endpoints$/,
    (node) => (Array.isArray(node.endpoints) ? node.origin : undefined),
  ],
  [/^mcp__.*__bazaar_search$|^MCP:bazaar_search$/, (node) => node.resource],
]

// Hosts wrap a tool's result differently, and some send it as a JSON string.
function* objects(value, depth = 0) {
  if (depth > MAX_DEPTH) return
  if (typeof value === "string") {
    const text = value.trim()
    if (text.startsWith("{") || text.startsWith("[")) {
      try {
        yield* objects(JSON.parse(text), depth + 1)
      } catch {}
    }
  } else if (Array.isArray(value)) {
    for (const item of value) yield* objects(item, depth + 1)
  } else if (value && typeof value === "object") {
    yield value
    for (const item of Object.values(value)) yield* objects(item, depth + 1)
  }
}

function domainOf(address) {
  if (typeof address !== "string") return null
  try {
    const url = new URL(address)
    return url.protocol === "https:"
      ? url.hostname.toLowerCase().replace(/^www\./, "")
      : null
  } catch {
    return null
  }
}

export function domainsIn(event) {
  const name = String(event?.tool_name ?? "")
  const read = READERS.find(([tool]) => tool.test(name))?.[1]
  if (!read) return []
  const found = new Set()
  for (const node of objects(event.tool_response ?? event.tool_output)) {
    const domain = domainOf(read(node))
    if (domain) found.add(domain)
    if (found.size >= MAX_DOMAINS) break
  }
  return [...found]
}

export function hookOutput(host, text) {
  return host === "cursor"
    ? { additional_context: text }
    : {
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          additionalContext: text,
        },
      }
}

async function readInput() {
  const chunks = []
  let size = 0
  for await (const chunk of process.stdin) {
    size += chunk.length
    if (size > MAX_INPUT_BYTES) return null
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString("utf8")
}

async function main() {
  const input = await readInput()
  if (!input) return
  const domains = domainsIn(JSON.parse(input))
  if (domains.length === 0) return
  const res = await fetch(`${API}/v1/brief`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "agent-reviews-hook/1",
    },
    body: JSON.stringify({ domains }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) return
  const { text } = await res.json()
  if (typeof text === "string" && text) {
    process.stdout.write(
      JSON.stringify(hookOutput(process.argv[2], text.slice(0, MAX_TEXT)))
    )
  }
}

const isScript =
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href

if (isScript) {
  main()
    .catch(() => {})
    .finally(() => {
      process.exitCode = 0
    })
}
