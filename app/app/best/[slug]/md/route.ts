import { categoryBySlug } from "@/lib/categories"
import { getLeaderboard } from "@/lib/leaderboard"
import { categoryMarkdown, markdownResponse } from "@/lib/markdown"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const category = categoryBySlug((await params).slug)
  if (!category) return new Response("Not found\n", { status: 404 })
  return markdownResponse(
    categoryMarkdown(category, await getLeaderboard(category.task))
  )
}
