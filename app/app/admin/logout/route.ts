import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { ADMIN_API_URL, ADMIN_COOKIE } from "@/lib/admin"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const token = (await cookies()).get(ADMIN_COOKIE)?.value
  if (token) {
    await fetch(`${ADMIN_API_URL}/v1/admin/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null)
  }
  // A relative Location keeps the browser on the host it signed out from.
  const host = request.headers.get("host") ?? ""
  const home = host.startsWith("admin.") ? "/" : "/admin"
  const res = new NextResponse(null, {
    status: 303,
    headers: { Location: home },
  })
  res.cookies.delete(ADMIN_COOKIE)
  return res
}
