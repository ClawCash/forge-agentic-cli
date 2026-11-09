import assert from "node:assert/strict"
import { test } from "node:test"
import { nextLog } from "../scripts/publish-review-log.mjs"

const entry = (id, fingerprint) => ({
  id,
  domain: "a.example",
  fingerprint,
  created_at: "2026-11-09T10:00:00.000Z",
})
const log = (...entries) =>
  entries.map((item) => JSON.stringify(item)).join("\n")

test("a new review is added to the log", () => {
  const { additions, problems } = nextLog(log(entry("a", "1")), [
    entry("a", "1"),
    entry("b", "2"),
  ])
  assert.deepEqual(additions, [entry("b", "2")])
  assert.deepEqual(problems, [])
})

test("an edited or deleted review fails the check", () => {
  const { additions, problems } = nextLog(
    log(entry("a", "1"), entry("b", "2")),
    [entry("a", "edited")]
  )
  assert.deepEqual(additions, [])
  assert.deepEqual(problems, ["a changed", "b disappeared"])
})

test("a deliberate correction is logged openly, once", () => {
  const corrections = { a: "Removed personal data" }
  const first = nextLog(log(entry("a", "1")), [entry("a", "2")], corrections)
  assert.deepEqual(first.problems, [])
  assert.deepEqual(first.additions, [
    { id: "a", fingerprint: "2", correction: "Removed personal data" },
  ])
  const after = log(entry("a", "1"), first.additions[0])
  assert.deepEqual(nextLog(after, [entry("a", "2")], corrections), {
    additions: [],
    problems: [],
  })
})

test("a corrected deletion stays recorded as deleted", () => {
  const { additions, problems } = nextLog(log(entry("a", "1")), [], {
    a: "Requested by the reviewer",
  })
  assert.deepEqual(problems, [])
  assert.equal(additions[0].fingerprint, null)
})
