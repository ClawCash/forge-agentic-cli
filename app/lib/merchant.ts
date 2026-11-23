import { SERVER_API_URL } from "@/lib/links"

// The merchants page calls /v1/merchant/* with the session token kept in an
// httpOnly cookie, so the token never reaches the page's scripts.

export const MERCHANT_COOKIE = "merchant_session"
// Holds Google sign-in's state and PKCE verifier for a few minutes.
export const GOOGLE_COOKIE = "merchant_google"
const BASE = SERVER_API_URL

export interface SeedingRequest {
  id: string
  domain: string
  endpoints: { url: string; price_usd: number }[]
  notes: string | null
  status: "open" | "seeded" | "declined"
  created_at: string
  updated_at: string
}

export interface MerchantProfile {
  name: string | null
  description: string | null
  docs_url: string | null
  spec_url: string | null
  pricing_url: string | null
  contact_email: string | null
}

export interface Claim {
  domain: string
  status: "pending" | "verified"
  method: "dns" | "file" | null
  created_at: string
  checked_at: string | null
  verified_at: string | null
  last_error: string | null
  verification?: {
    code: string
    dns: { type: string; name: string; value: string }
    file: { url: string; contents: string }
  }
  profile?: MerchantProfile | null
  seeding_requests?: SeedingRequest[]
}

export interface MerchantMe {
  email: string
  claims: Claim[]
  limits: { seed_max_price_usd: number; seed_max_endpoints: number }
}

export async function merchantApi(
  path: string,
  {
    method = "POST",
    body,
    token,
  }: { method?: string; body?: unknown; token?: string } = {}
) {
  const res = await fetch(`${BASE}/v1/merchant/${path}`, {
    method,
    headers: {
      ...(body !== undefined && { "Content-Type": "application/json" }),
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null)
  if (!res) {
    return {
      status: 502,
      data: { error: "The API didn't answer. Try again." } as Record<
        string,
        unknown
      >,
    }
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  return { status: res.status, data }
}

export type MeResult =
  | { state: "ok"; me: MerchantMe }
  | { state: "signed-out" }
  | { state: "error"; message: string }

export async function loadMe(token: string | undefined): Promise<MeResult> {
  if (!token) return { state: "signed-out" }
  const { status, data } = await merchantApi("me", { method: "GET", token })
  if (status === 401) return { state: "signed-out" }
  if (status !== 200) {
    return {
      state: "error",
      message: String(data.error ?? `The API answered ${status}`),
    }
  }
  return { state: "ok", me: data as unknown as MerchantMe }
}

// Whether "Continue with Google" is set up on the API.
export async function googleEnabled() {
  const { status, data } = await merchantApi("config", { method: "GET" })
  return status === 200 && typeof data.google_client_id === "string"
}
