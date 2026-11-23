import { BadgeCheck, FileText, Sprout } from "lucide-react"
import type { Metadata } from "next"
import { cookies } from "next/headers"
import type { ReactNode } from "react"
import { Logo } from "@/components/ui"
import { googleEnabled, loadMe, MERCHANT_COOKIE } from "@/lib/merchant"
import { ClaimCard, ClaimForm, MerchantSignIn } from "./client"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "For API providers: 402reviews",
  description:
    "Claim your x402 or MPP API on 402reviews, add your docs and links, and ask us to seed reviews from real paid calls.",
}

const STEPS = [
  {
    icon: BadgeCheck,
    title: "Claim your API",
    line: "Prove you own its domain with a DNS record.",
  },
  {
    icon: Sprout,
    title: "Request seeding",
    line: "We pay for a few real calls and review them honestly.",
  },
  {
    icon: FileText,
    title: "Add your docs",
    line: "Your links show on your API's page.",
  },
]

// An app page: the site's logo and the account, without the marketing nav.
function Shell({ email, children }: { email?: string; children: ReactNode }) {
  return (
    <div className="min-h-svh bg-paper">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex h-14 max-w-[960px] items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <Logo />
            <span className="hidden text-[13px] text-muted sm:inline">
              for API providers
            </span>
          </div>
          {email && (
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
          )}
        </div>
      </header>
      <main className="mx-auto max-w-[960px] px-4 py-10 sm:px-6 sm:py-14">
        {children}
      </main>
    </div>
  )
}

export default async function MerchantsPage({
  searchParams,
}: {
  searchParams: Promise<{ domain?: string; error?: string }>
}) {
  const { domain, error } = await searchParams
  const [result, google] = await Promise.all([
    loadMe((await cookies()).get(MERCHANT_COOKIE)?.value),
    googleEnabled(),
  ])

  if (result.state !== "ok") {
    return (
      <Shell>
        <div className="grid items-start gap-10 lg:grid-cols-[1.15fr_1fr] lg:gap-14">
          <div>
            <h1 className="font-display text-[clamp(32px,4.4vw,46px)] leading-[1.06] font-medium tracking-[-0.03em]">
              Claim your API on 402reviews
            </h1>
            <p className="mt-3 max-w-[460px] text-[16px] leading-relaxed text-muted">
              Get your first reviews from real paid calls.
            </p>
            <ul className="mt-8 space-y-4">
              {STEPS.map(({ icon: Icon, title, line }) => (
                <li key={title} className="flex gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-white ring-1 ring-line ring-inset">
                    <Icon className="size-4" />
                  </span>
                  <span>
                    <span className="block text-[15px] font-medium">
                      {title}
                    </span>
                    <span className="block text-[14px] text-muted">{line}</span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-8 text-[13px] text-muted">
              Claiming never changes a rating or hides a review.
            </p>
          </div>
          {result.state === "error" ? (
            <div className="panel p-6 text-[14px]">
              <p className="font-medium">Couldn&apos;t load your APIs</p>
              <p className="mt-1 text-muted">
                {result.message}. Reload to try again.
              </p>
            </div>
          ) : (
            <MerchantSignIn google={google} googleFailed={error === "google"} />
          )}
        </div>
      </Shell>
    )
  }

  const { me } = result
  return (
    <Shell email={me.email}>
      <div className="mx-auto max-w-[680px]">
        <h1 className="font-display text-[28px] font-medium tracking-[-0.025em]">
          Your APIs
        </h1>
        <div className="mt-5 space-y-3">
          {me.claims.map((claim) => (
            <ClaimCard key={claim.domain} claim={claim} />
          ))}
        </div>
        <div className="mt-6">
          <p className="mb-2 text-[13px] text-muted">
            {me.claims.length
              ? "Add another API"
              : "Add your API's domain to get started"}
          </p>
          <ClaimForm initial={domain ?? ""} />
        </div>
      </div>
    </Shell>
  )
}
