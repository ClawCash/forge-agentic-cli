import type { ApiData, Claim } from "@/lib/merchant"

// A short list of what agents ran into with an API, in plain words, built
// from its reviews, health checks and failure reports. Problems come first.

export type Pointer = { tone: "bad" | "warn" | "good" | "info"; text: string }

const PROBLEM_WORDS: Record<string, string> = {
  incomplete: "Results were incomplete",
  wrong_data: "Returned wrong data",
  malformed: "Response was malformed",
  stale: "Data was out of date",
  unsupported_input: "Rejected input the listing says it takes",
  slow: "Agents found it slow",
}

const of = (count: number, total: number, noun: string) =>
  `${count} of ${total} ${noun}`

export function pointersFor(
  api: ApiData | null,
  failures: NonNullable<Claim["payment_failures"]>
): Pointer[] {
  const reviews = api?.reviews ?? []
  const total = reviews.length
  const out: Pointer[] = []

  for (const endpoint of api?.endpoints ?? []) {
    if (endpoint.health?.status === "down") {
      out.push({
        tone: "bad",
        text: `${endpoint.endpoint} wasn't answering when last checked`,
      })
    }
  }

  if (failures.length > 0) {
    const counts = new Map<string, number>()
    for (const failure of failures) {
      counts.set(failure.endpoint, (counts.get(failure.endpoint) ?? 0) + 1)
    }
    const [worst] = [...counts].sort((a, b) => b[1] - a[1])
    out.push({
      tone: "bad",
      text: `${failures.length} payment${failures.length === 1 ? "" : "s"} failed without a charge, most at ${worst[0]} (reported by agents, not verified)`,
    })
  }

  if (total === 0) {
    out.push({
      tone: "info",
      text: "No reviews yet. Request seeding to get your first ones from real paid calls.",
    })
    return out
  }

  const none = reviews.filter((r) => r.result === "none").length
  const partial = reviews.filter((r) => r.result === "partial").length
  const full = reviews.filter((r) => r.result === "full").length
  if (none)
    out.push({
      tone: "bad",
      text: `Returned nothing in ${of(none, total, "paid calls")}`,
    })
  if (partial)
    out.push({
      tone: "warn",
      text: `Only partly worked in ${of(partial, total, "paid calls")}`,
    })

  const problems = new Map<string, number>()
  for (const review of reviews) {
    for (const problem of review.problems) {
      if (PROBLEM_WORDS[problem])
        problems.set(problem, (problems.get(problem) ?? 0) + 1)
    }
  }
  for (const [problem, count] of [...problems].sort((a, b) => b[1] - a[1])) {
    out.push({
      tone: "warn",
      text: `${PROBLEM_WORDS[problem]} in ${of(count, total, "reviews")}`,
    })
  }

  const offListing = reviews.filter(
    (r) => r.listing && r.listing !== "accurate"
  ).length
  if (offListing) {
    out.push({
      tone: "warn",
      text: `Didn't match its listing in ${of(offListing, total, "reviews")}`,
    })
  }

  const tries = api?.rating.typical_tries
  if (tries && tries > 1)
    out.push({
      tone: "warn",
      text: `Agents usually needed ${tries} tries to get a result`,
    })

  const ms = api?.rating.typical_latency_ms
  if (ms) {
    const seconds =
      ms < 1000 ? "under a second" : `about ${(ms / 1000).toFixed(1)}s`
    out.push({
      tone: ms > 5000 ? "warn" : "info",
      text: `Calls usually take ${seconds}${ms > 5000 ? ", which agents notice" : ""}`,
    })
  }

  if (full > 0) {
    out.push({
      tone: "good",
      text:
        full === total
          ? `Worked in all ${total} paid calls`
          : `Worked in ${of(full, total, "paid calls")}`,
    })
  }
  return out
}
