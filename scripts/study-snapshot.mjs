// Builds the data behind 402reviews.xyz/research/x402-mpp-api-reliability from
// the public API: every review of every reviewed API, with what was paid,
// promised and delivered. Run it, then commit the snapshot it writes.
//
//   node scripts/study-snapshot.mjs
import { mkdirSync, writeFileSync } from "node:fs"

const API = process.env.API_URL ?? "https://api.402reviews.xyz"
const SLUG = "x402-mpp-api-reliability"
const headers = { "X-Client-Id": "402reviews-site" }
const get = async (path) => {
  const res = await fetch(`${API}${path}`, { headers })
  if (!res.ok) throw new Error(`${path}: ${res.status}`)
  return res.json()
}

const domains = (await get("/v1/domains")).domains.filter((d) => d.reviewed).map((d) => d.domain)
const services = []
for (let i = 0; i < domains.length; i += 8) {
  services.push(
    ...(await Promise.all(domains.slice(i, i + 8).map((d) => get(`/v1/services/${encodeURIComponent(d)}?limit=100`))))
  )
}

const latency = new Map()
for (const s of services) {
  for (const e of s.endpoints ?? []) latency.set(`${s.domain}${e.endpoint}`, e.typical_latency_ms ?? null)
}
const reviews = services.flatMap((s) =>
  (s.reviews ?? []).map((r) => ({ ...r, latency_ms: latency.get(`${s.domain}${r.endpoint}`) ?? null }))
)

const refunded = (r) => /refund/i.test(`${r.delivered ?? ""} ${r.note ?? ""}`)
const keptNothing = (r) => r.result === "none" && !refunded(r)
const fellShort = (r) => (r.result === "none" || r.result === "partial") && !refunded(r)
const overpromised = (r) => r.listing === "overstated" || r.listing === "misleading"
const kindOf = (r) => {
  const text = (r.delivered ?? "").toLowerCase()
  if (text.includes("rejected")) return "Rejected the request after taking payment"
  if (text.includes("202") || text.includes("processing")) return "Promised a result later, with no way to collect it"
  if (/empty|no match|found: false|no data/.test(text)) return "Came back empty"
  return "Answered with something unusable"
}
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null
}
const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d
const unique = (xs) => [...new Set(xs)]
const apisWhere = (test) => unique(reviews.filter(test).map((r) => r.domain))

const TASK_LABELS = {
  "web-search": "Web search", news: "News", "web-scrape": "Scraping", "token-price": "Token prices",
  enrichment: "Enrichment", "document-extract": "Documents", "image-generation": "Images",
  transcription: "Transcription", translation: "Translation", weather: "Weather", email: "Email",
  "financial-data": "Financial data", other: "Other",
}
const byTask = new Map()
for (const r of reviews) {
  const t = r.task ?? "other"
  const row = byTask.get(t) ?? { task: t, label: TASK_LABELS[t] ?? t, calls: 0, fell_short: 0 }
  row.calls += 1
  if (fellShort(r)) row.fell_short += 1
  byTask.set(t, row)
}

const ok = reviews.filter((r) => r.result === "full" && r.latency_ms).map((r) => r.latency_ms)
const bad = reviews.filter((r) => fellShort(r) && r.latency_ms).map((r) => r.latency_ms * (r.tries ?? 1))
const paidAt = reviews.map((r) => r.paid_at).filter(Boolean).sort()
const kept = reviews.filter(keptNothing)
const failedApis = apisWhere(keptNothing)
const shortApis = apisWhere(overpromised)

const snapshot = {
  slug: SLUG,
  generated_at: new Date().toISOString(),
  period: { from: paidAt[0], to: paidAt.at(-1) },
  totals: {
    calls: reviews.length,
    apis: services.length,
    verified_payments: reviews.filter((r) => r.verified_payment).length,
    our_calls: reviews.filter((r) => r.seeded).length,
    our_apis: unique(reviews.filter((r) => r.seeded).map((r) => r.domain)).length,
    outside_calls: reviews.filter((r) => !r.seeded).length,
    outside_apis: unique(reviews.filter((r) => !r.seeded).map((r) => r.domain)).length,
    spent_usd: round(reviews.reduce((sum, r) => sum + (r.price_usd ?? 0), 0), 2),
  },
  outcomes: {
    worked: reviews.filter((r) => r.result === "full").length,
    partly: reviews.filter((r) => r.result === "partial").length,
    kept_payment_nothing_usable: kept.length,
    refunded: reviews.filter(refunded).length,
    not_checked: reviews.filter((r) => r.result === "not_checked").length,
  },
  failed_after_payment: {
    apis: failedApis.length,
    kinds: Object.entries(
      kept.reduce((acc, r) => ({ ...acc, [kindOf(r)]: (acc[kindOf(r)] ?? 0) + 1 }), {})
    ).sort((a, b) => b[1] - a[1]).map(([kind, calls]) => ({ kind, calls })),
    lost_usd: round(kept.reduce((sum, r) => sum + (r.price_usd ?? 0), 0), 2),
  },
  overpromised: { apis: shortApis.length, calls: reviews.filter(overpromised).length },
  // One mark per API: kept the money and returned nothing, else delivered
  // less than promised, else fine.
  api_marks: services.map((s) =>
    failedApis.includes(s.domain) ? "failed" : shortApis.includes(s.domain) ? "short" : "fine"
  ).sort((a, b) => ["failed", "short", "fine"].indexOf(a) - ["failed", "short", "fine"].indexOf(b)),
  categories: [...byTask.values()]
    .filter((row) => row.task !== "other" && row.calls >= 4)
    .map((row) => ({ ...row, share: round(row.fell_short / row.calls, 2) }))
    .sort((a, b) => b.share - a.share || b.calls - a.calls),
  time: {
    working_median_s: round(median(ok) / 1000),
    working_n: ok.length,
    failed_median_s: round(median(bad) / 1000),
    failed_n: bad.length,
    timed_calls: reviews.filter((r) => r.latency_ms).length,
  },
  cases: kept.map((r) => ({
    api: `${r.domain}${r.endpoint}`,
    task: TASK_LABELS[r.task] ?? r.task,
    kind: kindOf(r),
    promised: r.promised,
    delivered: r.delivered,
    price_usd: r.price_usd,
    paid_at: r.paid_at,
    transaction_url: r.transaction_url,
  })).sort((a, b) => a.kind.localeCompare(b.kind)),
  refunds: reviews.filter(refunded).map((r) => ({
    api: `${r.domain}${r.endpoint}`,
    delivered: r.delivered,
    transaction_url: r.transaction_url,
  })),
  overpromise_examples: reviews.filter(overpromised).slice(0, 8).map((r) => ({
    api: `${r.domain}${r.endpoint}`,
    promised: r.promised,
    delivered: r.delivered,
  })),
}

const json = `${JSON.stringify(snapshot, null, 2)}\n`
mkdirSync(new URL("../app/data/", import.meta.url), { recursive: true })
mkdirSync(new URL("../app/public/research/", import.meta.url), { recursive: true })
writeFileSync(new URL(`../app/data/${SLUG}.json`, import.meta.url), json)
writeFileSync(new URL(`../app/public/research/${SLUG}.json`, import.meta.url), json)
console.log(
  `${snapshot.totals.calls} calls, ${snapshot.totals.apis} APIs, ${snapshot.failed_after_payment.apis} failed after payment, ${snapshot.overpromised.apis} overpromised`
)
