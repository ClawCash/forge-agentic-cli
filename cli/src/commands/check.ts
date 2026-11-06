import { parseArgs } from "node:util"
import {
  type EndpointIdentity,
  resolveEndpointIdentity,
} from "../../../shared/src/identity.ts"
import type { CliDeps } from "../deps.ts"
import type { FeedbackEntry } from "../reputation.ts"
import { DEFAULT_SERVER } from "./submit.ts"

export const CHECK_USAGE = `Usage: reviews check <endpoint>... --task <tag> [options]

Shows what earlier agents experienced with each endpoint for this task, before
buying. Identities are resolved through ERC-8004 on Hedera, scores are read
from the reputation registry onchain, and review details come from the reviews
server. With several endpoints, it suggests which one to try.

Options:
  --task <tag>          Task to look up, e.g. invoice-extraction:hi
  --reviewers <list>    Comma-separated reviewer addresses to trust
                        (default: TRUSTED_REVIEWERS; empty means anyone)
  --server <url>        Reviews server (default: REVIEWS_SERVER or the demo server)
  --output json         Print one JSON object
`

interface ServerReview {
  id: string
  outcome: string
  value: number
  reason: string | null
  reviewer: string
  createdAt: string
  status: string
  feedbackIndex: string | null
  feedbackTransaction: string | null
  payment: { transactionId: string; evidence: string | null }
  humanVerified?: boolean
}

export interface EndpointReport {
  endpoint: string
  identity: EndpointIdentity
  onchain: { count: number; average: number | null }
  reviews: (ServerReview & { trusted: boolean; onchain: boolean })[]
  verdict: "recommended" | "unknown" | "avoid"
}

const lower = (value: string) => value.toLowerCase()

function verdictFor(
  onchain: EndpointReport["onchain"]
): EndpointReport["verdict"] {
  if (onchain.count === 0 || onchain.average === null) return "unknown"
  return onchain.average >= 50 ? "recommended" : "avoid"
}

async function reportFor(
  endpoint: string,
  task: string,
  trusted: string[],
  server: string,
  deps: CliDeps
): Promise<EndpointReport> {
  // The CLI resolves the identity itself rather than trusting the server.
  const identity = await resolveEndpointIdentity(endpoint, {
    fetch: deps.fetch,
    registry: deps.reputation.registry as Parameters<
      typeof resolveEndpointIdentity
    >[1]["registry"],
  })
  if (identity.status !== "verified") {
    return {
      endpoint,
      identity,
      onchain: { count: 0, average: null },
      reviews: [],
      verdict: "unknown",
    }
  }

  const [entries, listing] = await Promise.all([
    deps.reputation.readFeedback(BigInt(identity.agentId), trusted, task),
    deps
      .fetch(`${server}/reviews?${new URLSearchParams({ endpoint, task })}`)
      .then((res) => (res.ok ? res.json() : { reviews: [] }))
      .catch(() => ({ reviews: [] })) as Promise<{ reviews: ServerReview[] }>,
  ])
  const live = entries.filter((entry: FeedbackEntry) => !entry.revoked)
  const onchain = {
    count: live.length,
    average: live.length
      ? Math.round(
          live.reduce((sum, entry) => sum + entry.value, 0) / live.length
        )
      : null,
  }
  const onchainKeys = new Set(
    live.map((e) => `${lower(e.client)}#${e.feedbackIndex}`)
  )
  const reviews = (listing.reviews ?? []).map((review) => ({
    ...review,
    trusted: trusted.length === 0 || trusted.includes(lower(review.reviewer)),
    onchain: onchainKeys.has(
      `${lower(review.reviewer)}#${review.feedbackIndex}`
    ),
  }))
  return { endpoint, identity, onchain, reviews, verdict: verdictFor(onchain) }
}

function suggest(reports: EndpointReport[]) {
  const rank = { recommended: 0, unknown: 1, avoid: 2 }
  const sorted = [...reports].sort(
    (a, b) =>
      rank[a.verdict] - rank[b.verdict] ||
      (b.onchain.average ?? 0) - (a.onchain.average ?? 0)
  )
  return sorted[0]?.verdict === "avoid" ? null : (sorted[0] ?? null)
}

function render(report: EndpointReport, task: string) {
  const lines: string[] = []
  const name =
    report.identity.status === "verified"
      ? `${report.identity.name ?? "Unnamed service"} (agent ${report.identity.agentId}, verified)`
      : `identity unknown: ${report.identity.reason}`
  lines.push(`${report.endpoint}\n  ${name}`)
  if (report.onchain.count === 0) {
    lines.push(`  ${task}: no reviews yet (unknown)`)
  } else {
    lines.push(
      `  ${task}: ${report.onchain.count} onchain review${report.onchain.count === 1 ? "" : "s"}, average ${report.onchain.average}/100 → ${report.verdict}`
    )
  }
  for (const review of report.reviews.filter((r) => r.trusted)) {
    const mark =
      review.outcome === "success"
        ? "✓"
        : review.outcome === "partial"
          ? "~"
          : "✗"
    const proof = [
      review.payment.evidence ? "paid (verified)" : "payment unverified",
      review.humanVerified ? "human-approved (World ID)" : "no human approval",
      review.onchain ? `onchain #${review.feedbackIndex}` : review.status,
    ].join(", ")
    lines.push(
      `    ${mark} ${review.outcome}: ${review.reason ?? ""}\n      by ${review.reviewer} on ${review.createdAt.slice(0, 10)}, ${proof}`
    )
  }
  return lines.join("\n")
}

export async function runCheck(argv: string[], deps: CliDeps): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      task: { type: "string" },
      reviewers: { type: "string" },
      server: { type: "string" },
      output: { type: "string" },
    },
  })
  if (positionals.length === 0 || !values.task) {
    deps.stderr(CHECK_USAGE)
    return 1
  }
  const trusted = (values.reviewers ?? deps.env.TRUSTED_REVIEWERS ?? "")
    .split(",")
    .map((address) => lower(address.trim()))
    .filter(Boolean)
  if (trusted.some((address) => !/^0x[0-9a-f]{40}$/.test(address))) {
    throw new Error("--reviewers must be comma-separated 0x addresses")
  }
  const server = (
    values.server ??
    deps.env.REVIEWS_SERVER ??
    DEFAULT_SERVER
  ).replace(/\/$/, "")
  const reports = await Promise.all(
    positionals.map((endpoint) =>
      reportFor(endpoint, values.task!, trusted, server, deps)
    )
  )
  const suggestion = reports.length > 1 ? suggest(reports) : null

  if (values.output === "json") {
    deps.stdout(
      `${JSON.stringify({ task: values.task, trustedReviewers: trusted, reports, suggestion: suggestion?.endpoint ?? null }, null, 2)}\n`
    )
    return 0
  }
  const who = trusted.length
    ? `${trusted.length} trusted reviewer(s)`
    : "any reviewer"
  deps.stdout(`Reviews for ${values.task} (counting ${who})\n\n`)
  deps.stdout(`${reports.map((r) => render(r, values.task!)).join("\n\n")}\n`)
  if (reports.length > 1) {
    deps.stdout(
      suggestion
        ? `\nSuggested: ${suggestion.endpoint} (${suggestion.verdict})\n`
        : "\nNo endpoint is recommended for this task.\n"
    )
  }
  return 0
}
