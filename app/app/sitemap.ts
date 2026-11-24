import type { MetadataRoute } from "next"
import { CATEGORIES, categoryUrl } from "@/lib/categories"
import { getDomains, getLeaderboard } from "@/lib/leaderboard"
import { SITE_URL } from "@/lib/links"

export const revalidate = 3600

// Every page worth finding: the home page, the leaderboard, a page per task
// that has reviews, and a page per API we review or check. API pages say when
// their newest review came in.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [domains, boards] = await Promise.all([
    getDomains(),
    Promise.all(CATEGORIES.map((category) => getLeaderboard(category.task))),
  ])
  const now = new Date()
  const categories = CATEGORIES.flatMap((category, i) => {
    const board = boards[i]
    if (!board || board.top.length === 0) return []
    return [
      {
        url: categoryUrl(category),
        lastModified: new Date(board.updated_at),
        changeFrequency: "daily" as const,
        priority: 0.8,
      },
    ]
  })
  return [
    { url: SITE_URL, lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: `${SITE_URL}/leaderboard`, lastModified: now, changeFrequency: "hourly", priority: 0.9 },
    { url: `${SITE_URL}/best`, lastModified: now, changeFrequency: "daily", priority: 0.8 },
    { url: `${SITE_URL}/research/x402-mpp-api-reliability`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    ...categories,
    ...domains.map(({ domain, reviewed, last_reviewed_at }) => ({
      url: `${SITE_URL}/s/${domain}`,
      ...(last_reviewed_at && { lastModified: new Date(last_reviewed_at) }),
      changeFrequency: "weekly" as const,
      priority: reviewed ? 0.7 : 0.4,
    })),
  ]
}
