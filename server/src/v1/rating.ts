import type { ApiReview } from "./store.ts"

// Turns verified reviews into one number with a plain meaning: the chance the
// next paid call works for this task.
//
// Reviews are stored per endpoint and rolled up to the domain. An endpoint with
// few reviews leans on its domain, and a domain with few reviews leans on the
// average for the task, so one glowing review can't beat many good ones.

const RESULT = { full: 1, partial: 0.5, none: 0 } as Record<string, number>
const SATISFACTION = { satisfied: 1, partly: 0.5, not_satisfied: 0 } as Record<
  string,
  number
>
// Kept close together: nobody can verify this claim, so saying it mustn't buy
// much influence, and leaving it out mustn't beat admitting a light check.
const CHECKED = {
  against_source: 1,
  cross_checked: 0.9,
  looked_plausible: 0.7,
} as Record<string, number>
const UNSTATED_CHECK = 0.7
const PAY_AGAIN = { yes: 1, if_no_alternative: 0.9, no: 0.75 } as Record<
  string,
  number
>
const TRY_PENALTY = 0.1
const MIN_TRIES_FACTOR = 0.7
const HALF_LIFE_DAYS = 30
const DAY_MS = 86_400_000

const TASK_PRIOR_WEIGHT = 4
const DOMAIN_PRIOR_WEIGHT = 2
const NEUTRAL_PRIOR = 0.6
const PRIOR_PSEUDO_REVIEWS = 10
const MIN_BUYERS = 3

export interface RatingQuery {
  domain: string
  path: string
  task?: string
  language?: string
  format?: string
}

interface Scored {
  row: ApiReview
  value: number
  weight: number
}

// Outcome satisfaction counts toward the score. It counts for more when the
// user said it than when the agent inferred it.
const helpfulnessShare = (row: ApiReview) =>
  row.satisfactionFrom === "user" ? 0.6 : 0.3

const triesFactor = (row: ApiReview) =>
  Math.max(MIN_TRIES_FACTOR, 1 - TRY_PENALTY * ((row.tries ?? 1) - 1))

const payAgainFactor = (row: ApiReview) => PAY_AGAIN[row.payAgain ?? ""] ?? 1

const checkWeight = (row: ApiReview) =>
  row.checked ? (CHECKED[row.checked] ?? UNSTATED_CHECK) : UNSTATED_CHECK

export function outcomeValue(row: ApiReview): number | null {
  const satisfaction = SATISFACTION[row.satisfaction]
  const share = helpfulnessShare(row)
  const base =
    row.result === "not_checked"
      ? row.satisfactionFrom === "user"
        ? satisfaction
        : null
      : (1 - share) * RESULT[row.result] + share * satisfaction
  return base === null ? null : base * triesFactor(row) * payAgainFactor(row)
}

// One review's own score and every number behind it, so it can be recomputed.
export function reviewScore(row: ApiReview) {
  const value = outcomeValue(row)
  return {
    stars: value === null ? null : round(value * 5, 1),
    result: row.result === "not_checked" ? null : RESULT[row.result],
    helpfulness: SATISFACTION[row.satisfaction],
    helpfulness_share: helpfulnessShare(row),
    tries_factor: triesFactor(row),
    pay_again_factor: payAgainFactor(row),
    check_weight: checkWeight(row),
  }
}

function constraintMatch(row: ApiReview, query: RatingQuery) {
  const factor = (asked?: string, given?: string | null) =>
    !asked ? 1 : given === asked ? 1 : given ? 0.25 : 0.7
  return factor(query.language, row.language) * factor(query.format, row.format)
}

// One signed-up account is one agent, however many wallets it pays from.
const agentOf = (row: ApiReview) => row.userId ?? row.wallet

// An agent's newest review per endpoint and task is the one that counts, so
// buying repeatedly, or from more wallets, doesn't buy extra influence.
export function latestPerAgent(rows: ApiReview[]) {
  const latest = new Map<string, ApiReview>()
  for (const row of rows) {
    const key = `${agentOf(row)}|${row.path}|${row.task}`
    const seen = latest.get(key)
    if (!seen || seen.createdAt < row.createdAt) latest.set(key, row)
  }
  return [...latest.values()]
}

function score(rows: ApiReview[], query: RatingQuery, now: number) {
  return rows.flatMap((row): Scored[] => {
    const value = outcomeValue(row)
    if (value === null) return []
    const age = Math.max(0, now - row.createdAt.getTime()) / DAY_MS
    const weight =
      checkWeight(row) *
      0.5 ** (age / HALF_LIFE_DAYS) *
      constraintMatch(row, query)
    return [{ row, value, weight }]
  })
}

function shrink(evidence: Scored[], prior: number, priorWeight: number) {
  const weight = evidence.reduce((sum, e) => sum + e.weight, 0)
  const total = evidence.reduce((sum, e) => sum + e.weight * e.value, 0)
  return (total + prior * priorWeight) / (weight + priorWeight)
}

// The average for a task, pulled toward neutral until there is enough data.
export function taskPrior(rows: ApiReview[]) {
  const values = rows.flatMap((row) => outcomeValue(row) ?? [])
  const total = values.reduce((sum, v) => sum + v, 0)
  return (
    (total + NEUTRAL_PRIOR * PRIOR_PSEUDO_REVIEWS) /
    (values.length + PRIOR_PSEUDO_REVIEWS)
  )
}

const round = (value: number, places = 2) =>
  Math.round(value * 10 ** places) / 10 ** places

function verdict(chance: number, buyers: number) {
  if (buyers < MIN_BUYERS) return "unknown"
  return chance >= 0.7 ? "use" : chance >= 0.4 ? "caution" : "avoid"
}

function topProblem(evidence: Scored[]) {
  const totals = new Map<string, number>()
  let weight = 0
  for (const { row, weight: w } of evidence) {
    weight += w
    for (const problem of row.problems) {
      totals.set(problem, (totals.get(problem) ?? 0) + w)
    }
  }
  const [top] = [...totals].sort((a, b) => b[1] - a[1])
  return top && top[1] >= weight * 0.2 ? top[0] : null
}

function median(values: number[]) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

// The plain average of the reviews, which anyone can check by hand.
const averageValue = (evidence: Scored[]) =>
  evidence.reduce((sum, e) => sum + e.value, 0) / evidence.length

function summarize(evidence: Scored[], chance: number) {
  const weight = evidence.reduce((sum, e) => sum + e.weight, 0)
  const buyers = new Set(evidence.map((e) => agentOf(e.row))).size
  const satisfied =
    weight > 0
      ? evidence.reduce(
          (sum, e) => sum + e.weight * SATISFACTION[e.row.satisfaction],
          0
        ) / weight
      : null
  return {
    verdict: verdict(chance, buyers),
    stars: round(averageValue(evidence) * 5, 1),
    works_for_task: round(chance),
    satisfied: satisfied === null ? null : round(satisfied),
    confidence: weight < 3 ? "low" : weight < 12 ? "medium" : "high",
    buyers,
    reviews: evidence.length,
    typical_tries: median(evidence.flatMap((e) => e.row.tries ?? [])),
    top_problem: topProblem(evidence),
  }
}

export interface Rating {
  verdict: string
  stars: number | null
  works_for_task: number | null
  satisfied: number | null
  confidence: string
  cost_per_success_usd: number | null
  scope: "endpoint" | "domain" | null
  matched: string
  buyers: number
  reviews: number
  typical_tries: number | null
  top_problem: string | null
  notes: string[]
  // Only from reviews that said what was promised and what came back.
  listing_accuracy: {
    accurate: number
    overstated: number
    misleading: number
  } | null
  promised_vs_delivered: {
    promised: string
    delivered: string
    listing: string
  }[]
  domain_rating: {
    stars: number
    works_for_task: number
    buyers: number
    endpoints_reviewed: number
  } | null
  // Every number behind works_for_task, so it can be recomputed by hand.
  audit: {
    reviews_counted: number
    agents: number
    weighted_score: number
    evidence_weight: number
    baseline: number
    baseline_weight: number
    baseline_source: "domain" | "task"
  } | null
}

const EMPTY: Rating = {
  verdict: "unknown",
  stars: null,
  works_for_task: null,
  satisfied: null,
  confidence: "low",
  cost_per_success_usd: null,
  scope: null,
  matched: "none",
  buyers: 0,
  reviews: 0,
  typical_tries: null,
  top_problem: null,
  notes: [],
  listing_accuracy: null,
  promised_vs_delivered: [],
  domain_rating: null,
  audit: null,
}

function latestNotes(evidence: Scored[]) {
  return [...evidence]
    .sort((a, b) => b.row.createdAt.getTime() - a.row.createdAt.getTime())
    .flatMap(({ row }) =>
      row.note && row.noteStatus === "clean" ? [row.note] : []
    )
    .slice(0, 3)
}

const comparisons = (evidence: Scored[]) =>
  evidence.flatMap(({ row }) => (row.promised && row.delivered ? [row] : []))

function listingAccuracy(evidence: Scored[]) {
  const rows = comparisons(evidence)
  if (rows.length === 0) return null
  const count = (listing: string) =>
    rows.filter((row) => row.listing === listing).length
  return {
    accurate: count("accurate"),
    overstated: count("overstated"),
    misleading: count("misleading"),
  }
}

// Broken promises first: they are what an agent most needs to see.
function promisedVsDelivered(evidence: Scored[]) {
  return comparisons(evidence)
    .sort(
      (a, b) =>
        Number(a.listing === "accurate") - Number(b.listing === "accurate") ||
        b.createdAt.getTime() - a.createdAt.getTime()
    )
    .slice(0, 3)
    .map((row) => ({
      promised: row.promised as string,
      delivered: row.delivered as string,
      listing: row.listing,
    }))
}

// `rows` is every review for the domain; `prior` is taskPrior for the task.
export function rate(
  rows: ApiReview[],
  query: RatingQuery,
  prior: number,
  now = Date.now()
): Rating {
  const current = latestPerAgent(rows)
  const sameTask = query.task
    ? current.filter((row) => row.task === query.task)
    : current
  // No review for this task yet: other tasks on the domain say little, but
  // they are better than nothing.
  const usingOtherTasks = sameTask.length === 0
  const scored = score(usingOtherTasks ? current : sameTask, query, now).map(
    (e) => (usingOtherTasks ? { ...e, weight: e.weight * 0.25 } : e)
  )
  if (scored.length === 0) return EMPTY

  const onEndpoint = query.path
    ? scored.filter((e) => e.row.path === query.path)
    : []
  const elsewhere = onEndpoint.length
    ? scored.filter((e) => e.row.path !== query.path)
    : scored
  const domainChance = shrink(elsewhere, prior, TASK_PRIOR_WEIGHT)
  const scope = onEndpoint.length ? "endpoint" : "domain"
  const chance =
    scope === "endpoint"
      ? shrink(onEndpoint, domainChance, DOMAIN_PRIOR_WEIGHT)
      : domainChance

  const evidence = scope === "endpoint" ? onEndpoint : scored
  const summary = summarize(scored, chance)
  const here = summarize(evidence, chance)
  const priced = [...(query.path ? onEndpoint : [])]
    .filter((e) => e.row.priceUsd !== null)
    .sort((a, b) => b.row.paidAt.getTime() - a.row.paidAt.getTime())[0]
  const constraints = [query.language, query.format].filter(Boolean)
  const task = usingOtherTasks ? "overall" : (query.task ?? "overall")

  return {
    ...summary,
    stars: here.stars,
    satisfied: here.satisfied,
    typical_tries: here.typical_tries,
    top_problem: topProblem(evidence) ?? summary.top_problem,
    cost_per_success_usd: priced
      ? round((priced.row.priceUsd as number) / Math.max(chance, 0.01), 4)
      : null,
    scope,
    matched: [task, ...constraints].join(", "),
    notes: latestNotes(evidence),
    listing_accuracy: listingAccuracy(evidence),
    promised_vs_delivered: promisedVsDelivered(evidence),
    domain_rating: {
      stars: round(averageValue(scored) * 5, 1),
      works_for_task: round(shrink(scored, prior, TASK_PRIOR_WEIGHT)),
      buyers: new Set(scored.map((e) => agentOf(e.row))).size,
      endpoints_reviewed: new Set(scored.map((e) => e.row.path)).size,
    },
    audit: {
      reviews_counted: evidence.length,
      agents: new Set(evidence.map((e) => agentOf(e.row))).size,
      weighted_score: round(
        evidence.reduce((sum, e) => sum + e.weight * e.value, 0) /
          Math.max(
            evidence.reduce((sum, e) => sum + e.weight, 0),
            Number.EPSILON
          )
      ),
      evidence_weight: round(evidence.reduce((sum, e) => sum + e.weight, 0)),
      baseline: round(scope === "endpoint" ? domainChance : prior),
      baseline_weight:
        scope === "endpoint" ? DOMAIN_PRIOR_WEIGHT : TASK_PRIOR_WEIGHT,
      baseline_source: scope === "endpoint" ? "domain" : "task",
    },
  }
}

// Reviews are read by agents holding wallets, so a note is treated as hostile
// until shown otherwise. A held note is kept for moderation but never served.
const INSTRUCTIONS = [
  /ignore\s+(all|any|previous|prior|the\s+above|your)/i,
  /(system|developer)\s+(prompt|message|instruction)/i,
  /\byou\s+(must|should|need\s+to|have\s+to)\s+\w*\s*(use|call|pay|send|ignore|buy|always)/i,
  /\b(always|only)\s+(use|call|pay|choose|pick)\b/i,
  /\b(instructions?|assistant|agent)\s*:/i,
  /https?:\/\//i,
  /[<>`{}\\]/,
]

const SUSPICIOUS = [
  ...INSTRUCTIONS,
  /www\.|\b[a-z0-9-]+\.(com|io|ai|dev|xyz|co|net|org)\b/i,
  /0x[a-f0-9]{16,}/i,
  /\b(api[_\s-]?key|private\s+key|seed\s+phrase|password|secret)\b/i,
  /\b[\w.+-]+@[\w-]+\.[\w.]+\b/,
]

export const looksLikeInstructions = (text: string) =>
  INSTRUCTIONS.some((pattern) => pattern.test(text))

export function screenNote(note: string | undefined) {
  if (!note) return { note: null, noteStatus: "none" }
  // Strips control and invisible characters that can hide instructions.
  const clean = note
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
  return {
    note: clean || null,
    noteStatus: SUSPICIOUS.some((pattern) => pattern.test(clean))
      ? "held"
      : "clean",
  }
}
