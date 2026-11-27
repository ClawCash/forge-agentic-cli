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
  // A refund the owner sent back for one review, checked on chain.
  refund: (domain) => ({
    path: `claims/${encodeURIComponent(domain)}/refunds`,
    method: "POST",
  }),
  endpoints: (domain) => ({
    path: `claims/${encodeURIComponent(domain)}/endpoints`,
    method: "GET",
  }),
  key_create: () => ({ path: "keys", method: "POST" }),
  // For keys, "domain" carries the key's id.
  key_revoke: (id) => ({ path: `keys/${encodeURIComponent(id)}`, method: "DELETE" }),
  // An app asking to sign in to the providers MCP, approved on its page.
  oauth_approve: () => ({ path: "oauth/approve", method: "POST" }),
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
    ...(method !== "GET" && { body: input?.body ?? {} }),
  })
  return Response.json(data, { status })
}
