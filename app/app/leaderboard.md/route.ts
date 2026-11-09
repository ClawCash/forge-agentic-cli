import type { NextRequest } from "next/server"
import { getLeaderboard, isTask } from "@/lib/leaderboard"
import { leaderboardMarkdown, markdownResponse } from "@/lib/markdown"

export async function GET(request: NextRequest) {
  const task = request.nextUrl.searchParams.get("task") ?? undefined
  return markdownResponse(
    leaderboardMarkdown(await getLeaderboard(isTask(task) ? task : undefined))
  )
}
