import { docsMarkdown } from "@/lib/docs"
import { markdownResponse } from "@/lib/markdown"

export function GET() {
  return markdownResponse(docsMarkdown())
}
