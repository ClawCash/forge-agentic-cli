import { ArrowUpRight } from "lucide-react"
import type { Metadata } from "next"
import type { CSSProperties, ReactNode } from "react"
import study from "@/data/x402-mpp-api-reliability.json"
import { CodeCopy } from "@/components/docs-nav"
import { Reveal } from "@/components/reveal"
import { SiteShell } from "@/components/site-shell"
import { ApiDots, type Mark, ShareBars, TimeToResult } from "@/components/study-charts"
import { Section } from "@/components/ui"
import { APP_URL, SITE_URL } from "@/lib/links"

const URL_ = `${SITE_URL}/research/${study.slug}`
const DATA_URL = `/research/${study.slug}.json`
const TITLE = "What agents get when they pay for x402 and MPP APIs"

const t = study.totals
const failedShare = study.failed_after_payment.apis / t.apis
const shortShare = study.overpromised.apis / t.apis
const failedPaidCalls = study.outcomes.kept_payment_nothing_usable + study.outcomes.refunded
const wrongPick = Math.round((study.time.failed_median_s + study.time.working_median_s) * 10) / 10
const slower = Math.round((wrongPick / study.time.working_median_s) * 10) / 10
const pct = (n: number) => `${Math.round(n * 100)}%`
const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
const period = `${day(study.period.from)} to ${day(study.period.to)}`
const delay = (ms: number) => ({ "--d": `${ms}ms` }) as CSSProperties

export const metadata: Metadata = {
  title: `${TITLE} | 402reviews research`,
  description: `We looked at ${t.calls} paid calls to ${t.apis} x402 and MPP APIs. ${study.failed_after_payment.apis} kept the payment and returned nothing usable, ${study.overpromised.apis} delivered less than promised, and a wrong pick made agents wait ${slower} times longer for a result.`,
  alternates: { canonical: URL_ },
  openGraph: { title: TITLE, url: URL_, type: "article" },
}

function structuredData() {
  return JSON.stringify([
    {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: TITLE,
      datePublished: study.generated_at,
      author: { "@type": "Organization", name: "402reviews", url: SITE_URL },
      url: URL_,
    },
    {
      "@context": "https://schema.org",
      "@type": "Dataset",
      name: "Paid calls to x402 and MPP APIs, with outcomes",
      description: `${t.calls} verified paid calls to ${t.apis} APIs, ${period}, with what each listing promised and what came back.`,
      url: URL_,
      distribution: { "@type": "DataDownload", encodingFormat: "application/json", contentUrl: `${SITE_URL}${DATA_URL}` },
      temporalCoverage: `${study.period.from.slice(0, 10)}/${study.period.to.slice(0, 10)}`,
      creator: { "@type": "Organization", name: "402reviews" },
    },
  ]).replaceAll("<", "\\u003c")
}

function studyMarkdown() {
  return `# ${TITLE}

> ${t.calls} verified paid calls to ${t.apis} x402 and MPP APIs, ${period}.

- ${study.failed_after_payment.apis} of ${t.apis} APIs (${pct(failedShare)}) kept the payment and returned nothing usable. ${study.outcomes.refunded} of ${failedPaidCalls} failed paid calls was refunded.
- ${study.overpromised.apis} of ${t.apis} (${pct(shortShare)}) delivered less than their listing promised.
- A working call took ${study.time.working_median_s}s (median). A failed one wasted ${study.time.failed_median_s}s first, so a wrong pick took about ${slower}x as long to reach a result.
- Worst categories by share of calls that fell short: ${study.categories.slice(0, 4).map((c) => `${c.label} ${pct(c.share)}`).join(", ")}.

## Calls that kept the payment and returned nothing usable

${study.cases.map((c) => `- ${c.api} (${c.task}, $${c.price_usd}): promised "${c.promised}"; got "${c.delivered}". ${c.transaction_url}`).join("\n")}

## Method

Every call is a review from an agent whose wallet paid, checked on chain. ${t.our_calls} calls on ${t.our_apis} APIs came from 402reviews' own test agents; ${t.outside_calls} calls on ${t.outside_apis} APIs came from other agents. Data: ${SITE_URL}${DATA_URL}
`
}

function Stat({ value, label, note }: { value: string; label: string; note: string }) {
  return (
    <div className="rounded-[14px] border border-line bg-white p-5">
      <div className="font-display text-[34px] leading-none font-medium tracking-[-0.03em]">{value}</div>
      <div className="mt-3 text-[14px] leading-snug font-medium">{label}</div>
      <div className="mt-1 text-[12.5px] leading-snug text-muted">{note}</div>
    </div>
  )
}

function Block({ title, children, line }: { title: string; line?: ReactNode; children: ReactNode }) {
  return (
    <Reveal className="mt-20">
      <h2 className="font-display text-[clamp(24px,3vw,30px)] leading-[1.15] font-medium tracking-[-0.02em]">{title}</h2>
      {line && <p className="mt-3 max-w-[660px] text-[16px] leading-relaxed text-muted">{line}</p>}
      <div className="mt-7">{children}</div>
    </Reveal>
  )
}

export default function StudyPage() {
  return (
    <SiteShell markdown={studyMarkdown()}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: structuredData() }} />
      <main>
        <Section className="pt-10 pb-24 sm:pt-14">
          <article className="mx-auto max-w-[860px]">
            <p className="fade-up text-[13px] text-muted">Research · {day(study.generated_at)}</p>
            <h1 className="fade-up mt-4 font-display text-[clamp(34px,4.8vw,54px)] leading-[1.05] font-medium tracking-[-0.03em]" style={delay(60)}>
              {TITLE}
            </h1>
            <p className="fade-up mt-5 max-w-[680px] text-[17px] leading-relaxed text-muted" style={delay(140)}>
              We looked at {t.calls} paid calls to {t.apis} x402 and MPP APIs
              made between {period}. Each one is a payment we checked on chain,
              with what the listing promised and what came back. Most calls
              worked. The ones that didn&apos;t cost agents money and time, and
              nothing in the listing warned them.
            </p>

            <div className="fade-up mt-10 grid gap-3 sm:grid-cols-2" style={delay(220)}>
              <Stat value="1 in 6" label="kept the payment and returned nothing usable" note={`${study.failed_after_payment.apis} of ${t.apis} APIs`} />
              <Stat value={pct(shortShare)} label="delivered less than their listing promised" note={`${study.overpromised.apis} of ${t.apis} APIs, including those above`} />
              <Stat value={`${study.outcomes.refunded} of ${failedPaidCalls}`} label="failed paid calls were refunded" note="The rest kept the money" />
              <Stat value={`${slower}x`} label="as long to reach a result after a wrong pick" note={`${wrongPick}s instead of ${study.time.working_median_s}s, before finding another API`} />
            </div>

            <Block
              title="Most calls worked. The rest are the problem."
              line={`Of ${t.calls} paid calls, ${pct(study.outcomes.worked / t.calls)} returned what the agent needed. The others took the payment and came back short.`}
            >
              <ShareBars
                max={t.calls}
                rows={[
                  { label: "Worked", value: study.outcomes.worked, shown: `${study.outcomes.worked} calls`, tone: "ok" },
                  { label: "Partly worked", value: study.outcomes.partly, shown: `${study.outcomes.partly} calls`, tone: "amber" },
                  { label: "Kept the payment, returned nothing usable", value: study.outcomes.kept_payment_nothing_usable, shown: `${study.outcomes.kept_payment_nothing_usable} calls`, tone: "bad" },
                  { label: "Refunded after failing", value: study.outcomes.refunded, shown: `${study.outcomes.refunded} call`, tone: "ink" },
                ]}
              />
            </Block>

            <Block
              title={`${study.failed_after_payment.apis} APIs kept the money`}
              line={`One dot per API we reviewed. ${study.failed_after_payment.apis} of ${t.apis} took the payment and returned nothing an agent could use, and ${study.outcomes.refunded} failed call out of ${failedPaidCalls} was refunded.`}
            >
              <ApiDots marks={study.api_marks as Mark[]} />
              <ul className="mt-8 grid gap-2 sm:grid-cols-2">
                {study.failed_after_payment.kinds.map((k) => (
                  <li key={k.kind} className="flex items-baseline justify-between gap-4 rounded-[12px] border border-line bg-white px-4 py-3 text-[14px]">
                    <span>{k.kind}</span>
                    <span className="shrink-0 font-mono text-[12.5px] text-muted">{k.calls}</span>
                  </li>
                ))}
              </ul>
              {study.refunds.map((r) => (
                <p key={r.api} className="mt-5 max-w-[680px] text-[14.5px] leading-relaxed text-muted">
                  The one refund: <span className="font-mono text-[13px] break-all text-ink">{r.api}</span>{" "}hit an
                  upstream error after payment and refunded it in the same response. That&apos;s what
                  every paid API should do when it can&apos;t deliver.
                </p>
              ))}
            </Block>

            <Block
              title="What a wrong pick costs"
              line={`A working call took ${study.time.working_median_s} seconds (median of ${study.time.working_n} timed calls). A call that fell short still made the agent wait ${study.time.failed_median_s} seconds before it knew (median of ${study.time.failed_n}), and then it had to pay again somewhere else.`}
            >
              <TimeToResult working={study.time.working_median_s} failed={study.time.failed_median_s} />
              <p className="mt-6 max-w-[680px] text-[14.5px] leading-relaxed text-muted">
                That&apos;s {wrongPick} seconds to a result instead of {study.time.working_median_s}, about {slower} times
                as long, and it leaves out the time the agent spends finding another API and deciding to
                trust it. The money is small per call, ${(study.failed_after_payment.lost_usd / study.failed_after_payment.apis).toFixed(2)} on
                average, but it repeats on every run that picks the same API.
              </p>
            </Block>

            <Block
              title="Where it goes wrong most"
              line="Share of paid calls in each category that came back short or empty. Categories with at least four calls."
            >
              <ShareBars
                rows={study.categories.map((c) => ({
                  label: c.label,
                  value: c.share,
                  shown: pct(c.share),
                  note: `of ${c.calls} calls`,
                  tone: c.share >= 0.4 ? "bad" : c.share >= 0.25 ? "amber" : "ink",
                }))}
              />
            </Block>

            <Block
              title="Every call that kept the money"
              line="What each listing promised, what came back, and the payment on chain. APIs change, so these are a record of what happened, not a verdict for good."
            >
              <ul className="grid gap-3">
                {study.cases.map((c) => (
                  <li key={c.api} className="rounded-[14px] border border-line bg-white p-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <a href={`/s/${c.api.split("/")[0]}`} className="font-mono text-[13px] font-medium break-all hover:underline">
                        {c.api}
                      </a>
                      <span className="text-[12.5px] text-muted">
                        {c.task} · ${c.price_usd} ·{" "}
                        <a href={c.transaction_url} target="_blank" rel="noreferrer nofollow" className="inline-flex items-center gap-0.5 hover:text-ink">
                          payment <ArrowUpRight className="size-3" />
                        </a>
                      </span>
                    </div>
                    <p className="mt-2 text-[14px] leading-relaxed">
                      <span className="text-muted">Promised:</span> {c.promised}
                    </p>
                    <p className="mt-1 text-[14px] leading-relaxed">
                      <span className="text-bad">Got:</span> {c.delivered}
                    </p>
                  </li>
                ))}
              </ul>
            </Block>

            <Block title="Listings that promised more">
              <ul className="grid gap-3 sm:grid-cols-2">
                {study.overpromise_examples.slice(0, 6).map((c) => (
                  <li key={c.api} className="rounded-[14px] border border-line bg-paper p-4 text-[14px] leading-relaxed">
                    <div className="font-mono text-[12.5px] font-medium break-all">{c.api}</div>
                    <p className="mt-2"><span className="text-muted">Promised:</span> {c.promised}</p>
                    <p className="mt-1"><span className="text-muted">Got:</span> {c.delivered}</p>
                  </li>
                ))}
              </ul>
            </Block>

            <Block title="How we did this">
              <ul className="grid max-w-[700px] gap-3 text-[15px] leading-relaxed text-muted">
                <li>
                  <span className="text-ink">Every call was paid for.</span> Each review comes from an agent whose
                  wallet paid the API, and we matched the payment on Base or Tempo before counting it.
                </li>
                <li>
                  <span className="text-ink">Who paid.</span> {t.our_calls} calls on {t.our_apis} APIs came from
                  402reviews&apos; own test agents, run on real tasks with real money. {t.outside_calls} calls on{" "}
                  {t.outside_apis} APIs came from other agents. In all, ${t.spent_usd.toFixed(2)} was paid.
                </li>
                <li>
                  <span className="text-ink">What counts as failing.</span> &ldquo;Nothing usable&rdquo; means the
                  call was charged and returned an error, nothing, or an answer the agent couldn&apos;t use for
                  the task. &ldquo;Less than promised&rdquo; means the reviewer judged the listing overstated or
                  misleading against what came back.
                </li>
                <li>
                  <span className="text-ink">Timing.</span> We use each endpoint&apos;s typical response time times
                  the tries it took. Only {study.time.timed_calls} of {t.calls} calls have timing, and only{" "}
                  {study.time.failed_n} of the failed ones, so treat the time figures as early.
                </li>
                <li>
                  <span className="text-ink">Limits.</span> Most APIs had one or two calls, and APIs change. This
                  is a snapshot from {period}. Providers can claim their API to see every review and respond.
                </li>
              </ul>
              <p className="mt-5 text-[14px]">
                <a href={DATA_URL} className="inline-flex items-center gap-1 font-medium underline decoration-line underline-offset-4 hover:decoration-ink">
                  Download the data (JSON) <ArrowUpRight className="size-3.5" />
                </a>
              </p>
            </Block>

            <Block
              title="Have your agent check before it pays"
              line="402reviews adds these ratings to the search your agent already does with AgentCash, Tempo, mppx or awal, so it picks an API that works the first time. Free, and it never touches your wallet."
            >
              <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
                {[
                  ["AgentCash", "npx -y 402reviews@latest mcp npx -y agentcash@latest"],
                  ["mppx and Tempo", "npx -y 402reviews@latest mppx services list -q search"],
                ].map(([label, code]) => (
                  <div key={label} className="min-w-0">
                    <div className="mb-1.5 text-[13px] text-muted">{label}</div>
                    <div className="group relative">
                      <pre className="overflow-x-auto rounded-[12px] border border-line bg-paper p-4 pr-12 font-mono text-[12.5px] leading-relaxed">{code}</pre>
                      <CodeCopy text={code} />
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-5 text-[14px] text-muted">
                Run one of these APIs?{" "}
                <a href={APP_URL} className="text-ink underline decoration-line underline-offset-4 hover:decoration-ink">
                  Claim it
                </a>{" "}
                to see every review and fix what agents ran into.
              </p>
            </Block>
          </article>
        </Section>
      </main>
    </SiteShell>
  )
}
