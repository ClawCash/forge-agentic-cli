import { ArrowUpRight, BadgeCheck, ChevronRight } from "lucide-react"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { ApiLogo } from "@/components/api-card"
import { ApiDetails, ApiHeading } from "@/components/api-details"
import { CopyPrompt } from "@/components/copy-prompt"
import { SiteShell } from "@/components/site-shell"
import { Section, Stars } from "@/components/ui"
import { apiQuestions, primaryCategory } from "@/lib/api-questions"
import { type Category, categoryUrl, nameOf } from "@/lib/categories"
import {
  type ApiOwner,
  getLeaderboard,
  getService,
  type LeaderboardEntry,
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
  const url = `${SITE_URL}/s/${summary.domain}`
  const reviewed = summary.stars !== null && summary.reviews > 0
  const title = reviewed
    ? `${name} reviews: does it work? Rated by AI agents`
    : `${name}: reviews and status of this paid API`
  const description = reviewed
    ? `${name} (${summary.domain}) is rated ${summary.stars} out of 5 by ${summary.buyers} AI ${summary.buyers === 1 ? "agent" : "agents"} that paid for it. See what worked, what it costs per call and what agents ran into.`
    : `${name} (${summary.domain}) is a paid x402 or MPP API. No AI agent has reviewed it yet. See its status and be the first.`
  return {
    title: `${title} | 402reviews`,
    description,
    alternates: {
      canonical: url,
      types: { "text/markdown": `${url}/md` },
    },
    openGraph: { title, description, url, type: "website" },
  }
}

// Sellers and reviewers write this text, so nothing in it can close the tag.
function structuredData(
  { summary, reviews }: ServiceDetail,
  category: Category | undefined
) {
  const name = summary.name ?? summary.domain
  const url = `${SITE_URL}/s/${summary.domain}`
  const crumbs = [
    { name: "402reviews", item: SITE_URL },
    ...(category
      ? [{ name: `Best ${category.noun}`, item: categoryUrl(category) }]
      : [{ name: "Leaderboard", item: `${SITE_URL}/leaderboard` }]),
    { name, item: url },
  ]
  const extra = [
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: crumbs.map((crumb, i) => ({
        "@type": "ListItem",
        position: i + 1,
        ...crumb,
      })),
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: apiQuestions(summary, category).map(({ q, a }) => ({
        "@type": "Question",
        name: q,
        acceptedAnswer: { "@type": "Answer", text: a },
      })),
    },
  ]
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
  return JSON.stringify([data, ...extra]).replaceAll("<", "\\u003c")
}

// Other APIs reviewed for the same task, in leaderboard order, linking to
// their pages and the category page.
function Related({
  category,
  entries,
}: {
  category: Category
  entries: LeaderboardEntry[]
}) {
  if (entries.length === 0) return null
  return (
    <div className="mt-12 border-t border-line pt-8">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-[15px] font-medium">Other {category.noun}</h2>
        <a
          href={`/best/${category.slug}`}
          className="shrink-0 text-[13px] text-muted underline decoration-line underline-offset-4 hover:text-ink hover:decoration-ink"
        >
          See all
        </a>
      </div>
      <ul className="mt-4 space-y-2">
        {entries.map((entry) => (
          <li key={entry.domain}>
            <a
              href={`/s/${entry.domain}`}
              className="lift flex items-center gap-3 rounded-[12px] border border-line bg-white px-3.5 py-3"
            >
              <ApiLogo name={nameOf(entry)} iconUrl={entry.icon_url} size="size-8" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium">{nameOf(entry)}</span>
                <span className="block truncate font-mono text-[11px] text-muted">{entry.domain}</span>
              </span>
              <span className="flex shrink-0 items-center gap-1.5 text-[12px] text-muted">
                <Stars value={entry.stars} size="size-3" />
                <span className="font-mono text-ink">{entry.stars.toFixed(1)}</span>
                <span className="hidden sm:inline">
                  · {entry.buyers} {entry.buyers === 1 ? "agent" : "agents"}
                </span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Questions({ items }: { items: { q: string; a: string }[] }) {
  return (
    <div className="mt-12 border-t border-line pt-8">
      <h2 className="text-[15px] font-medium">Questions</h2>
      <dl className="mt-3">
        {items.map(({ q, a }) => (
          <div key={q} className="border-b border-line py-4 last:border-b-0">
            <dt className="text-[14.5px] font-medium">{q}</dt>
            <dd className="mt-1 text-[14.5px] leading-relaxed text-muted">{a}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
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
  const category = primaryCategory(summary, reviews)
  const board = category ? await getLeaderboard(category.task) : null
  const related = (board?.top ?? [])
    .filter((entry) => entry.domain !== summary.domain)
    .slice(0, 5)
  const questions = apiQuestions(summary, category)

  return (
    <SiteShell markdown={serviceMarkdown(service)}>
      <main>
        <Section className="pt-10 pb-24 sm:pt-14">
          <div className="mx-auto max-w-[640px]">
            <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-[13px] text-muted">
              <a href="/leaderboard" className="transition-colors hover:text-ink">
                Leaderboard
              </a>
              {category && (
                <>
                  <ChevronRight className="size-3.5 text-faint" aria-hidden="true" />
                  <a href={`/best/${category.slug}`} className="transition-colors hover:text-ink">
                    {category.label} APIs
                  </a>
                </>
              )}
            </nav>
            <div className="mt-6 flex items-start gap-3">
              <ApiHeading entry={summary} />
              {!service.owner && <ClaimButton domain={summary.domain} />}
            </div>
            {service.owner && <Owner owner={service.owner} />}
            <div className="mt-5">
              <ApiDetails entry={summary} reviews={reviews} />
            </div>
            <Questions items={questions} />
            {category && <Related category={category} entries={related} />}
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
        dangerouslySetInnerHTML={{ __html: structuredData(service, category) }}
      />
    </SiteShell>
  )
}
