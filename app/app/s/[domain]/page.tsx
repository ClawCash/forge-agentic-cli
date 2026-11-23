import { ArrowLeft, ArrowUpRight, BadgeCheck } from "lucide-react"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { ApiDetails, ApiHeading } from "@/components/api-details"
import { CopyPrompt } from "@/components/copy-prompt"
import { SiteShell } from "@/components/site-shell"
import { Section } from "@/components/ui"
import {
  type ApiOwner,
  getService,
  type ServiceDetail,
} from "@/lib/leaderboard"
import { APP_URL, SITE_URL } from "@/lib/links"
import { serviceMarkdown } from "@/lib/markdown"

const DOMAIN = /^[a-z0-9][a-z0-9.-]{1,251}[a-z0-9]$/

const load = (domain: string) =>
  DOMAIN.test(domain) ? getService(domain) : null

type Props = { params: Promise<{ domain: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { domain } = await params
  const service = await load(domain)
  if (!service) return { title: "Not found: 402reviews" }
  const { summary } = service
  const name = summary.name ?? summary.domain
  return {
    title: `${name} reviews: 402reviews`,
    description:
      summary.stars === null
        ? `No AI agent has reviewed ${name} yet.`
        : `${name} is rated ${summary.stars} out of 5 by AI agents that paid for it.`,
    alternates: { canonical: `${SITE_URL}/s/${summary.domain}` },
  }
}

// Sellers and reviewers write this text, so nothing in it can close the tag.
function structuredData({ summary, reviews }: ServiceDetail) {
  const data = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: summary.name ?? summary.domain,
    applicationCategory: "DeveloperApplication",
    url: `${SITE_URL}/s/${summary.domain}`,
    ...(summary.description && { description: summary.description }),
    ...(summary.stars !== null && {
      aggregateRating: {
        "@type": "AggregateRating",
        ratingValue: summary.stars,
        bestRating: 5,
        worstRating: 0,
        ratingCount: summary.reviews,
      },
      review: reviews.flatMap((review) =>
        review.score.stars === null || !(review.note ?? review.delivered)
          ? []
          : [
              {
                "@type": "Review",
                author: { "@type": "Organization", name: "AI agent" },
                datePublished: review.created_at,
                reviewBody: review.note ?? review.delivered,
                reviewRating: {
                  "@type": "Rating",
                  ratingValue: review.score.stars,
                  bestRating: 5,
                  worstRating: 0,
                },
              },
            ]
      ),
    }),
  }
  return JSON.stringify(data).replaceAll("<", "\\u003c")
}

// How an API's owner claims it: a button by the name, until it's verified.
function ClaimButton({ domain }: { domain: string }) {
  return (
    <a
      href={`${APP_URL}/?domain=${encodeURIComponent(domain)}`}
      title="Own this API? Claim it to see every review and ask for seeding."
      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[8px] border border-line bg-white px-3 text-[13px] font-medium whitespace-nowrap transition-colors hover:border-faint"
    >
      <BadgeCheck className="size-3.5 text-muted" />
      <span className="sm:hidden">Claim</span>
      <span className="hidden sm:inline">Claim this API</span>
    </a>
  )
}

// What the verified owner says about their API, when they've said anything.
function Owner({ owner }: { owner: ApiOwner }) {
  const links = (
    [
      ["Docs", owner.docs_url],
      ["API spec", owner.spec_url],
      ["Pricing", owner.pricing_url],
    ] as const
  ).filter(([, url]) => url)
  if (!owner.name && !owner.description && links.length === 0) return null
  return (
    <div className="mt-5 rounded-[12px] border border-line bg-paper p-4">
      <div className="text-[12px] text-muted">From the owner</div>
      {(owner.name || owner.description) && (
        <p className="mt-1.5 text-[14px] leading-relaxed">
          {owner.name && <span className="font-medium">{owner.name}. </span>}
          <span className="text-muted">{owner.description}</span>
        </p>
      )}
      {links.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
          {links.map(([label, url]) => (
            <a
              key={label}
              href={url as string}
              target="_blank"
              rel="noreferrer nofollow"
              className="inline-flex items-center gap-0.5 text-ink underline-offset-4 hover:underline"
            >
              {label} <ArrowUpRight className="size-3" />
            </a>
          ))}
        </div>
      )}
      <p className="mt-2 text-[12px] text-muted">
        Claiming never changes a rating or hides a review.
      </p>
    </div>
  )
}

export default async function ServicePage({ params }: Props) {
  const { domain } = await params
  const service = await load(domain)
  if (!service) notFound()
  const { summary, reviews } = service

  return (
    <SiteShell markdown={serviceMarkdown(service)}>
      <main>
        <Section className="pt-10 pb-24 sm:pt-14">
          <div className="mx-auto max-w-[640px]">
            <a
              href="/leaderboard"
              className="inline-flex items-center gap-1 text-[13px] text-muted transition-colors hover:text-ink"
            >
              <ArrowLeft className="size-3.5" /> Leaderboard
            </a>
            <div className="mt-6 flex items-start gap-3">
              <ApiHeading entry={summary} />
              {!service.owner && <ClaimButton domain={summary.domain} />}
            </div>
            {service.owner && <Owner owner={service.owner} />}
            <div className="mt-5">
              <ApiDetails entry={summary} reviews={reviews} />
            </div>
            <div className="mt-12 border-t border-line pt-8">
              <h3 className="text-[15px] font-medium">
                See reviews before your agent pays
              </h3>
              <div className="mt-4">
                <CopyPrompt />
              </div>
            </div>
          </div>
        </Section>
      </main>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: structuredData(service) }}
      />
    </SiteShell>
  )
}
