"use client"

import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  ArrowRight,
  ExternalLink,
  Info,
  TriangleAlert,
} from "lucide-react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { useRouter } from "next/navigation"
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react"
import { AnimatedCounter } from "@/components/arc/animated-counter/animated-counter"
import { Badge, type BadgeTone } from "@/components/arc/badge/badge"
import { Button } from "@/components/arc/button/button"
import { CopyButton } from "@/components/arc/copy-button/copy-button"
import { EmptyState } from "@/components/arc/empty-state/empty-state"
import { Input } from "@/components/arc/input/input"
import { motionTokens } from "@/components/arc/lib/motion-tokens"
import SegmentedControl from "@/components/arc/segmented-control/segmented-control"
import { TextShimmer } from "@/components/arc/text-shimmer/text-shimmer"
import { Textarea } from "@/components/arc/textarea/textarea"
import { LinkButton } from "@/components/merchant/link-button"
import { Card, Grid, Page } from "@/components/merchant/page"
import { PageTabs } from "@/components/merchant/page-tabs"
import { PromptBox } from "@/components/merchant/prompt-box"
import type { ApiData, ApiReview, Claim, SeedingRequest } from "@/lib/merchant"
import type { Pointer } from "@/lib/merchant-pointers"
import { verifyPrompt } from "@/lib/merchant-prompt"
import { act } from "./act"
import styles from "./views.module.css"


const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  })

function ErrorText({ children }: { children: ReactNode }) {
  return (
    <p className={styles.error} role="alert">
      {children}
    </p>
  )
}

// ---------------------------------------------------------------- Add an API

export function AddView({ initial, first }: { initial: string; first: boolean }) {
  const router = useRouter()
  const [domain, setDomain] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()

  async function claim(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(undefined)
    const { ok, data } = await act("claim", "", { domain })
    if (!ok) {
      setBusy(false)
      setError(String(data.error ?? "Couldn't add that domain. Try again."))
      return
    }
    router.push(`?api=${encodeURIComponent(String(data.domain ?? domain))}`)
    router.refresh()
  }

  return (
    <Page
      title={first ? "Claim your API" : "Add another API"}
      description="Enter the domain your API answers on. You'll prove you own it with a DNS record or a file, and claiming never changes a rating or hides a review."
    >
      <Grid columns="2-1" align="start">
        <Card title="Your API's domain">
          <form onSubmit={claim} className={styles.claimForm}>
            <div className={styles.claimField}>
              <Input
                label="Domain"
                placeholder="api.yourcompany.com"
                value={domain}
                onChange={(event) => setDomain(event.target.value)}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                error={error}
                required
              />
            </div>
            <Button type="submit" loading={busy} className={styles.claimButton}>
              Claim
            </Button>
          </form>
          <p className={styles.hint}>
            Use the host from your API&apos;s URLs. For
            https://api.yourcompany.com/v1/search, that&apos;s
            api.yourcompany.com.
          </p>
        </Card>
        <Card title="How it works">
          <ol className={styles.steps}>
            <li>
              <span className={styles.stepNumber}>1</span>
              <span>
                <strong>Claim the domain</strong>
                <span>The one agents call, like api.yourcompany.com.</span>
              </span>
            </li>
            <li>
              <span className={styles.stepNumber}>2</span>
              <span>
                <strong>Prove you own it</strong>
                <span>A DNS record or a file. Your coding agent can add it.</span>
              </span>
            </li>
            <li>
              <span className={styles.stepNumber}>3</span>
              <span>
                <strong>See every review</strong>
                <span>And ask us once to seed reviews from real paid calls.</span>
              </span>
            </li>
          </ol>
        </Card>
      </Grid>
    </Page>
  )
}

// ------------------------------------------------------------------- Verify

type CheckState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "missing"; at: string; error: string | null }

const AUTO_EVERY_MS = 20_000
const AUTO_TRIES = 12

export function VerifyView({ claim }: { claim: Claim }) {
  const router = useRouter()
  const reduce = !!useReducedMotion()
  const [method, setMethod] = useState("dns")
  const [state, setState] = useState<CheckState>(
    claim.checked_at
      ? { kind: "missing", at: claim.checked_at, error: claim.last_error }
      : { kind: "idle" }
  )
  const tries = useRef(0)
  const v = claim.verification

  async function check() {
    setState({ kind: "checking" })
    const { ok, data } = await act("check", claim.domain, {})
    if (ok && data.status === "verified") {
      router.refresh()
      return
    }
    setState({
      kind: "missing",
      at: new Date().toISOString(),
      error: String(
        data.last_error ?? data.error ?? "We couldn't find the record yet."
      ),
    })
  }

  // Looks again every 20 seconds for a few minutes while the tab is open.
  const checkRef = useRef(check)
  checkRef.current = check
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.hidden || tries.current >= AUTO_TRIES) return
      tries.current += 1
      void checkRef.current()
    }, AUTO_EVERY_MS)
    return () => window.clearInterval(timer)
  }, [])

  if (!v) return null
  const rows =
    method === "dns"
      ? [
          { label: "Type", value: v.dns.type },
          { label: "Name", value: v.dns.name },
          { label: "Value", value: v.dns.value },
        ]
      : [
          { label: "URL", value: v.file.url },
          { label: "Text", value: v.file.contents },
        ]

  return (
    <Page
      title={`Verify ${claim.domain}`}
      description="Prove you own this domain. Then you'll see every review of it and can ask us to seed reviews from real paid calls."
    >
      <Grid columns="2-1" align="start">
        <div className={styles.column}>
          <Card
            title={method === "dns" ? "Add a DNS record" : "Serve a file"}
            description={
              method === "dns"
                ? "Add it where your DNS is hosted, like Cloudflare, Vercel, GoDaddy or Route 53."
                : "Serve this text from your API with status 200 and no redirect."
            }
            actions={
              <SegmentedControl
                label="How to verify"
                value={method}
                onValueChange={setMethod}
                options={[
                  { value: "dns", label: "DNS record" },
                  { value: "file", label: "File" },
                ]}
              />
            }
          >
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.dl
                key={method}
                className={styles.records}
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, transition: { duration: motionTokens.duration.instant } }}
                transition={reduce ? { duration: 0 } : motionTokens.spring.smooth}
              >
                {rows.map((row) => (
                  <div key={row.label} className={styles.record}>
                    <dt>{row.label}</dt>
                    <dd>
                      <code>{row.value}</code>
                    </dd>
                    <CopyButton
                      value={row.value}
                      label={`Copy ${row.label.toLowerCase()}`}
                      iconOnly
                      variant="plain"
                    />
                  </div>
                ))}
              </motion.dl>
            </AnimatePresence>
            <p className={styles.hint}>
              {method === "dns"
                ? "It usually shows up within a minute or two. We look again every 20 seconds while this page is open."
                : "Static files and a one-line route both work. We look again every 20 seconds while this page is open."}
            </p>
          </Card>

          <Card
            title="Let your coding agent do it"
            description="Paste this into Claude Code, Codex or Cursor in your API's repo. It adds the record or the file and checks it's live."
          >
            <PromptBox text={verifyPrompt(claim)} />
          </Card>
        </div>
        <div className={styles.sticky}>
          <Card title="Status">
            <div className={styles.status} aria-live="polite">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.div
                  key={state.kind}
                  className={styles.statusLine}
                  initial={reduce ? { opacity: 0 } : { opacity: 0, y: 3 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, transition: { duration: motionTokens.duration.instant } }}
                  transition={reduce ? { duration: 0 } : motionTokens.spring.smooth}
                >
                  {state.kind === "checking" ? (
                    <>
                      <CircleDashed size={16} strokeWidth={1.75} aria-hidden="true" className={styles.spin} />
                      <TextShimmer>Looking for it now</TextShimmer>
                    </>
                  ) : state.kind === "missing" ? (
                    <>
                      <CircleDashed size={16} strokeWidth={1.75} aria-hidden="true" />
                      <span>
                        Not found yet
                        <small>Last checked {time(state.at)}</small>
                      </span>
                    </>
                  ) : (
                    <>
                      <CircleDashed size={16} strokeWidth={1.75} aria-hidden="true" />
                      <span>
                        Waiting for the record
                        <small>Add it, then check</small>
                      </span>
                    </>
                  )}
                </motion.div>
              </AnimatePresence>
              {state.kind === "missing" && state.error && (
                <p className={styles.statusError}>{state.error}</p>
              )}
            </div>
            <Button onClick={check} loading={state.kind === "checking"}>
              Check now
            </Button>
          </Card>
        </div>
      </Grid>
    </Page>
  )
}

// ----------------------------------------------------------------- Overview

function Stat({
  label,
  value,
  decimals = 0,
  suffix,
  context,
  empty,
}: {
  label: string
  value: number | null
  decimals?: number
  suffix?: string
  context: string
  empty: string
}) {
  return (
    <article className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      {value === null ? (
        <span className={styles.statEmpty}>{empty}</span>
      ) : (
        <span className={styles.statValue}>
          <AnimatedCounter value={value} decimals={decimals} suffix={suffix} />
        </span>
      )}
      <p className={styles.statContext}>{context}</p>
    </article>
  )
}

const RESULT: Record<ApiReview["result"], { label: string; tone: BadgeTone }> = {
  full: { label: "Worked", tone: "success" },
  partial: { label: "Partly worked", tone: "warning" },
  none: { label: "Returned nothing", tone: "danger" },
  not_checked: { label: "Not checked", tone: "neutral" },
}

const FILTERS = [
  { value: "all", label: "All" },
  { value: "full", label: "Worked" },
  { value: "partial", label: "Partly" },
  { value: "none", label: "Failed" },
]

function ReviewRow({ review, reduce }: { review: ApiReview; reduce: boolean }) {
  const result = RESULT[review.result] ?? RESULT.not_checked
  return (
    <motion.li
      layout={!reduce}
      className={styles.review}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: motionTokens.duration.instant } }}
      transition={reduce ? { duration: 0 } : motionTokens.spring.smooth}
    >
      <div className={styles.reviewHead}>
        <Badge tone={result.tone} size="sm" dot>
          {result.label}
        </Badge>
        <span className={styles.reviewTask}>{review.task}</span>
        <code className={styles.reviewEndpoint}>{review.endpoint}</code>
        <span className={styles.reviewDate}>{day(review.created_at)}</span>
      </div>
      {review.note && <p className={styles.reviewNote}>{review.note}</p>}
      {(review.promised || review.delivered) && (
        <dl className={styles.promised}>
          {review.promised && (
            <div>
              <dt>Promised</dt>
              <dd>{review.promised}</dd>
            </div>
          )}
          {review.delivered && (
            <div>
              <dt>Delivered</dt>
              <dd>{review.delivered}</dd>
            </div>
          )}
        </dl>
      )}
      <div className={styles.reviewMeta}>
        {review.seeded && <span>Seeded by 402reviews</span>}
        {review.price_usd != null && <span>Paid ${review.price_usd}</span>}
        {review.transaction_url && (
          <a href={review.transaction_url} target="_blank" rel="noreferrer">
            Payment <ExternalLink size={12} strokeWidth={1.75} aria-hidden="true" />
          </a>
        )}
      </div>
    </motion.li>
  )
}

function Reviews({ reviews }: { reviews: ApiReview[] }) {
  const reduce = !!useReducedMotion()
  const [filter, setFilter] = useState("all")
  const shown =
    filter === "all" ? reviews : reviews.filter((r) => r.result === filter)
  const count = (value: string) =>
    value === "all"
      ? reviews.length
      : reviews.filter((r) => r.result === value).length

  return (
    <Card
      title="Reviews"
      description={
        reviews.length
          ? `${reviews.length} from agents that paid for a call`
          : undefined
      }
      actions={
        reviews.length > 0 ? (
          <SegmentedControl
            label="Filter reviews"
            value={filter}
            onValueChange={setFilter}
            options={FILTERS.map((option) => ({
              ...option,
              accessory: <span className={styles.segmentCount}>{count(option.value)}</span>,
            }))}
          />
        ) : undefined
      }
    >
      {reviews.length === 0 ? (
        <EmptyState
          title="No reviews yet"
          description="They show here as agents pay for and review your API. Seeding gets you the first few."
        />
      ) : shown.length === 0 ? (
        <p className={styles.muted}>No reviews with this result.</p>
      ) : (
        <ul className={styles.reviews}>
          <AnimatePresence initial={false} mode="popLayout">
            {shown.map((review) => (
              <ReviewRow key={review.id} review={review} reduce={reduce} />
            ))}
          </AnimatePresence>
        </ul>
      )}
    </Card>
  )
}

const POINTER_ICON = {
  bad: CircleAlert,
  warn: TriangleAlert,
  good: CircleCheck,
  info: Info,
}

function Pointers({ pointers }: { pointers: Pointer[] }) {
  return (
    <Card
      title="What agents ran into"
      actions={
        <LinkButton href="?view=connect" variant="ghost" size="sm">
          Fix with your agent
          <ArrowRight size={14} strokeWidth={1.75} aria-hidden="true" />
        </LinkButton>
      }
    >
      <ul className={styles.pointers}>
        {pointers.map((pointer) => {
          const Icon = POINTER_ICON[pointer.tone]
          return (
            <li key={pointer.text} data-tone={pointer.tone}>
              <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
              <span>{pointer.text}</span>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

const SEED_STATUS: Record<SeedingRequest["status"], { label: string; tone: BadgeTone }> = {
  open: { label: "Requested", tone: "info" },
  seeded: { label: "Seeded", tone: "success" },
  declined: { label: "Declined", tone: "danger" },
}

function Seeding({
  claim,
  requests,
  maxPrice,
}: {
  claim: Claim
  requests: SeedingRequest[]
  maxPrice: number
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canAsk = !requests.some((request) => request.domain === claim.domain)

  async function ask() {
    setBusy(true)
    setError(null)
    const { ok, data } = await act("seeding", claim.domain, {})
    setBusy(false)
    if (!ok) {
      setError(String(data.error ?? "Couldn't send the request. Try again."))
      return
    }
    router.refresh()
  }

  return (
    <Card
      title="Seeding"
      description={
        canAsk
          ? `We pay for a few real calls to ${claim.domain}, up to $${maxPrice.toFixed(2)} each, and post honest reviews. You can ask once.`
          : "Requests you've sent, newest first."
      }
    >
      {canAsk && (
        <div className={styles.seedAsk}>
          <Button onClick={ask} loading={busy}>
            Request seeding
          </Button>
          {error && <ErrorText>{error}</ErrorText>}
        </div>
      )}
      {requests.length > 0 && (
        <ul className={styles.requests}>
          {requests.map((request) => {
            const status = SEED_STATUS[request.status] ?? SEED_STATUS.open
            return (
              <li key={request.id}>
                <span className={styles.requestText}>
                  <code>{request.domain}</code>
                  <small>
                    {request.status === "seeded"
                      ? `Seeded ${day(request.updated_at)}`
                      : `Sent ${day(request.created_at)}`}
                  </small>
                </span>
                <Badge tone={status.tone} size="sm">
                  {status.label}
                </Badge>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

const PROFILE_FIELDS = ["name", "description", "docs_url", "spec_url", "pricing_url", "contact_email"] as const
type ProfileValues = Record<(typeof PROFILE_FIELDS)[number], string>

// The sections of one verified API, under its title.
function apiTabs(claim: Claim, active: "overview" | "profile") {
  const base = `?api=${encodeURIComponent(claim.domain)}`
  return (
    <PageTabs
      label={`${claim.domain} sections`}
      active={active}
      items={[
        { id: "overview", label: "Overview", href: base },
        { id: "profile", label: "Profile", href: `${base}&tab=profile` },
      ]}
    />
  )
}

function apiTitle(claim: Claim) {
  return claim.profile?.name || claim.domain
}

function apiMeta(claim: Claim) {
  return (
    <span className={styles.titleMeta}>
      <Badge tone="success" size="sm" dot>
        Verified
      </Badge>
      <span>
        {claim.profile?.name ? `${claim.domain}. ` : ""}
        {claim.verified_at
          ? `You've owned this listing since ${day(claim.verified_at)}.`
          : "You own this listing."}
      </span>
    </span>
  )
}

function publicLink(publicUrl: string) {
  return (
    <LinkButton href={publicUrl} target="_blank" rel="noreferrer" variant="secondary">
      Public page
      <ExternalLink size={14} strokeWidth={1.75} aria-hidden="true" />
    </LinkButton>
  )
}

// How the owner's words show on the API's public page, as they type.
function ProfilePreview({ domain, values }: { domain: string; values: ProfileValues }) {
  const links = (
    [
      ["Docs", values.docs_url],
      ["API spec", values.spec_url],
      ["Pricing", values.pricing_url],
    ] as const
  ).filter(([, url]) => url.trim())
  const empty = !values.name.trim() && !values.description.trim() && links.length === 0
  return (
    <Card title="On 402reviews" description={`Shown on ${domain}'s page as "From the owner".`}>
      {empty ? (
        <p className={styles.previewEmpty}>Nothing yet. Fill in the form and it shows here.</p>
      ) : (
        <div className={styles.preview}>
          <span className={styles.previewLabel}>From the owner</span>
          {(values.name.trim() || values.description.trim()) && (
            <p className={styles.previewText}>
              {values.name.trim() && <strong>{values.name.trim()}. </strong>}
              <span>{values.description.trim()}</span>
            </p>
          )}
          {links.length > 0 && (
            <div className={styles.previewLinks}>
              {links.map(([label]) => (
                <span key={label}>
                  {label}
                  <ExternalLink size={12} strokeWidth={1.75} aria-hidden="true" />
                </span>
              ))}
            </div>
          )}
          <span className={styles.previewFoot}>Claiming never changes a rating or hides a review.</span>
        </div>
      )}
    </Card>
  )
}

export function ProfileView({ claim, publicUrl }: { claim: Claim; publicUrl: string }) {
  const router = useRouter()
  const [values, setValues] = useState<ProfileValues>(() => {
    const profile = (claim.profile ?? {}) as Partial<Record<keyof ProfileValues, string | null>>
    return Object.fromEntries(PROFILE_FIELDS.map((key) => [key, profile[key] ?? ""])) as ProfileValues
  })
  const [state, setState] = useState<"idle" | "busy" | "saved">("idle")
  const [error, setError] = useState<string | null>(null)

  async function save(event: FormEvent) {
    event.preventDefault()
    setState("busy")
    setError(null)
    const { ok, data } = await act("profile", claim.domain, values)
    if (!ok) {
      setState("idle")
      setError(String(data.error ?? "Couldn't save. Try again."))
      return
    }
    setState("saved")
    router.refresh()
  }

  const set =
    (key: keyof ProfileValues) =>
    (event: { target: { value: string } }) => {
      setValues((old) => ({ ...old, [key]: event.target.value }))
      setState("idle")
    }

  return (
    <Page
      title={apiTitle(claim)}
      description={apiMeta(claim)}
      actions={publicLink(publicUrl)}
      tabs={apiTabs(claim, "profile")}
    >
      <Grid columns="2-1" align="start">
        <Card
          title="Profile"
          description="How you describe your API on 402reviews, in your own words. It never changes a rating."
        >
          <form onSubmit={save} className={styles.profile}>
            <Input
              label="Name"
              placeholder="Acme Data"
              maxLength={60}
              value={values.name}
              onChange={set("name")}
            />
            <Textarea
              label="What it does"
              placeholder="Market data for trading agents."
              maxLength={280}
              rows={3}
              value={values.description}
              onChange={set("description")}
            />
            <div className={styles.profileRow}>
              <Input
                label="Docs"
                placeholder="https://docs.yourcompany.com"
                value={values.docs_url}
                onChange={set("docs_url")}
                inputMode="url"
              />
              <Input
                label="API spec"
                placeholder="https://yourcompany.com/openapi.json"
                value={values.spec_url}
                onChange={set("spec_url")}
                inputMode="url"
              />
            </div>
            <div className={styles.profileRow}>
              <Input
                label="Pricing"
                placeholder="https://yourcompany.com/pricing"
                value={values.pricing_url}
                onChange={set("pricing_url")}
                inputMode="url"
              />
              <Input
                label="Contact email"
                placeholder="api@yourcompany.com"
                value={values.contact_email}
                onChange={set("contact_email")}
                inputMode="email"
                description="Only 402reviews sees this."
              />
            </div>
            <div className={styles.profileActions}>
              <Button type="submit" loading={state === "busy"}>
                {state === "saved" ? "Saved" : "Save profile"}
              </Button>
              {error && <ErrorText>{error}</ErrorText>}
            </div>
          </form>
        </Card>
        <ProfilePreview domain={claim.domain} values={values} />
      </Grid>
    </Page>
  )
}

export function OverviewView({
  claim,
  data,
  pointers,
  requests,
  publicUrl,
  maxPrice,
}: {
  claim: Claim
  data: ApiData | null
  pointers: Pointer[]
  requests: SeedingRequest[]
  publicUrl: string
  maxPrice: number
}) {
  const rating = data?.rating
  const reviews = data?.reviews ?? []
  const ms = rating?.typical_latency_ms ?? null
  // Matches the public page: a rate from fewer than 3 agents would mislead.
  const likely =
    rating?.works_for_task != null && rating.buyers >= 3
      ? Math.round(rating.works_for_task * 100)
      : null
  return (
    <Page
      title={apiTitle(claim)}
      description={apiMeta(claim)}
      actions={publicLink(publicUrl)}
      tabs={apiTabs(claim, "overview")}
    >
      <div className={styles.stats}>
        <Stat
          label="Rating"
          value={rating?.stars ?? null}
          decimals={1}
          context={
            rating?.stars == null
              ? "Shows after the first review"
              : `Out of 5, from ${reviews.length} ${reviews.length === 1 ? "review" : "reviews"}`
          }
          empty="No rating yet"
        />
        <Stat
          label="Likely to work"
          value={likely}
          suffix="%"
          context={likely === null ? "Shown once 3 agents have paid" : "Across agents that paid"}
          empty="Too early"
        />
        <Stat
          label="Typical speed"
          value={ms === null ? null : ms < 1000 ? ms : Math.round(ms / 100) / 10}
          decimals={ms !== null && ms >= 1000 ? 1 : 0}
          suffix={ms !== null && ms < 1000 ? " ms" : "s"}
          context="How long a call usually takes"
          empty="Not measured"
        />
        <Stat
          label="Reviews"
          value={reviews.length}
          context={`From ${rating?.buyers ?? 0} ${(rating?.buyers ?? 0) === 1 ? "agent" : "agents"}`}
          empty="None"
        />
      </div>

      <Grid columns="2-1">
        <Reviews reviews={reviews} />
        <div className={styles.column}>
          <Pointers pointers={pointers} />
          <Seeding claim={claim} requests={requests} maxPrice={maxPrice} />
        </div>
      </Grid>

    </Page>
  )
}
