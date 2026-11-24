import { SERVER_API_URL } from "@/lib/links"

// The admin dashboard reads GET /v1/admin/stats with the session token kept in
// an httpOnly cookie, so the token never reaches the page's scripts.

export const ADMIN_COOKIE = "admin_session"
export const ADMIN_API_URL = process.env.ADMIN_API_URL ?? SERVER_API_URL

export interface AdminStats {
  generated_at: string
  // Who is signed in to the dashboard.
  admin_email?: string
  active: { dau: number; wau: number; mau: number; tau: number }
  totals: {
    users: number
    users_last_7_days: number
    auto_review_on: number
    reviews: number
    reviews_seeded: number
    reviews_last_7_days: number
    reviews_without_account: number
    failure_reports: number
    requests_last_30_days: number
    anonymous_requests_last_30_days: number
  }
  daily: {
    day: string
    active: number
    signups: number
    reviews: number
    requests: number
  }[]
  people: {
    email: string
    signed_up_at: string
    last_active_at: string
    reviews: number
    seeded_reviews: number
    failure_reports: number
    requests: number
    auto_review: boolean
  }[]
  activity: {
    at: string
    type: "signup" | "review" | "failure_report"
    who: string | null
    title: string
    detail: string | null
    seeded: boolean
  }[]
  requests_by_kind: { kind: string; signed_in: number; anonymous: number }[]
  clients: { client: string; requests: number }[]
  merchants?: {
    // What merchants did; older dashboards may not send these yet.
    totals?: {
      merchants: number
      merchants_last_7_days: number
      claims: number
      verified: number
      pending: number
      connected_apps: number
      keys: number
      seeding_open: number
    }
    daily?: { day: string; signups: number }[]
    accounts?: {
      email: string
      first_seen_at: string
      last_active_at: string
      sign_in: string | null
      apis: { domain: string; status: "pending" | "verified" }[]
      apps: string[]
      keys: number
      seeding_requests: number
      actions: number
    }[]
    events?: {
      at: string
      email: string
      kind: string
      domain: string | null
      detail: string | null
    }[]
    claims: {
      domain: string
      email: string
      status: "pending" | "verified"
      method: string | null
      created_at: string
      verified_at: string | null
    }[]
    seeding_requests: {
      id: string
      domain: string
      email: string
      endpoints: { url: string; price_usd: number }[]
      notes: string | null
      status: "open" | "seeded" | "declined"
      created_at: string
    }[]
  }
}

export type StatsResult =
  | { state: "ok"; stats: AdminStats }
  | { state: "signed-out" }
  | { state: "error"; message: string }

export async function loadStats(
  token: string | undefined
): Promise<StatsResult> {
  if (!token) return { state: "signed-out" }
  const res = await fetch(`${ADMIN_API_URL}/v1/admin/stats`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null)
  if (res?.status === 401) return { state: "signed-out" }
  if (!res?.ok) {
    return {
      state: "error",
      message: res ? `The API answered ${res.status}` : "The API didn't answer",
    }
  }
  return { state: "ok", stats: (await res.json()) as AdminStats }
}

// Passes a sign-in step to the API and returns its answer as is.
export async function forward(path: string, body: unknown) {
  const res = await fetch(`${ADMIN_API_URL}/v1/admin/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null)
  if (!res) {
    return { status: 502, data: { error: "The API didn't answer. Try again." } }
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  return { status: res.status, data }
}
