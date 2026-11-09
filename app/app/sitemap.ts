import type { MetadataRoute } from "next"
import { getDomains } from "@/lib/leaderboard"
import { SITE_URL } from "@/lib/links"

export const revalidate = 3600

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const domains = await getDomains()
  return [
    { url: SITE_URL },
    { url: `${SITE_URL}/leaderboard` },
    ...domains.map(({ domain }) => ({ url: `${SITE_URL}/s/${domain}` })),
  ]
}
