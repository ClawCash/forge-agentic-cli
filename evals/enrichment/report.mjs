import { readFileSync } from "node:fs"

// Compares groups from a results file. Confidence intervals come from
// resampling tasks, since runs of one task are not independent.

const file = process.argv[2]
const rows = readFileSync(file, "utf8")
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line))
  .filter((row) => !row.failure)

if (rows.length === 0) {
  console.log("No completed runs in this file.")
  process.exit(0)
}

const NAMES = {
  A: "A: today's search",
  B: "B: generic trust score",
  C: "C: task-level reviews",
  D: "D: shuffled reviews (placebo)",
}
const sum = (list, f) => list.reduce((total, row) => total + f(row), 0)
const mean = (list, f) => (list.length ? sum(list, f) / list.length : 0)

function stats(list) {
  const successes = sum(list, (r) => (r.success ? 1 : 0))
  return {
    runs: list.length,
    success: successes / Math.max(list.length, 1),
    costPerSuccess: successes ? sum(list, (r) => r.usd) / successes : Infinity,
    wasted: mean(list, (r) => r.wasted_calls),
    paid: mean(list, (r) => r.paid_calls),
    tokens: mean(list, (r) => r.tokens),
    seconds: mean(list, (r) => r.ms) / 1000,
  }
}

const tasks = [...new Set(rows.map((r) => r.task))]
const inGroup = (list, group) => list.filter((r) => r.group === group)

console.log(`${rows.length} runs, ${tasks.length} tasks\n`)
console.log(
  "group".padEnd(32),
  "runs".padStart(5),
  "success".padStart(8),
  "$/success".padStart(10),
  "paid".padStart(6),
  "wasted".padStart(7),
  "tokens".padStart(8),
  "sec".padStart(6)
)
const totals = {}
for (const group of Object.keys(NAMES)) {
  const s = (totals[group] = stats(inGroup(rows, group)))
  console.log(
    NAMES[group].padEnd(32),
    String(s.runs).padStart(5),
    `${(s.success * 100).toFixed(0)}%`.padStart(8),
    `$${s.costPerSuccess.toFixed(4)}`.padStart(10),
    s.paid.toFixed(2).padStart(6),
    s.wasted.toFixed(2).padStart(7),
    s.tokens.toFixed(0).padStart(8),
    s.seconds.toFixed(1).padStart(6)
  )
}

function bootstrap(metric, a, b, rounds = 4000) {
  let seed = 12345
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 2 ** 32
  }
  const draws = []
  for (let i = 0; i < rounds; i++) {
    const sample = tasks.flatMap(() => {
      const task = tasks[Math.floor(random() * tasks.length)]
      return rows.filter((r) => r.task === task)
    })
    const x = metric(stats(inGroup(sample, a)))
    const y = metric(stats(inGroup(sample, b)))
    if (Number.isFinite(x) && Number.isFinite(y)) draws.push(x - y)
  }
  draws.sort((p, q) => p - q)
  return [
    draws[Math.floor(draws.length * 0.025)],
    draws[Math.floor(draws.length * 0.975)],
  ]
}

const pct = (from, to) => ((from - to) / from) * 100
const compare = (name, a, b, metric, format) => {
  const [low, high] = bootstrap(metric, a, b)
  console.log(`${name}: ${format(low)} to ${format(high)}`)
}
const money = (v) => `$${v.toFixed(4)}`
const points = (v) => `${(v * 100).toFixed(0)} pts`

console.log("\nDifferences, with 95% intervals (first group minus second):")
for (const other of ["A", "B", "D"]) {
  compare(
    `cost per success, C minus ${other}`,
    "C",
    other,
    (s) => s.costPerSuccess,
    money
  )
  compare(
    `success rate, C minus ${other}`,
    "C",
    other,
    (s) => s.success,
    points
  )
}

const { A, C, D } = totals
const saved = pct(A.costPerSuccess, C.costPerSuccess)
const bar = saved >= 20 && C.success >= A.success
console.log(`\nCost per success, C vs A: ${saved.toFixed(0)}% lower`)
console.log(`Tokens, C vs A: ${pct(A.tokens, C.tokens).toFixed(0)}% lower`)
console.log(`Beats placebo on cost: ${C.costPerSuccess < D.costPerSuccess}`)
console.log(`Pass bar (at least 20% cheaper, no drop in success): ${bar}`)
