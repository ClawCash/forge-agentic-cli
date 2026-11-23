"use client"

import {
  AlertCircle,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Info,
  TriangleAlert,
} from "lucide-react"
import { AnimatePresence, MotionConfig, motion } from "motion/react"
import { useRouter } from "next/navigation"
import { type FormEvent, type ReactNode, useState } from "react"
import { Stars } from "@/components/ui"
import type { ApiReview, Claim, SeedingRequest } from "@/lib/merchant"
import type { Pointer } from "@/lib/merchant-pointers"

const SMOOTH = { type: "spring", stiffness: 380, damping: 34 } as const
const field =
  "h-10 w-full rounded-[10px] border border-line bg-white px-3.5 text-[14px] outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-faint focus:border-ink focus:shadow-[0_0_0_3px_rgb(12_14_18/0.08)]"
const primary =
  "inline-flex h-10 shrink-0 items-center justify-center whitespace-nowrap rounded-[10px] bg-ink px-4 text-[14px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
const secondary =
  "inline-flex h-10 shrink-0 items-center justify-center whitespace-nowrap rounded-[10px] border border-line bg-white px-4 text-[14px] font-medium transition-colors hover:border-faint disabled:opacity-50"

async function post(path: string, body: unknown) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null)
  const data = ((await res?.json().catch(() => ({}))) ?? {}) as Record<
    string,
    unknown
  >
  return { ok: Boolean(res?.ok), data }
}

const act = (action: string, domain: string, body?: unknown) =>
  post("/merchants/action", { action, domain, body })

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" })

// Respects the visitor's reduced-motion setting everywhere below.
export function Motion({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>
}

function ErrorLine({ children }: { children: ReactNode }) {
  return (
    <motion.p
      role="alert"
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-3 text-[13px] text-bad"
    >
      {children}
    </motion.p>
  )
}

// A section that opens smoothly, with a chevron that turns.
export function Fold({
  title,
  children,
  defaultOpen = false,
}: {
  title: ReactNode
  children: ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="group flex w-full items-center justify-between gap-3 py-1 text-left text-[14px] text-muted transition-colors hover:text-ink"
      >
        <span>{title}</span>
        <motion.span
          animate={{ rotate: open ? 180 : 0 }}
          transition={SMOOTH}
          className="flex size-6 items-center justify-center rounded-[7px] group-hover:bg-paper"
        >
          <ChevronDown className="size-4" />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={SMOOTH}
            className="overflow-hidden"
          >
            <div className="pt-3">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function ClaimForm({ initial = "" }: { initial?: string }) {
  const router = useRouter()
  const [domain, setDomain] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function claim(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const { ok, data } = await act("claim", "", { domain })
    setBusy(false)
    if (!ok) {
      setError(String(data.error ?? "Couldn't add that domain."))
      return
    }
    setDomain("")
    router.push(`?api=${encodeURIComponent(String(data.domain ?? ""))}`)
    router.refresh()
  }

  return (
    <form onSubmit={claim}>
      <div className="flex gap-2">
        <input
          required
          aria-label="Your API's domain"
          placeholder="api.yourcompany.com"
          value={domain}
          onChange={(event) => setDomain(event.target.value)}
          className={`${field} font-mono text-[13px]`}
        />
        <button type="submit" disabled={busy} className={primary}>
          {busy ? "Adding…" : "Add"}
        </button>
      </div>
      <AnimatePresence>
        {error && <ErrorLine>{error}</ErrorLine>}
      </AnimatePresence>
    </form>
  )
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex items-center gap-3 py-2">
      <span className="w-12 shrink-0 text-[13px] text-muted">{label}</span>
      <code
        className="min-w-0 flex-1 truncate font-mono text-[13px]"
        title={value}
      >
        {value}
      </code>
      <button
        type="button"
        aria-label={`Copy ${label}`}
        onClick={async () => {
          await navigator.clipboard.writeText(value).catch(() => {})
          setCopied(true)
          setTimeout(() => setCopied(false), 1800)
        }}
        className="flex size-8 shrink-0 items-center justify-center rounded-[8px] text-muted transition-colors hover:bg-paper hover:text-ink"
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={copied ? "done" : "copy"}
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.6, opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            {copied ? (
              <Check className="size-4 text-ok" />
            ) : (
              <Copy className="size-4" />
            )}
          </motion.span>
        </AnimatePresence>
      </button>
    </div>
  )
}

export function Verify({ claim }: { claim: Claim }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(claim.last_error)
  const steps = claim.verification
  if (!steps) return null

  async function check() {
    setBusy(true)
    setError(null)
    const { ok, data } = await act("check", claim.domain)
    setBusy(false)
    if (!ok) setError(String(data.error ?? "Couldn't check. Try again."))
    else if (data.status !== "verified")
      setError(String(data.last_error ?? "Not verified yet."))
    router.refresh()
  }

  return (
    <div>
      <p className="text-[14px] text-muted">
        Add this DNS record to prove you own {claim.domain}.
      </p>
      <div className="mt-3 divide-y divide-line rounded-[12px] border border-line px-3">
        <CopyRow label="Type" value="TXT" />
        <CopyRow label="Name" value={steps.dns.name} />
        <CopyRow label="Value" value={steps.dns.value} />
      </div>
      <div className="mt-3">
        <Fold title="Can't edit DNS? Use a file instead">
          <div className="divide-y divide-line rounded-[12px] border border-line px-3">
            <CopyRow label="URL" value={steps.file.url} />
            <CopyRow label="Text" value={steps.file.contents} />
          </div>
        </Fold>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <motion.button
          type="button"
          whileTap={{ scale: 0.97 }}
          onClick={check}
          disabled={busy}
          className={primary}
        >
          {busy ? "Checking…" : "Check now"}
        </motion.button>
        <span className="text-[13px] text-muted">
          DNS can take a few minutes.
        </span>
      </div>
      <AnimatePresence>
        {error && <ErrorLine>{error}</ErrorLine>}
      </AnimatePresence>
    </div>
  )
}

const TONES = {
  bad: { icon: AlertCircle, color: "text-bad" },
  warn: { icon: TriangleAlert, color: "text-[#b25e09]" },
  good: { icon: Check, color: "text-ok" },
  info: { icon: Info, color: "text-muted" },
}

export function Pointers({ pointers }: { pointers: Pointer[] }) {
  return (
    <ul className="space-y-2.5">
      {pointers.map((pointer, index) => {
        const { icon: Icon, color } = TONES[pointer.tone]
        return (
          <motion.li
            key={pointer.text}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...SMOOTH, delay: index * 0.04 }}
            className="flex gap-2.5 text-[14px] leading-snug"
          >
            <Icon className={`mt-0.5 size-4 shrink-0 ${color}`} />
            <span>{pointer.text}</span>
          </motion.li>
        )
      })}
    </ul>
  )
}

const RESULT = {
  full: { label: "Worked", style: "bg-[#e8f4ee] text-ok ring-[#cfe7da]" },
  partial: {
    label: "Partly worked",
    style: "bg-[#fdf3e6] text-[#b25e09] ring-[#f5dfc2]",
  },
  none: {
    label: "Returned nothing",
    style: "bg-[#fbeceb] text-bad ring-[#f3d3d0]",
  },
  not_checked: { label: "Not checked", style: "bg-paper text-muted ring-line" },
}

function ReviewRow({ review }: { review: ApiReview }) {
  const result = RESULT[review.result] ?? RESULT.not_checked
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={SMOOTH}
      className="py-4 first:pt-0 last:pb-0"
    >
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <span
          className={`rounded-[6px] px-2 py-0.5 text-[12px] font-medium ring-1 ring-inset ${result.style}`}
        >
          {result.label}
        </span>
        <span className="text-[13px] font-medium">{review.task}</span>
        <span className="truncate font-mono text-[12px] text-muted">
          {review.endpoint}
        </span>
        <span className="ml-auto text-[12px] text-faint">
          {day(review.created_at)}
        </span>
      </div>
      {review.note && (
        <p className="mt-2 text-[14px] leading-relaxed">
          &ldquo;{review.note}&rdquo;
        </p>
      )}
      {(review.promised || review.delivered) && (
        <dl className="mt-2 grid gap-1 text-[13px] leading-snug sm:grid-cols-[84px_1fr]">
          {review.promised && (
            <>
              <dt className="text-muted">Promised</dt>
              <dd>{review.promised}</dd>
            </>
          )}
          {review.delivered && (
            <>
              <dt className="text-muted">Delivered</dt>
              <dd>{review.delivered}</dd>
            </>
          )}
        </dl>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
        {review.seeded && <span>Seeded by 402reviews</span>}
        {review.price_usd != null && <span>Paid ${review.price_usd}</span>}
        {review.transaction_url && (
          <a
            href={review.transaction_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 hover:text-ink"
          >
            Verified payment <ExternalLink className="size-3" />
          </a>
        )}
      </div>
    </motion.li>
  )
}

export function Reviews({ reviews }: { reviews: ApiReview[] }) {
  const endpoints = [...new Set(reviews.map((review) => review.endpoint))]
  const [filter, setFilter] = useState<string | null>(null)
  const shown = filter
    ? reviews.filter((review) => review.endpoint === filter)
    : reviews
  if (reviews.length === 0) {
    return (
      <p className="text-[14px] text-muted">
        No reviews yet. They show here as agents review your API.
      </p>
    )
  }
  return (
    <div>
      {endpoints.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {[null, ...endpoints].map((endpoint) => {
            const active = filter === endpoint
            return (
              <button
                key={endpoint ?? "all"}
                type="button"
                onClick={() => setFilter(endpoint)}
                className={`relative rounded-[8px] px-2.5 py-1 text-[12px] transition-colors ${
                  active ? "text-white" : "text-muted hover:text-ink"
                } ${endpoint ? "font-mono" : ""}`}
              >
                {active && (
                  <motion.span
                    layoutId="review-filter"
                    transition={SMOOTH}
                    className="absolute inset-0 rounded-[8px] bg-ink"
                  />
                )}
                <span className="relative">{endpoint ?? "All"}</span>
              </button>
            )
          })}
        </div>
      )}
      <ul className="divide-y divide-line">
        <AnimatePresence initial={false} mode="popLayout">
          {shown.map((review) => (
            <ReviewRow key={review.id} review={review} />
          ))}
        </AnimatePresence>
      </ul>
    </div>
  )
}

const STATUS = {
  open: { label: "Requested", style: "bg-paper text-muted ring-line" },
  seeded: { label: "Seeded", style: "bg-[#e8f4ee] text-ok ring-[#cfe7da]" },
  declined: {
    label: "Declined",
    style: "bg-[#fbeceb] text-bad ring-[#f3d3d0]",
  },
}

// The side panel: every seeding request sent, and a one-click request for the
// API in view when it hasn't had one.
export function SeedingPanel({
  current,
  requests,
}: {
  current: Claim | null
  requests: SeedingRequest[]
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canAsk =
    current?.status === "verified" &&
    !requests.some((request) => request.domain === current.domain)

  async function ask() {
    if (!current) return
    setBusy(true)
    setError(null)
    const { ok, data } = await act("seeding", current.domain, {})
    setBusy(false)
    if (!ok) {
      setError(String(data.error ?? "Couldn't send the request."))
      return
    }
    router.refresh()
  }

  return (
    <div>
      <AnimatePresence initial={false}>
        {canAsk && (
          <motion.div
            key="ask"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={SMOOTH}
            className="overflow-hidden"
          >
            <div className="mb-4 rounded-[12px] bg-paper p-4">
              <p className="text-[13px] leading-relaxed text-muted">
                We&apos;ll pay for a few real calls to {current?.domain} and
                post honest reviews.
              </p>
              <motion.button
                type="button"
                whileTap={{ scale: 0.97 }}
                onClick={ask}
                disabled={busy}
                className={`${primary} mt-3 w-full`}
              >
                {busy ? "Sending…" : "Request seeding"}
              </motion.button>
              <AnimatePresence>
                {error && <ErrorLine>{error}</ErrorLine>}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {requests.length === 0 ? (
        <p className="text-[13px] text-muted">No requests yet.</p>
      ) : (
        <ul className="space-y-2">
          <AnimatePresence initial={false}>
            {requests.map((request) => {
              const status = STATUS[request.status] ?? STATUS.open
              return (
                <motion.li
                  key={request.id}
                  layout
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={SMOOTH}
                  className="rounded-[10px] border border-line px-3 py-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-[12px]">
                      {request.domain}
                    </span>
                    <span
                      className={`shrink-0 rounded-[6px] px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${status.style}`}
                    >
                      {status.label}
                    </span>
                  </div>
                  <div className="mt-1 text-[12px] text-muted">
                    {request.status === "seeded"
                      ? `Seeded ${day(request.updated_at)}`
                      : `Sent ${day(request.created_at)}`}
                  </div>
                </motion.li>
              )
            })}
          </AnimatePresence>
        </ul>
      )}
    </div>
  )
}

export function ProfileForm({ claim }: { claim: Claim }) {
  const router = useRouter()
  const [values, setValues] = useState({
    name: claim.profile?.name ?? "",
    description: claim.profile?.description ?? "",
    docs_url: claim.profile?.docs_url ?? "",
  })
  const [state, setState] = useState<"idle" | "busy" | "saved">("idle")
  const [error, setError] = useState<string | null>(null)

  async function save(event: FormEvent) {
    event.preventDefault()
    setState("busy")
    setError(null)
    const { ok, data } = await act("profile", claim.domain, {
      ...values,
      spec_url: claim.profile?.spec_url ?? "",
      pricing_url: claim.profile?.pricing_url ?? "",
      contact_email: claim.profile?.contact_email ?? "",
    })
    if (!ok) {
      setState("idle")
      setError(String(data.error ?? "Couldn't save."))
      return
    }
    setState("saved")
    router.refresh()
  }

  const set = (key: keyof typeof values) => (value: string) => {
    setValues((old) => ({ ...old, [key]: value }))
    setState("idle")
  }

  const input = (
    key: keyof typeof values,
    label: string,
    placeholder: string,
    max?: number
  ) => (
    <label className="block">
      <span className="text-[13px] font-medium">{label}</span>
      <input
        value={values[key]}
        maxLength={max}
        placeholder={placeholder}
        onChange={(event) => set(key)(event.target.value)}
        className={`${field} mt-1.5`}
      />
    </label>
  )

  return (
    <form onSubmit={save} className="space-y-3">
      {input("name", "Name", "Acme Data", 60)}
      {input(
        "description",
        "What it does",
        "Market data for trading agents.",
        280
      )}
      {input("docs_url", "Docs link", "https://docs.yourcompany.com")}
      <div className="flex items-center gap-3">
        <motion.button
          type="submit"
          whileTap={{ scale: 0.97 }}
          disabled={state === "busy"}
          className={secondary}
        >
          {state === "busy" ? "Saving…" : "Save"}
        </motion.button>
        <AnimatePresence>
          {state === "saved" && (
            <motion.span
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-1 text-[13px] text-ok"
            >
              <Check className="size-4" /> Saved
            </motion.span>
          )}
        </AnimatePresence>
      </div>
      <AnimatePresence>
        {error && <ErrorLine>{error}</ErrorLine>}
      </AnimatePresence>
    </form>
  )
}

export function StarsValue({ value }: { value: number | null }) {
  return value === null ? (
    <span className="text-[14px] text-muted">No rating yet</span>
  ) : (
    <span className="flex items-center gap-2">
      <Stars value={value} size="size-4" />
      <span className="text-[14px] font-medium tabular-nums">
        {value.toFixed(1)}
      </span>
    </span>
  )
}
