import { randomUUID } from "node:crypto"
import { Hono } from "hono"
import { bodyLimit } from "hono/body-limit"
import { z } from "zod"
import {
  ChainUnavailableError,
  type FindPayments,
  type FoundPayment,
  priceUsd,
} from "./chains.ts"
import {
  accountRoutes,
  hashKey,
  KEY_HEADER,
  type SendCode,
} from "./accounts.ts"
import { type WalletProof, walletProver } from "./proof.ts"
import { type Rating, rate, screenNote, taskPrior } from "./rating.ts"
import {
  type ApiReview,
  type ApiReviewStore,
  type ApiUser,
  PaymentAlreadyReviewedError,
} from "./store.ts"
import type { ReadTerms } from "./terms.ts"

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

const ReviewBody = z.object({
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
  transaction: z.string().trim().min(32).max(120).optional(),
})

export interface V1Deps {
  store: ApiReviewStore
  baseUrl: string
  secret: string
  baseRpcUrl?: string
  findPayments: FindPayments
  sendCode: SendCode | null
  readTerms: ReadTerms
  fetch?: typeof fetch
  // Overrides wallet proof in tests that exercise only the rating flow.
  proveWallet?: (request: Request) => Promise<WalletProof>
}

// A review is filed against an endpoint and rolled up to its domain.
export function locate(input: string) {
  const url = new URL(/^[a-z]+:\/\//i.test(input) ? input : `https://${input}`)
  const domain = url.hostname.toLowerCase().replace(/^www\./, "")
  const path = url.pathname.replace(/\/+$/, "")
  return { domain, path, url: `https://${domain}${path}` }
}

function shortWallet(wallet: string) {
  return `${wallet.slice(0, 6)}…${wallet.slice(-4)}`
}

function publicReview(row: ApiReview) {
  return {
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
    verified_payment: true,
    network: row.network,
    price_usd: row.priceUsd,
    wallet: shortWallet(row.wallet),
    paid_at: row.paidAt.toISOString(),
    created_at: row.createdAt.toISOString(),
  }
}

const rank = (rating: Rating) =>
  ({ use: 0, unknown: 1, caution: 2, avoid: 3 })[rating.verdict] ?? 1

const USAGE_KINDS: [RegExp, string][] = [
  [/\/v1\/check$/, "check"],
  [/\/v1\/search$/, "search"],
  [/\/v1\/probe$/, "probe"],
  [/\/v1\/reviews$/, "review"],
  [/\/v1\/leaderboard$/, "leaderboard"],
  [/\/v1\/services\//, "service"],
]

export function v1Routes(deps: V1Deps) {
  const app = new Hono<{ Variables: { user: ApiUser | null } }>()

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
    return targets.map(({ input, domain, path }) => {
      const rating = rate(
        rows.filter((row) => row.domain === domain),
        { domain, path, ...filters },
        prior
      )
      return {
        url: input,
        domain,
        ...rating,
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
        const { url, ...reviews } = rating
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
          reviews,
        }
      })
      .sort(
        (a, b) =>
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
      rating: rate(rows, { domain, path: "", task }, prior),
      endpoints: paths.map((p) => ({
        endpoint: p || "/",
        url: `https://${domain}${p}`,
        ...rate(rows, { domain, path: p, task }, prior),
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
    if (open) return { payment: open }
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

  app.post("/reviews", bodyLimit({ maxSize: 16 * 1024 }), async (c) => {
    // Read from a copy: MPP verification needs the original request intact.
    const parsed = ReviewBody.safeParse(
      await c.req.raw
        .clone()
        .json()
        .catch(() => null)
    )
    if (!parsed.success) {
      return c.json(
        { error: "Invalid review", issues: parsed.error.issues },
        400
      )
    }
    const body = parsed.data

    const user = c.get("user")
    if (!user) {
      return c.json(
        {
          error:
            "Reviewing needs a quick signup. Send the user's email to POST /v1/auth/start, then the code they receive to POST /v1/auth/verify, and pass the returned key as X-Reviews-Key.",
          signup: {
            start: `${deps.baseUrl}/v1/auth/start`,
            verify: `${deps.baseUrl}/v1/auth/verify`,
            header: "X-Reviews-Key",
          },
        },
        401
      )
    }

    const proof = await prove(c.req.raw)
    if (proof.status === "challenge") return proof.response
    if (proof.status === "invalid") {
      return c.json({ error: proof.reason }, 401)
    }

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
        return c.json(
          {
            error:
              "Could not reach the chain to confirm the payment. Try again shortly.",
          },
          503
        )
      }
      throw error
    }
    if (lookup.problem) {
      return c.json({ error: lookup.problem.error }, lookup.problem.status)
    }
    const payment = lookup.payment as FoundPayment

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
        userId: user.id,
      })
      const response = c.json(
        {
          id: row.id,
          domain: row.domain,
          endpoint: row.path || "/",
          verified_payment: true,
          note_published: row.noteStatus === "clean",
          more: moreLink(row.domain, row.task, row.path),
        },
        201
      )
      proof.headers?.forEach((value, key) => response.headers.set(key, value))
      return response
    } catch (error) {
      if (error instanceof PaymentAlreadyReviewedError) {
        return c.json({ error: error.message }, 409)
      }
      throw error
    }
  })

  // What agents say: the top-rated APIs and the latest verified reviews.
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
    const prior = taskPrior(rows)
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
    return c.json({
      updated_at: new Date().toISOString(),
      task: task ?? null,
      total_reviews: rows.length,
      total_apis: byDomain.size,
      top,
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
