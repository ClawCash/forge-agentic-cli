// Agent Reviews for OpenCode: adds ratings to x402 and MPP wallet search results.
//
// The wallet logic is all in hook.mjs, which this runs after a wallet search. It
// sends only the domains of the APIs returned, and stays silent on any failure.

import { spawn } from "node:child_process"
import { homedir } from "node:os"
import { join } from "node:path"

const TIMEOUT_MS = 4000

// OpenCode names MCP tools server_tool, so the tool is found by its ending.
const TOOLS = [
  "discover_api_endpoints",
  "bazaar_get_resource_details",
  "bazaar_search",
  "bazaar_list",
  "search_resources",
  "search_skills",
  "search_services",
  "list_services",
  "recommend_services",
  "search_offers",
  "get_service",
  "search",
]
const DIRECTORY = /x402|402index|agent-?tools|decixa/i
const WALLET_COMMAND = /\b(awal|agentcash|pay\s+skills|tempo\s+wallet)\b/

function toolName(name) {
  const tool = TOOLS.find((known) => name.endsWith(`_${known}`))
  if (tool) return `mcp__${name.slice(0, -tool.length - 1)}__${tool}`
  return DIRECTORY.test(name) ? `mcp__${name}__${name}` : null
}

function eventFor(input, output) {
  const response = output.output ?? output.content
  if (input.tool === "bash") {
    const command = String(input.args?.command ?? "")
    return WALLET_COMMAND.test(command)
      ? {
          tool_name: "Bash",
          tool_input: { command },
          tool_response: { stdout: response },
        }
      : null
  }
  const tool_name = toolName(input.tool)
  return tool_name ? { tool_name, tool_response: response } : null
}

function ratings(event) {
  const script =
    process.env.AGENT_REVIEWS_HOOK ??
    join(homedir(), ".config", "agent-reviews", "hook.mjs")
  return new Promise((resolve) => {
    const child = spawn("node", [script, "plain"], {
      stdio: ["pipe", "pipe", "ignore"],
      timeout: TIMEOUT_MS,
    })
    let text = ""
    child.stdout.on("data", (chunk) => (text += chunk))
    child.on("error", () => resolve(""))
    child.on("close", (code) => resolve(code === 0 ? text : ""))
    child.stdin.on("error", () => {})
    child.stdin.end(JSON.stringify(event))
  })
}

export const AgentReviews = async () => ({
  "tool.execute.after": async (input, output) => {
    const event = eventFor(input, output)
    const text = event ? await ratings(event) : ""
    if (!text) return
    if (typeof output.output === "string") {
      output.output = `${output.output}\n\n${text}`
    } else if (Array.isArray(output.content)) {
      output.content.push({ type: "text", text })
    }
  },
})
