import type { ExtractionMode } from "./invoice.ts"

// The two controlled demo services. Both advertise the same capability; only
// reviews tell an agent that A misses Hindi line items.
export interface DemoApi {
  id: "a" | "b"
  name: string
  description: string
  path: string
  price: string
  mode: ExtractionMode
}

const DESCRIPTION =
  "Extracts the invoice number, vendor, currency, line items and total from a plain-text invoice. " +
  'POST {"text": "<invoice>"}. Demo service built for ETHGlobal Mumbai.'

export const DEMO_APIS: DemoApi[] = [
  {
    id: "a",
    name: "Demo Invoice API A",
    description: DESCRIPTION,
    path: "/a/invoices/extract",
    price: "$0.01",
    mode: "ascii-only",
  },
  {
    id: "b",
    name: "Demo Invoice API B",
    description: DESCRIPTION,
    path: "/b/invoices/extract",
    price: "$0.01",
    mode: "unicode",
  },
]
