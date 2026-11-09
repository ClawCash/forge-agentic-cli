// A scripted demo agent: given the Hindi invoice task, it checks reviews,
// picks a service, pays it over x402 on Hedera, checks the result itself, and
// can leave a review (with a person's World ID approval). With
// --ignore-reviews it skips the check and takes the first listing, which is
// what an agent without reviews would do. It narrates like an agent: what it
// is about to do, each tool call and its result, and the answer at the end.
//
//   npm run demo -- --agent b
//   npm run demo -- --agent a --ignore-reviews
//   npm run demo -- --agent b --review

import { readFileSync } from "node:fs"
import { parseArgs, styleText } from "node:util"
import qrcode from "qrcode-terminal"
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

const DEFAULT_SERVER = "https://reviews-api.forgeintel.co"

export interface DemoOptions {
  agent: string
  task: string
  invoice: string
  server: string
  ignoreReviews: boolean
  review: boolean
  color?: boolean
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

interface ExtractedItem {
  description: string
  quantity: number
  unitPrice: string
  amount: string
}

// Runs one CLI command and returns its exit code and output.
async function cli(args: string[], deps: CliDeps) {
  let stdout = ""
  let stderr = ""
  const code = await run(args, {
    ...deps,
    stdout: (text) => (stdout += text),
    stderr: (text) => (stderr += text),
  })
  return { code, stdout, stderr }
}

// The transcript: agent messages ("●"), tool calls ("● tool(args)") and
// their results ("⎿").
function transcript(say: (line: string) => void, color: boolean) {
  const paint = (format: Parameters<typeof styleText>[0], text: string) =>
    color ? styleText(format, text) : text
  const wrap = (text: string, width = 92) => {
    const lines: string[] = []
    for (const paragraph of text.split("\n")) {
      let line = ""
      for (const word of paragraph.split(" ")) {
        if (line && line.length + word.length + 1 > width) {
          lines.push(line)
          line = word
        } else {
          line = line ? `${line} ${word}` : word
        }
      }
      lines.push(line)
    }
    return lines
  }
  return {
    paint,
    message(text: string) {
      const [first, ...rest] = wrap(text)
      say("")
      say(`${paint("bold", "●")} ${first}`)
      for (const line of rest) say(`  ${line}`)
    },
    tool(name: string, args: string, results: string[]) {
      say("")
      say(
        `${paint("bold", "●")} ${paint("bold", name)}${paint("dim", `(${args})`)}`
      )
      results.forEach((line, i) =>
        say(`  ${paint("dim", i === 0 ? "⎿ " : "  ")} ${line}`)
      )
    },
    plain(line = "") {
      say(line)
    },
  }
}

const nameOf = (endpoint: string) =>
  DEMO_APIS.find((api) => endpoint.endsWith(api.path))?.name ?? endpoint

const money = (value: string) =>
  Number(value).toLocaleString("en-IN", { minimumFractionDigits: 2 })

// "a", "a and b", "a, b and c"
const list = (items: string[]) =>
  items.length < 2
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`

export async function runDemoAgent(
  options: DemoOptions,
  deps: CliDeps,
  say: (line: string) => void
): Promise<DemoResult> {
  const t = transcript(say, options.color ?? false)
  const { paint } = t
  const text = readFileSync(options.invoice, "utf8")
  const items = sourceItems(text)
  const candidates = DEMO_APIS.map((api) => `${options.server}${api.path}`)

  t.plain(
    `${paint("dim", ">")} Extract every line item from this Hindi invoice. ${paint("dim", `(agent ${options.agent.toUpperCase()}, task ${options.task})`)}`
  )

  let chosen = candidates[0]
  if (options.ignoreReviews) {
    t.message(
      `The invoice has ${items.length} line items. Two paid APIs advertise invoice extraction and I have no reviews to go on, so I'll try the first listing, ${nameOf(chosen)}.`
    )
  } else {
    t.message(
      `The invoice has ${items.length} line items. Two paid APIs advertise invoice extraction, so before paying I'll check what other agents experienced with them on this task.`
    )
    const checked = await cli(
      ["check", ...candidates, "--task", options.task, "--output", "json"],
      deps
    )
    if (checked.code !== 0) throw new Error(`check failed: ${checked.stderr}`)
    const report = JSON.parse(checked.stdout) as {
      reports: CheckReport[]
      suggestion: string | null
    }
    const results: string[] = []
    for (const r of report.reports) {
      const name = r.identity.name ?? r.endpoint
      const verdict =
        r.verdict === "recommended"
          ? paint("green", "recommended")
          : r.verdict === "avoid"
            ? paint("red", "avoid")
            : paint("yellow", "unknown")
      const score =
        r.onchain.count === 0
          ? "no reviews yet"
          : `${r.onchain.count} onchain review${r.onchain.count === 1 ? "" : "s"}, average ${r.onchain.average}/100`
      results.push(`${name}: ${score} → ${verdict}`)
      const worst = r.reviews.find(
        (review) => review.trusted && review.outcome !== "success"
      )
      if (worst?.reason) results.push(paint("dim", `  "${worst.reason}"`))
    }
    t.tool(
      "reviews check",
      `${candidates.length} endpoints, task ${options.task}`,
      results
    )

    chosen =
      report.suggestion ??
      candidates.find((_, i) => report.reports[i].verdict !== "avoid") ??
      candidates[0]
    const avoided = report.reports.find(
      (r) => r.verdict === "avoid" && r.endpoint !== chosen
    )
    const pick = report.reports.find((r) => r.endpoint === chosen)
    const reason = avoided?.reviews.find(
      (review) => review.trusted && review.outcome !== "success"
    )?.reason
    t.message(
      avoided
        ? `${nameOf(avoided.endpoint)} has failed this exact task for other agents${reason ? `: "${reason}"` : ""}. I'll use ${nameOf(chosen)} instead${pick?.onchain.count ? ` (${pick.onchain.average}/100 from ${pick.onchain.count} review${pick.onchain.count === 1 ? "" : "s"})` : ""}.`
        : pick?.onchain.count
          ? `${nameOf(chosen)} has a good track record on this task. I'll use it.`
          : `Nobody has reviewed these APIs for this task yet. I'll try ${nameOf(chosen)} and review it afterwards.`
    )
  }

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
  t.tool("reviews pay", `${nameOf(chosen)}, cap $0.10`, [
    `Paid ${interaction.price?.amountUsd ?? "0"} USDC on Hedera testnet · HTTP ${interaction.response.status} · ${seconds}s` +
      (interaction.evidence?.status === "verified"
        ? ` · ${paint("green", "payment verified")}`
        : ""),
    ...(interaction.settlement?.explorerUrl
      ? [paint("dim", interaction.settlement.explorerUrl)]
      : []),
  ])

  const result = JSON.parse(body) as {
    invoiceNumber?: string
    vendor?: string
    currency?: string
    lineItems?: ExtractedItem[]
    total?: string
  }
  const check = checkInvoice(text, result)
  t.tool("check result", `${check.expectedItems} line items expected`, [
    check.outcome === "success"
      ? `${paint("green", `${check.returnedItems} of ${check.expectedItems} line items`)} · they add up to the stated total`
      : `${paint("red", `${check.returnedItems} of ${check.expectedItems} line items`)} · missing: ${list(check.missing)}`,
  ])

  if (check.outcome === "success") {
    const lines = (result.lineItems ?? []).map(
      (item) =>
        `    ${item.description.padEnd(20)} ${String(item.quantity).padStart(2)} × ${money(item.unitPrice).padStart(8)} = ${money(item.amount).padStart(9)}`
    )
    t.message(
      `Done. Here are all ${check.returnedItems} line items from ${result.invoiceNumber ?? "the invoice"}${result.vendor ? ` (${result.vendor})` : ""}:`
    )
    t.plain("")
    for (const line of lines) t.plain(line)
    t.plain(
      `    ${"Total".padEnd(20)} ${"".padStart(15)}${money(result.total ?? "0").padStart(9)} ${result.currency ?? ""}`
    )
    t.plain("")
    t.plain(
      `  One paid call, ${interaction.price?.amountUsd} USDC, and no trial and error.`
    )
  } else {
    t.message(
      `I couldn't complete the task. ${nameOf(chosen)} returned only ${check.returnedItems} of the ${check.expectedItems} line items: it dropped ${list(check.missing)}, so the items add up to ${money(String((result.lineItems ?? []).reduce((sum, item) => sum + Number(item.amount), 0)))} instead of the stated ${money(result.total ?? "0")}. Finishing would take another paid call to a different service.`
    )
  }

  let reviewed = false
  if (options.review) {
    t.message(
      `I'll leave a short review so the next agent knows how ${nameOf(chosen)} did on this task. It only counts once you approve it with World ID. Scan this code:`
    )
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
      {
        ...deps,
        showApproval: async (url) => {
          t.plain("")
          qrcode.generate(url, { small: true }, (qr) => {
            for (const line of qr.split("\n")) t.plain(`  ${line}`)
          })
          t.plain(`  ${paint("dim", url)}`)
          t.plain(`  ${paint("dim", "Waiting for your approval…")}`)
          await deps.showApproval?.(url)
        },
      }
    )
    reviewed = submitted.code === 0
    const feedback = /Feedback: (\S+)/.exec(submitted.stderr)?.[1]
    const index = /Published as feedback #(\d+)/.exec(submitted.stderr)?.[1]
    t.tool(
      "reviews submit",
      `${check.outcome}, ${check.outcome === "success" ? 100 : check.outcome === "partial" ? 50 : 0}/100`,
      reviewed
        ? [
            `${paint("green", "Approved with World ID")} · written to Hedera${index ? ` as feedback #${index}` : ""}`,
            ...(feedback ? [paint("dim", feedback)] : []),
          ]
        : [
            paint(
              "yellow",
              "Not approved: stored as unverified, not written onchain"
            ),
            ...submitted.stderr
              .split("\n")
              .filter((line) => /already|refused|Not approved/.test(line))
              .slice(0, 1)
              .map((line) => paint("dim", line.trim())),
          ]
    )
    if (reviewed) {
      t.message("Review published. The next agent with this task will see it.")
    }
  } else {
    t.plain("")
    t.plain(
      paint(
        "dim",
        `  To review: npm run reviews -- submit ${interaction.id} --task ${options.task} --outcome ${check.outcome} --reason "${check.reason}"`
      )
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
        color: Boolean(process.stdout.isTTY) && !process.env.NO_COLOR,
      },
      deps,
      (line) => console.log(line)
    )
    console.log("")
    process.exitCode = result.check.outcome === "success" ? 0 : 1
  } catch (error) {
    console.error((error as Error).message)
    process.exitCode = 1
  }
}
