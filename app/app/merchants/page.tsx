import { BadgeCheck, FileText, Sprout } from "lucide-react"
import type { Metadata } from "next"
import { cookies } from "next/headers"
import { SiteShell } from "@/components/site-shell"
import { Section } from "@/components/ui"
import { loadMe, MERCHANT_COOKIE } from "@/lib/merchant"
import { ClaimCard, ClaimForm, MerchantSignIn } from "./client"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "For API providers: 402reviews",
  description:
    "Claim your x402 or MPP API on 402reviews, add your docs and links, and ask us to seed reviews from real paid calls.",
}

const MARKDOWN = `# 402reviews for API providers

> Claim your x402 or MPP API, add your docs and links, and ask 402reviews to seed reviews from real paid calls.

1. Sign in with your email at https://402reviews.xyz/merchants.
2. Claim your API's domain and prove you own it with a DNS TXT record or a file at /.well-known/api-reviews.txt.
3. Edit the profile shown on your API's page, and request seeding for up to 3 endpoints that cost $0.05 or less a call.

Claiming never changes a rating or hides a review.
`

const STEPS = [
  {
    icon: BadgeCheck,
    title: "Claim and verify",
    line: "Prove you own your API's domain with a DNS record or a file.",
  },
  {
    icon: FileText,
    title: "Show your docs",
    line: "Add your name, description and links to docs, spec and pricing.",
  },
  {
    icon: Sprout,
    title: "Request seeding",
    line: "We pay for real calls to a few cheap endpoints and review them honestly.",
  },
]

function Intro() {
  return (
    <div>
      <h1 className="font-display text-[clamp(36px,4.6vw,52px)] leading-[1.06] font-medium tracking-[-0.03em]">
        Claim your API on 402reviews
      </h1>
      <p className="mt-4 max-w-[520px] text-[17px] leading-relaxed text-muted">
        Show agents your docs and links, and get your first reviews from real
        paid calls.
      </p>
      <ul className="mt-8 space-y-5">
        {STEPS.map(({ icon: Icon, title, line }) => (
          <li key={title} className="flex gap-3.5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-paper ring-1 ring-line ring-inset">
              <Icon className="size-4 text-ink" />
            </span>
            <span>
              <span className="block text-[15px] font-medium">{title}</span>
              <span className="block text-[14px] text-muted">{line}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-8 text-[13px] text-muted">
        Claiming never changes a rating or hides a review.
      </p>
    </div>
  )
}

export default async function MerchantsPage({
  searchParams,
}: {
  searchParams: Promise<{ domain?: string }>
}) {
  const { domain } = await searchParams
  const result = await loadMe((await cookies()).get(MERCHANT_COOKIE)?.value)

  return (
    <SiteShell markdown={MARKDOWN}>
      <main>
        <Section className="pt-12 pb-24 sm:pt-16">
          {result.state !== "ok" ? (
            <div className="grid items-start gap-12 lg:grid-cols-[1.2fr_1fr] lg:gap-16">
              <Intro />
              <div className="lg:pt-2">
                {result.state === "error" ? (
                  <div className="panel p-6 text-[14px]">
                    <p className="font-medium">Couldn&apos;t load your APIs</p>
                    <p className="mt-1 text-muted">
                      {result.message}. Reload to try again.
                    </p>
                  </div>
                ) : (
                  <MerchantSignIn />
                )}
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-[920px]">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <h1 className="font-display text-[34px] leading-tight font-medium tracking-[-0.025em]">
                    Your APIs
                  </h1>
                  <p className="mt-1 text-[14px] text-muted">
                    Signed in as {result.me.email}
                  </p>
                </div>
                <form action="/merchants/logout" method="post">
                  <button
                    type="submit"
                    className="text-[13px] text-muted hover:text-ink"
                  >
                    Sign out
                  </button>
                </form>
              </div>
              <div className="mt-8 rounded-[14px] border border-line bg-paper p-5 sm:p-6">
                <h2 className="text-[15px] font-medium">Claim an API</h2>
                <p className="mt-1 mb-4 text-[13px] text-muted">
                  The domain your API answers on, like api.yourcompany.com.
                </p>
                <ClaimForm initial={domain ?? ""} />
              </div>
              <div className="mt-6 space-y-4">
                {result.me.claims.map((claim) => (
                  <ClaimCard
                    key={claim.domain}
                    claim={claim}
                    maxPrice={result.me.limits.seed_max_price_usd}
                    maxEndpoints={result.me.limits.seed_max_endpoints}
                  />
                ))}
              </div>
            </div>
          )}
        </Section>
      </main>
    </SiteShell>
  )
}
