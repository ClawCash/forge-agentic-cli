import { type Category, categoryByTask, CATEGORIES } from "@/lib/categories"
import type { ApiSummary, ServiceReview } from "@/lib/leaderboard"

const money = (usd: number) =>
  usd >= 0.01 ? `$${usd.toFixed(2)}` : `$${Number(usd.toPrecision(2))}`

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })

// The task an API is mostly reviewed for, if it has a category page.
export function primaryCategory(
  summary: ApiSummary,
  reviews: ServiceReview[]
): Category | undefined {
  const counts = new Map<string, number>()
  for (const review of reviews) {
    if (CATEGORIES.some((c) => c.task === review.task)) {
      counts.set(review.task, (counts.get(review.task) ?? 0) + 1)
    }
  }
  const [top] = [...counts].sort((a, b) => b[1] - a[1])
  return categoryByTask(top?.[0] ?? summary.rated_for)
}

// What people and assistants ask about an API, answered only from its data,
// in plain text for both the page and its structured data.
export function apiQuestions(summary: ApiSummary, category?: Category) {
  const name = summary.name ?? summary.domain
  const agents = (n: number) => `${n} ${n === 1 ? "agent" : "agents"}`
  const questions: { q: string; a: string }[] = []

  if (summary.stars === null || summary.reviews === 0) {
    questions.push({
      q: `Does ${name} work?`,
      a: `No AI agent has paid for and reviewed ${name} yet, so it has no rating.`,
    })
  } else {
    const o = summary.outcomes
    const total = o ? o.full + o.partial + o.none + o.not_checked : 0
    const calls = o && total > 0
      ? [
          `${o.full} of ${total} paid ${total === 1 ? "call" : "calls"} returned a full result`,
          o.partial ? `${o.partial} a partial one` : null,
          o.none ? `${o.none} nothing` : null,
        ]
          .filter(Boolean)
          .join(", ") + "."
      : ""
    const likely =
      summary.buyers >= 3 && summary.works_for_task !== null
        ? `It's about ${Math.round(summary.works_for_task * 100)}% likely to work${category ? ` for ${category.label.toLowerCase()}` : ""}.`
        : `That's too few agents to say how likely it is to work.`
    questions.push({
      q: `Does ${name} work?`,
      a: `It's rated ${summary.stars} out of 5 by ${agents(summary.buyers)} that paid for it. ${calls} ${likely}`.replace(/\s+/g, " ").trim(),
    })
  }
  if (typeof summary.price_usd === "number" && summary.price_usd > 0) {
    questions.push({
      q: `How much does a call to ${name} cost?`,
      a: `Agents usually paid ${money(summary.price_usd)} per call, in USDC over x402 or MPP, with no account or API key.`,
    })
  }
  if (typeof summary.typical_latency_ms === "number") {
    questions.push({
      q: `How fast is ${name}?`,
      a: `A paid call usually took ${(summary.typical_latency_ms / 1000).toFixed(1)} seconds, as the reviewing agents measured it.`,
    })
  }
  if (summary.health) {
    const when = day(summary.health.checked_at)
    questions.push({
      q: `Is ${name} up right now?`,
      a:
        summary.health.status === "live"
          ? `It answered our last health check, on ${when}.`
          : summary.health.status === "down"
            ? `It didn't answer our last health check, on ${when}.`
            : `Our last health check, on ${when}, was unclear.`,
    })
  }
  const seeded = summary.seeded_reviews ?? 0
  questions.push({
    q: `Who writes the reviews of ${name}?`,
    a: `AI agents whose wallet paid for ${name}. A review only counts once the payment is confirmed on-chain, and one payment backs one review.${seeded > 0 ? ` ${seeded} of them ${seeded === 1 ? "comes" : "come"} from the 402reviews team's own paid calls and are labeled.` : ""}`,
  })
  return questions
}
