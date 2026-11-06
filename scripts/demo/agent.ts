// A scripted demo agent: given the Hindi invoice task, it checks reviews,
// picks a service, pays it over x402 on Hedera, checks the result itself, and
// can leave a review (with a person's World ID approval). With
// --ignore-reviews it skips the check and takes the first listing, which is
// what an agent without reviews would do.
//
//   npm run demo -- --agent b
//   npm run demo -- --agent a --ignore-reviews
//   npm run demo -- --agent b --review

import { readFileSync } from "node:fs"
import { parseArgs } from "node:util"
import { run } from "../../cli/src/index.ts"
import type { CliDeps } from "../../cli/src/deps.ts"
import { hederaReputation } from "../../cli/src/reputation.ts"
import type { Interaction } from "../../cli/src/interactions.ts"
import { DEMO_APIS } from "../../server/src/demo-apis.ts"
import {
  checkInvoice,
  type InvoiceCheck,
  sourceItems,
} from "./check-invoice.ts"

const DEFAULT_SERVER = "https://forge-agentic-cli-production.up.railway.app"

export interface DemoOptions {
  agent: string
  task: string
  invoice: string
  server: string
  ignoreReviews: boolean
  review: boolean
}

export interface DemoResult {
  chosen: string
  usedReviews: boolean
  interaction: Interaction
  check: InvoiceCheck
  reviewed: boolean
}

interface CheckReport {
  endpoint: string
  identity: { status: string; name?: string | null; agentId?: string }
  onchain: { count: number; average: number | null }
  reviews: { outcome: string; reason: string | null; trusted: boolean }[]
  verdict: string
}

// Runs one CLI command and returns its exit code and output.
async function cli(args: string[], deps: CliDeps, { passStderr = false } = {}) {
  let stdout = ""
  let stderr = ""
  const code = await run(args, {
    ...deps,
    stdout: (text) => (stdout += text),
    stderr: passStderr ? deps.stderr : (text) => (stderr += text),
  })
  return { code, stdout, stderr }
}

export async function runDemoAgent(
  options: DemoOptions,
  deps: CliDeps,
  say: (line: string) => void
): Promise<DemoResult> {
  const text = readFileSync(options.invoice, "utf8")
  const items = sourceItems(text)
  const candidates = DEMO_APIS.map((api) => `${options.server}${api.path}`)
  const step = (n: number, title: string) => say(`\n${n}. ${title}`)

  say(
    `Agent ${options.agent.toUpperCase()}: "Extract every line item from this Hindi invoice."`
  )
  say(`   The invoice has ${items.length} line items.`)

  step(
    1,
    options.ignoreReviews
      ? "Choose a service (no reviews)"
      : "Check reviews before buying"
  )
  let chosen = candidates[0]
  if (options.ignoreReviews) {
    say(
      `   Both services advertise invoice extraction. Taking the first listing.`
    )
  } else {
    const checked = await cli(
      ["check", ...candidates, "--task", options.task, "--output", "json"],
      deps
    )
    if (checked.code !== 0) throw new Error(`check failed: ${checked.stderr}`)
    const report = JSON.parse(checked.stdout) as {
      reports: CheckReport[]
      suggestion: string | null
    }
    for (const r of report.reports) {
      const name = r.identity.name ?? r.endpoint
      const score =
        r.onchain.count === 0
          ? "no reviews yet"
          : `${r.onchain.count} onchain review(s), average ${r.onchain.average}/100`
      say(`   ${name}: ${score} → ${r.verdict}`)
      const worst = r.reviews.find(
        (review) => review.trusted && review.outcome !== "success"
      )
      if (worst?.reason) say(`     "${worst.reason}"`)
    }
    chosen =
      report.suggestion ??
      candidates.find((c, i) => report.reports[i].verdict !== "avoid") ??
      candidates[0]
  }
  const chosenName =
    DEMO_APIS.find((api) => chosen.endsWith(api.path))?.name ?? chosen
  say(`   Chose ${chosenName}.`)

  step(2, `Pay ${chosenName} over x402 on Hedera`)
  const paid = await cli(
    [
      "pay",
      chosen,
      "--agent",
      options.agent,
      "--json",
      JSON.stringify({ text }),
      "--output",
      "json",
    ],
    deps
  )
  if (!paid.stdout) throw new Error(`pay failed: ${paid.stderr}`)
  const { interaction, body } = JSON.parse(paid.stdout) as {
    interaction: Interaction
    body: string
  }
  const seconds = (interaction.timings.totalMs / 1000).toFixed(2)
  say(
    `   Paid $${interaction.price?.amountUsd ?? "0"} USDC, HTTP ${interaction.response.status} in ${seconds}s` +
      (interaction.evidence?.status === "verified" ? " (payment verified)" : "")
  )
  if (interaction.settlement?.explorerUrl)
    say(`   ${interaction.settlement.explorerUrl}`)

  step(3, "Check the result")
  const check = checkInvoice(text, JSON.parse(body))
  say(
    `   ${check.returnedItems} of ${check.expectedItems} line items → ${check.outcome}`
  )
  say(`   ${check.reason}`)

  let reviewed = false
  if (options.review) {
    step(4, "Leave a review (a person approves with World ID)")
    const submitted = await cli(
      [
        "submit",
        interaction.id,
        "--task",
        options.task,
        "--outcome",
        check.outcome,
        "--reason",
        check.reason,
      ],
      deps,
      { passStderr: true }
    )
    reviewed = submitted.code === 0
  }

  say("")
  say(
    check.outcome === "success"
      ? `Done: task completed with 1 paid call ($${interaction.price?.amountUsd}).`
      : `Not done: ${chosenName} could not complete the task; another paid call is needed.`
  )
  if (!options.review) {
    say(
      `Review it: npm run reviews -- submit ${interaction.id} --task ${options.task} --outcome ${check.outcome} --reason "${check.reason}"`
    )
  }
  return {
    chosen,
    usedReviews: !options.ignoreReviews,
    interaction,
    check,
    reviewed,
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({
    options: {
      agent: { type: "string", default: "b" },
      task: { type: "string", default: "invoice-extraction:hi" },
      invoice: { type: "string", default: "tests/fixtures/hindi-invoice.txt" },
      server: { type: "string" },
      "ignore-reviews": { type: "boolean", default: false },
      review: { type: "boolean", default: false },
    },
  })
  const server = (
    values.server ??
    process.env.REVIEWS_SERVER ??
    DEFAULT_SERVER
  ).replace(/\/$/, "")
  const deps: CliDeps = {
    fetch,
    env: { ...process.env, REVIEWS_SERVER: server },
    stdout: (t) => process.stdout.write(t),
    stderr: (t) => process.stderr.write(t),
    reputation: hederaReputation(),
  }
  try {
    const result = await runDemoAgent(
      {
        agent: values.agent!,
        task: values.task!,
        invoice: values.invoice!,
        server,
        ignoreReviews: values["ignore-reviews"]!,
        review: values.review!,
      },
      deps,
      (line) => console.log(line)
    )
    process.exitCode = result.check.outcome === "success" ? 0 : 1
  } catch (error) {
    console.error((error as Error).message)
    process.exitCode = 1
  }
}
