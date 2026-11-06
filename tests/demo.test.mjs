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

  // Messages wrap at terminal width; compare with whitespace collapsed.
  const text = lines.join(" ").replace(/\s+/g, " ")
  // Agent A: no reviews, first listing, an honest failure.
  assert.match(
    text,
    /I have no reviews to go on, so I'll try the first listing, Demo Invoice API A/
  )
  assert.match(text, /● reviews pay\(Demo Invoice API A, cap \$0\.10\)/)
  assert.match(
    text,
    /I couldn't complete the task\. Demo Invoice API A returned only 2 of the 4 line items/
  )
  assert.match(
    text,
    /Approved with World ID · written to Hedera as feedback #1/
  )
  // Agent B: checks reviews, avoids A for the reason given, delivers the result.
  assert.match(
    text,
    /● reviews check\(2 endpoints, task invoice-extraction:hi\)/
  )
  assert.match(
    text,
    /Demo Invoice API A: 1 onchain review, average 0\/100 → avoid/
  )
  assert.match(
    text,
    /Demo Invoice API A has failed this exact task for other agents: "Dropped 2 of 4 line items/
  )
  assert.match(text, /I'll use Demo Invoice API B instead/)
  assert.match(
    text,
    /Done\. Here are all 4 line items from INV-2026-0042 \(Sharma Traders, Mumbai\)/
  )
  assert.match(text, /हल्दी पाउडर 200g/)
  assert.match(text, /One paid call, 0\.01 USDC/)
  assert.doesNotMatch(text, /\u001b\[/, "no colour codes unless asked")
})
