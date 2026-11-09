import { API_URL } from "@/lib/links"

export const dynamic = "force-static"
export const revalidate = 300

// Served from the CDN, so hooks don't depend on the API being up. A failed
// refresh keeps the last good copy; only a build with no API falls back.
export async function GET() {
  const building = process.env.NEXT_PHASE === "phase-production-build"
  const res = await fetch(`${API_URL}/v1/ratings`, {
    next: { revalidate },
    signal: AbortSignal.timeout(8000),
  }).catch(() => null)
  if (res?.ok) return Response.json(await res.json())
  if (building) {
    return Response.json({
      version: 1,
      generated_at: null,
      rated: {},
      down: [],
    })
  }
  throw new Error("The ratings are unavailable")
}
