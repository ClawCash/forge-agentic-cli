#!/usr/bin/env node
// Runs real, free wallet searches through the wrapper, exactly as an agent
// would, and fails if any answer stops coming back with ratings. A wallet that
// renames a tool or changes its format would otherwise make ratings vanish
// without anyone noticing.

import { execFile, spawn } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createInterface } from "node:readline"
import { setTimeout as wait } from "node:timers/promises"
import { promisify } from "node:util"
import { domainsIn } from "../app/public/wrap.mjs"

const WRAP = new URL("../app/public/wrap.mjs", import.meta.url).pathname
const RATINGS_FILE = join(mkdtempSync(join(tmpdir(), "reviews-")), "ratings.json")
const ENV = { ...process.env, AGENT_REVIEWS_RATINGS: RATINGS_FILE }
const DIRECTORY =
  "https://api.cdp.coinbase.com/platform/v2/x402/discovery/search?query=web%20search&limit=5"
const RATINGS = "https://reviews.forgeintel.co/ratings.json"
const RETRY_MS = 20_000
const DAY_MS = 86_400_000

// Starts a wallet behind the wrapper, makes one search, and returns the
// answer the agent would see.
async function searchThroughWrapper(wallet, tool, args) {
  const child = spawn(process.execPath, [WRAP, ...wallet], {
    env: ENV,
    stdio: ["pipe", "pipe", "ignore"],
  })
  const replies = new Map()
  createInterface({ input: child.stdout }).on("line", (line) => {
    try {
      const message = JSON.parse(line)
      replies.get(message.id)?.(message)
    } catch {}
  })
  const ask = (id, method, params) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${method} timed out`)), 120_000)
      replies.set(id, (message) => (clearTimeout(timer), resolve(message)))
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`)
    })
  try {
    await ask(1, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "agent-reviews-check", version: "1" },
    })
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`
    )
    const { result, error } = await ask(2, "tools/call", { name: tool, arguments: args })
    if (error || result?.isError) throw new Error(`${tool} returned an error`)
    return result
  } finally {
    child.kill()
  }
}

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`${url} returned ${res.status}`)
  return res.json()
}

async function rated(wallet, tool, args) {
  const { content = [] } = await searchThroughWrapper(wallet, tool, args)
  const added = content.at(-1)?.text ?? ""
  if (!added.startsWith("Agent Reviews")) {
    throw new Error("no ratings were added to the answer")
  }
  return added.split("\n")[0]
}

// Runs a wallet's search command through the wrapper, as an agent's shell would.
async function ratedInShell(words) {
  const { stderr } = await promisify(execFile)(
    process.execPath,
    [WRAP, "run", ...words],
    { env: { ...ENV, NO_COLOR: "1" }, timeout: 180_000, maxBuffer: 8_000_000 }
  )
  const added = stderr.slice(stderr.lastIndexOf("\nAgent Reviews") + 1)
  if (!added.startsWith("Agent Reviews")) {
    throw new Error("no ratings were added to the output")
  }
  return added.split("\n")[0]
}

function found(event) {
  const domains = domainsIn(event)
  if (domains.length === 0) throw new Error("no APIs found in the result")
  return `${domains.length} APIs`
}

const CHECKS = {
  AgentCash: () =>
    rated(["npx", "-y", "agentcash@latest"], "search", { query: "web search", limit: 3 }),
  "MPP directory": () =>
    rated(["https://mpp.dev/mcp/services"], "search_services", { query: "search", limit: 5 }),
  "Coinbase hosted Bazaar": () =>
    rated(
      ["https://api.cdp.coinbase.com/platform/v2/x402/discovery/mcp"],
      "search_resources",
      { query: "web search", limit: 5 }
    ),
  "pay.sh": () =>
    rated(["npx", "-y", "@solana/pay", "mcp"], "search_catalog", {
      query: "web search",
      max_results: 5,
    }),
  "AgentCash CLI": () =>
    ratedInShell(["npx", "-y", "agentcash@latest", "search", "web search"]),
  "pay.sh CLI": () =>
    ratedInShell(["npx", "-y", "@solana/pay", "skills", "search", "web search"]),
  "mppx CLI": () =>
    ratedInShell(["npx", "-y", "mppx", "services", "list", "-q", "search"]),
  // Payments MCP and awal search only through their desktop wallet apps,
  // which can't run here, so the Coinbase data both return is read directly.
  "Coinbase Payments MCP data": async () =>
    found({
      tool_name: "mcp__payments-mcp__bazaar_search",
      tool_response: await getJson(DIRECTORY),
    }),
  "Ratings file": async () => {
    const { generated_at: generatedAt, rated } = await getJson(RATINGS)
    if (!generatedAt || Date.now() - Date.parse(generatedAt) > DAY_MS) {
      throw new Error(`the file is out of date: ${generatedAt}`)
    }
    const count = Object.keys(rated).length
    if (count === 0) throw new Error("the file has no ratings")
    return `${count} rated APIs`
  },
}

// One retry, so a passing network blip doesn't raise an alarm.
async function attempt(name, check) {
  for (const last of [false, true]) {
    try {
      console.log(`ok    ${name}: ${await check()}`)
      return true
    } catch (error) {
      if (last) {
        console.log(`FAIL  ${name}: ${error.message}`)
        return false
      }
      await wait(RETRY_MS)
    }
  }
}

await promisify(execFile)(process.execPath, [WRAP, "refresh"], { env: ENV })
const results = await Promise.all(
  Object.entries(CHECKS).map(([name, check]) => attempt(name, check))
)
process.exitCode = results.every(Boolean) ? 0 : 1
