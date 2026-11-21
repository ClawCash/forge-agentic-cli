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
  // The endpoint a search listed, when it gave one, such as "/v1/scrape".
  path?: string
  // For the task asked about, and for `path` when there is one.
  rating: Rating
  down: boolean
  // For the ratings file: each task this domain was reviewed for, and each
  // reviewed endpoint's rating per task.
  tasks?: Record<string, Rating>
  endpoints?: Record<string, Record<string, Rating>>
  // For the ratings file: endpoints with reported payment failures.
  failures?: Record<string, Rating["payment_failures"]>
}

// A well-reviewed endpoint for a task.
export interface Alternative {
  url: string
  rating: Rating
  // The networks its reviewed payments settled on, so a wallet that pays on
  // one network is only pointed at APIs it can pay.
  networks?: string[]
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

// Endpoints a search listed, as domain and path.
export function briefUrls(input: unknown) {
  if (!Array.isArray(input)) return []
  const seen = new Set<string>()
  return input
    .flatMap((value) => {
      if (typeof value !== "string") return []
      try {
        const url = new URL(value)
        if (url.protocol !== "https:") return []
        const domain = url.hostname.toLowerCase().replace(/^www\./, "")
        const path = url.pathname.replace(/\/+$/, "")
        const key = `${domain}${path}`
        if (!DOMAIN.test(domain) || seen.has(key)) return []
        seen.add(key)
        return [{ domain, path }]
      } catch {
        return []
      }
    })
    .slice(0, MAX_BRIEF_DOMAINS)
}

const NOT_RESPONDING = "not responding when last checked"

const money = (usd: number) => `$${Number(usd.toPrecision(2))}`
const duration = (ms: number) =>
  ms < 1000
    ? "under a second"
    : `about ${ms < 10_000 ? (ms / 1000).toFixed(1) : Math.round(ms / 1000)}s`
const agentsWord = (count: number) =>
  `${count} ${count === 1 ? "agent" : "agents"}`

export const listOf = (words: string[]) =>
  words.length < 2
    ? words.join("")
    : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`

export const failureWords = (
  failures: NonNullable<Rating["payment_failures"]>
) =>
  `payment failed without a charge for ${agentsWord(failures.agents)} (unverified, latest ${failures.latest_at})`

// One API's numbers in a line: stars, chance of working and price first,
// then only the problems.
export function briefDetails({
  rating,
  down,
}: {
  rating: Rating
  down: boolean
}) {
  const agents = rating.audit?.agents ?? rating.buyers
  const seeded =
    rating.seeded_reviews > 0
      ? ` (${rating.seeded_reviews} seeded by 402reviews)`
      : ""
  const schema = rating.schema_match
  const accuracy = rating.listing_accuracy
  const compared = accuracy
    ? accuracy.accurate + accuracy.overstated + accuracy.misleading
    : 0
  const calls = rating.outcomes
    ? Object.values(rating.outcomes).reduce((sum, n) => sum + n, 0)
    : 0
  const latest = rating.latest
  const problem = rating.top_problem?.replaceAll("_", " ")
  const counted = rating.top_problem_count
  const headline = [
    `${(rating.stars ?? 0).toFixed(1)}/5 from ${agentsWord(agents)}${seeded}`,
    rating.works_for_task !== null &&
      `about ${Math.round(rating.works_for_task * 100)}% likely to work`,
    rating.price_usd !== null && `${money(rating.price_usd)} a call`,
    rating.typical_latency_ms !== null &&
      `usually ${duration(rating.typical_latency_ms)} per call`,
    rating.verdict === "unknown"
      ? "too early to tell"
      : `verdict ${rating.verdict}`,
  ]
  const sentences = [
    headline.filter(Boolean).join(", "),
    rating.outcomes?.none &&
      `Returned nothing in ${rating.outcomes.none} of ${calls} paid calls`,
    rating.outcomes?.partial &&
      `Partial results in ${rating.outcomes.partial} of ${calls} paid calls`,
    latest &&
      calls > 1 &&
      (latest.result === "none" || latest.result === "partial") &&
      `The latest paid call, on ${latest.at}, returned ${latest.result === "none" ? "nothing" : "partial results"}`,
    schema &&
      schema.all_fields_returned < schema.checked &&
      `Missing advertised fields in ${schema.checked - schema.all_fields_returned} of ${schema.checked} ${schema.checked === 1 ? "check" : "checks"}`,
    accuracy &&
      accuracy.accurate < compared &&
      `Didn't match its listing in ${compared - accuracy.accurate} of ${compared} reviews`,
    problem &&
      !(rating.top_problem === "paid_no_result" && rating.outcomes?.none) &&
      (counted
        ? `Top problem: ${problem}, in ${counted.reviews} of ${counted.of} reviews`
        : `Top problem: ${problem}`),
    rating.payment_failures && `Also, ${failureWords(rating.payment_failures)}`,
    down && "Not responding when last checked",
  ]
  return `${sentences.filter(Boolean).join(". ")}.`
}

// Reviewed for other tasks only: say which, and give no numbers for this one.
export const otherTasksLine = (
  name: string,
  others: string[],
  task: string,
  down: boolean
) =>
  `${name}: reviewed only for ${listOf(others)}, not ${task}${down ? ". Not responding when last checked" : ""}`

// The label after an API's name: the task its reviews were for, and whether
// they came from other endpoints on the same domain.
export const labelOf = (
  ratedFor: string | null | undefined,
  domain: string,
  fromOtherEndpoints: boolean
) => {
  const parts = [
    ratedFor,
    fromOtherEndpoints && `from other endpoints on ${domain}`,
  ].filter(Boolean)
  return parts.length ? ` (${parts.join(", ")})` : ""
}

function briefLine(entry: BriefEntry, task?: string) {
  const { domain, rating, down } = entry
  const name = entry.path ? `${domain}${entry.path}` : domain
  if (rating.stars !== null) {
    const fromOthers = Boolean(entry.path) && rating.scope === "domain"
    return `${name}${labelOf(rating.rated_for, domain, fromOthers)}: ${briefDetails(entry)}`
  }
  if (task && rating.other_tasks?.length) {
    return otherTasksLine(name, rating.other_tasks, task, down)
  }
  if (rating.payment_failures) {
    return `${name}: ${failureWords(rating.payment_failures)}${down ? ". Not responding when last checked" : ""}`
  }
  return down ? `${name}: ${NOT_RESPONDING}` : null
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
    return [
      `402reviews: none of these APIs have ${reviews} yet.`,
      ...others,
      ...more,
    ].join("\n")
  }
  return [
    "402reviews, from agents that paid for these APIs:",
    ...lines.map((line) => `- ${line}`),
    ...(unreviewed > 0
      ? [
          `No rating yet for ${unreviewed} of ${counts.total} APIs in these results.`,
        ]
      : []),
    ...others,
    ...more,
  ].join("\n")
}

export const alternativeLine = ({ url, rating }: Alternative) =>
  `${url}${labelOf(rating.rated_for, "", false)}: ${briefDetails({ rating, down: false })}`

export function brief(
  entries: BriefEntry[],
  {
    task,
    alternatives = [],
  }: { task?: string; alternatives?: Alternative[] } = {}
) {
  const lines = entries.flatMap((entry) => briefLine(entry, task) ?? [])
  const reviewed = entries.filter((e) => e.rating.stars !== null).length
  const text = briefText(
    lines,
    { reviewed, total: entries.length },
    task,
    alternatives.slice(0, MAX_ALTERNATIVES).map(alternativeLine)
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
  const endpoints: Record<string, Record<string, Record<string, string>>> = {}
  const failures: Record<string, Record<string, string>> = {}
  const down: string[] = []
  const lines = (ratings: Record<string, Rating>, isDown: boolean) =>
    Object.fromEntries(
      Object.entries(ratings)
        .filter(([, rating]) => rating.stars !== null)
        .map(([task, rating]) => [task, briefDetails({ rating, down: isDown })])
    )
  for (const entry of entries) {
    if (entry.down) down.push(entry.domain)
    for (const [path, failed] of Object.entries(entry.failures ?? {})) {
      if (!failed) continue
      failures[entry.domain] ??= {}
      failures[entry.domain][path] = failureWords(failed)
    }
    if (entry.rating.stars === null) continue
    rated[entry.domain] = briefDetails(entry)
    const byTask = lines(entry.tasks ?? {}, entry.down)
    if (Object.keys(byTask).length > 0) tasks[entry.domain] = byTask
    for (const [path, ratings] of Object.entries(entry.endpoints ?? {})) {
      const byEndpoint = lines(ratings, entry.down)
      if (Object.keys(byEndpoint).length === 0) continue
      endpoints[entry.domain] ??= {}
      endpoints[entry.domain][path] = byEndpoint
    }
  }
  return {
    version: 1,
    generated_at: now.toISOString(),
    rated,
    tasks,
    endpoints,
    failures,
    down,
    top: Object.fromEntries(
      Object.entries(top).map(([task, list]) => [
        task,
        list.map((alternative) => ({
          url: alternative.url,
          task: alternative.rating.rated_for,
          line: briefDetails({ rating: alternative.rating, down: false }),
          networks: alternative.networks ?? [],
        })),
      ])
    ),
  }
}
