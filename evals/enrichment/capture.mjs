import { execFile } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { promisify } from "node:util"
import { passes, referenceFor, sellersFor, TASKS } from "./market.mjs"

// Pays each seller once per task through AgentCash and saves what came back.
// Without --pay it only prints what it would spend.

const run = promisify(execFile)
const flag = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`)
  return at === -1 ? fallback : process.argv[at + 1]
}
const PAY = process.argv.includes("--pay")
const CAP = Number(flag("cap", "0.30"))
const CALL_CAP = 0.01
const OUT = new URL("out/", import.meta.url).pathname
const FILE = `${OUT}snapshot.json`
mkdirSync(OUT, { recursive: true })

const plan = TASKS.flatMap((task) =>
  sellersFor(task.category).map((seller) => ({ task, seller }))
)
const planned = plan.reduce((sum, p) => sum + p.seller.price_usd, 0)
console.log(
  `${plan.length} calls to ${new Set(plan.map((p) => p.seller.url)).size} sellers, about $${planned.toFixed(4)}, capped at $${CAP}`
)
if (!PAY) process.exit(0)

const snapshot = existsSync(FILE)
  ? JSON.parse(readFileSync(FILE, "utf8"))
  : { capturedAt: new Date().toISOString(), references: {}, responses: {} }
const save = () => writeFileSync(FILE, JSON.stringify(snapshot, null, 1))
const spent = () =>
  Object.values(snapshot.responses).reduce((sum, r) => sum + r.charged, 0)

async function pay(request) {
  const started = Date.now()
  const args = [
    "-y",
    "agentcash@latest",
    "fetch",
    request.url,
    "--max-amount",
    String(CALL_CAP),
    "--payment-network",
    "base",
    "--payment-protocol",
    "x402",
    "--timeout",
    "45000",
    "-m",
    request.method,
    ...(request.body
      ? ["-b", request.body, "-H", "Content-Type: application/json"]
      : []),
  ]
  const result = await run("npx", args, {
    maxBuffer: 8 * 1024 * 1024,
    timeout: 90_000,
  }).catch((error) => ({ stdout: error.stdout ?? "", stderr: error.message }))
  return { ...result, ms: Date.now() - started }
}

function parse(result, price) {
  let parsed
  try {
    parsed = JSON.parse(result.stdout)
  } catch {
    return {
      status: 0,
      body: String(result.stdout || result.stderr).slice(0, 2000),
      charged: 0,
    }
  }
  const paid = parsed.metadata?.payment?.success === true
  const failed = parsed.success === false
  return {
    status: failed ? (parsed.error?.statusCode ?? 0) : 200,
    body: failed
      ? JSON.stringify(parsed.error ?? parsed).slice(0, 2000)
      : typeof parsed.data === "string"
        ? parsed.data
        : JSON.stringify(parsed.data),
    charged: paid ? price : 0,
    transaction: parsed.metadata?.payment?.transactionHash,
  }
}

for (const { task, seller } of plan) {
  const key = `${task.id}|${seller.url}`
  if (snapshot.responses[key]) continue
  if (spent() + seller.price_usd > CAP) {
    console.log(`Stopping: the next call would pass the $${CAP} cap`)
    break
  }
  snapshot.references[task.id] ??= await referenceFor(task)
  const result = await pay(seller.request(task.input))
  const response = { ...parse(result, seller.price_usd), ms: result.ms }
  snapshot.responses[key] = response
  save()
  console.log(
    `$${spent().toFixed(4)} ${task.id} ${seller.url.split("/")[2]} status=${response.status} charged=${response.charged} correct=${passes(task, response.body, snapshot.references[task.id])}`
  )
}
console.log(`Done. Spent $${spent().toFixed(4)}`)
