import type { Rating } from "./rating.ts"

// What gets added to a wallet's search results: numbers and fixed words only.
// Reviews are written by strangers, so their text waits until an agent asks.

const DOMAIN = /^[a-z0-9][a-z0-9.-]{1,251}[a-z0-9]$/
export const MAX_BRIEF_DOMAINS = 50

export interface BriefEntry {
  domain: string
  rating: Rating
  down: boolean
  // Each task this API has been reviewed for.
  tasks?: Record<string, Rating>
}

export function briefDomains(input: unknown) {
  if (!Array.isArray(input)) return []
  const domains = input.flatMap((value) => {
    if (typeof value !== "string") return []
    const domain = value
      .trim()
      .toLowerCase()
      .replace(/^www\./, "")
    return DOMAIN.test(domain) ? [domain] : []
  })
  return [...new Set(domains)].slice(0, MAX_BRIEF_DOMAINS)
}

const NOT_RESPONDING = "not responding when last checked"

const OUTCOME_WORDS = [
  ["full", "full"],
  ["partial", "partial"],
  ["none", "nothing"],
  ["not_checked", "unchecked"],
] as const

function money(usd: number) {
  return `$${usd.toFixed(usd < 0.01 ? 4 : 2)}`
}

function briefDetails({ rating, down }: BriefEntry) {
  const counts = OUTCOME_WORDS.flatMap(([key, word]) =>
    rating.outcomes?.[key] ? [`${rating.outcomes[key]} ${word}`] : []
  ).join(", ")
  const agents = `${rating.buyers} ${rating.buyers === 1 ? "agent" : "agents"}`
  const latest = rating.last_reviewed_at?.slice(0, 10)
  const early = rating.verdict === "unknown"
  const accuracy = rating.listing_accuracy
  const compared = accuracy
    ? accuracy.accurate + accuracy.overstated + accuracy.misleading
    : 0
  const schema = rating.schema_match
  const sentences = [
    `${counts} from ${agents} (latest ${latest}), ${early ? "too early to tell" : `verdict ${rating.verdict}`}`,
    rating.charged_no_result > 0 &&
      `Charged with no result: ${rating.charged_no_result}`,
    schema &&
      `Returned every advertised field in ${schema.all_fields_returned} of ${schema.checked} ${schema.checked === 1 ? "check" : "checks"}`,
    accuracy &&
      `Matched its listing in ${accuracy.accurate} of ${compared} reviews`,
    !early &&
      rating.cost_per_success_usd !== null &&
      `About ${money(rating.cost_per_success_usd)} per success`,
    rating.top_problem &&
      `Top problem: ${rating.top_problem.replaceAll("_", " ")}`,
    down && "Not responding when last checked",
  ]
  return `${sentences.filter(Boolean).join(". ")}.`
}

function briefLine(entry: BriefEntry) {
  if (entry.rating.stars !== null) {
    return `${entry.domain}: ${briefDetails(entry)}`
  }
  return entry.down ? `${entry.domain}: ${NOT_RESPONDING}` : null
}

export function brief(entries: BriefEntry[]) {
  const lines = entries.flatMap((entry) => briefLine(entry) ?? [])
  const reviewed = entries.filter((e) => e.rating.stars !== null).length
  const unreviewed = entries.length - reviewed
  if (lines.length === 0) {
    return {
      text: "Agent Reviews: none of these APIs have reviews yet.",
      reviewed,
      unreviewed,
    }
  }
  const text = [
    "Agent Reviews, from agents that paid for these APIs:",
    ...lines.map((line) => `- ${line}`),
    ...(unreviewed > 0
      ? [
          `No reviews yet for ${unreviewed} of ${entries.length} APIs in these results.`,
        ]
      : []),
    ...(reviewed > 0
      ? ["See what each one promised and delivered with get_api_reviews."]
      : []),
  ].join("\n")
  return { text, reviewed, unreviewed }
}

// Every rating in one small file, so a hook can answer from disk and a search
// never waits on us.
export function ratingsFile(entries: BriefEntry[], now = new Date()) {
  const rated: Record<string, string> = {}
  const tasks: Record<string, Record<string, string>> = {}
  const down: string[] = []
  for (const entry of entries) {
    if (entry.rating.stars === null) {
      if (entry.down) down.push(entry.domain)
      continue
    }
    rated[entry.domain] = briefDetails(entry)
    const reviewed = Object.entries(entry.tasks ?? {}).filter(
      ([, rating]) => rating.stars !== null
    )
    if (reviewed.length > 0) {
      tasks[entry.domain] = Object.fromEntries(
        reviewed.map(([task, rating]) => [
          task,
          briefDetails({ ...entry, rating }),
        ])
      )
    }
  }
  return { version: 1, generated_at: now.toISOString(), rated, tasks, down }
}
