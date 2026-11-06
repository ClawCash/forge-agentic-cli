// The demo agent's own check of an invoice extraction: did the service return
// every line item in the source invoice, and do the amounts add up to the
// stated total? This is the agent's judgment, which becomes its review.

export interface InvoiceCheck {
  outcome: "success" | "partial" | "failure"
  expectedItems: number
  returnedItems: number
  missing: string[]
  reason: string
}

interface Extracted {
  lineItems?: { description?: string; amount?: string }[]
  total?: string | null
}

const toMinor = (value: string) => Math.round(Number(value) * 100)
const money = (minor: number) => (minor / 100).toFixed(2)

// Line items in the source text: the lines between "Items:" and "Total:".
export function sourceItems(text: string) {
  const lines = text.split(/\r?\n/).map((line) => line.trim())
  const start = lines.findIndex((line) => /^items:$/i.test(line))
  if (start === -1) return []
  const items: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (/^total:/i.test(line)) break
    const description = line.split("|")[0]?.trim()
    if (description) items.push(description)
  }
  return items
}

export function checkInvoice(source: string, result: unknown): InvoiceCheck {
  const expected = sourceItems(source)
  const extracted = (result ?? {}) as Extracted
  const items = Array.isArray(extracted.lineItems) ? extracted.lineItems : []
  const returned = new Set(items.map((item) => item.description?.trim()))
  const missing = expected.filter((description) => !returned.has(description))
  const sum = items.reduce(
    (total, item) => total + toMinor(item.amount ?? "0"),
    0
  )
  const total = extracted.total ? toMinor(extracted.total) : null
  const sums = total !== null && sum === total
  const base = {
    expectedItems: expected.length,
    returnedItems: items.length,
    missing,
  }

  if (items.length === 0) {
    return { ...base, outcome: "failure", reason: "Returned no line items" }
  }
  if (missing.length > 0) {
    return {
      ...base,
      outcome: "failure",
      reason: `Dropped ${missing.length} of ${expected.length} line items (${missing.join(", ")}); line items sum ${money(sum)} vs stated total ${total === null ? "unknown" : money(total)}`,
    }
  }
  if (!sums) {
    return {
      ...base,
      outcome: "partial",
      reason: `All ${expected.length} line items, but they sum to ${money(sum)} vs stated total ${total === null ? "unknown" : money(total)}`,
    }
  }
  return {
    ...base,
    outcome: "success",
    reason: `All ${expected.length} line items; they sum to ${money(sum)}, matching the stated total`,
  }
}
