#!/usr/bin/env node
// Checks that an API's reviews haven't changed since they were first published.
//
// Usage: node verify-review.mjs stableenrich.dev
//
// It recomputes each review's fingerprint from what the API serves today, and
// compares it with the public log, a git history where every entry locks in
// the ones before it.

import { createHash } from "node:crypto"
import { realpathSync } from "node:fs"
import { pathToFileURL } from "node:url"

const API = "https://reviews-api.forgeintel.co"
const REPOSITORY = "ClawCash/forge-agentic-cli"
const LOG_TAGS = "review-log-"

// Every public field of a review that isn't worked out from the others.
const AUDITED_FIELDS = [
  "id",
  "domain",
  "endpoint",
  "task",
  "language",
  "format",
  "result",
  "listing",
  "satisfaction",
  "satisfaction_from",
  "problems",
  "checked",
  "pay_again",
  "tries",
  "note",
  "task_description",
  "promised",
  "delivered",
  "advertised_fields",
  "proof_method",
  "network",
  "price_usd",
  "wallet",
  "transaction",
  "output",
  "paid_at",
  "created_at",
]

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])])
    )
  }
  return value ?? null
}

export function fingerprintOf(review) {
  const record = Object.fromEntries(
    AUDITED_FIELDS.map((field) => [field, review[field]])
  )
  if (review.seeded) record.seeded = true
  const hash = createHash("sha256").update(JSON.stringify(canonical(record)))
  return `sha256:${hash.digest("hex")}`
}

// The latest fingerprint published for each review.
export function readLog(text) {
  const logged = new Map()
  for (const line of text.split("\n")) {
    if (!line.trim()) continue
    const entry = JSON.parse(line)
    logged.set(entry.id, entry)
  }
  return logged
}

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw new Error(`${url} returned ${res.status}`)
  return res.json()
}

async function latestLog() {
  const names = []
  for (let page = 1; ; page++) {
    const refs = await getJson(
      `https://api.github.com/repos/${REPOSITORY}/git/matching-refs/tags/${LOG_TAGS}?per_page=100&page=${page}`
    )
    names.push(...refs.map((ref) => ref.ref.replace("refs/tags/", "")))
    if (refs.length < 100) break
  }
  const latest = names.sort().at(-1)
  if (!latest) throw new Error("No published log was found")
  const res = await fetch(
    `https://raw.githubusercontent.com/${REPOSITORY}/${latest}/reviews.jsonl`,
    { signal: AbortSignal.timeout(20_000) }
  )
  if (!res.ok) throw new Error(`The log ${latest} returned ${res.status}`)
  return { latest, logged: readLog(await res.text()) }
}

async function main() {
  const domain = process.argv[2]
  if (!domain) {
    console.log("Usage: node verify-review.mjs <domain>")
    process.exitCode = 2
    return
  }
  const { latest, logged } = await latestLog()
  const { reviews } = await getJson(
    `${API}/v1/services/${encodeURIComponent(domain)}?limit=100`
  )
  console.log(`Comparing ${reviews.length} reviews with ${latest}`)
  let changed = 0
  for (const review of reviews) {
    const served = fingerprintOf(review)
    const entry = logged.get(review.id)
    const status =
      served !== review.fingerprint
        ? "CHANGED: the fingerprint doesn't match its own content"
        : !entry
          ? "not logged yet: newer than the last published log"
          : entry.fingerprint !== served
            ? "CHANGED since it was published"
            : `ok${entry.correction ? ` (corrected: ${entry.correction})` : ""}`
    if (status.startsWith("CHANGED")) changed += 1
    console.log(`${review.id}  ${status}`)
  }
  process.exitCode = changed > 0 ? 1 : 0
}

const isScript =
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href

if (isScript) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 2
  })
}
