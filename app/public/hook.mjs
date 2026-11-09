#!/usr/bin/env node
// Agent Reviews: adds ratings to the API search results of x402 and MPP wallets.
//
// It runs after a wallet's search tool or search command, reads the domains of
// the APIs in the result, and adds one short line per API to what the agent
// sees. Those domains are all it ever sends: never your query, files, keys or
// wallet details. If anything goes wrong it stays silent, so it can't get in
// your agent's way.

import { realpathSync } from "node:fs"
import { pathToFileURL } from "node:url"

const API = process.env.AGENT_REVIEWS_API ?? "https://reviews-api.forgeintel.co"
const MAX_INPUT_BYTES = 4_000_000
const MAX_DOMAINS = 50
const MAX_DEPTH = 12
const MAX_TEXT = 4000
const TIMEOUT_MS = 2500

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

// Each search tool, and the only place in its result an API address is read.
// Cursor leaves out the server's name, so these readers also check the shape.
const TOOLS = [
  // AgentCash
  [
    /^mcp__.*agentcash.*__search$|^MCP:search$/,
    (node) => (typeof node.path === "string" ? node.origin?.url : undefined),
  ],
  [
    /^mcp__.*agentcash.*__discover_api_endpoints$|^MCP:discover_api_endpoints$/,
    (node) => (Array.isArray(node.endpoints) ? node.origin : undefined),
  ],
  // Coinbase Payments MCP
  [
    /^(mcp__.*__|MCP:)bazaar_(search|list|get_resource_details)$/,
    (node) => node.resource,
  ],
  // Coinbase's hosted Bazaar
  [
    /^mcp__.*(bazaar|cdp|coinbase).*__search_resources$|^MCP:search_resources$/,
    bazaarTool,
  ],
  // pay.sh
  [
    /^mcp__.*pay.*__search_skills$|^MCP:search_skills$/,
    (node) => node.service_url,
  ],
  // MPP's service directory
  [
    /^(mcp__.*(mpp|tempo).*__|MCP:)(search_services|list_services|recommend_services|search_offers|get_service)$/,
    (node) =>
      node.integration !== undefined
        ? (node.serviceUrl ?? node.url)
        : undefined,
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
  /^(mcp__.*__|MCP:).*(x402.*(search|discover)|(search|discover).*x402)|^mcp__.*(x402|402index|agent-?tools|decixa).*__.*(search|discover|ask_services)/

// Wallet search commands, only where the command itself runs.
const LAUNCH = String.raw`(?:^|[;&|(]\s*)(?:\w+=\S*\s+)*(?:npx\s+(?:-\S+\s+)*|bunx\s+|pnpm\s+dlx\s+|yarn\s+dlx\s+)?(?:\S*\/)?`
const command = (name, rest) =>
  new RegExp(`${LAUNCH}${name}(?:@\\S+)?\\s+${rest}`)
const COMMANDS = [
  command("awal", String.raw`(?:x402\s+)?bazaar\s+(?:search|list)\b`),
  command("agentcash", String.raw`(?:search|discover)\b`),
  command("pay", String.raw`skills\s+search\b`),
  command("tempo", String.raw`wallet\s+(?:-\S+\s+)*services\b`),
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
          [node.text, node.result, node.stdout].filter(
            (text) => typeof text === "string"
          )
        )
  return unique(texts.flatMap(addressesInText))
}

function stdoutOf(response) {
  for (const node of objects(response)) {
    const output = node.stdout ?? node.output_for_prompt
    if (typeof output === "string") return output
  }
  return typeof response === "string" ? response : ""
}

// Grok names MCP tools server__tool, without Claude's prefix.
const prefixed = (name) =>
  /^[a-z0-9].*__/i.test(name) && !name.startsWith("mcp__")
    ? `mcp__${name}`
    : name

const SHELL_TOOLS = ["Bash", "Shell", "run_terminal_command"]

const orText = (found, value) => (found.length > 0 ? found : readText(value))

export function domainsIn(event) {
  const name = prefixed(String(event?.tool_name ?? event?.toolName ?? ""))
  const response =
    event?.tool_response ?? event?.toolResult ?? event?.tool_output
  if (SHELL_TOOLS.includes(name)) {
    const line = String((event?.tool_input ?? event?.toolInput)?.command ?? "")
    if (!COMMANDS.some((pattern) => pattern.test(line))) return []
    const stdout = stdoutOf(response)
    return orText(read(stdout, listed), stdout)
  }
  const tool = TOOLS.find(([pattern]) => pattern.test(name))
  if (tool) return read(response, tool[1])
  if (!DIRECTORY.test(name)) return []
  return orText(
    read(response, (node) => [...listed(node), node.url]),
    response
  )
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
    const short = text.slice(0, MAX_TEXT)
    const host = process.argv[2]
    process.stdout.write(
      host === "plain" ? short : JSON.stringify(hookOutput(host, short))
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
