import { SERVER_API_URL } from "@/lib/links"

// Public totals from the API: every number is a real count, refreshed about
// once a minute. Null when the API can't be reached, so pages leave them out
// instead of showing made-up figures.
export interface SiteStats {
  updated_at: string
  reviews: number
  apis_reviewed: number
  buyers: number
  paid_usd: number
  checks: number
  apis_tracked: number
}

export async function getStats(): Promise<SiteStats | null> {
  try {
    const res = await fetch(`${SERVER_API_URL}/v1/stats`, {
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(6000),
    })
    return res.ok ? ((await res.json()) as SiteStats) : null
  } catch {
    return null
  }
}
