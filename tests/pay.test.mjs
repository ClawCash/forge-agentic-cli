import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { run } from "../cli/src/index.ts"
import { FAKE_TX, fakeReceipts, fakeSeller } from "./helpers/payments.mjs"

const agentKey = generatePrivateKey()
const agent = privateKeyToAccount(agentKey).address
const merchant = privateKeyToAccount(generatePrivateKey()).address

function harness(
  seller,
  receipts = fakeReceipts({ from: agent, to: merchant, value: 10000n })
) {
  const out = { stdout: "", stderr: "" }
  const home = mkdtempSync(join(tmpdir(), "reviews-test-"))
  const deps = {
    fetch: seller.fetch,
    env: { AGENT_A_PRIVATE_KEY: agentKey, REVIEWS_HOME: home },
    stdout: (text) => (out.stdout += text),
    stderr: (text) => (out.stderr += text),
    receiptClient: () => receipts,
  }
  return { deps, out, home }
}

test("pays a 402 endpoint from the agent's wallet and records the receipt", async () => {
  const settles = []
  const { deps, out, home } = harness(fakeSeller({ payTo: merchant, settles }))
  const code = await run(
    [
      "pay",
      "https://seller.test/paid",
      "--agent",
      "a",
      "--json",
      '{"text":"hi"}',
    ],
    deps
  )
  assert.equal(code, 0, out.stderr)
  assert.deepEqual(JSON.parse(out.stdout), { echo: { text: "hi" } })
  assert.match(out.stderr, /Paid \$0\.01 USDC on Arc testnet/)
  assert.match(out.stderr, /verified onchain/)

  // The payment was signed by the agent, for the advertised amount.
  assert.equal(settles.length, 1)
  const auth = settles[0].payload.payload.authorization
  assert.equal(auth.from, agent)
  assert.equal(auth.to, merchant)
  assert.equal(auth.value, "10000")

  const dir = join(home, "interactions")
  const file = readdirSync(dir).find((name) => name.endsWith(".json"))
  const interaction = JSON.parse(readFileSync(join(dir, file), "utf8"))
  assert.match(interaction.id, /^int_/)
  assert.equal(interaction.agent.address, agent)
  assert.equal(interaction.request.method, "POST")
  assert.equal(interaction.price.amountUsd, "0.01")
  assert.equal(interaction.price.payTo, merchant)
  assert.equal(interaction.response.status, 200)
  assert.equal(interaction.settlement.transaction, FAKE_TX)
  assert.equal(
    interaction.settlement.explorerUrl,
    `https://explorer.testnet.arc.io/tx/${FAKE_TX}`
  )
  assert.equal(interaction.evidence.status, "verified")
  assert.ok(interaction.timings.challengeMs >= 0)
  assert.equal(
    readFileSync(join(dir, file.replace(".json", ".body")), "utf8"),
    out.stdout.trim()
  )
})

test("refuses to pay more than --max-usd", async () => {
  const settles = []
  const { deps, out } = harness(
    fakeSeller({ payTo: merchant, price: "$0.50", settles })
  )
  const code = await run(
    [
      "pay",
      "https://seller.test/paid",
      "--agent",
      "a",
      "--json",
      "{}",
      "--max-usd",
      "0.10",
    ],
    deps
  )
  assert.equal(code, 1)
  assert.match(out.stderr, /above --max-usd/)
  assert.equal(settles.length, 0)
})

test("records an unverified receipt when the chain disagrees", async () => {
  const stranger = privateKeyToAccount(generatePrivateKey()).address
  const { deps, out } = harness(
    fakeSeller({ payTo: merchant }),
    fakeReceipts({ from: stranger, to: merchant, value: 10000n })
  )
  await run(
    ["pay", "https://seller.test/paid", "--agent", "a", "--json", "{}"],
    deps
  )
  assert.match(out.stderr, /not verified: No matching USDC transfer/)
})

test("free endpoints are recorded without a price", async () => {
  const { deps, out } = harness(fakeSeller({ payTo: merchant }))
  const code = await run(
    ["pay", "https://seller.test/free", "--agent", "a", "--output", "json"],
    deps
  )
  assert.equal(code, 0)
  const { interaction } = JSON.parse(out.stdout)
  assert.equal(interaction.price, null)
  assert.equal(interaction.settlement, null)
  assert.equal(interaction.request.method, "GET")
})

test("explains a missing agent key", async () => {
  const { deps, out } = harness(fakeSeller({ payTo: merchant }))
  deps.env = { REVIEWS_HOME: deps.env.REVIEWS_HOME }
  assert.equal(
    await run(["pay", "https://seller.test/paid", "--agent", "a"], deps),
    1
  )
  assert.match(out.stderr, /AGENT_A_PRIVATE_KEY is not set/)
})
