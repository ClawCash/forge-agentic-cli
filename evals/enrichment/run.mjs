import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { promisify } from "node:util"
import { rate, taskPrior } from "../../server/src/v1/rating.ts"
import { passes, sellersFor, TASKS } from "./market.mjs"

// Runs agents on captured responses, in four groups:
//   A: today's search. B: a generic trust score.
//   C: task-level ratings. D: the same ratings, shuffled (placebo).

const exec = promisify(execFile)
const flag = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`)
  return at === -1 ? fallback : process.argv[at + 1]
}
const MODEL = flag("model", "claude-opus-5-5")
const REPEATS = Number(flag("repeats", "3"))
const CONCURRENCY = Number(flag("concurrency", "4"))
const ONLY = flag("tasks", "")
const HERE = new URL(".", import.meta.url).pathname
const OUT = `${HERE}${flag("out", "out")}/`
const snapshot = JSON.parse(readFileSync(`${OUT}snapshot.json`, "utf8"))
const RESULTS = `${OUT}results-${MODEL}.jsonl`
export const GROUPS = ["A", "B", "C", "D"]

const SYSTEM = `You complete a task by buying data from paid APIs.
Call search_apis to see what is available, call_api to buy from one, and finish with your final answer.
Base your answer only on what an API returned. You are spending real money, so avoid unnecessary calls.`

const hash = (text) =>
  createHash("sha256").update(text).digest().readUInt32BE(0)

function shuffled(list, seed) {
  const out = [...list]
  let state = seed || 1
  for (let i = out.length - 1; i > 0; i--) {
    state = (state * 1664525 + 1013904223) >>> 0
    const j = state % (i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

const responseOf = (task, seller) =>
  snapshot.responses[`${task.id}|${seller.url}`]

// What the seed tasks would have produced as reviews, in the production format.
function seedRows(category) {
  const seeds = TASKS.filter(
    (t) => t.phase === "seed" && t.category === category
  )
  return sellersFor(category).flatMap((seller) => {
    const { hostname, pathname } = new URL(seller.url)
    return seeds.flatMap((task, n) => {
      const response = responseOf(task, seller)
      if (!response || response.charged === 0) return []
      const ok = passes(task, response.body, snapshot.references[task.id])
      return [
        {
          domain: hostname,
          path: pathname.replace(/\/+$/, ""),
          task: category,
          language: task.language ?? null,
          format: null,
          result: ok ? "full" : "none",
          listing: ok ? "accurate" : "overstated",
          satisfaction: ok ? "satisfied" : "not_satisfied",
          satisfactionFrom: "agent",
          problems: ok ? [] : ["wrong_data"],
          checked: "against_source",
          tries: 1,
          note: null,
          noteStatus: "none",
          wallet: `seed-${seller.url}-${n}`,
          priceUsd: response.charged,
          paidAt: new Date(snapshot.capturedAt),
          createdAt: new Date(snapshot.capturedAt),
        },
      ]
    })
  })
}

function ratingsFor(task) {
  const rows = seedRows(task.category)
  const prior = taskPrior(rows)
  return sellersFor(task.category).map((seller) => {
    const { hostname, pathname } = new URL(seller.url)
    const path = pathname.replace(/\/+$/, "")
    const r = rate(
      rows.filter((row) => row.domain === hostname),
      {
        domain: hostname,
        path,
        task: task.category,
        language: task.language,
      },
      prior
    )
    return {
      verdict: r.verdict,
      stars: r.stars,
      works_for_task: r.works_for_task,
      satisfied: r.satisfied,
      confidence: r.confidence,
      cost_per_success_usd: r.cost_per_success_usd,
      matched: r.matched,
      buyers: r.buyers,
      top_problem: r.top_problem,
    }
  })
}

// Knows nothing about the task: was it up, did it answer, how fast.
function genericTrust(task) {
  const seeds = TASKS.filter(
    (t) => t.phase === "seed" && t.category === task.category
  )
  return sellersFor(task.category).map((seller) => {
    const responses = seeds.map((t) => responseOf(t, seller)).filter(Boolean)
    const up =
      responses.filter((r) => r.status >= 200 && r.status < 300).length /
      Math.max(responses.length, 1)
    const ms =
      responses.reduce((sum, r) => sum + r.ms, 0) /
      Math.max(responses.length, 1)
    return {
      trust_score: Math.round(up * 80 + Math.max(0, 1 - ms / 30000) * 20),
    }
  })
}

function listingFor(task, group, repeat) {
  const sellers = sellersFor(task.category)
  const ratings = ratingsFor(task)
  const enrich = {
    A: () => sellers.map(() => ({})),
    B: () => genericTrust(task).map((trust) => ({ trust })),
    C: () => ratings.map((reviews) => ({ reviews })),
    D: () =>
      shuffled(ratings, hash(`${task.id}|${repeat}`)).map((reviews) => ({
        reviews,
      })),
  }[group]()
  const items = sellers.map((seller, i) => ({
    url: seller.url,
    price_usd: seller.price_usd,
    description: seller.description,
    ...enrich[i],
  }))
  return shuffled(items, hash(`order|${task.id}|${repeat}`))
}

async function runOne({ task, group, repeat }) {
  const id = `${task.id}-${group}-${repeat}`
  const dir = `${OUT}runs/${MODEL}/${id}/`
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const responses = Object.fromEntries(
    sellersFor(task.category).map((seller) => [
      seller.url,
      responseOf(task, seller),
    ])
  )
  writeFileSync(
    `${dir}run.json`,
    JSON.stringify({ listing: listingFor(task, group, repeat), responses })
  )
  writeFileSync(
    `${dir}mcp.json`,
    JSON.stringify({
      mcpServers: {
        market: {
          command: process.execPath,
          args: [`${HERE}server.mjs`],
          env: {
            MARKET_RUN: `${dir}run.json`,
            MARKET_LOG: `${dir}log.jsonl`,
          },
        },
      },
    })
  )
  const started = Date.now()
  let usage = {}
  let failure = null
  let costUsd = 0
  try {
    const pending = exec(
      "claude",
      [
        "-p",
        task.question,
        "--model",
        MODEL,
        "--output-format",
        "json",
        "--no-session-persistence",
        "--setting-sources",
        "",
        "--strict-mcp-config",
        "--mcp-config",
        `${dir}mcp.json`,
        "--tools",
        "",
        "--allowedTools",
        "mcp__market__search_apis,mcp__market__call_api,mcp__market__finish",
        "--system-prompt",
        SYSTEM,
        "--disable-slash-commands",
        "--max-budget-usd",
        "1",
      ],
      { cwd: dir, timeout: 240_000, maxBuffer: 16 * 1024 * 1024 }
    )
    // The CLI waits on an open stdin before it starts.
    pending.child.stdin.end()
    const { stdout } = await pending
    const parsed = JSON.parse(stdout)
    usage = parsed.usage ?? {}
    costUsd = parsed.total_cost_usd ?? 0
    if (parsed.is_error) failure = String(parsed.result).slice(0, 200)
  } catch (error) {
    // The CLI exits non-zero with its reason as JSON on stdout.
    let reason = error.message
    try {
      reason = JSON.parse(error.stdout).result ?? reason
    } catch {}
    failure = String(reason).slice(0, 200)
  }
  const log = existsSync(`${dir}log.jsonl`)
    ? readFileSync(`${dir}log.jsonl`, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : []
  const calls = log.filter((e) => e.tool === "call_api" && e.known)
  const answer = log.find((e) => e.tool === "finish")?.answer ?? null
  const reference = snapshot.references[task.id]
  const wasted = calls.filter(
    (e) => e.charged > 0 && !passes(task, responses[e.url].body, reference)
  ).length
  return {
    id,
    task: task.id,
    category: task.category,
    group,
    repeat,
    model: MODEL,
    success: answer !== null && passes(task, answer, reference),
    answered: answer !== null,
    usd: calls.reduce((sum, e) => sum + e.charged, 0),
    paid_calls: calls.filter((e) => e.charged > 0).length,
    wasted_calls: wasted,
    first_url: calls[0]?.url ?? null,
    tokens:
      (usage.input_tokens ?? 0) +
      (usage.cache_creation_input_tokens ?? 0) +
      (usage.cache_read_input_tokens ?? 0) +
      (usage.output_tokens ?? 0),
    output_tokens: usage.output_tokens ?? 0,
    model_cost_usd: costUsd,
    ms: Date.now() - started,
    failure,
  }
}

const done = new Set(
  existsSync(RESULTS)
    ? readFileSync(RESULTS, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line).id)
    : []
)
const tests = TASKS.filter(
  (t) => t.phase === "test" && (!ONLY || ONLY.split(",").includes(t.id))
)
const queue = tests
  .flatMap((task) =>
    GROUPS.flatMap((group) =>
      Array.from({ length: REPEATS }, (_, repeat) => ({ task, group, repeat }))
    )
  )
  .filter((job) => !done.has(`${job.task.id}-${job.group}-${job.repeat}`))

console.log(`${queue.length} runs on ${MODEL}`)
let finished = 0
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const result = await runOne(job)
      appendFileSync(RESULTS, `${JSON.stringify(result)}\n`)
      finished += 1
      console.log(
        `${finished} ${result.id} success=${result.success} usd=${result.usd.toFixed(4)} paid=${result.paid_calls} tokens=${result.tokens}${result.failure ? ` FAILED ${result.failure}` : ""}`
      )
    }
  })
)
