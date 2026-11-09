import { randomBytes, randomUUID } from "node:crypto"
import { Hono } from "hono"
import { bodyLimit } from "hono/body-limit"
import { cors } from "hono/cors"
import { z } from "zod"
import {
  ChainUnavailableError,
  type FindPayments,
  type FoundPayment,
  priceUsd,
  transactionUrl,
} from "./chains.ts"
import {
  accountRoutes,
  hashKey,
  KEY_HEADER,
  type SendCode,
} from "./accounts.ts"
import { brief, briefDomains, MAX_BRIEF_DOMAINS, ratingsFile } from "./brief.ts"
import { fingerprintOf } from "./fingerprint.ts"
import { isSeeded } from "./seed.ts"
import { domainHealth, healthView } from "./health.ts"
import { clientIp, rateLimiter } from "./limits.ts"
import type { ReadProfile } from "./profiles.ts"
import { type WalletProof, walletProver } from "./proof.ts"
import {
  latestPerAgent,
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
  type ServiceProfile,
} from "./store.ts"
import { locate, type PaymentTerms, type ReadTerms } from "./terms.ts"

// The free reviews API. Search, check, probe and the leaderboard need nothing.
// Writing a review needs a quick email signup and proof that the writer's
// wallet actually paid for the API.

export const TASKS = [
  "web-search",
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

function publicReview(row: ApiReview, counted: boolean) {
  const record = reviewRecord(row)
  return {
    ...record,
    fingerprint: fingerprintOf(record),
    helpfulness: HELPFULNESS_OF[row.satisfaction] ?? row.satisfaction,
    score: reviewScore(row),
    counted,
    verified_payment: true,
    transaction_url: transactionUrl(row.network, record.transaction),
  }
}

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
    const rows = await deps.store.listByDomains([
      ...new Set(targets.map((t) => t.domain)),
    ])
    const prior = await priorFor(filters.task)
    const health = await deps.store.getHealth(targets.map((t) => t.url))
    return targets.map(({ input, domain, path, url }) => {
      const rating = rate(
        rows.filter((row) => row.domain === domain),
        { domain, path, ...filters },
        prior
      )
      return {
        url: input,
        domain,
        ...rating,
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

  // One line per API for a wallet's search results, so an agent sees ratings
  // without making another call.
  app.post("/brief", bodyLimit({ maxSize: 16 * 1024 }), async (c) => {
    const body = await c.req.json().catch(() => null)
    const domains = briefDomains(body?.domains)
    if (domains.length === 0) {
      return c.json({ error: `Pass 1 to ${MAX_BRIEF_DOMAINS} domains` }, 400)
    }
    const [rows, subdomainRows, health, prior] = await Promise.all([
      deps.store.listByDomains(domains),
      deps.store.listBySubdomains(domains),
      deps.store.listHealthByDomains(domains),
      priorFor(undefined),
    ])
    // A directory can list a company's site while reviews name its API host.
    const reviewsOf = (domain: string) => {
      const exact = rows.filter((row) => row.domain === domain)
      return exact.length > 0
        ? exact
        : subdomainRows.filter((row) => row.domain.endsWith(`.${domain}`))
    }
    return c.json(
      brief(
        domains.map((domain) => ({
          domain,
          rating: rate(reviewsOf(domain), { domain, path: "" }, prior),
          down:
            domainHealth(health.filter((row) => row.domain === domain))
              ?.status === "down",
        }))
      )
    )
  })

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
    const [rows, healthDomains, prior] = await Promise.all([
      deps.store.listRecent(5000),
      deps.store.listHealthDomains(),
      priorFor(undefined),
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
      ...new Set([...rows.map((row) => row.domain), ...healthDomains]),
    ]
    return c.json(
      ratingsFile(
        domains.map((domain) => {
          const reviews = rows.filter((row) => row.domain === domain)
          return {
            domain,
            rating: rate(reviews, { domain, path: "" }, prior),
            down:
              domainHealth(health.filter((row) => row.domain === domain))
                ?.status === "down",
            tasks: Object.fromEntries(
              [...new Set(reviews.map((row) => row.task))].map((task) => [
                task,
                rate(
                  reviews,
                  { domain, path: "", task },
                  priors.get(task) as number
                ),
              ])
            ),
          }
        })
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
    const counted = new Set(latestPerAgent(rows).map((row) => row.id))
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
    return c.json({
      domain,
      task: task ?? null,
      known,
      profile: profileView(domain, profile),
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
      reviews: reviews.map((row) => publicReview(row, counted.has(row.id))),
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
    return c.json({
      updated_at: new Date().toISOString(),
      task: task ?? null,
      total_reviews: rows.length,
      total_apis: byDomain.size,
      top: top.map((entry) => {
        return {
          ...entry,
          ...profileView(entry.domain, profiles.get(entry.domain)),
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
