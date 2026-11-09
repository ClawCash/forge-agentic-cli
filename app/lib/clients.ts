export const AGENTS = [
  {
    name: "Claude Code",
    logo: "claudecode.svg",
    url: "https://claude.com/product/claude-code",
  },
  { name: "Codex", logo: "codex.svg", url: "https://openai.com/codex/" },
  { name: "Cursor", logo: "cursor.svg", url: "https://cursor.com" },
  { name: "Grok Bot", logo: "grokbot.svg", url: "https://grok.com" },
  { name: "Instinct", logo: "instinct.png", url: "https://instinct.com" },
  {
    name: "Hermes",
    logo: "hermesagent.svg",
    url: "https://hermes-agent.nousresearch.com",
  },
  { name: "OpenClaw", logo: "openclaw.svg", url: "https://openclaw.ai" },
  { name: "Muse Code", logo: "muse.svg", url: "https://dev.meta.ai" },
  { name: "OpenCode", logo: "opencode.svg", url: "https://opencode.ai" },
]

// What an agent might already be paying with. `url` is where to get the client:
// a tile without one has no client to get yet. `height` evens out logos of very
// different shapes. `wordmark` logos already spell the name, so only the others
// get it written beside them.
export const CLIENTS: {
  name: string
  logo: string
  height: number
  wordmark?: boolean
  url?: string
}[] = [
  {
    name: "Coinbase MCP",
    logo: "coinbase.png",
    height: 22,
    url: "https://docs.cdp.coinbase.com/agentic-wallet/mcp/quickstart",
  },
  {
    name: "Cloudflare",
    logo: "cloudflare.svg",
    height: 24,
  },
  {
    name: "Vercel",
    logo: "vercel.svg",
    height: 18,
  },
  {
    name: "AgentCash",
    logo: "agentcash.svg",
    height: 15,
    wordmark: true,
    url: "https://agentcash.dev/install",
  },
  {
    name: "thirdweb",
    logo: "thirdweb.svg",
    height: 20,
    url: "https://portal.thirdweb.com/x402/agents",
  },
  {
    name: "pay.sh",
    logo: "payshell.svg",
    height: 22,
    url: "https://pay.sh/docs/toolchain/install",
  },
  {
    name: "lobster.cash",
    logo: "lobster.svg",
    height: 22,
    url: "https://www.lobster.cash/install",
  },
  {
    name: "MPP",
    logo: "mpp.svg",
    height: 18,
    wordmark: true,
    url: "https://mpp.dev/tools/wallet",
  },
  {
    name: "x402",
    logo: "x402.svg",
    height: 24,
    wordmark: true,
    url: "https://docs.x402.org/getting-started/quickstart-for-buyers",
  },
]
