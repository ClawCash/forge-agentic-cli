import type { Metadata } from "next"
import { cookies } from "next/headers"
import { getLeaderboard } from "@/lib/leaderboard"
import { googleEnabled, loadMe, MERCHANT_COOKIE, merchantApi } from "@/lib/merchant"
import { backdropReviews } from "../review-backdrop"
import { SignIn } from "../sign-in"
import { SignInShowcase } from "../sign-in-showcase"
import { Consent, InvalidRequest } from "./consent"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Connect an app to 402reviews",
  robots: { index: false, follow: false },
}

const FIELDS = [
  "response_type",
  "client_id",
  "redirect_uri",
  "code_challenge",
  "code_challenge_method",
  "state",
  "scope",
  "resource",
] as const

// Where Claude, Cursor, Codex and VS Code send a provider to sign in to the
// providers MCP. Signed out, it's the usual sign-in; signed in, the provider
// approves the app, which then gets a key named after it.
export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const raw = await searchParams
  const params = Object.fromEntries(
    FIELDS.map((key) => [key, typeof raw[key] === "string" ? (raw[key] as string) : ""])
  ) as Record<(typeof FIELDS)[number], string>

  const looksRight =
    params.response_type === "code" &&
    !!params.client_id &&
    !!params.redirect_uri &&
    !!params.code_challenge &&
    (params.code_challenge_method || "S256") === "S256"
  const client = looksRight
    ? await merchantApi(
        `oauth/client?client_id=${encodeURIComponent(params.client_id)}&redirect_uri=${encodeURIComponent(params.redirect_uri)}`,
        { method: "GET" }
      )
    : null
  if (!client || client.status !== 200 || typeof client.data.name !== "string") {
    return <InvalidRequest />
  }
  const app = client.data.name

  const [result, google] = await Promise.all([
    loadMe((await cookies()).get(MERCHANT_COOKIE)?.value),
    googleEnabled(),
  ])
  const here = `/merchants/authorize?${new URLSearchParams(
    Object.entries(params).filter(([, value]) => value)
  )}`

  if (result.state !== "ok") {
    const board = await getLeaderboard()
    return (
      <SignIn
        google={google}
        title={`Sign in to connect ${app}`}
        intro={`${app} wants to read the feedback on your APIs. Sign in with your 402reviews account to continue.`}
        next={here}
        showcase={<SignInShowcase reviews={backdropReviews(board)} />}
      />
    )
  }

  return (
    <Consent
      app={app}
      email={result.me.email}
      domains={result.me.claims
        .filter((claim) => claim.status === "verified")
        .map((claim) => claim.domain)}
      request={params}
    />
  )
}
