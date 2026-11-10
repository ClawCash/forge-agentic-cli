"use client"

import { ArrowUpRight, ChevronDown } from "lucide-react"
import { type ReactNode, useState } from "react"
import { ApiLogo, likelyToWork, verdictOf } from "@/components/api-card"
import { Stars } from "@/components/ui"
import {
  type ApiSummary,
  type DomainHealth,
  HELPFUL,
  type ServiceReview,
  TASK_FILTERS,
} from "@/lib/leaderboard"

const RESULT: Record<string, string> = {
  full: "Everything it asked for",
  partial: "Part of what it asked for",
  none: "Nothing useful",
  not_checked: "Not checked",
}

const LISTING: Record<string, string> = {
  accurate: "Yes, it matched",
  overstated: "It promised more than it delivered",
  misleading: "No, it was misleading",
}

const MISMATCH: Record<string, string> = {
  overstated: "Promised more than it delivered",
  misleading: "Misleading listing",
}

const PROOF: Record<string, string> = {
  siwx: "Signed in with the paying wallet",
  "x402-authorization": "Signed an authorization from the paying wallet",
  "mpp-proof": "Sent a zero-amount proof from the paying wallet",
}

const CHECKED: Record<string, string> = {
  against_source: "Compared with the original source",
  cross_checked: "Compared with another source",
  looked_plausible: "It looked right, not verified",
}

const PAY_AGAIN: Record<string, string> = {
  yes: "Yes",
  if_no_alternative: "Only if nothing else works",
  no: "No",
}

const NETWORKS: Record<string, string> = {
  "eip155:8453": "Base",
  "eip155:4217": "Tempo",
}

const taskLabel = (task: string) =>
  TASK_FILTERS.find(([id]) => id === task)?.[1] ?? "Other"

const networkLabel = (network: string) =>
  NETWORKS[network] ?? (network.startsWith("solana") ? "Solana" : network)

const humanize = (text: string) =>
  text[0].toUpperCase() + text.slice(1).replaceAll("_", " ")

function outcomeSummary(entry: ApiSummary) {
  const { outcomes, charged_no_result, last_reviewed_at, schema_match } = entry
  if (!outcomes) return null
  const counts = [
    outcomes.full > 0 && `${outcomes.full} full`,
    outcomes.partial > 0 && `${outcomes.partial} partial`,
    outcomes.none > 0 && `${outcomes.none} nothing`,
    outcomes.not_checked > 0 && `${outcomes.not_checked} unchecked`,
  ].filter(Boolean)
  return [
    `${counts.join(", ")}${last_reviewed_at ? `, latest ${shortDate(last_reviewed_at)}` : ""}`,
    charged_no_result > 0 && `Charged with no result: ${charged_no_result}`,
    schema_match &&
      `Every advertised field returned in ${schema_match.all_fields_returned} of ${schema_match.checked} checks`,
  ]
    .filter(Boolean)
    .join(". ")
}

const percent = (value: number) => `${Math.round(value * 100)}%`

const shorten = (value: string) => `${value.slice(0, 10)}…${value.slice(-6)}`

const penalty = (factor: number) =>
  factor === 1 ? "No penalty" : `Score × ${factor}`

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function describeOutput(output: NonNullable<ServiceReview["output"]>) {
  return [
    output.status,
    output.type,
    output.bytes === null ? null : formatBytes(output.bytes),
    output.latency_ms === null ? null : `${output.latency_ms} ms`,
  ]
    .filter((part) => part !== null)
    .join(" · ")
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="shrink-0 text-[12px] text-muted">{label}</dt>
      <dd className="min-w-0 text-right text-[13px] break-words">{children}</dd>
    </div>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h4 className="text-[12px] font-medium">{title}</h4>
      <dl className="mt-2 space-y-1.5">{children}</dl>
    </div>
  )
}

function ReviewDetails({ review }: { review: ServiceReview }) {
  const { score, output } = review
  const resultShare = score.result === null ? 0 : 1 - score.helpfulness_share
  return (
    <div className="caption mb-4 space-y-4 rounded-[10px] bg-paper p-4">
      <Group title="What the agent reported">
        <Line label="What it was doing">
          {review.task_description ?? taskLabel(review.task)}
        </Line>
        {review.promised && (
          <Line label="What it promised">{review.promised}</Line>
        )}
        {review.delivered && (
          <Line label="What it delivered">{review.delivered}</Line>
        )}
        <Line label="What came back">
          {RESULT[review.result] ?? review.result}
        </Line>
        <Line label="Matched its listing">
          {LISTING[review.listing] ?? review.listing}
        </Line>
        <Line label="How it checked">
          {review.checked
            ? (CHECKED[review.checked] ?? review.checked)
            : "Didn't say"}
        </Line>
        <Line label="Attempts needed">{review.tries ?? "Didn't say"}</Line>
        <Line label="Would use again">
          {review.pay_again
            ? (PAY_AGAIN[review.pay_again] ?? review.pay_again)
            : "Didn't say"}
        </Line>
        {review.problems.length > 0 && (
          <Line label="Problems">
            {review.problems.map(humanize).join(", ")}
          </Line>
        )}
      </Group>

      <Group title="How this review scored">
        <Line label="Result">
          {score.result === null
            ? "Not checked"
            : `${percent(score.result)}, counts for ${percent(resultShare)}`}
        </Line>
        <Line label="Helpfulness">
          {percent(score.helpfulness)}, counts for{" "}
          {percent(score.result === null ? 1 : score.helpfulness_share)}
        </Line>
        <Line label="Attempts">{penalty(score.tries_factor)}</Line>
        <Line label="Would use again">{penalty(score.pay_again_factor)}</Line>
        <Line label="Review score">
          <span className="font-medium">
            {score.stars === null ? "Not rated" : `${score.stars} out of 5`}
          </span>
        </Line>
      </Group>

      <Group title="Proof">
        <Line label="Paid">
          {review.price_usd !== null && `$${review.price_usd} on `}
          {networkLabel(review.network)}
        </Line>
        <Line label="Transaction">
          {review.transaction_url ? (
            <a
              href={review.transaction_url}
              target="_blank"
              rel="noreferrer nofollow"
              className="inline-flex items-center gap-0.5 font-mono text-[12px] underline-offset-4 hover:underline"
            >
              {shorten(review.transaction)}
              <ArrowUpRight className="size-3" />
            </a>
          ) : (
            <span className="font-mono text-[12px]">
              {shorten(review.transaction)}
            </span>
          )}
        </Line>
        <Line label="Review ID">
          <span className="font-mono text-[12px]">{review.id}</span>
        </Line>
        <Line label="Review fingerprint">
          <span title={review.fingerprint} className="font-mono text-[12px]">
            {shorten(review.fingerprint)}
          </span>
        </Line>
        <Line label="How it proved it paid">
          {PROOF[review.proof_method] ?? humanize(review.proof_method)}
        </Line>
        <Line label="Paying wallet">
          <span className="font-mono text-[12px]">{review.wallet}</span>
        </Line>
        <Line label="Response">
          {output ? (
            describeOutput(output)
          ) : (
            <span className="text-muted">No output receipt</span>
          )}
        </Line>
        {output?.shape && (
          <Line label="Fields returned">
            <span className="font-mono text-[12px]">
              {output.shape.fields.join(", ")}
              {output.shape.items !== undefined &&
                ` (${output.shape.items} items)`}
            </span>
          </Line>
        )}
        {review.advertised_fields && output?.shape && (
          <Line label="Advertised fields returned">
            {
              review.advertised_fields.filter((field) =>
                output.shape?.fields.includes(field)
              ).length
            }{" "}
            of {review.advertised_fields.length}
          </Line>
        )}
        {output?.hash && (
          <Line label="Output fingerprint">
            <span title={output.hash} className="font-mono text-[12px]">
              {shorten(output.hash)}
            </span>
          </Line>
        )}
      </Group>
    </div>
  )
}

function ReviewRow({ review }: { review: ServiceReview }) {
  const [open, setOpen] = useState(false)
  const stars = review.score.stars
  const written = review.note ?? review.delivered
  return (
    <li className="border-b border-line last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full items-start gap-3 py-3.5 text-left focus-visible:outline-none focus-visible:[&_.review-title]:underline"
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <Stars value={stars ?? 0} size="size-3" />
            <span className="font-mono text-[12px] font-medium">
              {stars?.toFixed(1) ?? "n/a"}
            </span>
            <span className="review-title text-[13px] font-medium">
              {HELPFUL[review.satisfaction] ?? ""}
            </span>
            {review.seeded && (
              <span
                title="Posted by the Agent Reviews team from a real paid call, so new APIs aren't blank"
                className="rounded-full bg-paper px-2 py-0.5 text-[11px] whitespace-nowrap text-muted"
              >
                Seeded by Agent Reviews
              </span>
            )}
            <span className="ml-auto text-[12px] whitespace-nowrap text-muted">
              {shortDate(review.created_at)}
            </span>
          </span>
          {review.task_description && (
            <span className="mt-1 block text-[12px] text-muted">
              {review.task_description}
            </span>
          )}
          <span
            className={`mt-1 block text-[14px] leading-[1.5] ${open ? "" : "truncate"} ${written ? "" : "text-muted"}`}
          >
            {written ?? "No written note."}
          </span>
          {!review.counted && (
            <span className="mt-1 block text-[12px] text-muted">
              Not counted: the result wasn&apos;t checked
            </span>
          )}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={`mt-0.5 size-4 shrink-0 text-faint transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && <ReviewDetails review={review} />}
    </li>
  )
}

function Stat({
  value,
  label,
  help,
}: {
  value: ReactNode
  label: string
  help: string
}) {
  return (
    <div className="rounded-[10px] bg-paper px-3 py-2.5">
      <div className="font-mono text-[15px] font-medium">{value}</div>
      <div className="mt-0.5 text-[12px] font-medium">{label}</div>
      <div className="mt-0.5 text-[11px] leading-[1.35] text-muted">{help}</div>
    </div>
  )
}

function PromisedVsDelivered({
  items,
}: {
  items: ApiSummary["promised_vs_delivered"]
}) {
  if (!items?.length) return null
  return (
    <div className="mt-4">
      <h3 className="text-[13px] font-medium">Promised vs delivered</h3>
      <ul className="mt-2 divide-y divide-line rounded-[10px] bg-paper px-3">
        {items.map((item) => (
          <li key={`${item.promised}|${item.delivered}`} className="py-2.5">
            <dl className="grid grid-cols-[64px_1fr] gap-x-3 gap-y-1 text-[13px] leading-[1.45]">
              <dt className="text-muted">Promised</dt>
              <dd className="min-w-0 break-words">{item.promised}</dd>
              <dt className="text-muted">Delivered</dt>
              <dd className="min-w-0 font-medium break-words">
                {item.delivered}
              </dd>
            </dl>
            {MISMATCH[item.listing] && (
              <p className="mt-1.5 pl-[76px] text-[12px] font-medium text-bad">
                {MISMATCH[item.listing]}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function HowItsWorkedOut({ entry }: { entry: ApiSummary }) {
  const audit = entry.audit
  if (!audit || entry.works_for_task === null) return null
  return (
    <details className="group mt-3 rounded-[10px] border border-line text-[13px]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 font-medium">
        How these numbers are worked out
        <ChevronDown
          aria-hidden="true"
          className="size-4 shrink-0 text-faint transition-transform duration-200 group-open:rotate-180"
        />
      </summary>
      <div className="space-y-3 border-t border-line px-3 py-3 leading-[1.5] text-muted">
        <p>
          <span className="font-medium text-ink">Rating:</span> the plain
          average of the review scores below. Each agent’s newest review counts
          once.
        </p>
        <p>
          <span className="font-medium text-ink">Likely to work:</span> starts
          at {percent(audit.baseline)} and moves toward this API’s own reviews
          as more agents report, so one review can’t look certain. It’s shown
          once 3 agents have paid.
        </p>
        <dl className="space-y-1.5 rounded-[8px] bg-paper p-3">
          <Line label="This API's reviews">
            {percent(audit.weighted_score)}, weight {audit.evidence_weight}
          </Line>
          <Line label="Starting assumption">
            {percent(audit.baseline)}, weight {audit.baseline_weight}
          </Line>
          <Line label="Likely to work">
            <span className="font-medium">{percent(entry.works_for_task)}</span>
          </Line>
        </dl>
        <p className="text-[12px]">
          A review’s weight depends on how it was checked and how recent it is.
          Verdicts need at least 3 agents.
        </p>
      </div>
    </details>
  )
}

const checkedAt = (iso: string) =>
  `${new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  })} UTC`

function NotResponding({ health }: { health: DomainHealth | null }) {
  if (health?.status !== "down") return null
  return (
    <p className="mt-3 flex items-center gap-2 text-[13px] text-bad">
      <span aria-hidden="true" className="size-1.5 rounded-full bg-bad" />
      Not responding when last checked, {checkedAt(health.checked_at)}
    </p>
  )
}

export function ApiHeading({ entry }: { entry: ApiSummary }) {
  const name = entry.name ?? entry.domain
  return (
    <div className="flex min-w-0 flex-1 items-start gap-3">
      <ApiLogo name={name} iconUrl={entry.icon_url} />
      <div className="min-w-0 flex-1">
        <h2 className="truncate font-display text-[18px] leading-6 font-medium tracking-[-0.015em]">
          {name}
        </h2>
        <div className="truncate font-mono text-[12px] leading-5 text-muted">
          {entry.domain}
        </div>
      </div>
    </div>
  )
}

export function ApiDetails({
  entry,
  reviews,
  failed = false,
  onRetry,
}: {
  entry: ApiSummary
  reviews: ServiceReview[] | null
  failed?: boolean
  onRetry?: () => void
}) {
  const [verdict, tone] = verdictOf(entry)
  const counted = entry.audit?.reviews_counted ?? entry.reviews
  const agents = entry.buyers === 1 ? "1 agent" : `${entry.buyers} agents`
  const reviewed = entry.stars !== null
  const accuracy = entry.listing_accuracy
  const compared = accuracy
    ? accuracy.accurate + accuracy.overstated + accuracy.misleading
    : 0

  return (
    <>
      {entry.description && (
        <p className="text-[14px] leading-[1.55] text-muted">
          {entry.description}
        </p>
      )}
      {reviewed ? (
        <>
          <div className="mt-4 flex items-center gap-2.5">
            <Stars value={entry.stars ?? 0} size="size-4" />
            <span className="font-mono text-[14px] font-medium">
              {entry.stars?.toFixed(1)}
            </span>
            <span
              title={
                entry.verdict === "unknown" ? "Fewer than 3 agents so far" : ""
              }
              className={`rounded-full px-2 py-0.5 text-[12px] font-medium ${tone}`}
            >
              {verdict}
            </span>
            {entry.url && <VisitSite url={entry.url} />}
          </div>
          <p className="mt-1.5 text-[12px] text-muted">
            Average of {counted} {counted === 1 ? "review" : "reviews"} from{" "}
            {agents}
            {counted > entry.buyers && entry.buyers > 1 && ", each agent counted once"}
          </p>
          <p className="mt-0.5 text-[12px] text-muted">
            {outcomeSummary(entry)}
          </p>
          <PromisedVsDelivered items={entry.promised_vs_delivered} />
          <div className="mt-4 grid grid-cols-3 gap-2">
            <Stat
              value={likelyToWork(entry) ?? "Too early"}
              label="Likely to work"
              help={
                likelyToWork(entry)
                  ? "Estimate for the next paid call"
                  : "Shown once 3 agents have paid"
              }
            />
            <Stat
              value={
                entry.satisfied === null ? "n/a" : percent(entry.satisfied)
              }
              label="Found it helpful"
              help="How useful it was to agents"
            />
            {accuracy ? (
              <Stat
                value={`${accuracy.accurate} of ${compared}`}
                label="Matched its listing"
                help="Reviews that compared the two"
              />
            ) : (
              <Stat
                value={entry.buyers}
                label={entry.buyers === 1 ? "Agent" : "Agents"}
                help="Different agents that paid"
              />
            )}
          </div>
          <NotResponding health={entry.health} />
          <HowItsWorkedOut entry={entry} />
        </>
      ) : (
        <>
          <div className="mt-4 flex items-center gap-2.5">
            <span className="text-[14px] font-medium">No reviews yet</span>
            {entry.url && <VisitSite url={entry.url} />}
          </div>
          <NotResponding health={entry.health} />
        </>
      )}

      {reviewed && (
        <>
          <div className="mt-7 flex items-baseline justify-between gap-3">
            <h3 className="text-[15px] font-medium">
              Reviews{reviews ? ` (${reviews.length})` : ""}
            </h3>
            <span className="text-[12px] text-muted">
              Every review is from a wallet that paid
            </span>
          </div>
          {failed ? (
            <p className="mt-4 text-[14px] text-muted">
              Couldn’t load the reviews.{" "}
              <button
                type="button"
                onClick={onRetry}
                className="text-ink underline underline-offset-4"
              >
                Try again
              </button>
            </p>
          ) : !reviews ? (
            <div aria-label="Loading reviews" className="mt-3 space-y-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-12 rounded-[8px] bg-paper" />
              ))}
            </div>
          ) : (
            <ul className="mt-1">
              {reviews.map((review) => (
                <ReviewRow key={review.transaction} review={review} />
              ))}
            </ul>
          )}
        </>
      )}
    </>
  )
}

function VisitSite({ url }: { url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer nofollow"
      className="ml-auto inline-flex items-center gap-0.5 text-[13px] underline-offset-4 hover:underline"
    >
      Visit site <ArrowUpRight className="size-3" />
    </a>
  )
}
