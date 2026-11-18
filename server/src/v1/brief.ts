import type { Rating } from "./rating.ts"

// What gets added to a wallet's search results: numbers and fixed words only.
// Reviews are written by strangers, so their text waits until an agent asks.
// The wrapper (app/public/wrap.mjs) words its lines the same way; a test holds
// the two together.

const DOMAIN = /^[a-z0-9][a-z0-9.-]{1,251}[a-z0-9]$/
export const MAX_BRIEF_DOMAINS = 50
// Reviewed APIs for the task that a search didn't list.
export const MAX_ALTERNATIVES = 2

export interface BriefEntry {
  domain: string
  rating: Rating
  down: boolean
  // Each task this API has been reviewed for.
  tasks?: Record<string, Rating>
}

// A well-reviewed endpoint for a task.
export interface Alternative {
  url: string
  rating: Rating
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

const money = (usd: number) => `$${Number(usd.toPrecision(2))}`
const times = (count: number) => (count === 1 ? "once" : `${count} times`)

export const listOf = (words: string[]) =>
  words.length < 2
    ? words.join("")
    : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`

// One API's numbers in a line: stars, chance of working and price first,
// then only the problems.
export function briefDetails({
  rating,
  down,
}: {
  rating: Rating
  down: boolean
}) {
  const agents = `${rating.buyers} ${rating.buyers === 1 ? "agent" : "agents"}`
  const seeded =
    rating.seeded_reviews > 0
      ? ` (${rating.seeded_reviews} seeded by 402reviews)`
      : ""
  const schema = rating.schema_match
  const accuracy = rating.listing_accuracy
  const compared = accuracy
    ? accuracy.accurate + accuracy.overstated + accuracy.misleading
    : 0
  const headline = [
    `${(rating.stars ?? 0).toFixed(1)}/5 from ${agents}${seeded}`,
    rating.works_for_task !== null &&
      `about ${Math.round(rating.works_for_task * 100)}% likely to work`,
    rating.price_usd !== null && `${money(rating.price_usd)} a call`,
    rating.verdict === "unknown"
      ? "too early to tell"
      : `verdict ${rating.verdict}`,
  ]
  const sentences = [
    headline.filter(Boolean).join(", "),
    rating.charged_no_result > 0 &&
      `Charged with no result ${times(rating.charged_no_result)}`,
    schema &&
      schema.all_fields_returned < schema.checked &&
      `Missing advertised fields in ${schema.checked - schema.all_fields_returned} of ${schema.checked} ${schema.checked === 1 ? "check" : "checks"}`,
    accuracy &&
      accuracy.accurate < compared &&
      `Didn't match its listing in ${compared - accuracy.accurate} of ${compared} reviews`,
    rating.top_problem &&
      `Top problem: ${rating.top_problem.replaceAll("_", " ")}`,
    down && "Not responding when last checked",
  ]
  return `${sentences.filter(Boolean).join(". ")}.`
}

// Reviewed for other tasks only: say which, and give no numbers for this one.
export const otherTasksLine = (
  domain: string,
  others: string[],
  task: string,
  down: boolean
) =>
  `${domain}: reviewed only for ${listOf(others)}, not ${task}${down ? ". Not responding when last checked" : ""}`

function briefLine(entry: BriefEntry, task?: string) {
  const { domain, rating, down } = entry
  if (rating.stars !== null) {
    return `${domain}${task ? ` (${task})` : ""}: ${briefDetails(entry)}`
  }
  if (task && rating.other_tasks?.length) {
    return otherTasksLine(domain, rating.other_tasks, task, down)
  }
  return down ? `${domain}: ${NOT_RESPONDING}` : null
}

export function briefText(
  lines: string[],
  counts: { reviewed: number; total: number },
  task: string | undefined,
  alternatives: string[]
) {
  const unreviewed = counts.total - counts.reviewed
  const reviews = task ? `${task} reviews` : "reviews"
  const others = alternatives.length
    ? [
        `Reviewed for ${task}, not in these results:`,
        ...alternatives.map((line) => `- ${line}`),
      ]
    : []
  const more =
    counts.reviewed > 0 || alternatives.length > 0
      ? ["See what each one promised and delivered with get_api_reviews."]
      : []
  if (lines.length === 0) {
    return [`402reviews: none of these APIs have ${reviews} yet.`, ...others, ...more].join(
      "\n"
    )
  }
  return [
    "402reviews, from agents that paid for these APIs:",
    ...lines.map((line) => `- ${line}`),
    ...(unreviewed > 0
      ? [
          `No ${reviews} yet for ${unreviewed} of ${counts.total} APIs in these results.`,
        ]
      : []),
    ...others,
    ...more,
  ].join("\n")
}

export function brief(
  entries: BriefEntry[],
  { task, alternatives = [] }: { task?: string; alternatives?: Alternative[] } = {}
) {
  const lines = entries.flatMap((entry) => briefLine(entry, task) ?? [])
  const reviewed = entries.filter((e) => e.rating.stars !== null).length
  const text = briefText(
    lines,
    { reviewed, total: entries.length },
    task,
    alternatives
      .slice(0, MAX_ALTERNATIVES)
      .map(({ url, rating }) => `${url}: ${briefDetails({ rating, down: false })}`)
  )
  return { text, reviewed, unreviewed: entries.length - reviewed }
}

// Every rating in one small file, so the wrapper can answer from disk and a search
// never waits on us. `top` lists well-reviewed endpoints for each task.
export function ratingsFile(
  entries: BriefEntry[],
  top: Record<string, Alternative[]> = {},
  now = new Date()
) {
  const rated: Record<string, string> = {}
  const tasks: Record<string, Record<string, string>> = {}
  const down: string[] = []
  for (const entry of entries) {
    if (entry.down) down.push(entry.domain)
    if (entry.rating.stars === null) continue
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
  return {
    version: 1,
    generated_at: now.toISOString(),
    rated,
    tasks,
    down,
    top: Object.fromEntries(
      Object.entries(top).map(([task, list]) => [
        task,
        list.map(({ url, rating }) => ({
          url,
          line: briefDetails({ rating, down: false }),
        })),
      ])
    ),
  }
}
