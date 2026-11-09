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

// What an agent might already be paying with. `height` evens out logos of very
// different shapes. `wordmark` logos already spell the name, so only the others
// get it written beside them.
export const CLIENTS = [
  {
    name: "Coinbase MCP",
    logo: "coinbase.png",
    height: 22,
    url: "https://docs.cdp.coinbase.com/agentic-wallet/mcp/welcome",
  },
  {
    name: "Cloudflare",
    logo: "cloudflare.svg",
    height: 24,
    url: "https://developers.cloudflare.com/agents/tools/payments/x402/",
  },
  {
    name: "Vercel",
    logo: "vercel.svg",
    height: 18,
    url: "https://vercel.com/blog/introducing-x402-mcp-open-protocol-payments-for-mcp-tools",
  },
  {
    name: "AgentCash",
    logo: "agentcash.svg",
    height: 15,
    wordmark: true,
    url: "https://agentcash.dev",
  },
  {
    name: "thirdweb",
    logo: "thirdweb.svg",
    height: 20,
    url: "https://thirdweb.com",
  },
  { name: "pay.sh", logo: "payshell.svg", height: 22, url: "https://pay.sh" },
  {
    name: "lobster.cash",
    logo: "lobster.svg",
    height: 22,
    url: "https://www.lobster.cash",
  },
  {
    name: "MPP",
    logo: "mpp.svg",
    height: 18,
    wordmark: true,
    url: "https://mpp.dev",
  },
  {
    name: "x402",
    logo: "x402.svg",
    height: 24,
    wordmark: true,
    url: "https://x402.org",
  },
]
