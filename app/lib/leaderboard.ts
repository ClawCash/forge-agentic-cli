import { API_URL } from "@/lib/links"

export interface DomainHealth {
  status: string
  checked_at: string
}

export interface LeaderboardEntry {
  rank: number
  domain: string
  name: string | null
  description: string | null
  icon_url: string | null
  url: string | null
  verdict: string
  stars: number
  works_for_task: number
  satisfied: number | null
  confidence: string
  matched: string
  buyers: number
  reviews: number
  top_problem: string | null
  notes: string[]
  outcomes: {
    full: number
    partial: number
    none: number
    not_checked: number
  } | null
  charged_no_result: number
  last_reviewed_at: string | null
  schema_match: {
    all_fields_returned: number
    checked: number
    missing: string[]
  } | null
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
  health: DomainHealth | null
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

// One API's summary. It can have no reviews yet, unlike a leaderboard entry.
export type ApiSummary = Omit<
  LeaderboardEntry,
  "rank" | "stars" | "works_for_task"
> & { stars: number | null; works_for_task: number | null }

export interface ServiceDetail {
  summary: ApiSummary
  reviews: ServiceReview[]
}

export interface AgentSays {
  domain: string
  endpoint: string
  task: string
  satisfaction: string
  note: string
  created_at: string
}

export interface Leaderboard {
  updated_at: string
  task: string | null
  total_reviews: number
  total_apis: number
  top: LeaderboardEntry[]
  recent: AgentSays[]
}

export interface FeaturedReview {
  entry: LeaderboardEntry
  review: {
    endpoint: string
    satisfaction: string
    note: string
    network: string
    price_usd: number | null
    wallet: string
    paid_at: string
    score: ReviewScore
    transaction_url: string | null
  }
}

export interface ReviewScore {
  stars: number | null
  result: number | null
  helpfulness: number
  helpfulness_share: number
  tries_factor: number
  pay_again_factor: number
  check_weight: number
}

export interface ServiceReview {
  endpoint: string
  task: string
  task_description: string | null
  id: string
  proof_method: string
  advertised_fields: string[] | null
  promised: string | null
  delivered: string | null
  result: string
  listing: string
  satisfaction: string
  problems: string[]
  checked: string | null
  pay_again: string | null
  tries: number | null
  note: string | null
  score: ReviewScore
  counted: boolean
  network: string
  price_usd: number | null
  wallet: string
  transaction: string
  transaction_url: string | null
  output: {
    hash: string | null
    status: number | null
    type: string | null
    bytes: number | null
    shape: { fields: string[]; items?: number } | null
    latency_ms: number | null
  } | null
  created_at: string
}

export const HELPFUL: Record<string, string> = {
  satisfied: "Helpful",
  partly: "Somewhat helpful",
  not_satisfied: "Not helpful",
}

export const TASK_FILTERS: [string, string][] = [
  ["web-search", "Web search"],
  ["web-scrape", "Scraping"],
  ["token-price", "Token prices"],
  ["enrichment", "Enrichment"],
  ["document-extract", "Documents"],
  ["image-generation", "Images"],
  ["transcription", "Transcription"],
  ["translation", "Translation"],
  ["weather", "Weather"],
  ["email", "Email"],
]

export function isTask(value: string | undefined): value is string {
  return TASK_FILTERS.some(([task]) => task === value)
}

export async function getLeaderboard(
  task?: string
): Promise<Leaderboard | null> {
  const query = `?limit=100${task ? `&task=${encodeURIComponent(task)}` : ""}`
  try {
    const res = await fetch(`${API_URL}/v1/leaderboard${query}`, {
      next: { revalidate: 30 },
      signal: AbortSignal.timeout(8000),
    })
    return res.ok ? ((await res.json()) as Leaderboard) : null
  } catch {
    return null
  }
}

export async function getServiceReviews(domain: string, signal: AbortSignal) {
  const res = await fetch(
    `${API_URL}/v1/services/${encodeURIComponent(domain)}?limit=100`,
    { signal }
  )
  if (!res.ok) throw new Error("Could not load the reviews")
  return ((await res.json()) as { reviews: ServiceReview[] }).reviews
}

export async function getService(
  domain: string
): Promise<ServiceDetail | null> {
  try {
    const res = await fetch(
      `${API_URL}/v1/services/${encodeURIComponent(domain)}?limit=100`,
      { next: { revalidate: 300 }, signal: AbortSignal.timeout(8000) }
    )
    if (!res.ok) return null
    const data = await res.json()
    if (!data.known) return null
    return {
      summary: {
        domain: data.domain,
        ...data.profile,
        ...data.rating,
        health: data.health,
      },
      reviews: data.reviews,
    }
  } catch {
    return null
  }
}

export async function getDomains() {
  try {
    const res = await fetch(`${API_URL}/v1/domains`, {
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return []
    return ((await res.json()) as { domains: { domain: string }[] }).domains
  } catch {
    return []
  }
}

// The newest real review with a note, from the top API that has one.
export async function getFeaturedReview(
  board: Leaderboard | null
): Promise<FeaturedReview | null> {
  const entry = board?.top.find((e) => e.notes.length > 0)
  if (!entry) return null
  try {
    const res = await fetch(`${API_URL}/v1/services/${entry.domain}`, {
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    const { reviews } = (await res.json()) as {
      reviews: FeaturedReview["review"][]
    }
    const review = reviews.find((r) => r.note)
    return review ? { entry, review } : null
  } catch {
    return null
  }
}
