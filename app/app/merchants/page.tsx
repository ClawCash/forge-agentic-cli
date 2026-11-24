import type { Metadata } from "next"
import { cookies } from "next/headers"
import { Alert } from "@/components/arc/alert/alert"
import {
  MerchantShell,
  type NavEntry,
  type NavSection,
} from "@/components/merchant/shell"
import { getLeaderboard } from "@/lib/leaderboard"
import { SITE_URL } from "@/lib/links"
import { googleEnabled, loadApi, loadMe, MERCHANT_COOKIE } from "@/lib/merchant"
import { pointersFor } from "@/lib/merchant-pointers"
import { backdropReviews } from "./review-backdrop"
import { SignIn } from "./sign-in"
import { SignInShowcase } from "./sign-in-showcase"
import { ConnectView } from "./connect-view"
import { AddView, OverviewView, ProfileView, VerifyView } from "./views"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "402reviews for API providers",
  description:
    "Claim your x402 or MPP API on 402reviews, see every review and what agents ran into, and ask us to seed reviews from real paid calls.",
}

const ADD = "add"
const CONNECT = "connect"

export default async function MerchantsPage({
  searchParams,
}: {
  searchParams: Promise<{
    api?: string
    add?: string
    connect?: string
    view?: string
    tab?: string
    domain?: string
    error?: string
  }>
}) {
  // Views go by ?view=add and ?view=connect: Vercel drops a query key with no
  // value (?add) when it rewrites providers.402reviews.xyz/ to this page. The bare
  // forms still work on /merchants.
  const { api, add, connect, view: asked, tab, domain, error } = await searchParams
  const [result, google] = await Promise.all([
    loadMe((await cookies()).get(MERCHANT_COOKIE)?.value),
    googleEnabled(),
  ])

  if (result.state === "signed-out") {
    const board = await getLeaderboard()
    return (
      <SignIn
        google={google}
        googleFailed={error === "google"}
        showcase={<SignInShowcase reviews={backdropReviews(board)} />}
      />
    )
  }
  if (result.state === "error") {
    return (
      <main style={{ display: "grid", minHeight: "100svh", placeItems: "center", padding: "var(--space-4)" }}>
        <Alert tone="danger" title="Couldn't load your APIs">
          {result.message}. Reload to try again.
        </Alert>
      </main>
    )
  }

  const { me } = result
  const claims = me.claims
  // A domain passed from an API's public page opens the add form with it.
  const wantsConnect = (asked === CONNECT || connect !== undefined) && claims.length > 0
  const wantsAdd =
    !wantsConnect &&
    (asked === ADD ||
      add !== undefined ||
      claims.length === 0 ||
      (!!domain && !claims.some((claim) => claim.domain === domain)))
  const current = wantsAdd || wantsConnect
    ? null
    : (claims.find((claim) => claim.domain === (api ?? domain)) ?? claims[0])
  const requests = claims.flatMap((claim) => claim.seeding_requests ?? [])

  const items: NavEntry[] = claims.map((claim) => ({
    id: claim.domain,
    label: claim.domain,
    href: `?api=${encodeURIComponent(claim.domain)}`,
    kind: claim.status === "verified" ? "verified" : "pending",
  }))
  const sections: NavSection[] = [
    {
      id: "apis",
      heading: "APIs",
      items: [
        ...items,
        { id: ADD, label: "Add an API", href: `?view=${ADD}`, kind: "add" },
      ],
    },
    {
      id: "agent",
      heading: "Your agent",
      items: [
        { id: CONNECT, label: "Connect your agent", href: `?view=${CONNECT}`, kind: "connect" },
      ],
    },
  ]
  const verifiedDomains = claims
    .filter((claim) => claim.status === "verified")
    .map((claim) => claim.domain)
  const footer: NavEntry[] = [
    {
      id: "leaderboard",
      label: "402reviews.xyz",
      href: `${SITE_URL}/leaderboard`,
      kind: "external",
    },
  ]

  let view: React.ReactNode
  if (wantsConnect) {
    view = <ConnectView keys={me.provider_keys ?? []} domains={verifiedDomains} />
  } else if (!current) {
    view = <AddView initial={domain ?? ""} first={claims.length === 0} />
  } else if (current.status !== "verified") {
    view = <VerifyView key={current.domain} claim={current} />
  } else if (tab === "profile") {
    view = (
      <ProfileView
        key={current.domain}
        claim={current}
        publicUrl={`${SITE_URL}/s/${current.domain}`}
      />
    )
  } else {
    const data = await loadApi(current.domain)
    view = (
      <OverviewView
        key={current.domain}
        claim={current}
        data={data}
        pointers={pointersFor(data, current.payment_failures ?? [])}
        requests={requests}
        publicUrl={`${SITE_URL}/s/${current.domain}`}
        maxPrice={me.limits.seed_max_price_usd}
      />
    )
  }

  return (
    <MerchantShell
      email={me.email}
      sections={sections}
      footer={footer}
      active={wantsConnect ? CONNECT : (current?.domain ?? ADD)}
      crumb={
        wantsConnect
          ? "Connect your agent"
          : (current?.domain ?? (claims.length ? "Add an API" : "Claim your API"))
      }
    >
      {view}
    </MerchantShell>
  )
}
