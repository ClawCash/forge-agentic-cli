import assert from "node:assert/strict"
import { test } from "node:test"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { loadConfig } from "../server/src/config.ts"
import { createApp } from "../server/src/index.ts"

const sellerKey = generatePrivateKey()
const seller = privateKeyToAccount(sellerKey).address
const config = loadConfig({
  SERVICE_OWNER_PRIVATE_KEY: sellerKey,
  PUBLIC_BASE_URL: "https://demo.example/",
  DEMO_API_A_AGENT_ID: "7",
})
const app = createApp(config)

function decodeHeader(value) {
  return JSON.parse(Buffer.from(value, "base64").toString("utf8"))
}

test("health checks answer without payment", async () => {
  const res = await app.request("/health")
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { ok: true })
})

for (const id of ["a", "b"]) {
  test(`an unpaid call to demo API ${id.toUpperCase()} gets Arc testnet payment terms`, async () => {
    const res = await app.request(`/${id}/invoices/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Invoice INV-1" }),
    })
    assert.equal(res.status, 402)
    const header = res.headers.get("payment-required")
    assert.ok(header, "PAYMENT-REQUIRED header is present")
    const required = decodeHeader(header)
    assert.equal(required.x402Version, 2)
    assert.equal(
      required.resource.url,
      `https://demo.example/${id}/invoices/extract`
    )
    assert.equal(required.accepts.length, 1)
    const [accept] = required.accepts
    assert.equal(accept.scheme, "exact")
    assert.equal(accept.network, "eip155:5042002")
    assert.equal(accept.asset, "0x3600000000000000000000000000000000000000")
    assert.equal(accept.amount, "10000")
    assert.equal(accept.payTo, seller)
    assert.equal(accept.extra.name, "USDC")
    assert.equal(accept.extra.version, "2")
  })
}

test("serves ERC-8004 registration files for both services", async () => {
  const a = await (await app.request("/a/agent-registration.json")).json()
  assert.equal(
    a.type,
    "https://eips.ethereum.org/EIPS/eip-8004#registration-v1"
  )
  assert.equal(a.name, "Demo Invoice API A")
  assert.equal(a.x402Support, true)
  assert.deepEqual(a.services, [
    { name: "web", endpoint: "https://demo.example/a/invoices/extract" },
  ])
  assert.deepEqual(a.registrations, [
    {
      agentId: 7,
      agentRegistry:
        "eip155:5042002:0x8004A818BFB912233c491871b3d84c89A494BD9e",
    },
  ])

  const b = await (await app.request("/b/agent-registration.json")).json()
  assert.deepEqual(b.registrations, [], "unregistered services list none")

  const wellKnown = await (
    await app.request("/.well-known/agent-registration.json")
  ).json()
  assert.deepEqual(wellKnown.registrations, a.registrations)

  const logo = await app.request("/b/logo.svg")
  assert.equal(logo.headers.get("content-type"), "image/svg+xml")
})

test("config rejects a missing or malformed seller key", () => {
  assert.throws(() => loadConfig({}), /SERVICE_OWNER_PRIVATE_KEY/)
  assert.throws(
    () => loadConfig({ SERVICE_OWNER_PRIVATE_KEY: "0x1234" }),
    /SERVICE_OWNER_PRIVATE_KEY/
  )
})
