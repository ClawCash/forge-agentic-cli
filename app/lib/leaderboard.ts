import { API_URL } from "@/lib/links"

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
  }
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
