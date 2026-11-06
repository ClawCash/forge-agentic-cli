// Line-item extraction for the two demo invoice APIs. Both read the same plain
// text format:
//
//   Invoice INV-2026-0042
//   Vendor: Sharma Traders, Mumbai
//   Currency: INR
//   Items:
//   Basmati rice 5kg | 2 | 650.00
//   चाय पत्ती 1kg | 3 | 420.00
//   Total: 2560.00
//
// API B handles any script. API A has a deliberate, realistic limitation: its
// item pattern only accepts ASCII descriptions, so Hindi (Devanagari) items
// are silently dropped. That is the failure the demo's first agent runs into.

export type ExtractionMode = "ascii-only" | "unicode"

export interface LineItem {
  description: string
  quantity: number
  unitPrice: string
  amount: string
}

export interface ExtractedInvoice {
  invoiceNumber: string | null
  vendor: string | null
  currency: string | null
  lineItems: LineItem[]
  total: string | null
}

const ITEM_PATTERNS: Record<ExtractionMode, RegExp> = {
  "ascii-only": /^([\x20-\x7E]+?)\s*\|\s*(\d+)\s*\|\s*(\d+(?:\.\d{1,2})?)$/,
  unicode: /^(.+?)\s*\|\s*(\d+)\s*\|\s*(\d+(?:\.\d{1,2})?)$/u,
}

// Money is handled in minor units (paise, cents) to avoid float drift.
function toMinor(value: string) {
  const [whole, fraction = ""] = value.split(".")
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"))
}

function fromMinor(minor: number) {
  return `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, "0")}`
}

function field(lines: string[], label: string) {
  const prefix = `${label.toLowerCase()}:`
  const line = lines.find((l) => l.toLowerCase().startsWith(prefix))
  return line ? line.slice(prefix.length).trim() || null : null
}

export function extractInvoice(
  text: string,
  mode: ExtractionMode
): ExtractedInvoice {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const heading = lines.find((l) => /^invoice\s+\S+/i.test(l))
  const itemsStart = lines.findIndex((l) => /^items:$/i.test(l))
  const totalLine = field(lines, "Total")

  const lineItems: LineItem[] = []
  if (itemsStart !== -1) {
    for (const line of lines.slice(itemsStart + 1)) {
      if (/^total:/i.test(line)) break
      const match = ITEM_PATTERNS[mode].exec(line)
      if (!match) continue
      const quantity = Number(match[2])
      const unitPrice = toMinor(match[3])
      lineItems.push({
        description: match[1].trim(),
        quantity,
        unitPrice: fromMinor(unitPrice),
        amount: fromMinor(quantity * unitPrice),
      })
    }
  }

  return {
    invoiceNumber: heading ? heading.split(/\s+/)[1] : null,
    vendor: field(lines, "Vendor"),
    currency: field(lines, "Currency"),
    lineItems,
    total:
      totalLine && /^\d+(\.\d{1,2})?$/.test(totalLine)
        ? fromMinor(toMinor(totalLine))
        : null,
  }
}
