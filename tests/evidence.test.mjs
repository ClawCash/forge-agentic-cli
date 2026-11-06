import assert from "node:assert/strict"
import { test } from "node:test"
import { checkPayment } from "../shared/src/evidence.ts"
import { mirrorTransactionId } from "../shared/src/hedera.ts"
import { formatUsdc, parseUsd } from "../shared/src/networks.ts"
import { FAKE_TX, fakeMirror, USDC, usdcTransfer } from "./helpers/payments.mjs"

const payer = "0.0.5001"
const merchant = "0.0.5002"
const claim = {
  transactionId: FAKE_TX,
  token: USDC,
  from: payer,
  to: merchant,
  amount: 10000n,
}
const mirrorId = mirrorTransactionId(FAKE_TX)

test("verifies a matching USDC transfer from the payer", async () => {
  const mirror = fakeMirror({
    transactions: {
      [mirrorId]: usdcTransfer({ from: payer, to: merchant, amount: 10000 }),
    },
  })
  assert.deepEqual(await checkPayment(claim, mirror), {
    status: "verified",
    consensusTimestamp: "1731000001.000000001",
  })
})

test("rejects a transfer from someone other than the reviewer", async () => {
  const mirror = fakeMirror({
    transactions: {
      [mirrorId]: usdcTransfer({
        from: "0.0.6666",
        to: merchant,
        amount: 10000,
      }),
    },
  })
  assert.equal((await checkPayment(claim, mirror)).status, "unverified")
})

test("rejects the wrong amount, wrong token, or a failed transaction", async () => {
  for (const transfer of [
    usdcTransfer({ from: payer, to: merchant, amount: 9999 }),
    usdcTransfer({ from: payer, to: merchant, amount: 10000, token: "0.0.1" }),
    usdcTransfer({
      from: payer,
      to: merchant,
      amount: 10000,
      result: "INSUFFICIENT_TOKEN_BALANCE",
    }),
  ]) {
    const mirror = fakeMirror({ transactions: { [mirrorId]: transfer } })
    assert.equal((await checkPayment(claim, mirror)).status, "unverified")
  }
})

test("a transaction the mirror node never shows is unverified", async () => {
  const result = await checkPayment(claim, fakeMirror())
  assert.equal(result.status, "unverified")
  assert.match(result.reason, /not found/)
})

test("converts Hedera transaction IDs and dollar amounts", () => {
  assert.equal(
    mirrorTransactionId("0.0.123@1700000000.000000001"),
    "0.0.123-1700000000-000000001"
  )
  assert.throws(
    () => mirrorTransactionId("0xabc"),
    /Not a Hedera transaction ID/
  )
  assert.equal(parseUsd("0.10", 6), 100000n)
  assert.equal(formatUsdc(10000n, 6), "0.01")
  assert.equal(formatUsdc(1234567n, 6), "1.234567")
  assert.throws(() => parseUsd("1e3", 6), /Not a dollar amount/)
})
