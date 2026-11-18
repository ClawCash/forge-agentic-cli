import { type NextRequest, NextResponse } from "next/server"

const MARKDOWN_PATHS: Record<string, string> = {
  "/": "/index.md",
  "/leaderboard": "/leaderboard.md",
  "/docs": "/docs.md",
}

// True when the client ranks markdown at least as high as HTML, so browsers
// (which ask for text/html first) still get the page.
export function prefersMarkdown(accept: string | null) {
  if (!accept) return false
  const quality = (type: string) => {
    const match = accept
      .split(",")
      .map((part) => part.trim().toLowerCase().split(";"))
      .find(([value]) => value.trim() === type)
    if (!match) return -1
    const q = match.find((param) => param.trim().startsWith("q="))
    return q ? Number(q.trim().slice(2)) : 1
  }
  const markdown = Math.max(
    quality("text/markdown"),
    quality("text/x-markdown")
  )
  return markdown > 0 && markdown >= quality("text/html")
}

export function proxy(request: NextRequest) {
  // Exact case on purpose: Next matches routes case-insensitively, so a
  // redirect rule would send /SKILL.md to itself forever.
  if (request.nextUrl.pathname === "/skill.md") {
    const url = request.nextUrl.clone()
    url.pathname = "/SKILL.md"
    return NextResponse.redirect(url, 308)
  }
  // docs.402reviews.xyz is the docs page of the same site.
  const docsHost = request.headers.get("host")?.startsWith("docs.")
  const pathname =
    docsHost && request.nextUrl.pathname === "/"
      ? "/docs"
      : request.nextUrl.pathname
  const target =
    MARKDOWN_PATHS[pathname] ??
    (/^\/s\/[^/]+$/.test(pathname) ? `${pathname}/md` : undefined)
  if (target && prefersMarkdown(request.headers.get("accept"))) {
    const url = request.nextUrl.clone()
    url.pathname = target
    return NextResponse.rewrite(url)
  }
  if (pathname !== request.nextUrl.pathname) {
    const url = request.nextUrl.clone()
    url.pathname = pathname
    const response = NextResponse.rewrite(url)
    response.headers.set("Vary", "Accept")
    return response
  }
  const response = NextResponse.next()
  if (target) response.headers.set("Vary", "Accept")
  return response
}

export const config = {
  matcher: ["/", "/leaderboard", "/docs", "/skill.md", "/s/:domain"],
}
