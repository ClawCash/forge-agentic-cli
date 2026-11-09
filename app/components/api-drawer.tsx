"use client"

import { ArrowUpRight, ChevronDown, X } from "lucide-react"
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react"
import { createPortal } from "react-dom"
import { ApiLogo, verdictOf } from "@/components/api-card"
import { Stars } from "@/components/ui"
import {
  getServiceReviews,
  type LeaderboardEntry,
  SATISFACTION,
  type ServiceReview,
  TASK_FILTERS,
} from "@/lib/leaderboard"

const RESULT: Record<string, string> = {
  full: "Full result",
  partial: "Partial result",
  none: "No result",
  not_checked: "Not checked",
}

const LISTING: Record<string, string> = {
  accurate: "Accurate",
  overstated: "Overstated",
  misleading: "Misleading",
}

const CHECKED: Record<string, string> = {
  against_source: "Against the source",
  cross_checked: "Cross-checked",
  looked_plausible: "Looked plausible",
}

const PAY_AGAIN: Record<string, string> = {
  yes: "Yes",
  if_no_alternative: "If no alternative",
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

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })

function Detail({
  label,
  wide,
  children,
}: {
  label: string
  wide?: boolean
  children: ReactNode
}) {
  return (
    <div className={wide ? "col-span-2" : ""}>
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd className="mt-0.5 text-[13px] break-words">{children}</dd>
    </div>
  )
}

function ReviewRow({ review }: { review: ServiceReview }) {
  const [open, setOpen] = useState(false)
  const [stars, label] = SATISFACTION[review.satisfaction] ?? [3, ""]
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
            <Stars value={stars} size="size-3" />
            <span className="review-title text-[13px] font-medium">
              {label}
            </span>
            <span className="ml-auto text-[12px] whitespace-nowrap text-muted">
              {shortDate(review.created_at)}
            </span>
          </span>
          <span
            className={`mt-1 block text-[14px] leading-[1.5] ${open ? "" : "truncate"} ${review.note ? "" : "text-muted"}`}
          >
            {review.note ?? "No written note."}
          </span>
        </span>
        <ChevronDown
          aria-hidden="true"
          className={`mt-0.5 size-4 shrink-0 text-faint transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <dl className="caption mb-4 grid grid-cols-2 gap-x-5 gap-y-3 rounded-[10px] bg-paper p-4">
          <Detail label="Endpoint" wide>
            <span className="font-mono text-[12px]">{review.endpoint}</span>
          </Detail>
          <Detail label="Task">{taskLabel(review.task)}</Detail>
          <Detail label="Result">
            {RESULT[review.result] ?? review.result}
          </Detail>
          <Detail label="Listing was">
            {LISTING[review.listing] ?? review.listing}
          </Detail>
          <Detail label="How it was checked">
            {review.checked
              ? (CHECKED[review.checked] ?? review.checked)
              : "Not stated"}
          </Detail>
          <Detail label="Tries">{review.tries ?? "Not stated"}</Detail>
          <Detail label="Would pay again">
            {review.pay_again
              ? (PAY_AGAIN[review.pay_again] ?? review.pay_again)
              : "Not stated"}
          </Detail>
          {review.problems.length > 0 && (
            <Detail label="Problems" wide>
              {review.problems.map(humanize).join(", ")}
            </Detail>
          )}
          <Detail label="Paid">
            {review.price_usd !== null && `$${review.price_usd} on `}
            {networkLabel(review.network)}
          </Detail>
          <Detail label="Buyer">
            <span className="font-mono text-[12px]">{review.wallet}</span>
          </Detail>
        </dl>
      )}
    </li>
  )
}

function Stat({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="rounded-[10px] bg-paper px-3 py-2.5">
      <div className="font-mono text-[15px] font-medium">{value}</div>
      <div className="mt-0.5 text-[12px] text-muted">{label}</div>
    </div>
  )
}

export function ApiDrawer({
  entry,
  onClose,
}: {
  entry: LeaderboardEntry
  onClose: () => void
}) {
  const panel = useRef<HTMLDivElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const [leaving, setLeaving] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [reviews, setReviews] = useState<ServiceReview[] | null>(null)
  const [failed, setFailed] = useState(false)
  const name = entry.name ?? entry.domain
  const [verdict, tone] = verdictOf(entry)

  useEffect(() => {
    const controller = new AbortController()
    getServiceReviews(entry.domain, controller.signal)
      .then((loaded) => {
        setReviews(loaded)
        setFailed(false)
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true)
      })
    return () => controller.abort()
  }, [entry.domain, attempt])

  // Holds the page still, and hands focus back to the card on close.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    closeButton.current?.focus()
    return () => {
      document.body.style.overflow = overflow
      opener?.focus()
    }
  }, [])

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") setLeaving(true)
    if (event.key !== "Tab") return
    const focusable = panel.current?.querySelectorAll<HTMLElement>("a, button")
    if (!focusable?.length) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50" onKeyDown={onKeyDown}>
      <div
        data-leaving={leaving}
        className="drawer-backdrop absolute inset-0 bg-ink/30"
        onClick={() => setLeaving(true)}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={`Reviews of ${name}`}
        data-leaving={leaving}
        onAnimationEnd={(event) => {
          if (leaving && event.target === panel.current) onClose()
        }}
        className="drawer absolute inset-y-0 right-0 flex w-full flex-col bg-white sm:w-[500px] sm:border-l sm:border-line"
      >
        <div className="flex items-start gap-3 border-b border-line px-5 py-4 sm:px-6">
          <ApiLogo name={name} iconUrl={entry.icon_url} />
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-display text-[18px] leading-6 font-medium tracking-[-0.015em]">
              {name}
            </h2>
            <div className="truncate font-mono text-[12px] leading-5 text-muted">
              {entry.domain}
            </div>
          </div>
          <button
            ref={closeButton}
            type="button"
            aria-label="Close"
            onClick={() => setLeaving(true)}
            className="-mt-1 -mr-1 grid size-8 shrink-0 place-items-center rounded-[8px] text-muted transition-colors hover:bg-paper hover:text-ink focus-visible:bg-paper focus-visible:outline-none"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          {entry.description && (
            <p className="text-[14px] leading-[1.55] text-muted">
              {entry.description}
            </p>
          )}
          <div className="mt-4 flex items-center gap-2.5">
            <Stars value={entry.stars} size="size-4" />
            <span className="font-mono text-[14px] font-medium">
              {entry.stars.toFixed(1)}
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-[12px] font-medium ${tone}`}
            >
              {verdict}
            </span>
            {entry.url && (
              <a
                href={entry.url}
                target="_blank"
                rel="noreferrer nofollow"
                className="ml-auto inline-flex items-center gap-0.5 text-[13px] underline-offset-4 hover:underline"
              >
                Visit site <ArrowUpRight className="size-3" />
              </a>
            )}
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <Stat
              value={`${Math.round(entry.works_for_task * 100)}%`}
              label="Worked"
            />
            <Stat
              value={
                entry.satisfied === null
                  ? "n/a"
                  : `${Math.round(entry.satisfied * 100)}%`
              }
              label="Satisfied"
            />
            <Stat
              value={entry.buyers}
              label={entry.buyers === 1 ? "Buyer" : "Buyers"}
            />
          </div>

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
              Couldn&apos;t load the reviews.{" "}
              <button
                type="button"
                onClick={() => {
                  setFailed(false)
                  setAttempt(attempt + 1)
                }}
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
                <ReviewRow
                  key={`${review.created_at}-${review.wallet}`}
                  review={review}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
