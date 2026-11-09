#!/usr/bin/env node
// Runs real, free wallet searches through the hook's own reader, and fails if
// any of them stops yielding APIs. A wallet that renames a tool or changes its
// format would otherwise make ratings vanish without anyone noticing.

import { execFile } from "node:child_process"
import { setTimeout as wait } from "node:timers/promises"
import { promisify } from "node:util"
import { domainsIn } from "../app/public/hook.mjs"

const MPP = "https://mpp.dev/mcp/services"
const BAZAAR = "https://api.cdp.coinbase.com/platform/v2/x402/discovery/mcp"
const DIRECTORY =
  "https://api.cdp.coinbase.com/platform/v2/x402/discovery/search?query=web%20search&limit=5"
const PAY_CATALOG = "https://pay.sh/api/catalog"
const RATINGS = "https://reviews.forgeintel.co/ratings.json"
const RETRY_MS = 20_000
const DAY_MS = 86_400_000

async function callTool(url, name, args) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
    signal: AbortSignal.timeout(30_000),
  })
  const text = await res.text()
  const event = text.split("\n").find((line) => line.startsWith("data:"))
  const { result, error } = JSON.parse(event ? event.slice(5) : text)
  if (error || result?.isError) throw new Error(`${name} returned an error`)
  return result
}

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`${url} returned ${res.status}`)
  return res.json()
}

const SEARCHES = {
  "AgentCash CLI": async () => {
    const { stdout } = await promisify(execFile)(
      "npx",
      ["-y", "agentcash@latest", "search", "web search", "--limit", "3"],
      { timeout: 120_000, maxBuffer: 4_000_000 }
    )
    return {
      tool_name: "Bash",
      tool_input: { command: 'npx -y agentcash search "web search"' },
      tool_response: { stdout },
    }
  },
  "MPP directory": async () => ({
    tool_name: "mcp__mpp-services__search_services",
    tool_response: await callTool(MPP, "search_services", {
      query: "search",
      limit: 5,
    }),
  }),
  "Coinbase hosted Bazaar": async () => ({
    tool_name: "mcp__bazaar__search_resources",
    tool_response: await callTool(BAZAAR, "search_resources", {
      query: "web search",
      limit: 5,
    }),
  }),
  "Coinbase directory": async () => ({
    tool_name: "mcp__payments-mcp__bazaar_search",
    tool_response: await getJson(DIRECTORY),
  }),
  "pay.sh catalog": async () => ({
    tool_name: "mcp__pay__search_skills",
    tool_response: { providers: (await getJson(PAY_CATALOG)).providers },
  }),
}

async function checkSearch(search) {
  const domains = domainsIn(await search())
  if (domains.length === 0) throw new Error("no APIs found in the result")
  return `${domains.length} APIs`
}

async function checkRatings() {
  const { generated_at: generatedAt, rated } = await getJson(RATINGS)
  if (!generatedAt || Date.now() - Date.parse(generatedAt) > DAY_MS) {
    throw new Error(`the file is out of date: ${generatedAt}`)
  }
  const count = Object.keys(rated).length
  if (count === 0) throw new Error("the file has no ratings")
  return `${count} rated APIs`
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

const results = await Promise.all([
  ...Object.entries(SEARCHES).map(([name, search]) =>
    attempt(name, () => checkSearch(search))
  ),
  attempt("Ratings file", checkRatings),
])
process.exitCode = results.every(Boolean) ? 0 : 1
