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
const CHECKED = {
  against_source: 1,
  cross_checked: 0.8,
  looked_plausible: 0.3,
} as Record<string, number>
const UNSTATED_CHECK = 0.5
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
export function outcomeValue(row: ApiReview): number | null {
  const satisfaction = SATISFACTION[row.satisfaction]
  if (row.result === "not_checked") {
    return row.satisfactionFrom === "user" ? satisfaction : null
  }
  const share = row.satisfactionFrom === "user" ? 0.6 : 0.3
  return (1 - share) * RESULT[row.result] + share * satisfaction
}

function constraintMatch(row: ApiReview, query: RatingQuery) {
  const factor = (asked?: string, given?: string | null) =>
    !asked ? 1 : given === asked ? 1 : given ? 0.25 : 0.7
  return factor(query.language, row.language) * factor(query.format, row.format)
}

// A wallet's newest review per endpoint and task is the one that counts, so
// buying repeatedly doesn't buy extra influence.
function latestPerWallet(rows: ApiReview[]) {
  const latest = new Map<string, ApiReview>()
  for (const row of rows) {
    const key = `${row.wallet}|${row.path}|${row.task}`
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
      (row.checked
        ? (CHECKED[row.checked] ?? UNSTATED_CHECK)
        : UNSTATED_CHECK) *
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

function summarize(evidence: Scored[], chance: number) {
  const weight = evidence.reduce((sum, e) => sum + e.weight, 0)
  const buyers = new Set(evidence.map((e) => e.row.wallet)).size
  const satisfied =
    weight > 0
      ? evidence.reduce(
          (sum, e) => sum + e.weight * SATISFACTION[e.row.satisfaction],
          0
        ) / weight
      : null
  return {
    verdict: verdict(chance, buyers),
    stars: round(chance * 5, 1),
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
  domain_rating: {
    stars: number
    works_for_task: number
    buyers: number
    endpoints_reviewed: number
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
  domain_rating: null,
}

function latestNotes(evidence: Scored[]) {
  return [...evidence]
    .sort((a, b) => b.row.createdAt.getTime() - a.row.createdAt.getTime())
    .flatMap(({ row }) =>
      row.note && row.noteStatus === "clean" ? [row.note] : []
    )
    .slice(0, 3)
}

// `rows` is every review for the domain; `prior` is taskPrior for the task.
export function rate(
  rows: ApiReview[],
  query: RatingQuery,
  prior: number,
  now = Date.now()
): Rating {
  const current = latestPerWallet(rows)
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
  const priced = [...(query.path ? onEndpoint : [])]
    .filter((e) => e.row.priceUsd !== null)
    .sort((a, b) => b.row.paidAt.getTime() - a.row.paidAt.getTime())[0]
  const constraints = [query.language, query.format].filter(Boolean)
  const task = usingOtherTasks ? "overall" : (query.task ?? "overall")

  return {
    ...summary,
    top_problem: topProblem(evidence) ?? summary.top_problem,
    cost_per_success_usd: priced
      ? round((priced.row.priceUsd as number) / Math.max(chance, 0.01), 4)
      : null,
    scope,
    matched: [task, ...constraints].join(", "),
    notes: latestNotes(evidence),
    domain_rating: {
      stars: round(shrink(scored, prior, TASK_PRIOR_WEIGHT) * 5, 1),
      works_for_task: round(shrink(scored, prior, TASK_PRIOR_WEIGHT)),
      buyers: new Set(scored.map((e) => e.row.wallet)).size,
      endpoints_reviewed: new Set(scored.map((e) => e.row.path)).size,
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
