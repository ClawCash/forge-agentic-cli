import { homeMarkdown } from "@/lib/markdown"

export function GET() {
  return new Response(homeMarkdown(), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  })
}
