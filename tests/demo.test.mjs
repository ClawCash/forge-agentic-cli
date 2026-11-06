import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { runDemoAgent } from "../scripts/demo/agent.ts"
import { checkInvoice, sourceItems } from "../scripts/demo/check-invoice.ts"
import { extractInvoice } from "../server/src/invoice.ts"
import { A, B, BASE, hindiInvoice, TASK, world } from "./helpers/story.mjs"

const invoice = fileURLToPath(
  new URL("./fixtures/hindi-invoice.txt", import.meta.url)
)
const options = (overrides) => ({
  agent: "a",
  task: TASK,
  invoice,
  server: BASE,
  ignoreReviews: false,
  review: false,
  ...overrides,
})

test("the checker finds the missing Hindi items and the totals", () => {
  assert.deepEqual(sourceItems(hindiInvoice), [
    "Basmati rice 5kg",
    "चाय पत्ती 1kg",
    "Toor dal 1kg",
    "हल्दी पाउडर 200g",
  ])
  const fromA = checkInvoice(
    hindiInvoice,
    extractInvoice(hindiInvoice, "ascii-only")
  )
  assert.equal(fromA.outcome, "failure")
  assert.deepEqual(fromA.missing, ["चाय पत्ती 1kg", "हल्दी पाउडर 200g"])
  assert.match(
    fromA.reason,
    /^Dropped 2 of 4 line items .* sum 1860\.00 vs stated total 3291\.00$/
  )

  const fromB = checkInvoice(
    hindiInvoice,
    extractInvoice(hindiInvoice, "unicode")
  )
  assert.equal(fromB.outcome, "success")
  assert.match(fromB.reason, /All 4 line items; they sum to 3291\.00/)

  const wrongTotal = checkInvoice(hindiInvoice, {
    ...extractInvoice(hindiInvoice, "unicode"),
    total: "9999.00",
  })
  assert.equal(wrongTotal.outcome, "partial")
  assert.equal(checkInvoice(hindiInvoice, { lineItems: [] }).outcome, "failure")
})

test("without reviews the agent repeats the trial; with them it avoids API A", async () => {
  const w = await world()
  const lines = []
  const say = (line) => lines.push(line)

  // Agent A has no reviews to go on, takes the first listing, and fails.
  const first = await runDemoAgent(
    options({ agent: "a", ignoreReviews: true, review: true }),
    w.deps(),
    say
  )
  assert.equal(first.chosen, A)
  assert.equal(first.check.outcome, "failure")
  assert.equal(first.reviewed, true, "the person approved agent A's review")

  // Agent B checks reviews first, skips API A, and succeeds.
  const second = await runDemoAgent(options({ agent: "b" }), w.deps(), say)
  assert.equal(second.chosen, B)
  assert.equal(second.check.outcome, "success")
  assert.equal(second.interaction.evidence.status, "verified")

  const text = lines.join("\n")
  assert.match(text, /Taking the first listing/)
  assert.match(
    text,
    /Demo Invoice API A: 1 onchain review\(s\), average 0\/100 → avoid/
  )
  assert.match(text, /"Dropped 2 of 4 line items/)
  assert.match(text, /Chose Demo Invoice API B/)
  assert.match(text, /Done: task completed with 1 paid call/)
})
