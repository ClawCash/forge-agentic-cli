import { cookies } from "next/headers"
import { ADMIN_API_URL, ADMIN_COOKIE } from "@/lib/admin"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const token = (await cookies()).get(ADMIN_COOKIE)?.value
  if (!token) return Response.json({ error: "Sign in again" }, { status: 401 })
  const body = (await request.json().catch(() => null)) as {
    id?: string
    status?: string
  } | null
  const res = await fetch(
    `${ADMIN_API_URL}/v1/admin/seeding/${encodeURIComponent(String(body?.id ?? ""))}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: body?.status }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    }
  ).catch(() => null)
  if (!res)
    return Response.json({ error: "The API didn't answer" }, { status: 502 })
  return Response.json(await res.json().catch(() => ({})), {
    status: res.status,
  })
}
