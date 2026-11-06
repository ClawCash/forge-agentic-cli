import { mkdtempSync, readdirSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { run } from "../../cli/src/index.ts"
import { loadConfig } from "../../server/src/config.ts"
import { memoryStore } from "../../server/src/db/store.ts"
import { createApp } from "../../server/src/index.ts"
import { fakeLedger, fakeReputation } from "./ledger.mjs"
import { actOnApproval, fakeWorld } from "./world.mjs"

export const BASE = "https://demo.example"
export const A = `${BASE}/a/invoices/extract`
export const B = `${BASE}/b/invoices/extract`
export const TASK = "invoice-extraction:hi"
export const hindiInvoice = readFileSync(
  new URL("../fixtures/hindi-invoice.txt", import.meta.url),
  "utf8"
)

// The full story, in-process: the real demo server with its reviews API, a
// fake Hedera ledger behind x402, and a fake ERC-8004 reputation registry.
export async function world({ approvalTtlMs } = {}) {
  const ownerKey = generatePrivateKey()
  const owner = privateKeyToAccount(ownerKey).address
  const agentAKey = generatePrivateKey()
  const agentBKey = generatePrivateKey()
  const agentA = privateKeyToAccount(agentAKey).address
  const agentB = privateKeyToAccount(agentBKey).address
  const ledger = fakeLedger({
    accounts: {
      [owner]: "0.0.5002",
      [agentA]: "0.0.5001",
      [agentB]: "0.0.5003",
    },
  })
  const reputation = fakeReputation({
    owner,
    agentURIs: {
      7: `${BASE}/a/agent-registration.json`,
      8: `${BASE}/b/agent-registration.json`,
    },
  })
  const store = memoryStore()
  const config = await loadConfig({
    SERVICE_OWNER_HEDERA_ACCOUNT_ID: "0.0.5002",
    PUBLIC_BASE_URL: BASE,
    DEMO_API_A_AGENT_ID: "7",
    DEMO_API_B_AGENT_ID: "8",
  })
  const fetchApp = (url, init) => app.request(url.toString(), init)
  const world = fakeWorld()
  // How the person answers the next approval link the CLI shows.
  const human = { choice: "approve", person: "person-1" }
  const app = createApp(config, {
    world,
    approvalTtlMs,
    facilitator: ledger.facilitator,
    reviews: {
      store,
      fetch: fetchApp,
      mirror: ledger.mirror,
      registry: reputation.registry,
      receipts: reputation.receipts,
    },
  })
  const home = mkdtempSync(join(tmpdir(), "reviews-flow-"))
  // CLI dependencies wired to this in-process world; output goes to `out`.
  const deps = (out = { stdout: "", stderr: "" }) => ({
    fetch: fetchApp,
    env: {
      AGENT_A_PRIVATE_KEY: agentAKey,
      AGENT_B_PRIVATE_KEY: agentBKey,
      REVIEWS_HOME: home,
      REVIEWS_SERVER: BASE,
    },
    stdout: (t) => (out.stdout += t),
    stderr: (t) => (out.stderr += t),
    mirror: ledger.mirror,
    reputation,
    pollMs: 1,
    showApproval: async (url) => {
      await actOnApproval(app, world, url, human)
    },
  })
  async function cli(...argv) {
    const out = { stdout: "", stderr: "" }
    const code = await run(argv, deps(out))
    return { code, ...out }
  }
  const lastInteractionId = () =>
    readdirSync(join(home, "interactions"))
      .filter((f) => f.endsWith(".json"))
      .map((f) =>
        JSON.parse(readFileSync(join(home, "interactions", f), "utf8"))
      )
      .sort((x, y) => x.startedAt.localeCompare(y.startedAt))
      .at(-1).id
  return {
    app,
    cli,
    deps,
    human,
    world,
    store,
    reputation,
    agentA,
    agentB,
    home,
    lastInteractionId,
  }
}
