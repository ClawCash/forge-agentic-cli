#!/usr/bin/env node
// Adds new review fingerprints to the public log, and fails if a review that
// was already published has since changed or disappeared.
//
// Each log entry is a tag on its own commit history, away from the code, so it
// triggers no deploys. Each commit builds on the one before, so rewriting an
// old entry would change every later commit.

import { execFile } from "node:child_process"
import { readFileSync } from "node:fs"
import { realpathSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { promisify } from "node:util"
import { readLog } from "../app/public/verify-review.mjs"

const API = process.env.REVIEWS_API ?? "https://reviews-api.forgeintel.co"
const TAG_PREFIX = "review-log-"
const LOG_FILE = "reviews.jsonl"
const CORRECTIONS = new URL("./review-log-corrections.json", import.meta.url)

// `corrections` names reviews that were changed on purpose, with the reason.
// Those are logged openly as corrections instead of failing the check.
export function nextLog(previous, current, corrections = {}) {
  const logged = readLog(previous)
  const now = new Map(current.map((review) => [review.id, review]))
  const additions = []
  const problems = []
  for (const [id, entry] of logged) {
    const fingerprint = now.get(id)?.fingerprint ?? null
    if (fingerprint === entry.fingerprint) continue
    if (corrections[id]) {
      additions.push({ id, fingerprint, correction: corrections[id] })
    } else {
      problems.push(`${id} ${now.has(id) ? "changed" : "disappeared"}`)
    }
  }
  for (const review of current) {
    if (logged.has(review.id)) continue
    const { id, domain, fingerprint, created_at } = review
    additions.push({ id, domain, fingerprint, created_at })
  }
  return { additions, problems }
}

async function git(args, input) {
  const child = promisify(execFile)("git", args, { maxBuffer: 64_000_000 })
  if (input !== undefined) child.child.stdin.end(input)
  return (await child).stdout.trim()
}

async function main() {
  const res = await fetch(`${API}/v1/fingerprints`, {
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(`The API returned ${res.status}`)
  const { reviews } = await res.json()
  const tags = await git(["tag", "--list", `${TAG_PREFIX}*`])
  const latest = tags.split("\n").filter(Boolean).sort().at(-1)
  const previous = latest ? await git(["show", `${latest}:${LOG_FILE}`]) : ""
  const corrections = JSON.parse(readFileSync(CORRECTIONS, "utf8"))
  const { additions, problems } = nextLog(previous, reviews, corrections)
  for (const problem of problems) console.log(`FAIL  ${problem}`)
  console.log(`${additions.length} new entries, ${problems.length} problems`)
  if (problems.length > 0) process.exitCode = 1
  if (additions.length === 0) return

  const lines = additions.map((entry) => JSON.stringify(entry)).join("\n")
  const content = `${previous ? `${previous}\n` : ""}${lines}\n`
  const blob = await git(["hash-object", "-w", "--stdin"], content)
  const tree = await git(["mktree"], `100644 blob ${blob}\t${LOG_FILE}\n`)
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")
  const tag = `${TAG_PREFIX}${stamp}`
  const parent = latest ? ["-p", latest] : []
  const commit = await git(["commit-tree", tree, ...parent, "-m", tag])
  await git(["tag", tag, commit])
  await git(["push", "origin", `refs/tags/${tag}`])
  console.log(`Published ${tag}`)
}

const isScript =
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href

if (isScript) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
