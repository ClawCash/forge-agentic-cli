import assert from "node:assert/strict"
import { test } from "node:test"
import { checkPayment } from "../shared/src/evidence.ts"
import { formatUsdc, parseUsd } from "../shared/src/networks.ts"
import { FAKE_TX, fakeReceipts, USDC } from "./helpers/payments.mjs"

const payer = "0x6c259ee820b03a8a48209E66f16CC3fD399d9a96"
const merchant = "0x2F8657faA6463C2F2F5854299fB76F5847CbCB44"
const claim = {
  txHash: FAKE_TX,
  asset: USDC,
  from: payer,
  to: merchant,
  amount: 10000n,
}

test("verifies a matching USDC transfer from the payer", async () => {
  const result = await checkPayment(
    fakeReceipts({ from: payer, to: merchant, value: 10000n }),
    claim
  )
  assert.deepEqual(result, { status: "verified", blockNumber: "123" })
})

test("rejects a transfer from someone other than the reviewer", async () => {
  const other = "0xF314967D8607671595962c61A7A08f6a8097D190"
  const result = await checkPayment(
    fakeReceipts({ from: other, to: merchant, value: 10000n }),
    claim
  )
  assert.equal(result.status, "unverified")
})

test("rejects the wrong amount, wrong token, or a reverted transaction", async () => {
  for (const receipts of [
    fakeReceipts({ from: payer, to: merchant, value: 9999n }),
    fakeReceipts({ from: payer, to: merchant, value: 10000n, asset: merchant }),
    fakeReceipts({
      from: payer,
      to: merchant,
      value: 10000n,
      status: "reverted",
    }),
  ]) {
    assert.equal((await checkPayment(receipts, claim)).status, "unverified")
  }
})

test("a missing receipt is unverified, not an error", async () => {
  const result = await checkPayment(
    {
      getTransactionReceipt: async () => Promise.reject(new Error("not found")),
    },
    claim
  )
  assert.equal(result.status, "unverified")
  assert.match(result.reason, /not found/)
})

test("converts between dollars and USDC units", () => {
  assert.equal(parseUsd("0.10", 6), 100000n)
  assert.equal(parseUsd("2", 6), 2000000n)
  assert.equal(formatUsdc(10000n, 6), "0.01")
  assert.equal(formatUsdc(1234567n, 6), "1.234567")
  assert.throws(() => parseUsd("1e3", 6), /Not a dollar amount/)
})
