import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { extractInvoice } from "../server/src/invoice.ts"

const hindiInvoice = readFileSync(
  new URL("./fixtures/hindi-invoice.txt", import.meta.url),
  "utf8"
)

function sum(items) {
  return items.reduce((total, item) => total + Number(item.amount) * 100, 0)
}

test("the unicode extractor finds every line item and they add up", () => {
  const invoice = extractInvoice(hindiInvoice, "unicode")
  assert.equal(invoice.invoiceNumber, "INV-2026-0042")
  assert.equal(invoice.vendor, "Sharma Traders, Mumbai")
  assert.equal(invoice.currency, "INR")
  assert.equal(invoice.total, "3291.00")
  assert.deepEqual(
    invoice.lineItems.map((item) => item.description),
    ["Basmati rice 5kg", "चाय पत्ती 1kg", "Toor dal 1kg", "हल्दी पाउडर 200g"]
  )
  assert.deepEqual(invoice.lineItems[3], {
    description: "हल्दी पाउडर 200g",
    quantity: 2,
    unitPrice: "85.50",
    amount: "171.00",
  })
  assert.equal(sum(invoice.lineItems), 329100)
})

test("the ascii-only extractor silently drops Hindi items", () => {
  const invoice = extractInvoice(hindiInvoice, "ascii-only")
  assert.deepEqual(
    invoice.lineItems.map((item) => item.description),
    ["Basmati rice 5kg", "Toor dal 1kg"]
  )
  assert.equal(invoice.total, "3291.00")
  assert.notEqual(sum(invoice.lineItems), 329100)
})

test("both extractors agree on an English-only invoice", () => {
  const text =
    "Invoice INV-7\nVendor: Acme\nCurrency: USD\nItems:\nWidget | 3 | 2.5\nTotal: 7.50"
  const a = extractInvoice(text, "ascii-only")
  const b = extractInvoice(text, "unicode")
  assert.deepEqual(a, b)
  assert.equal(a.lineItems[0].amount, "7.50")
  assert.equal(a.total, "7.50")
})

test("missing fields come back as null rather than guesses", () => {
  const invoice = extractInvoice("hello", "unicode")
  assert.deepEqual(invoice, {
    invoiceNumber: null,
    vendor: null,
    currency: null,
    lineItems: [],
    total: null,
  })
})
