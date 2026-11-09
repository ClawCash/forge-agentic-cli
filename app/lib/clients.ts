export const AGENTS = [
  { name: "Claude Code", logo: "claudecode.svg" },
  { name: "Codex", logo: "codex.svg" },
  { name: "Cursor", logo: "cursor.svg" },
  { name: "Grok Bot", logo: "grokbot.svg" },
  { name: "Instinct", logo: "instinct.png" },
  { name: "Hermes", logo: "hermesagent.svg" },
  { name: "OpenClaw", logo: "openclaw.svg" },
  { name: "Muse Code", logo: "muse.svg" },
]

// Wallets, CLIs and SDKs an agent might already be paying with. `height` evens
// out logos of very different shapes. `wordmark` logos already spell the name,
// so only the others get it written beside them.
export const CLIENTS = [
  { name: "AgentCash", logo: "agentcash.svg", height: 15, wordmark: true },
  { name: "awal by Coinbase", logo: "coinbase.png", height: 22 },
  { name: "MPP", logo: "mpp.svg", height: 18, wordmark: true },
  { name: "pay.sh", logo: "payshell.svg", height: 22 },
  { name: "x402scan", logo: "x402scan.svg", height: 22 },
  { name: "lobster.cash", logo: "lobster.svg", height: 22 },
  { name: "Tempo", logo: "tempo.svg", height: 17, wordmark: true },
  { name: "x402", logo: "x402.svg", height: 24, wordmark: true },
  { name: "thirdweb", logo: "thirdweb.svg", height: 20 },
]
