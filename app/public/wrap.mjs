#!/usr/bin/env node
// Agent Reviews: adds ratings to your wallet's API search results, in any agent.
//
// Put this in front of the command that starts your wallet's MCP server:
//
//   node wrap.mjs npx -y agentcash@latest
//   node wrap.mjs https://mpp.dev/mcp/services     (a remote server with no sign-in)
//
// It starts the wallet itself and passes every message through unchanged, with
// one exception: when the wallet answers a search, it adds a few lines of
// ratings for the APIs in the answer. It never stores, changes or sends payment
// requests. The ratings come from a local file of public ratings, refreshed in
// the background with a plain download, so nothing about your searches leaves
// your machine. If anything goes wrong, the wallet's answer goes through as is.

import { spawn } from "node:child_process"
import {
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { createInterface } from "node:readline"
import { fileURLToPath, pathToFileURL } from "node:url"

const RATINGS_URL =
  process.env.AGENT_REVIEWS_RATINGS_URL ??
  "https://reviews.forgeintel.co/ratings.json"
const RATINGS_FILE =
  process.env.AGENT_REVIEWS_RATINGS ??
  join(homedir(), ".config", "agent-reviews", "ratings.json")
const LAST_ATTEMPT = `${RATINGS_FILE}.attempt`
const FRESH_MS = 10 * 60_000
const RETRY_MS = 60_000
const TOO_OLD_MS = 7 * 86_400_000
const MAX_RATINGS_BYTES = 8_000_000
const REFRESH_TIMEOUT_MS = 10_000
const MAX_MESSAGE_BYTES = 4_000_000
const MAX_DOMAINS = 50
const MAX_DEPTH = 12
const MAX_TEXT = 4000

const ADDRESS = String.raw`https:\/\/[^\s"'<>)\]\x00-\x1f]+`
const TLD = "com|dev|io|ai|xyz|co|net|org|app|sh|to|one|gg|so|fun|cash|cloud"

// Coinbase's hosted Bazaar returns each API as a tool. Its address is in the
// tool's metadata when given, and otherwise encoded in the tool's name.
function bazaarTool(node) {
  const terms = node._meta?.["x402/payment-required"]
  if (!terms) return undefined
  if (terms.extensions?.agentkit?.info?.uri) {
    return terms.extensions.agentkit.info.uri
  }
  const host = new RegExp(
    `^x402_[a-z]+_https___((?:[a-z0-9-]+_)+?(?:${TLD}))(?:_|$)`
  ).exec(node.name ?? "")?.[1]
  return host && `https://${host.replaceAll("_", ".")}`
}

// Each wallet's search tools, named mcp__<wallet command>__<tool>, and the
// only place in their answers an API address is read.
const TOOLS = [
  // AgentCash
  [
    /^mcp__.*agentcash.*__search$/,
    (node) => (typeof node.path === "string" ? node.origin?.url : undefined),
  ],
  [
    /^mcp__.*agentcash.*__discover_api_endpoints$/,
    (node) => (Array.isArray(node.endpoints) ? node.origin : undefined),
  ],
  // Coinbase Payments MCP
  [/^mcp__.*__bazaar_(search|list|get_resource_details)$/, (node) => node.resource],
  // Coinbase's hosted Bazaar
  [/^mcp__.*(bazaar|cdp|coinbase).*__search_resources$/, bazaarTool],
  // pay.sh
  [/^mcp__.*pay.*__search_skills$/, (node) => node.service_url],
  // MPP's service directory and Tempo Wallet
  [
    /^mcp__.*(mpp|tempo).*__(search_services|list_services|recommend_services|search_offers|get_service|get_services_by_recipient|services_search|services_list|services_show)$/,
    (node) =>
      node.integration !== undefined
        ? (node.serviceUrl ?? node.url)
        : node.service_url,
  ],
]

// The fields directories use for an API's address.
const listed = (node) => [
  node.resource,
  node.service_url,
  node.serviceUrl,
  node.endpoint_url,
  node.endpointUrl,
  typeof node.path === "string" ? node.origin?.url : undefined,
  Array.isArray(node.endpoints) ? node.origin : undefined,
  node.integration !== undefined ? node.url : undefined,
]

// Other x402 directories vary too much to list field by field.
const DIRECTORY =
  /^mcp__.*__.*(x402.*(search|discover)|(search|discover).*x402|list_mpp_services|listPayableServices|boltzpay_discover)|^mcp__.*(x402|402index|agent-?tools|decixa|boltzpay).*__.*(search|discover|ask_services)/

const isSearch = (name) =>
  TOOLS.some(([pattern]) => pattern.test(name)) || DIRECTORY.test(name)

// Picks the rating for the job at hand. This only reads the search on this
// machine, so the query itself is never sent anywhere.
const TASK_WORDS = [
  [
    "enrichment",
    /\b(enrich\w*|people|person|compan\w+|linkedin|leads?|contacts?|prospect\w*)\b/i,
  ],
  ["email", /\b(emails?|inbox\w*)\b/i],
  ["web-scrape", /\b(scrap\w+|crawl\w*)\b/i],
  ["web-search", /\b(web search|search the web|news|serp|google)\b/i],
  ["token-price", /\b(token|crypto|coin|defi)\b/i],
  ["weather", /\b(weather|forecast)\b/i],
  ["document-extract", /\b(pdf|documents?|ocr)\b/i],
  ["image-generation", /\b(images?|photos?|pictures?)\b/i],
  ["transcription", /\b(transcri\w+|speech)\b/i],
  ["translation", /\btranslat\w+/i],
]

export function taskOf(event) {
  const input = event?.tool_input ?? {}
  const text = [input.query, input.task, input.q]
    .filter((part) => typeof part === "string")
    .join(" ")
  return TASK_WORDS.find(([, words]) => words.test(text))?.[0] ?? null
}

// Wallets wrap their answers differently, and some send them as JSON strings.
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

const unique = (addresses) =>
  [...new Set(addresses.flatMap((a) => domainOf(a) ?? []))].slice(
    0,
    MAX_DOMAINS
  )

const read = (value, reader) => unique([...objects(value)].flatMap(reader))

function addressesInText(text) {
  const named = [
    ...text.matchAll(new RegExp(`\\bendpoint\\b[*:\\s\`]*(${ADDRESS})`, "gi")),
  ].map((match) => match[1])
  if (named.length > 0) return named
  const first = new RegExp(ADDRESS)
  return text.split("\n").flatMap((line) => first.exec(line)?.[0] ?? [])
}

function readText(value) {
  const texts =
    typeof value === "string"
      ? [value]
      : [...objects(value)].flatMap((node) =>
          [node.text, node.result].filter((text) => typeof text === "string")
        )
  return unique(texts.flatMap(addressesInText))
}

// The APIs in a search answer. `event` is { tool_name, tool_input, tool_response }.
export function domainsIn(event) {
  const name = String(event?.tool_name ?? "")
  const response = event?.tool_response
  const tool = TOOLS.find(([pattern]) => pattern.test(name))
  if (tool) return read(response, tool[1])
  if (!DIRECTORY.test(name)) return []
  const found = read(response, (node) => [...listed(node), node.url])
  return found.length > 0 ? found : readText(response)
}

// Same wording as the API's /v1/brief. A test holds the two together.
export function briefFrom(ratings, domains, task = null) {
  if (!ratings?.rated || !ratings.generated_at) return null
  if (Date.now() - Date.parse(ratings.generated_at) > TOO_OLD_MS) return null
  const { rated } = ratings
  const names = Object.keys(rated)
  const down = new Set(ratings.down)
  const lines = []
  let reviewed = 0
  for (const domain of domains) {
    // A directory can list a company's site while reviews name its API host.
    const name = Object.hasOwn(rated, domain)
      ? domain
      : names.find((known) => known.endsWith(`.${domain}`))
    if (name) {
      reviewed += 1
      const forTask = task ? ratings.tasks?.[name]?.[task] : undefined
      lines.push(
        forTask ? `${domain}, ${task}: ${forTask}` : `${domain}: ${rated[name]}`
      )
    } else if (down.has(domain)) {
      lines.push(`${domain}: not responding when last checked`)
    }
  }
  if (lines.length === 0) {
    return "Agent Reviews: none of these APIs have reviews yet."
  }
  const unreviewed = domains.length - reviewed
  return [
    "Agent Reviews, from agents that paid for these APIs:",
    ...lines.map((line) => `- ${line}`),
    ...(unreviewed > 0
      ? [
          `No reviews yet for ${unreviewed} of ${domains.length} APIs in these results.`,
        ]
      : []),
    ...(reviewed > 0
      ? ["See what each one promised and delivered with get_api_reviews."]
      : []),
  ].join("\n")
}

function loadRatings() {
  try {
    return JSON.parse(readFileSync(RATINGS_FILE, "utf8"))
  } catch {
    return null
  }
}

function ageOf(file) {
  try {
    return Date.now() - statSync(file).mtimeMs
  } catch {
    return Infinity
  }
}

// Hands the download to a separate process, so a search never waits for it.
function refreshInBackground() {
  if (ageOf(RATINGS_FILE) < FRESH_MS || ageOf(LAST_ATTEMPT) < RETRY_MS) return
  mkdirSync(dirname(RATINGS_FILE), { recursive: true })
  writeFileSync(LAST_ATTEMPT, "")
  spawn(process.execPath, [fileURLToPath(import.meta.url), "refresh"], {
    detached: true,
    stdio: "ignore",
  }).unref()
}

async function refresh() {
  const res = await fetch(RATINGS_URL, {
    headers: { "User-Agent": "agent-reviews-wrap/1" },
    signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
  })
  if (!res.ok) return
  const body = await res.text()
  if (body.length > MAX_RATINGS_BYTES) return
  const ratings = JSON.parse(body)
  const usable =
    typeof ratings?.generated_at === "string" &&
    ratings.rated &&
    typeof ratings.rated === "object" &&
    Array.isArray(ratings.down)
  if (!usable) return
  mkdirSync(dirname(RATINGS_FILE), { recursive: true })
  const partial = `${RATINGS_FILE}.${process.pid}`
  writeFileSync(partial, body)
  renameSync(partial, RATINGS_FILE)
}

// The wallet's search tools are told apart by the command or address that
// starts it, so they are found whatever the agent named the server.
export const walletOf = (words) =>
  words
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9.@/-]+/g, "-")

const parse = (line) => {
  try {
    return line.length > MAX_MESSAGE_BYTES ? null : JSON.parse(line)
  } catch {
    return null
  }
}
const each = (message) =>
  Array.isArray(message) ? message : message ? [message] : []

// Only the agent's search calls are remembered. Payment calls aren't.
export function remember(searches, wallet, message) {
  for (const m of each(message)) {
    const name = `mcp__${wallet}__${m?.params?.name}`
    if (m?.method === "tools/call" && m.id != null && isSearch(name)) {
      searches.set(m.id, { name, input: m.params.arguments ?? {} })
    } else if (m?.method === "notifications/cancelled") {
      searches.delete(m.params?.requestId)
    }
  }
}

// The wallet's line, with ratings added if it answers a remembered search.
export function withRatings(searches, line) {
  const message = parse(line)
  let changed = false
  for (const m of each(message)) {
    const search = m?.method === undefined && searches.get(m?.id)
    if (!search) continue
    searches.delete(m.id)
    if (!m.result || m.result.isError) continue
    const event = {
      tool_name: search.name,
      tool_input: search.input,
      tool_response: m.result,
    }
    const domains = domainsIn(event)
    if (domains.length === 0) continue
    try {
      refreshInBackground()
    } catch {}
    const text = briefFrom(loadRatings(), domains, taskOf(event))
    if (!text) continue
    const content = Array.isArray(m.result.content) ? m.result.content : []
    m.result.content = [
      ...content,
      { type: "text", text: text.slice(0, MAX_TEXT) },
    ]
    changed = true
  }
  return changed ? JSON.stringify(message) : line
}

const linesOf = (stream, onLine, onEnd = () => {}) =>
  createInterface({ input: stream, crlfDelay: Infinity })
    .on("line", onLine)
    .on("close", onEnd)

const send = (line) => process.stdout.write(`${line}\n`)

// A wallet started as a local command.
function wrapCommand(command, args) {
  const wallet = walletOf([command, ...args])
  const searches = new Map()
  const child = spawn(command, args, {
    stdio: ["pipe", "pipe", "inherit"],
    shell: process.platform === "win32",
  })
  child.on("error", (error) => {
    process.stderr.write(
      `Agent Reviews couldn't start ${command}: ${error.message}\n`
    )
    process.exit(1)
  })
  child.stdin.on("error", () => {})
  linesOf(
    process.stdin,
    (line) => {
      try {
        remember(searches, wallet, parse(line))
      } catch {}
      child.stdin.write(`${line}\n`)
    },
    () => child.stdin.end()
  )
  linesOf(child.stdout, (line) => {
    let out = line
    try {
      out = withRatings(searches, line)
    } catch {}
    send(out)
  })
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => child.kill(signal))
  }
  child.on("close", (code) => {
    process.stdin.destroy()
    process.exitCode = code ?? 1
  })
}

function eventsIn(body) {
  return body
    .split(/\r?\n\r?\n/)
    .map((event) =>
      event
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n")
    )
    .filter((data) => data.trim())
}

// A remote wallet server reached over HTTP, for servers that need no sign-in.
function wrapUrl(url) {
  const wallet = walletOf([url])
  const searches = new Map()
  let session
  let version
  linesOf(process.stdin, async (line) => {
    const message = parse(line)
    if (!message) return
    try {
      remember(searches, wallet, message)
    } catch {}
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          ...(session && { "Mcp-Session-Id": session }),
          ...(version && { "MCP-Protocol-Version": version }),
        },
        body: line,
      })
      session = res.headers.get("mcp-session-id") ?? session
      const body = await res.text()
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const replies = (res.headers.get("content-type") ?? "").includes(
        "text/event-stream"
      )
        ? eventsIn(body)
        : body.trim()
          ? [body.trim()]
          : []
      for (const reply of replies) {
        const protocol = parse(reply)?.result?.protocolVersion
        if (typeof protocol === "string") version = protocol
        let out = reply
        try {
          out = withRatings(searches, reply)
        } catch {}
        send(out)
      }
    } catch (error) {
      for (const m of each(message)) {
        if (m?.method && m.id != null) {
          send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: m.id,
              error: {
                code: -32000,
                message: `Couldn't reach ${new URL(url).host}: ${error.message}`,
              },
            })
          )
        }
      }
    }
  })
}

const isScript =
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href

if (isScript) {
  const [first, ...rest] = process.argv.slice(2)
  if (first === "refresh") {
    refresh()
      .catch(() => {})
      .finally(() => {
        process.exitCode = 0
      })
  } else if (!first) {
    process.stderr.write(
      "Usage: node wrap.mjs <wallet MCP command...>  or  node wrap.mjs <https URL>\n"
    )
    process.exitCode = 2
  } else if (/^https?:\/\//i.test(first)) {
    wrapUrl(first)
  } else {
    wrapCommand(first, rest)
  }
}
