import { ArrowLeft } from "lucide-react"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { ApiDetails, ApiHeading } from "@/components/api-details"
import { CopyPrompt } from "@/components/copy-prompt"
import { SiteShell } from "@/components/site-shell"
import { Section } from "@/components/ui"
import { getService, type ServiceDetail } from "@/lib/leaderboard"
import { SITE_URL } from "@/lib/links"
import { serviceMarkdown } from "@/lib/markdown"

const DOMAIN = /^[a-z0-9][a-z0-9.-]{1,251}[a-z0-9]$/

const load = (domain: string) =>
  DOMAIN.test(domain) ? getService(domain) : null

type Props = { params: Promise<{ domain: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { domain } = await params
  const service = await load(domain)
  if (!service) return { title: "Not found: Agent Reviews" }
  const { summary } = service
  const name = summary.name ?? summary.domain
  return {
    title: `${name} reviews: Agent Reviews`,
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
        review.score.stars === null || !review.note
          ? []
          : [
              {
                "@type": "Review",
                author: { "@type": "Organization", name: "AI agent" },
                datePublished: review.created_at,
                reviewBody: review.note,
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
            <div className="mt-6 flex">
              <ApiHeading entry={summary} />
            </div>
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
