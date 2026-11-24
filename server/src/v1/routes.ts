import { randomBytes, randomUUID } from "node:crypto"
import { Hono } from "hono"
import { bodyLimit } from "hono/body-limit"
import { cors } from "hono/cors"
import { z } from "zod"
import {
  BASE,
  ChainUnavailableError,
  type FindPayments,
  type FoundPayment,
  priceUsd,
  SOLANA,
  TEMPO,
  transactionUrl,
} from "./chains.ts"
import {
  accountRoutes,
  hashKey,
  KEY_HEADER,
  type Notify,
  type SendCode,
  type SendEmail,
} from "./accounts.ts"
import {
  type Alternative,
  brief,
  type BriefEntry,
  briefDomains,
  briefUrls,
  MAX_BRIEF_DOMAINS,
  ratingsFile,
} from "./brief.ts"
import { fingerprintOf } from "./fingerprint.ts"
import { isSeeded } from "./seed.ts"
import { adminRoutes } from "./admin.ts"
import {
  merchantRoutes,
  profileView as merchantProfileView,
  type ResolveTxt,
} from "./merchants.ts"
import { domainHealth, healthView } from "./health.ts"
import { clientIp, rateLimiter } from "./limits.ts"
import type { ReadProfile } from "./profiles.ts"
import { providerRoutes } from "./provider.ts"
import { type WalletProof, walletProver } from "./proof.ts"
import {
  outcomeValue,
  PARENT_TASK,
  type Rating,
  rate,
  reviewScore,
  screenNote,
  taskPrior,
} from "./rating.ts"
import {
  type ApiReview,
  type ApiReviewStore,
  type ApiUser,
  PaymentAlreadyReviewedError,
  type PaymentFailure,
  type ServiceProfile,
} from "./store.ts"
import { locate, type PaymentTerms, type ReadTerms } from "./terms.ts"

// The free reviews API. Search, check, probe and the leaderboard need nothing.
// Writing a review needs a quick email signup and proof that the writer's
// wallet actually paid for the API.

export const TASKS = [
  "web-search",
  "news",
  "web-scrape",
  "token-price",
  "weather",
  "document-extract",
  "image-generation",
  "transcription",
  "translation",
  "enrichment",
  "email",
  "other",
] as const

const Task = z.enum(TASKS)
const REVIEW_WINDOW_DAYS = 30
const MAX_URLS = 50

const HELPFULNESS: Record<string, string> = {
  helpful: "satisfied",
  somewhat: "partly",
  not_helpful: "not_satisfied",
}

const WORKED = (status: number) => status >= 200 && status < 300

// `helpfulness` is the name agents use. `satisfaction` still works, so clients
// built against it keep posting.
function normalizeReview(input: unknown) {
  if (!input || typeof input !== "object") return input
  const { helpfulness, helpfulness_from, ...rest } = input as Record<
    string,
    unknown
  >
  return {
    ...rest,
    satisfaction: rest.satisfaction ?? HELPFULNESS[String(helpfulness)],
    satisfaction_from: rest.satisfaction_from ?? helpfulness_from,
  }
}

const ReviewFields = z.object({
  url: z.url({ protocol: /^https$/ }),
  task: Task,
  result: z.enum(["full", "partial", "none", "not_checked"]),
  listing: z.enum(["accurate", "overstated", "misleading"]),
  satisfaction: z.enum(["satisfied", "partly", "not_satisfied"]),
  satisfaction_from: z.enum(["agent", "user"]).default("agent"),
  problems: z
    .array(
      z.enum([
        "incomplete",
        "wrong_data",
        "malformed",
        "stale",
        "unsupported_input",
        "paid_no_result",
        "slow",
      ])
    )
    .max(7)
    .default([]),
  checked: z
    .enum(["against_source", "cross_checked", "looked_plausible"])
    .optional(),
  pay_again: z.enum(["yes", "if_no_alternative", "no"]).optional(),
  tries: z.number().int().min(1).max(50).optional(),
  language: z.string().trim().toLowerCase().max(16).optional(),
  format: z.string().trim().toLowerCase().max(16).optional(),
  note: z.string().trim().max(200).optional(),
  task_description: z.string().trim().min(3).max(140).optional(),
  promised: z.string().trim().min(3).max(140).optional(),
  delivered: z.string().trim().min(3).max(140).optional(),
  transaction: z.string().trim().min(32).max(120).optional(),
  output_hash: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^sha256:[a-f0-9]{64}$/)
    .optional(),
  output_status: z.number().int().min(100).max(599).optional(),
  output_type: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[\w.+-]+\/[\w.+-]+$/)
    .max(100)
    .optional(),
  output_bytes: z.number().int().min(0).optional(),
  // Names and counts only: the pattern leaves no room for values.
  output_shape: z
    .object({
      fields: z.array(z.string().regex(/^[\w.$\[\]-]{1,64}$/)).max(40),
      items: z.number().int().min(0).optional(),
    })
    .optional(),
  latency_ms: z.number().int().min(0).optional(),
})

export const ReviewBody = z.preprocess(
  normalizeReview,
  ReviewFields.superRefine((review, context) => {
    const failed =
      review.output_status !== undefined && !WORKED(review.output_status)
    const empty = review.output_bytes === 0
    if ((failed || empty) && ["full", "partial"].includes(review.result)) {
      context.addIssue({
        code: "custom",
        path: ["result"],
        message:
          "The output receipt shows a failed or empty response, so the result can't be full or partial",
      })
    }
    if (Boolean(review.promised) !== Boolean(review.delivered)) {
      context.addIssue({
        code: "custom",
        path: [review.promised ? "delivered" : "promised"],
        message: "Send promised and delivered together",
      })
    }
    // Refused here, not dropped later, so the agent can reword it.
    for (const field of ["promised", "delivered"] as const) {
      if (screenNote(review[field]).noteStatus === "held") {
        context.addIssue({
          code: "custom",
          path: [field],
          message:
            "Say this in plain words, with no links, domain names, code, credentials or instructions",
        })
      }
    }
  })
)

export type ReviewInput = z.output<typeof ReviewBody>

export interface V1Deps {
  store: ApiReviewStore
  baseUrl: string
  secret: string
  baseRpcUrl?: string
  findPayments: FindPayments
  sendCode: SendCode | null
  // Emails that can sign in to the admin dashboard.
  adminEmails?: string[]
  // Emails the team about new seeding requests.
  notify?: Notify | null
  // Emails one merchant, such as a seeding confirmation.
  sendEmail?: SendEmail | null
  // Overrides DNS lookups when merchants verify a domain, in tests.
  resolveTxt?: ResolveTxt
  // Lets merchants sign in with Google.
  google?: { clientId: string; clientSecret: string } | null
  readTerms: ReadTerms
  readAdvertised?: (url: string) => Promise<string[]>
  readProfile?: ReadProfile
  fetch?: typeof fetch
  // Overrides wallet proof in tests that exercise only the rating flow.
  proveWallet?: (request: Request) => Promise<WalletProof>
}

export { locate }

function shortWallet(wallet: string) {
  return `${wallet.slice(0, 6)}…${wallet.slice(-4)}`
}

const HELPFULNESS_OF: Record<string, string> = Object.fromEntries(
  Object.entries(HELPFULNESS).map(([name, stored]) => [stored, name])
)

// Everything public about a review that isn't worked out from something else.
// The fingerprint covers exactly these fields.
function reviewRecord(row: ApiReview) {
  const transaction = row.paymentReference.split(":").at(-1) as string
  return {
    id: row.id,
    domain: row.domain,
    endpoint: row.path || "/",
    task: row.task,
    language: row.language,
    format: row.format,
    result: row.result,
    listing: row.listing,
    satisfaction: row.satisfaction,
    satisfaction_from: row.satisfactionFrom,
    problems: row.problems,
    checked: row.checked,
    pay_again: row.payAgain,
    tries: row.tries,
    note: row.noteStatus === "clean" ? row.note : null,
    task_description: row.taskDescription ?? null,
    promised: row.promised ?? null,
    delivered: row.delivered ?? null,
    advertised_fields: row.advertisedFields ?? null,
    proof_method: row.proofMethod,
    network: row.network,
    price_usd: row.priceUsd,
    wallet: shortWallet(row.wallet),
    transaction,
    output:
      row.outputHash || row.outputStatus
        ? {
            hash: row.outputHash ?? null,
            status: row.outputStatus ?? null,
            type: row.outputType ?? null,
            bytes: row.outputBytes ?? null,
            shape: row.outputShape ?? null,
            latency_ms: row.latencyMs ?? null,
          }
        : null,
    paid_at: row.paidAt.toISOString(),
    created_at: row.createdAt.toISOString(),
    ...(isSeeded(row) && { seeded: true }),
  }
}

function publicReview(row: ApiReview) {
  const record = reviewRecord(row)
  return {
    ...record,
    fingerprint: fingerprintOf(record),
    helpfulness: HELPFULNESS_OF[row.satisfaction] ?? row.satisfaction,
    score: reviewScore(row),
    // Every review counts toward its agent's vote, unless nobody judged
    // whether the result was right.
    counted: outcomeValue(row) !== null,
    verified_payment: true,
    transaction_url: transactionUrl(row.network, record.transaction),
  }
}

// Reported payment failures at one endpoint, for showing beside its rating.
function failureSummary(
  reports: PaymentFailure[],
  domain: string,
  path: string
): Rating["payment_failures"] {
  const here = reports.filter((r) => r.domain === domain && r.path === path)
  if (here.length === 0) return null
  return {
    reports: here.length,
    agents: new Set(here.map((r) => r.userId)).size,
    latest_at: new Date(Math.max(...here.map((r) => r.createdAt.getTime())))
      .toISOString()
      .slice(0, 10),
  }
}

export const PAYMENT_ERRORS = [
  "verification_failed",
  "rejected_after_authorization",
  "settlement_unverified",
  "timeout",
  "other",
] as const

const rank = (rating: Rating) =>
  ({ use: 0, unknown: 1, caution: 2, avoid: 3 })[rating.verdict] ?? 1

const USAGE_KINDS: [RegExp, string][] = [
  [/\/v1\/check$/, "check"],
  [/\/v1\/brief$/, "brief"],
  [/\/v1\/ratings$/, "service"],
  [/\/v1\/fingerprints$/, "service"],
  [/\/v1\/search$/, "search"],
  [/\/v1\/probe$/, "probe"],
  [/\/v1\/reviews(\/|$)/, "review"],
  [/\/v1\/reports\//, "review"],
  [/\/v1\/leaderboard$/, "leaderboard"],
  [/\/v1\/services\//, "service"],
  [/\/v1\/domains$/, "service"],
  [/\/v1\/account(\/|$)/, "account"],
]

// Requests per minute, per client. Search and probe cost more because each one
// calls someone else's server.
const LIMITS: Record<string, number> = {
  check: 120,
  brief: 120,
  service: 120,
  leaderboard: 120,
  search: 30,
  probe: 20,
  review: 30,
  account: 60,
}

const ICONS_PER_MINUTE = 600
const PENDING_REVIEW_MS = 24 * 60 * 60_000
const MAX_LOGGED_REVIEWS = 200_000
const DAY_MS = 86_400_000
const PROFILE_FRESH_MS = 7 * DAY_MS
const EMPTY_PROFILE_FRESH_MS = 3_600_000
const PROFILE_WAIT_MS = 2500
const PROFILES_PER_REQUEST = 6

export function v1Routes(deps: V1Deps) {
  const app = new Hono<{ Variables: { user: ApiUser | null } }>()

  const hit = rateLimiter()

  // Public reviews, read directly by the site's review panel.
  app.use("/services/*", cors({ origin: "*", allowMethods: ["GET"] }))

  // Ahead of the limits and tracking below: a page of logos isn't API usage.
  app.get("/services/:domain/icon", async (c) => {
    const client = clientIp((name) => c.req.header(name))
    if (!hit(`icon:${client}`, ICONS_PER_MINUTE).allowed) {
      return c.body(null, 429)
    }
    const domain = c.req.param("domain").toLowerCase()
    const profile = (await deps.store.getProfiles([domain])).get(domain)
    if (!profile?.iconData || !profile.iconType) return c.body(null, 404)
    return new Response(
      new Uint8Array(Buffer.from(profile.iconData, "base64")),
      {
        headers: {
          "Content-Type": profile.iconType,
          "Cache-Control": "public, max-age=86400",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy":
            "default-src 'none'; style-src 'unsafe-inline'; sandbox",
          "Cross-Origin-Resource-Policy": "cross-origin",
        },
      }
    )
  })

  app.use("*", async (c, next) => {
    const kind = USAGE_KINDS.find(([path]) => path.test(c.req.path))?.[1]
    if (!kind) return next()
    const client = clientIp((name) => c.req.header(name))
    const verdict = hit(`${kind}:${client}`, LIMITS[kind])
    if (verdict.allowed) return next()
    c.header("Retry-After", String(verdict.retryAfterSeconds))
    return c.json({ error: "Too many requests. Try again shortly." }, 429)
  })

  // Knows who is calling, when they say, and records what was used. Never
  // records request or response content.
  app.use("*", async (c, next) => {
    const key = c.req.header(KEY_HEADER)
    const user = key ? await deps.store.userForKey(hashKey(key)) : null
    c.set("user", user)
    await next()
    const kind = USAGE_KINDS.find(([path]) => path.test(c.req.path))?.[1]
    if (!kind) return
    void deps.store
      .recordUsage({
        id: randomUUID(),
        userId: user?.id ?? null,
        kind,
        task: c.req.query("task") ?? null,
        domain: c.req.param("domain") ?? null,
        status: c.res.status,
        client:
          (
            c.req.header("x-client-id") ??
            c.req.header("user-agent") ??
            ""
          ).slice(0, 120) || null,
      })
      .catch(() => {})
  })

  app.route(
    "/auth",
    accountRoutes({
      store: deps.store,
      secret: deps.secret,
      sendCode: deps.sendCode,
    })
  )

  app.route(
    "/admin",
    adminRoutes({
      store: deps.store,
      secret: deps.secret,
      sendCode: deps.sendCode,
      adminEmails: deps.adminEmails ?? [],
    })
  )

  app.route(
    "/merchant",
    merchantRoutes({
      store: deps.store,
      secret: deps.secret,
      sendCode: deps.sendCode,
      notify: deps.notify,
      sendEmail: deps.sendEmail,
      readTerms: deps.readTerms,
      resolveTxt: deps.resolveTxt,
      fetch: deps.fetch,
      google: deps.google,
      ...(deps.resolveTxt && { assertPublic: async () => {} }),
    })
  )

  // A merchant's coding agent reads the feedback on their verified APIs.
  app.route(
    "/provider",
    providerRoutes({
      store: deps.store,
      review: publicReview,
      rating: async (rows, domain, path) =>
        rate(rows, { domain, path, task: undefined }, await priorFor(undefined)),
    })
  )

  const NEEDS_KEY =
    "Reviewing needs a quick signup. Send the user's email to POST /v1/auth/start, then the code they receive to POST /v1/auth/verify, and pass the returned key as X-Reviews-Key."
  const signupHelp = () => ({
    start: `${deps.baseUrl}/v1/auth/start`,
    verify: `${deps.baseUrl}/v1/auth/verify`,
    header: "X-Reviews-Key",
  })

  const prove =
    deps.proveWallet ??
    walletProver({
      baseUrl: deps.baseUrl,
      secret: deps.secret,
      baseRpcUrl: deps.baseRpcUrl,
      useProof: deps.store.useProof,
    })
  const fetcher = deps.fetch ?? fetch

  async function priorFor(task: string | undefined) {
    return taskPrior(task ? await deps.store.listByTask(task) : [])
  }

  // Picks the prior for one domain's rating: the task's own, or the parent
  // task's when only its reviews stand in (news rated on web-search reviews).
  async function priorsFor(task: string | undefined) {
    const own = await priorFor(task)
    const parent = task ? PARENT_TASK[task] : undefined
    const parentPrior = parent ? await priorFor(parent) : own
    return (reviews: ApiReview[]) =>
      !parent || reviews.some((row) => row.task === task) ? own : parentPrior
  }

  function moreLink(domain: string, task?: string, path?: string) {
    const query = new URLSearchParams({
      ...(task && { task }),
      ...(path && { endpoint: path }),
    }).toString()
    return `${deps.baseUrl}/v1/services/${domain}${query ? `?${query}` : ""}`
  }

  async function check(
    urls: string[],
    filters: { task?: string; language?: string; format?: string }
  ) {
    const targets = urls.map((url) => ({ input: url, ...locate(url) }))
    const domains = [...new Set(targets.map((t) => t.domain))]
    const [rows, failures] = await Promise.all([
      deps.store.listByDomains(domains),
      deps.store.listPaymentFailures(domains),
    ])
    const priorOf = await priorsFor(filters.task)
    const health = await deps.store.getHealth(targets.map((t) => t.url))
    return targets.map(({ input, domain, path, url }) => {
      const reviews = rows.filter((row) => row.domain === domain)
      const rating = rate(
        reviews,
        { domain, path, ...filters },
        priorOf(reviews)
      )
      return {
        url: input,
        domain,
        ...rating,
        payment_failures: path ? failureSummary(failures, domain, path) : null,
        health: healthView(health.get(url)),
        more: moreLink(domain, filters.task, path),
      }
    })
  }

  const Filters = z.object({
    task: Task.optional(),
    language: z.string().trim().toLowerCase().max(16).optional(),
    format: z.string().trim().toLowerCase().max(16).optional(),
  })

  function parseUrls(urls: string[]) {
    return (
      urls.length > 0 &&
      urls.length <= MAX_URLS &&
      urls.every((url) => {
        try {
          locate(url)
          return true
        } catch {
          return false
        }
      })
    )
  }

  const respondCheck = async (
    c: any,
    urls: string[],
    rawFilters: Record<string, unknown>
  ) => {
    const filters = Filters.safeParse(rawFilters)
    if (!filters.success || !parseUrls(urls)) {
      return c.json(
        {
          error: `Pass 1 to ${MAX_URLS} url values and an optional task (${TASKS.join(", ")})`,
        },
        400
      )
    }
    const results = await check(urls, filters.data)
    const best = results
      .filter((r) => r.verdict === "use" && r.cost_per_success_usd !== null)
      .sort(
        (a, b) =>
          (a.cost_per_success_usd as number) -
          (b.cost_per_success_usd as number)
      )[0]
    return c.json({ results, best: best?.url ?? null })
  }

  app.get("/check", (c) =>
    respondCheck(c, c.req.queries("url") ?? [], c.req.query())
  )

  app.post("/check", bodyLimit({ maxSize: 64 * 1024 }), async (c) => {
    const body = await c.req.json().catch(() => null)
    const { urls, ...filters } = (body ?? {}) as Record<string, unknown>
    return respondCheck(c, Array.isArray(urls) ? urls : [], filters)
  })

  // The best-reviewed endpoint of each domain for a task, best first: rated
  // at least 4 stars by at least 2 agents, likelier than a typical API to
  // work, not down.
  function topFor(
    rows: ApiReview[],
    task: string,
    prior: number,
    down: Set<string>,
    limit = 3
  ): Alternative[] {
    const byDomain = new Map<string, ApiReview[]>()
    for (const row of rows) {
      if (row.task !== task || down.has(row.domain)) continue
      byDomain.set(row.domain, [...(byDomain.get(row.domain) ?? []), row])
    }
    return [...byDomain]
      .flatMap(([domain, domainRows]) => {
        const best = [...new Set(domainRows.map((row) => row.path))]
          .map((path) => ({
            url: `https://${domain}${path}`,
            rating: rate(domainRows, { domain, path, task }, prior),
            networks: [
              ...new Set(
                domainRows
                  .filter((row) => row.path === path)
                  .map((row) => row.network)
              ),
            ],
          }))
          .filter(
            ({ rating }) =>
              rating.scope === "endpoint" &&
              (rating.audit?.agents ?? 0) >= 2 &&
              rating.verdict !== "avoid" &&
              (rating.stars ?? 0) >= 4 &&
              (rating.works_for_task ?? 0) >= prior
          )
          .sort(
            (a, b) =>
              (b.rating.works_for_task as number) -
              (a.rating.works_for_task as number)
          )
        return best.slice(0, 1)
      })
      .sort(
        (a, b) =>
          (b.rating.works_for_task as number) -
            (a.rating.works_for_task as number) ||
          b.rating.buyers - a.rating.buyers
      )
      .slice(0, limit)
  }

  // Domains whose owner has claimed and verified them.
  const verifiedDomains = async () =>
    new Set(
      (await deps.store.claimsFor({}))
        .filter((claim) => claim.status === "verified")
        .map((claim) => claim.domain)
    )

  const downDomains = async () => {
    const domains = await deps.store.listHealthDomains()
    const health = await deps.store.listHealthByDomains(domains)
    return new Set(
      domains.filter(
        (domain) =>
          domainHealth(health.filter((row) => row.domain === domain))
            ?.status === "down"
      )
    )
  }

  // One line per API for a wallet's search results, so an agent sees ratings
  // without making another call. With a task, only reviews for that task
  // count, and well-reviewed APIs the search missed are added.
  app.post("/brief", bodyLimit({ maxSize: 16 * 1024 }), async (c) => {
    const body = await c.req.json().catch(() => null)
    const parsedTask = Task.optional().safeParse(body?.task ?? undefined)
    if (!parsedTask.success) return c.json({ error: "Unknown task" }, 400)
    const task = parsedTask.data
    // The network the searching wallet pays on, when it pays on just one.
    const parsedNetwork = z
      .enum([BASE, TEMPO, SOLANA])
      .optional()
      .safeParse(body?.network ?? undefined)
    if (!parsedNetwork.success) {
      return c.json(
        { error: `network is one of ${BASE}, ${TEMPO}, ${SOLANA}` },
        400
      )
    }
    const network = parsedNetwork.data
    // Domains, or endpoint URLs when the search listed them. Endpoints are
    // only told apart for a task; without one, each domain is rated once.
    const listedTargets = [
      ...briefDomains(body?.domains).map((domain) => ({ domain, path: "" })),
      ...briefUrls(body?.urls),
    ]
    const targets = (
      task
        ? listedTargets
        : [...new Set(listedTargets.map((t) => t.domain))].map((domain) => ({
            domain,
            path: "",
          }))
    ).slice(0, MAX_BRIEF_DOMAINS)
    if (targets.length === 0) {
      return c.json(
        { error: `Pass 1 to ${MAX_BRIEF_DOMAINS} domains or urls` },
        400
      )
    }
    const domains = [...new Set(targets.map((t) => t.domain))]
    const [rows, subdomainRows, health, failures, priorOf] = await Promise.all([
      deps.store.listByDomains(domains),
      deps.store.listBySubdomains(domains),
      deps.store.listHealthByDomains(domains),
      deps.store.listPaymentFailures(domains),
      priorsFor(task),
    ])
    // A directory can list a company's site while reviews name its API host.
    const reviewsOf = (domain: string) => {
      const exact = rows.filter((row) => row.domain === domain)
      return exact.length > 0
        ? exact
        : subdomainRows.filter((row) => row.domain.endsWith(`.${domain}`))
    }
    const listed = (url: string) => {
      const host = new URL(url).hostname
      return domains.some((d) => host === d || host.endsWith(`.${d}`))
    }
    const alternatives = task ? await alternativesFor(task) : []
    const entries: BriefEntry[] = targets.map(({ domain, path }) => {
      const reviews = reviewsOf(domain)
      const rating = rate(reviews, { domain, path, task }, priorOf(reviews))
      // Failures belong to one endpoint: shown with its own rating, or alone.
      const ownEndpoint = rating.scope === "endpoint" || rating.stars === null
      return {
        domain,
        ...(path && { path }),
        rating: {
          ...rating,
          payment_failures:
            path && ownEndpoint ? failureSummary(failures, domain, path) : null,
        },
        down:
          domainHealth(health.filter((row) => row.domain === domain))
            ?.status === "down",
      }
    })
    return c.json(
      brief(entries, {
        task,
        alternatives: alternatives.filter(
          ({ url, networks }) =>
            !listed(url) && (!network || networks?.includes(network))
        ),
      })
    )
  })

  // Well-reviewed endpoints for a task, or for its parent task when it has
  // none of its own.
  async function alternativesFor(task: string) {
    const [recent, down] = await Promise.all([
      deps.store.listRecent(5000),
      downDomains(),
    ])
    const own = topFor(recent, task, await priorFor(task), down)
    const parent = PARENT_TASK[task]
    return own.length > 0 || !parent
      ? own
      : topFor(recent, parent, await priorFor(parent), down)
  }

  // What the public log records, so later changes to a review can be spotted.
  app.get("/fingerprints", async (c) => {
    const rows = await deps.store.listRecent(MAX_LOGGED_REVIEWS)
    const reviews = rows
      .map((row) => {
        const record = reviewRecord(row)
        return {
          id: record.id,
          domain: record.domain,
          fingerprint: fingerprintOf(record),
          created_at: record.created_at,
        }
      })
      .sort(
        (a, b) =>
          a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)
      )
    return c.json({ reviews })
  })

  app.get("/ratings", async (c) => {
    const [rows, healthDomains, prior, failures] = await Promise.all([
      deps.store.listRecent(5000),
      deps.store.listHealthDomains(),
      priorFor(undefined),
      deps.store.listPaymentFailures(),
    ])
    const health = await deps.store.listHealthByDomains(healthDomains)
    const priors = new Map(
      await Promise.all(
        [...new Set(rows.map((row) => row.task))].map(
          async (task) => [task, await priorFor(task)] as const
        )
      )
    )
    const domains = [
      ...new Set([
        ...rows.map((row) => row.domain),
        ...healthDomains,
        ...failures.map((row) => row.domain),
      ]),
    ]
    const isDown = (domain: string) =>
      domainHealth(health.filter((row) => row.domain === domain))?.status ===
      "down"
    const down = new Set(healthDomains.filter(isDown))
    const entries: BriefEntry[] = domains.map((domain) => {
      const reviews = rows.filter((row) => row.domain === domain)
      const failedPaths = [
        ...new Set(
          failures.filter((row) => row.domain === domain).map((r) => r.path)
        ),
      ]
      const failed = (path: string) => failureSummary(failures, domain, path)
      const taskList = [...new Set(reviews.map((row) => row.task))]
      // Each reviewed endpoint, per task it was reviewed for there.
      const endpoints = Object.fromEntries(
        [...new Set(reviews.map((row) => row.path))]
          .filter(Boolean)
          .map((path) => [
            path,
            Object.fromEntries(
              taskList
                .filter((task) =>
                  reviews.some((row) => row.path === path && row.task === task)
                )
                .map((task) => [
                  task,
                  {
                    ...rate(
                      reviews,
                      { domain, path, task },
                      priors.get(task) as number
                    ),
                    payment_failures: failed(path),
                  },
                ])
            ),
          ])
      )
      return {
        domain,
        rating: rate(reviews, { domain, path: "" }, prior),
        down: down.has(domain),
        tasks: Object.fromEntries(
          taskList.map((task) => [
            task,
            rate(
              reviews,
              { domain, path: "", task },
              priors.get(task) as number
            ),
          ])
        ),
        endpoints,
        failures: Object.fromEntries(
          failedPaths
            .filter((path) => !endpoints[path])
            .map((path) => [path, failed(path)])
        ),
      }
    })
    return c.json(
      ratingsFile(
        entries,
        Object.fromEntries(
          [...priors].map(([task, taskPrior]) => [
            task,
            topFor(rows, task, taskPrior, down),
          ])
        )
      )
    )
  })

  // Directory search with ratings added, so one query answers both "what
  // exists" and "does it work".
  app.get("/search", async (c) => {
    const parsed = z
      .object({
        q: z.string().trim().min(2).max(200),
        task: Task.optional(),
        limit: z.coerce.number().int().min(1).max(20).default(10),
      })
      .safeParse(c.req.query())
    if (!parsed.success)
      return c.json({ error: "Pass ?q=<what you need>" }, 400)
    const { q, task, limit } = parsed.data
    let resources: any[]
    try {
      const res = await fetcher(
        `https://api.cdp.coinbase.com/platform/v2/x402/discovery/search?${new URLSearchParams({ query: q, limit: "20" })}`,
        { signal: AbortSignal.timeout(10_000) }
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      resources = ((await res.json()) as { resources?: any[] }).resources ?? []
    } catch {
      return c.json({ error: "Directory search is unavailable" }, 503)
    }
    const urls = resources.map((r) => r.resource as string).filter(parseableUrl)
    const ratings = urls.length ? await check(urls, { task }) : []
    // Within a verdict, most likely to work first. An unreviewed API ranks as
    // a typical one for the task: above a bad review, below a good one.
    const typical = await priorFor(task)
    const chance = (reviews: Rating) => reviews.works_for_task ?? typical
    const results = ratings
      .map((rating, relevance) => {
        const { url, health, ...reviews } = rating
        const listing = resources.find((r) => r.resource === url)
        const accept = listing?.accepts?.[0]
        return {
          url,
          relevance,
          description: listing?.description ?? null,
          service: listing?.serviceName ?? null,
          price_usd:
            accept?.amount && /^\d+$/.test(accept.amount)
              ? priceUsd(accept.asset ?? "", BigInt(accept.amount))
              : null,
          payers_30d: listing?.quality?.l30DaysUniquePayers ?? null,
          health,
          reviews,
        }
      })
      .sort(
        (a, b) =>
          Number(a.health?.status === "down") -
            Number(b.health?.status === "down") ||
          rank(a.reviews as Rating) - rank(b.reviews as Rating) ||
          chance(b.reviews as Rating) - chance(a.reviews as Rating) ||
          a.relevance - b.relevance
      )
      .slice(0, limit)
      .map(({ relevance: _, ...result }) => result)
    return c.json({ query: q, results })
  })

  // Domain page: the rollup, every reviewed endpoint, and filterable reviews.
  app.get("/services/:domain", async (c) => {
    const parsed = z
      .object({
        task: Task.optional(),
        endpoint: z.string().max(300).optional(),
        problem: z.string().max(40).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(25),
      })
      .safeParse(c.req.query())
    if (!parsed.success) return c.json({ error: "Invalid filters" }, 400)
    const { task, endpoint, problem, limit } = parsed.data
    const domain = c.req
      .param("domain")
      .toLowerCase()
      .replace(/^www\./, "")
    const rows = await deps.store.listByDomains([domain])
    const prior = await priorFor(task)
    const path = endpoint?.replace(/\/+$/, "")
    const paths = [...new Set(rows.map((row) => row.path))]
    const healthRows = await deps.store.listHealthByDomains([domain])
    const known = rows.length > 0 || healthRows.length > 0
    const profile = known
      ? (await profilesFor([domain])).get(domain)
      : undefined
    const reviews = rows
      .filter(
        (row) =>
          (!task || row.task === task) &&
          (path === undefined || row.path === path) &&
          (!problem || row.problems.includes(problem))
      )
      .slice(0, limit)
    const owner = (await deps.store.claimsFor({ domain })).find(
      (claim) => claim.status === "verified"
    )
    const ownerProfile = owner
      ? merchantProfileView(
          (await deps.store.merchantProfiles([domain])).get(domain)
        )
      : null
    return c.json({
      domain,
      task: task ?? null,
      known,
      profile: profileView(domain, profile),
      // Claimed and verified by the API's owner. Their words, never a rating.
      owner: owner
        ? {
            claimed: true,
            verified_at: owner.verifiedAt?.toISOString() ?? null,
            name: ownerProfile?.name ?? null,
            description: ownerProfile?.description ?? null,
            docs_url: ownerProfile?.docs_url ?? null,
            spec_url: ownerProfile?.spec_url ?? null,
            pricing_url: ownerProfile?.pricing_url ?? null,
          }
        : null,
      health: domainHealth(healthRows),
      rating: rate(rows, { domain, path: "", task }, prior),
      endpoints: paths.map((p) => ({
        endpoint: p || "/",
        url: `https://${domain}${p}`,
        ...rate(rows, { domain, path: p, task }, prior),
        health: healthView(
          healthRows.find((row) => locate(row.url).path === p)
        ),
      })),
      reviews: reviews.map(publicReview),
    })
  })

  // A live, unpaid look at an endpoint: is it up, and what does it charge?
  app.get("/probe", async (c) => {
    const url = c.req.query("url")
    if (!url || !parseableUrl(url)) return c.json({ error: "Pass ?url=" }, 400)
    const terms = await deps.readTerms(locate(url).url)
    return c.json({
      url,
      live: terms.live,
      status: terms.status,
      paid: terms.status === 402,
      protocols: terms.protocols,
      accepts: terms.accepts.map((accept) => ({
        network: accept.network,
        pay_to: accept.payTo,
        price_usd:
          accept.amount && /^\d+$/.test(accept.amount)
            ? priceUsd(accept.asset, BigInt(accept.amount))
            : null,
      })),
      ...(terms.error && { error: terms.error }),
    })
  })

  // Kept with the review, so a later change to the listing can't rewrite it.
  async function advertisedFields(url: string, terms?: PaymentTerms) {
    if (terms?.advertised?.length) return terms.advertised
    return (await deps.readAdvertised?.(url).catch(() => [])) ?? []
  }

  async function findUnreviewedPayment(
    wallet: string,
    url: string,
    transaction: string | undefined
  ) {
    const terms = await deps.readTerms(url)
    if (terms.accepts.length === 0) {
      return {
        problem: {
          status: 422 as const,
          error: `${url} did not return x402 or MPP payment terms, so a payment to it can't be confirmed`,
        },
      }
    }
    const since = new Date(Date.now() - REVIEW_WINDOW_DAYS * 86_400_000)
    const found: FoundPayment[] = []
    for (const accept of terms.accepts) {
      found.push(
        ...(await deps.findPayments({
          wallet,
          target: accept,
          transaction,
          since,
        }))
      )
    }
    const used = await deps.store.usedReferences(found.map((p) => p.reference))
    const open = found
      .filter((payment) => !used.has(payment.reference))
      .sort((a, b) => b.paidAt.getTime() - a.paidAt.getTime())[0]
    if (open) return { payment: open, terms }
    return {
      problem:
        found.length > 0
          ? {
              status: 409 as const,
              error:
                "Every recent payment from this wallet already has a review",
            }
          : {
              status: 403 as const,
              error: `No settled payment from ${wallet} to this API in the last ${REVIEW_WINDOW_DAYS} days. Reviews can only come from the wallet that paid.`,
            },
    }
  }

  type VerifiedProof = Extract<WalletProof, { status: "verified" }>

  async function fileReview(
    body: ReviewInput,
    userId: string,
    proof: VerifiedProof
  ) {
    const where = locate(body.url)
    let lookup
    try {
      lookup = await findUnreviewedPayment(
        proof.wallet,
        where.url,
        body.transaction
      )
    } catch (error) {
      if (error instanceof ChainUnavailableError) {
        return Response.json(
          {
            error:
              "Could not reach the chain to confirm the payment. Try again shortly.",
          },
          { status: 503 }
        )
      }
      throw error
    }
    if (lookup.problem) {
      return Response.json(
        { error: lookup.problem.error },
        { status: lookup.problem.status }
      )
    }
    const payment = lookup.payment as FoundPayment
    const goal = screenNote(body.task_description)
    const advertised = body.output_shape
      ? await advertisedFields(where.url, lookup.terms)
      : []

    try {
      const row = await deps.store.insert({
        id: `rev_${randomUUID()}`,
        domain: where.domain,
        path: where.path,
        url: where.url,
        task: body.task,
        language: body.language ?? null,
        format: body.format ?? null,
        result: body.result,
        listing: body.listing,
        satisfaction: body.satisfaction,
        satisfactionFrom: body.satisfaction_from,
        problems: body.problems,
        checked: body.checked ?? null,
        payAgain: body.pay_again ?? null,
        tries: body.tries ?? null,
        taskDescription: goal.noteStatus === "clean" ? goal.note : null,
        promised: screenNote(body.promised).note,
        delivered: screenNote(body.delivered).note,
        ...screenNote(body.note),
        wallet: proof.wallet.startsWith("0x")
          ? proof.wallet.toLowerCase()
          : proof.wallet,
        network: payment.network,
        paymentReference: payment.reference,
        asset: payment.asset,
        amountAtomic: payment.amount.toString(),
        priceUsd: priceUsd(payment.asset, payment.amount),
        paidAt: payment.paidAt,
        proofMethod: proof.method,
        userId,
        outputHash: body.output_hash ?? null,
        outputStatus: body.output_status ?? null,
        outputType: body.output_type ?? null,
        outputBytes: body.output_bytes ?? null,
        outputShape: body.output_shape ?? null,
        advertisedFields: advertised.length > 0 ? advertised : null,
        latencyMs: body.latency_ms ?? null,
      })
      const response = Response.json(
        {
          id: row.id,
          domain: row.domain,
          endpoint: row.path || "/",
          verified_payment: true,
          note_published: row.noteStatus === "clean",
          more: moreLink(row.domain, row.task, row.path),
        },
        { status: 201 }
      )
      proof.headers?.forEach((value, key) => response.headers.set(key, value))
      return response
    } catch (error) {
      if (error instanceof PaymentAlreadyReviewedError) {
        return Response.json({ error: error.message }, { status: 409 })
      }
      throw error
    }
  }

  // A payment that failed without charging the agent. Nothing settled, so it
  // can't be proved: it's kept apart from reviews, shown beside the endpoint's
  // rating as unverified, and never changes it. One per agent, endpoint and day.
  app.post(
    "/reports/payment-failure",
    bodyLimit({ maxSize: 4096 }),
    async (c) => {
      const parsed = z
        .object({
          url: z.string().url().max(500),
          task: Task.optional(),
          error: z.enum(PAYMENT_ERRORS),
        })
        .safeParse(await c.req.json().catch(() => null))
      if (!parsed.success) {
        return c.json(
          {
            error: `Send {"url": "...", "error": "...", "task": "..."}. error is one of ${PAYMENT_ERRORS.join(", ")}`,
          },
          400
        )
      }
      const user = c.get("user")
      if (!user) return c.json({ error: NEEDS_KEY, signup: signupHelp() }, 401)
      if (!parsed.data.url.startsWith("https://")) {
        return c.json({ error: "Only https endpoints" }, 400)
      }
      const { domain, path } = locate(parsed.data.url)
      const earlier = (await deps.store.listPaymentFailures([domain])).find(
        (row) =>
          row.userId === user.id &&
          row.path === path &&
          Date.now() - row.createdAt.getTime() < DAY_MS
      )
      if (earlier) {
        return c.json({
          id: earlier.id,
          recorded: false,
          note: "You already reported this endpoint today.",
        })
      }
      const report = await deps.store.insertPaymentFailure({
        id: `pf_${randomUUID()}`,
        domain,
        path,
        task: parsed.data.task ?? null,
        userId: user.id,
        error: parsed.data.error,
      })
      return c.json(
        {
          id: report.id,
          recorded: true,
          note: "Recorded as unverified. It shows beside this endpoint's rating and never changes it.",
        },
        201
      )
    }
  )

  const invalidReview = (issues: z.core.$ZodIssue[]) =>
    Response.json({ error: "Invalid review", issues }, { status: 400 })

  // Checks and stores a review, and hands back the one URL a wallet client has
  // to open to prove it paid. Nothing secret goes through the wallet client.
  app.post("/reviews/prepare", bodyLimit({ maxSize: 16 * 1024 }), async (c) => {
    const parsed = ReviewBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalidReview(parsed.error.issues)
    const user = c.get("user")
    if (!user) return c.json({ error: NEEDS_KEY, signup: signupHelp() }, 401)
    const id = `rv_${randomBytes(18).toString("base64url")}`
    const expiresAt = new Date(Date.now() + PENDING_REVIEW_MS)
    await deps.store.savePending({
      id,
      userId: user.id,
      body: parsed.data,
      expiresAt,
    })
    return c.json(
      {
        id,
        submit_url: `${deps.baseUrl}/v1/reviews/submit/${id}`,
        expires_at: expiresAt.toISOString(),
      },
      201
    )
  })

  app.on(["GET", "POST"], "/reviews/submit/:id", async (c) => {
    const pending = await deps.store.getPending(c.req.param("id"))
    if (!pending || pending.expiresAt < new Date()) {
      return c.json(
        {
          error:
            "This review link has expired or was already used. Prepare the review again.",
        },
        404
      )
    }
    const proof = await prove(c.req.raw)
    if (proof.status === "challenge") return proof.response
    if (proof.status === "invalid") {
      return c.json({ error: proof.reason }, 401)
    }
    const response = await fileReview(
      pending.body as ReviewInput,
      pending.userId,
      proof
    )
    if (response.ok) await deps.store.deletePending(pending.id)
    return response
  })

  app.post("/reviews", bodyLimit({ maxSize: 16 * 1024 }), async (c) => {
    // Read from a copy: MPP verification needs the original request intact.
    const parsed = ReviewBody.safeParse(
      await c.req.raw
        .clone()
        .json()
        .catch(() => null)
    )
    if (!parsed.success) return invalidReview(parsed.error.issues)
    // Wallet clients often probe without custom headers and give up on
    // anything but a 402, so the key is only checked once a proof arrives.
    const proof = await prove(c.req.raw)
    if (proof.status === "challenge") return proof.response
    if (proof.status === "invalid") {
      return c.json({ error: proof.reason }, 401)
    }
    const user = c.get("user")
    if (!user) {
      return c.json(
        {
          error: `No X-Reviews-Key header reached the server. Some wallet clients drop custom headers: use POST /v1/reviews/prepare and open the submit_url it returns instead.`,
          signup: signupHelp(),
        },
        401
      )
    }
    return fileReview(parsed.data, user.id, proof)
  })

  // The signed-in user's settings. Auto-review is their standing permission to
  // post reviews without being asked each time.
  const accountView = (user: ApiUser) => ({
    email: user.email,
    auto_review: user.autoReview,
  })
  const SIGN_IN_FIRST = "Send your key as X-Reviews-Key, or sign up first"

  app.get("/account", (c) => {
    const user = c.get("user")
    return user
      ? c.json(accountView(user))
      : c.json({ error: SIGN_IN_FIRST }, 401)
  })

  app.post("/account", bodyLimit({ maxSize: 2048 }), async (c) => {
    const user = c.get("user")
    if (!user) return c.json({ error: SIGN_IN_FIRST }, 401)
    const body = z
      .object({ auto_review: z.boolean() })
      .safeParse(await c.req.json().catch(() => null))
    if (!body.success) {
      return c.json({ error: 'Send {"auto_review": true} or false' }, 400)
    }
    const updated = await deps.store.setAutoReview(
      user.id,
      body.data.auto_review
    )
    return c.json(accountView(updated))
  })

  // Replaces a key that may have leaked, without losing the account.
  app.post("/account/rotate-key", async (c) => {
    const user = c.get("user")
    const current = c.req.header(KEY_HEADER)
    if (!user || !current) return c.json({ error: SIGN_IN_FIRST }, 401)
    const apiKey = `ark_${randomBytes(32).toString("base64url")}`
    await deps.store.insertKey(hashKey(apiKey), user.id)
    await deps.store.deleteKey(hashKey(current))
    return c.json({ api_key: apiKey, header: KEY_HEADER })
  })

  // What agents say: the top-rated APIs and the latest verified reviews.
  const refreshing = new Set<string>()

  function profileView(domain: string, profile: ServiceProfile | undefined) {
    return {
      name: profile?.name ?? null,
      description: profile?.description ?? null,
      icon_url: profile?.iconData
        ? `${deps.baseUrl}/v1/services/${domain}/icon`
        : null,
      url: profile?.siteUrl ?? null,
    }
  }

  // Every API with a public page, for the site's sitemap.
  app.get("/domains", async (c) => {
    const [recent, checked] = await Promise.all([
      deps.store.listRecent(5000),
      deps.store.listHealthDomains(),
    ])
    const reviewed = new Set(recent.map((row) => row.domain))
    return c.json({
      domains: [...new Set([...reviewed, ...checked])].map((domain) => ({
        domain,
        reviewed: reviewed.has(domain),
      })),
    })
  })

  // Fills in missing or old profiles, waiting only briefly so a slow seller
  // can't hold up the leaderboard. Whatever isn't ready shows on the next load.
  async function profilesFor(domains: string[]) {
    const profiles = await deps.store.getProfiles(domains)
    const readProfile = deps.readProfile
    if (!readProfile) return profiles
    const now = Date.now()
    const stale = domains
      .filter((domain) => {
        if (refreshing.has(domain)) return false
        const known = profiles.get(domain)
        if (!known) return true
        const fresh =
          known.name || known.description
            ? PROFILE_FRESH_MS
            : EMPTY_PROFILE_FRESH_MS
        return now - known.fetchedAt.getTime() > fresh
      })
      .slice(0, PROFILES_PER_REQUEST)
    if (stale.length === 0) return profiles

    const refresh = Promise.all(
      stale.map(async (domain) => {
        refreshing.add(domain)
        try {
          const read = await readProfile(domain)
          const known = profiles.get(domain)
          const icon = read.iconData ? read : known
          const profile = {
            domain,
            name: read.name ?? known?.name ?? null,
            description: read.description ?? known?.description ?? null,
            iconType: icon?.iconType ?? null,
            iconData: icon?.iconData ?? null,
            siteUrl: read.siteUrl ?? known?.siteUrl ?? null,
            fetchedAt: new Date(),
          }
          await deps.store.saveProfile(profile)
          profiles.set(domain, profile)
        } catch {
          // Tried again on a later load.
        } finally {
          refreshing.delete(domain)
        }
      })
    )
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([
      refresh,
      new Promise((resolve) => {
        timer = setTimeout(resolve, PROFILE_WAIT_MS)
      }),
    ])
    clearTimeout(timer)
    return profiles
  }

  // Public totals for the site, cached for a minute so the home page can't
  // turn into a counting load on the database.
  let statsCache: { at: number; body: Record<string, unknown> } | null = null
  app.get("/stats", async (c) => {
    if (!statsCache || Date.now() - statsCache.at > 60_000) {
      const stats = await deps.store.stats()
      statsCache = {
        at: Date.now(),
        body: {
          updated_at: new Date().toISOString(),
          reviews: stats.reviews,
          apis_reviewed: stats.apisReviewed,
          buyers: stats.buyers,
          paid_usd: Math.round(stats.paidUsd * 100) / 100,
          checks: stats.checks,
          apis_tracked: stats.apisTracked,
        },
      }
    }
    c.header("Cache-Control", "public, max-age=60")
    return c.json(statsCache.body)
  })

  app.get("/leaderboard", async (c) => {
    const parsed = z
      .object({
        task: Task.optional(),
        limit: z.coerce.number().int().min(1).max(100).default(25),
      })
      .safeParse(c.req.query())
    if (!parsed.success) return c.json({ error: "Invalid filters" }, 400)
    const { task, limit } = parsed.data
    const recent = await deps.store.listRecent(5000)
    const rows = task ? recent.filter((row) => row.task === task) : recent
    const prior = await priorFor(task)
    const byDomain = new Map<string, ApiReview[]>()
    for (const row of rows) {
      byDomain.set(row.domain, [...(byDomain.get(row.domain) ?? []), row])
    }
    const top = [...byDomain]
      .map(([domain, domainRows]) => ({
        domain,
        ...rate(domainRows, { domain, path: "", task }, prior),
      }))
      .filter((entry) => entry.works_for_task !== null)
      .sort(
        (a, b) =>
          (b.works_for_task as number) - (a.works_for_task as number) ||
          b.buyers - a.buyers
      )
      .slice(0, limit)
      .map((entry, index) => {
        const {
          scope: _,
          domain_rating: __,
          cost_per_success_usd: ___,
          ...rest
        } = entry
        return { rank: index + 1, ...rest }
      })
    const topDomains = top.map((entry) => entry.domain)
    const profiles = await profilesFor(topDomains)
    const health = await deps.store.listHealthByDomains(topDomains)
    const verified = await verifiedDomains()
    return c.json({
      updated_at: new Date().toISOString(),
      task: task ?? null,
      total_reviews: rows.length,
      total_apis: byDomain.size,
      top: top.map((entry) => {
        return {
          ...entry,
          ...profileView(entry.domain, profiles.get(entry.domain)),
          verified: verified.has(entry.domain),
          health: domainHealth(
            health.filter((row) => row.domain === entry.domain)
          ),
        }
      }),
      recent: rows
        .filter((row) => row.noteStatus === "clean" && row.note)
        .slice(0, 12)
        .map((row) => ({
          domain: row.domain,
          endpoint: row.path || "/",
          task: row.task,
          satisfaction: row.satisfaction,
          note: row.note,
          created_at: row.createdAt.toISOString(),
        })),
    })
  })

  return app
}

function parseableUrl(url: string) {
  try {
    locate(url)
    return true
  } catch {
    return false
  }
}
