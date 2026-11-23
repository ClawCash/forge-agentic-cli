import { cookies } from "next/headers"
import { MERCHANT_COOKIE, merchantApi } from "@/lib/merchant"

export const dynamic = "force-dynamic"

// One endpoint for the page's buttons, so the token stays in the cookie.
const ACTIONS: Record<
  string,
  (domain: string) => { path: string; method: string }
> = {
  claim: () => ({ path: "claims", method: "POST" }),
  check: (domain) => ({
    path: `claims/${encodeURIComponent(domain)}/check`,
    method: "POST",
  }),
  profile: (domain) => ({
    path: `claims/${encodeURIComponent(domain)}/profile`,
    method: "PUT",
  }),
  seeding: (domain) => ({
    path: `claims/${encodeURIComponent(domain)}/seeding`,
    method: "POST",
  }),
  key_create: () => ({ path: "keys", method: "POST" }),
  // For keys, "domain" carries the key's id.
  key_revoke: (id) => ({ path: `keys/${encodeURIComponent(id)}`, method: "DELETE" }),
}

export async function POST(request: Request) {
  const token = (await cookies()).get(MERCHANT_COOKIE)?.value
  if (!token) return Response.json({ error: "Sign in again" }, { status: 401 })
  const input = (await request.json().catch(() => null)) as {
    action?: string
    domain?: string
    body?: unknown
  } | null
  const action = ACTIONS[String(input?.action)]
  if (!action)
    return Response.json({ error: "Unknown action" }, { status: 400 })
  const { path, method } = action(String(input?.domain ?? ""))
  const { status, data } = await merchantApi(path, {
    method,
    token,
    body: input?.body ?? {},
  })
  return Response.json(data, { status })
}
