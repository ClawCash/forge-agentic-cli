import { getService } from "@/lib/leaderboard"
import { markdownResponse, serviceMarkdown } from "@/lib/markdown"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ domain: string }> }
) {
  const service = await getService((await params).domain)
  return service
    ? markdownResponse(serviceMarkdown(service))
    : new Response("Not found\n", { status: 404 })
}
