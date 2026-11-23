import { ExternalLink } from "lucide-react"
import type { Metadata } from "next"
import { cookies } from "next/headers"
import type { ReactNode } from "react"
import { Logo } from "@/components/ui"
import { SITE_URL } from "@/lib/links"
import {
  type Claim,
  googleEnabled,
  loadApi,
  loadMe,
  MERCHANT_COOKIE,
} from "@/lib/merchant"
import { pointersFor } from "@/lib/merchant-pointers"
import {
  ClaimForm,
  Fold,
  Motion,
  Pointers,
  ProfileForm,
  Reviews,
  SeedingPanel,
  StarsValue,
  Verify,
} from "./client"
import { SignIn } from "./sign-in"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "402reviews for API providers",
  description:
    "Claim your x402 or MPP API on 402reviews, see every review and what agents ran into, and ask us to seed reviews from real paid calls.",
}

function Card({
  title,
  note,
  children,
}: {
  title?: string
  note?: string
  children: ReactNode
}) {
  return (
    <section className="rounded-[14px] border border-line bg-white p-5">
      {title && (
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <h2 className="text-[15px] font-medium">{title}</h2>
          {note && <span className="text-[12px] text-muted">{note}</span>}
        </div>
      )}
      {children}
    </section>
  )
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-[12px] bg-paper px-3.5 py-3">
      <div className="text-[12px] text-muted">{label}</div>
      <div className="mt-1 text-[15px] font-medium">{children}</div>
    </div>
  )
}

function Header({ email }: { email: string }) {
  return (
    <header className="border-b border-line bg-white">
      <div className="mx-auto flex h-14 max-w-[1120px] items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex items-center gap-2.5">
          <Logo />
          <span className="hidden text-[13px] text-muted sm:inline">
            for API providers
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden max-w-[220px] truncate text-[13px] text-muted sm:inline">
            {email}
          </span>
          <form action="/merchants/logout" method="post">
            <button
              type="submit"
              className="h-8 rounded-[8px] border border-line bg-white px-3 text-[13px] font-medium transition-colors hover:border-faint"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  )
}

const speed = (ms: number | null) =>
  ms === null
    ? "Not measured"
    : ms < 1000
      ? "Under 1s"
      : `${(ms / 1000).toFixed(1)}s`

export default async function MerchantsPage({
  searchParams,
}: {
  searchParams: Promise<{ api?: string; domain?: string; error?: string }>
}) {
  const { api, domain, error } = await searchParams
  const [result, google] = await Promise.all([
    loadMe((await cookies()).get(MERCHANT_COOKIE)?.value),
    googleEnabled(),
  ])

  if (result.state === "signed-out") {
    return (
      <Motion>
        <SignIn google={google} googleFailed={error === "google"} />
      </Motion>
    )
  }
  if (result.state === "error") {
    return (
      <main className="flex min-h-svh items-center justify-center bg-paper px-4">
        <div className="panel max-w-[400px] p-6 text-[14px]">
          <p className="font-medium">Couldn&apos;t load your APIs</p>
          <p className="mt-1 text-muted">
            {result.message}. Reload to try again.
          </p>
        </div>
      </main>
    )
  }

  const { me } = result
  const claims = me.claims
  const current: Claim | null =
    claims.find((claim) => claim.domain === api) ?? claims[0] ?? null
  const verified = current?.status === "verified"
  const data = verified && current ? await loadApi(current.domain) : null
  const pointers = verified
    ? pointersFor(data, current?.payment_failures ?? [])
    : []
  const requests = claims.flatMap((claim) => claim.seeding_requests ?? [])
  const reviews = data?.reviews ?? []

  return (
    <Motion>
      <div className="min-h-svh bg-paper">
        <Header email={me.email} />
        <main className="mx-auto grid max-w-[1120px] gap-5 px-4 py-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0 space-y-4">
            {claims.length > 1 && (
              <nav className="flex flex-wrap gap-1.5" aria-label="Your APIs">
                {claims.map((claim) => {
                  const active = claim.domain === current?.domain
                  return (
                    <a
                      key={claim.domain}
                      href={`?api=${encodeURIComponent(claim.domain)}`}
                      className={`rounded-[9px] px-3 py-1.5 font-mono text-[13px] transition-colors ${
                        active
                          ? "bg-ink text-white"
                          : "bg-white text-muted ring-1 ring-line ring-inset hover:text-ink"
                      }`}
                    >
                      {claim.domain}
                    </a>
                  )
                })}
              </nav>
            )}

            {!current ? (
              <Card title="Add your API">
                <p className="mb-4 text-[14px] text-muted">
                  Enter the domain your API answers on. You&apos;ll prove you
                  own it with a DNS record.
                </p>
                <ClaimForm initial={domain ?? ""} />
              </Card>
            ) : (
              <Card>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <h1 className="truncate font-mono text-[18px] font-medium">
                      {current.domain}
                    </h1>
                    <span
                      className={`shrink-0 rounded-[6px] px-2 py-0.5 text-[12px] font-medium ring-1 ring-inset ${
                        verified
                          ? "bg-[#e8f4ee] text-ok ring-[#cfe7da]"
                          : "bg-paper text-muted ring-line"
                      }`}
                    >
                      {verified ? "Verified" : "Not verified yet"}
                    </span>
                  </div>
                  {verified && (
                    <a
                      href={`${SITE_URL}/s/${current.domain}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[13px] text-muted transition-colors hover:text-ink"
                    >
                      Public page <ExternalLink className="size-3.5" />
                    </a>
                  )}
                </div>
                <div className="mt-4">
                  {verified ? (
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <Stat label="Rating">
                        <StarsValue value={data?.rating.stars ?? null} />
                      </Stat>
                      <Stat label="Likely to work">
                        {data?.rating.works_for_task != null
                          ? `~${Math.round(data.rating.works_for_task * 100)}%`
                          : "Not enough reviews"}
                      </Stat>
                      <Stat label="Typical speed">
                        {speed(data?.rating.typical_latency_ms ?? null)}
                      </Stat>
                      <Stat label="Reviews">{reviews.length}</Stat>
                    </div>
                  ) : (
                    <Verify claim={current} />
                  )}
                </div>
              </Card>
            )}

            {verified && current && (
              <>
                <Card title="What agents ran into">
                  <Pointers pointers={pointers} />
                </Card>
                <Card
                  title="Reviews"
                  note={
                    reviews.length
                      ? `${reviews.length} from paid calls`
                      : undefined
                  }
                >
                  <Reviews reviews={reviews} />
                </Card>
                <Card>
                  <Fold title="Docs and links shown on your public page">
                    <ProfileForm claim={current} />
                  </Fold>
                </Card>
              </>
            )}
          </div>

          <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
            <Card title="Seeding requests">
              <SeedingPanel current={current} requests={requests} />
            </Card>
            {current && (
              <Card title="Add another API">
                <ClaimForm initial={domain ?? ""} />
              </Card>
            )}
            <p className="px-1 text-[12px] leading-relaxed text-muted">
              Claiming never changes a rating or hides a review.
            </p>
          </aside>
        </main>
      </div>
    </Motion>
  )
}
