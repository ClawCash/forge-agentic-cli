import assert from "node:assert/strict"
import { mkdtempSync, readdirSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { inspectHederaTransaction } from "@x402/hedera"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { run } from "../cli/src/index.ts"
import { mirrorTransactionId } from "../shared/src/hedera.ts"
import {
  FAKE_TX,
  FEE_PAYER,
  fakeMirror,
  fakeSeller,
  USDC,
  usdcTransfer,
} from "./helpers/payments.mjs"

const agentKey = generatePrivateKey()
const agentAddress = privateKeyToAccount(agentKey).address
const agentAccount = "0.0.5001"
const merchant = "0.0.5002"

function harness(
  seller,
  transfer = usdcTransfer({ from: agentAccount, to: merchant, amount: 10000 })
) {
  const out = { stdout: "", stderr: "" }
  const home = mkdtempSync(join(tmpdir(), "reviews-test-"))
  const deps = {
    fetch: seller.fetch,
    env: { AGENT_A_PRIVATE_KEY: agentKey, REVIEWS_HOME: home },
    stdout: (text) => (out.stdout += text),
    stderr: (text) => (out.stderr += text),
    mirror: fakeMirror({
      accounts: { [agentAddress]: agentAccount },
      transactions: { [mirrorTransactionId(FAKE_TX)]: transfer },
    }),
  }
  return { deps, out, home }
}

test("pays a 402 endpoint from the agent's Hedera account and records the receipt", async () => {
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
  assert.match(out.stderr, /Paid \$0\.01 USDC on Hedera testnet to 0\.0\.5002/)
  assert.match(out.stderr, /verified on the mirror node/)

  // The agent signed a USDC transfer from its own account to the merchant,
  // with the facilitator as fee payer.
  assert.equal(settles.length, 1)
  const { requirements, payload } = settles[0]
  assert.equal(requirements.extra.feePayer, FEE_PAYER)
  const tx = inspectHederaTransaction(payload.payload.transaction)
  const usdc = tx.tokenTransfers[USDC]
  assert.ok(usdc, "transfers testnet USDC")
  assert.deepEqual(usdc.map((t) => [t.accountId, t.amount.toString()]).sort(), [
    [agentAccount, "-10000"],
    [merchant, "10000"],
  ])

  const dir = join(home, "interactions")
  const file = readdirSync(dir).find((name) => name.endsWith(".json"))
  const interaction = JSON.parse(readFileSync(join(dir, file), "utf8"))
  assert.match(interaction.id, /^int_/)
  assert.equal(interaction.agent.address, agentAddress)
  assert.equal(interaction.agent.accountId, agentAccount)
  assert.equal(interaction.price.network, "hedera:testnet")
  assert.equal(interaction.price.asset, USDC)
  assert.equal(interaction.price.amountUsd, "0.01")
  assert.equal(interaction.response.status, 200)
  assert.equal(interaction.settlement.transaction, FAKE_TX)
  assert.equal(
    interaction.settlement.explorerUrl,
    `https://hashscan.io/testnet/transaction/${FAKE_TX}`
  )
  assert.equal(interaction.evidence.status, "verified")
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

test("records an unverified receipt when the mirror node disagrees", async () => {
  const { deps, out } = harness(
    fakeSeller({ payTo: merchant }),
    usdcTransfer({ from: "0.0.6666", to: merchant, amount: 10000 })
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

test("explains a missing key or a wallet without a Hedera account", async () => {
  const noKey = harness(fakeSeller({ payTo: merchant }))
  noKey.deps.env = { REVIEWS_HOME: noKey.deps.env.REVIEWS_HOME }
  assert.equal(
    await run(["pay", "https://seller.test/paid", "--agent", "a"], noKey.deps),
    1
  )
  assert.match(noKey.out.stderr, /AGENT_A_PRIVATE_KEY is not set/)

  const noAccount = harness(fakeSeller({ payTo: merchant }))
  noAccount.deps.mirror = fakeMirror()
  assert.equal(
    await run(
      ["pay", "https://seller.test/paid", "--agent", "a"],
      noAccount.deps
    ),
    1
  )
  assert.match(noAccount.out.stderr, /has no Hedera testnet account yet/)
})
