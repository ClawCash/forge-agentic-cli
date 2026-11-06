import assert from "node:assert/strict"
import { test } from "node:test"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { loadConfig } from "../server/src/config.ts"
import { createApp } from "../server/src/index.ts"
import { resolveEndpointIdentity } from "../shared/src/identity.ts"
import { fakeFacilitator } from "./helpers/payments.mjs"

const BASE = "https://demo.example"
const owner = privateKeyToAccount(generatePrivateKey()).address

async function setup({ agentIds = { a: "7", b: "8" }, onchainURIs } = {}) {
  const app = createApp(
    await loadConfig({
      SERVICE_OWNER_HEDERA_ACCOUNT_ID: "0.0.5002",
      PUBLIC_BASE_URL: BASE,
      DEMO_API_A_AGENT_ID: agentIds.a,
      DEMO_API_B_AGENT_ID: agentIds.b,
    }),
    { facilitator: fakeFacilitator() }
  )
  const uris = onchainURIs ?? {
    7: `${BASE}/a/agent-registration.json`,
    8: `${BASE}/b/agent-registration.json`,
  }
  return {
    fetch: (url, init) => app.request(url.toString(), init),
    registry: {
      readContract: async ({ functionName, args: [id] }) => {
        const uri = uris[Number(id)]
        if (!uri) throw new Error("ERC721NonexistentToken")
        return functionName === "tokenURI" ? uri : owner
      },
    },
  }
}

test("verifies each demo endpoint against its own agent", async () => {
  const deps = await setup()
  const a = await resolveEndpointIdentity(`${BASE}/a/invoices/extract`, deps)
  assert.equal(a.status, "verified")
  assert.equal(a.agentId, "7")
  assert.equal(a.name, "Demo Invoice API A")
  assert.equal(a.owner, owner)
  assert.equal(
    a.agentRegistry,
    "eip155:296:0x8004A818BFB912233c491871b3d84c89A494BD9e"
  )

  const b = await resolveEndpointIdentity(`${BASE}/b/invoices/extract/`, deps)
  assert.equal(b.status, "verified")
  assert.equal(b.agentId, "8")
})

test("an endpoint no registration file lists stays unknown", async () => {
  const result = await resolveEndpointIdentity(`${BASE}/c/other`, await setup())
  assert.equal(result.status, "unknown")
  assert.match(result.reason, /does not list this endpoint/)
})

test("a domain without registrations stays unknown", async () => {
  const deps = await setup({ agentIds: { a: "", b: "" } })
  const result = await resolveEndpointIdentity(
    `${BASE}/a/invoices/extract`,
    deps
  )
  assert.equal(result.status, "unknown")
  assert.match(result.reason, /lists no Hedera testnet ERC-8004 registration/)
})

test("a domain claiming someone else's agent is not trusted", async () => {
  // The domain says agent 7, but agent 7's onchain URI points elsewhere.
  const deps = await setup({
    onchainURIs: {
      7: "https://elsewhere.example/a.json",
      8: `${BASE}/b/agent-registration.json`,
    },
  })
  const original = deps.fetch
  deps.fetch = async (url, init) =>
    String(url).startsWith("https://elsewhere.example")
      ? new Response(JSON.stringify({ services: [], registrations: [] }))
      : original(url, init)
  const result = await resolveEndpointIdentity(
    `${BASE}/a/invoices/extract`,
    deps
  )
  assert.equal(result.status, "unknown")
})

test("a missing agent onchain is reported, not thrown", async () => {
  const deps = await setup({ onchainURIs: {} })
  const result = await resolveEndpointIdentity(
    `${BASE}/a/invoices/extract`,
    deps
  )
  assert.equal(result.status, "unknown")
  assert.match(result.reason, /ERC721NonexistentToken/)
})
