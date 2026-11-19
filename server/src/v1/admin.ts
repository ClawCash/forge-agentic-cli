import {
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto"
import type { Context } from "hono"
import { Hono } from "hono"
import { bodyLimit } from "hono/body-limit"
import { z } from "zod"
import { hashKey, type SendCode } from "./accounts.ts"
import { clientIp, rateLimiter } from "./limits.ts"
import { isSeeded } from "./seed.ts"
import type {
  ApiReview,
  ApiReviewStore,
  ApiUser,
  PaymentFailure,
  UsageClient,
  UsageDay,
  UsageUser,
} from "./store.ts"

// The admin dashboard's API: an emailed code for anyone on ADMIN_EMAILS, then a
// week-long session token that reads who signed up and what they did.

const DAY_MS = 86_400_000
const SESSION_MS = 7 * DAY_MS
const CODE_TTL_MS = 10 * 60_000
const RESEND_AFTER_MS = 60_000
const MAX_ATTEMPTS = 5
const DAYS_SHOWN = 30

export const parseAdminEmails = (value: string | undefined) =>
  (value ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)

const RESULT_WORDS: Record<string, string> = {
  full: "worked",
  partial: "partly worked",
  none: "returned nothing",
}

export interface AdminInput {
  users: ApiUser[]
  reviews: ApiReview[]
  failures: PaymentFailure[]
  byDay: UsageDay[]
  byUser: UsageUser[]
  clients: UsageClient[]
}

const dayOf = (date: Date) => date.toISOString().slice(0, 10)

// A user counts as active on a day when they signed up, made a signed-in API
// request, posted a review or reported a failed payment. Days are UTC.
export function buildAdminStats(input: AdminInput, now = new Date()) {
  const days = Array.from({ length: DAYS_SHOWN }, (_, i) =>
    dayOf(new Date(now.getTime() - (DAYS_SHOWN - 1 - i) * DAY_MS))
  )
  const ago = (n: number) => new Date(now.getTime() - n * DAY_MS)
  const emailOf = new Map(input.users.map((user) => [user.id, user.email]))

  const activeOn = new Map<string, Set<string>>()
  const everActive = new Set<string>()
  const lastActive = new Map<string, Date>()
  const mark = (userId: string | null, day: string, at?: Date) => {
    if (!userId) return
    everActive.add(userId)
    const set = activeOn.get(day) ?? new Set()
    set.add(userId)
    activeOn.set(day, set)
    if (at && at > (lastActive.get(userId) ?? new Date(0))) {
      lastActive.set(userId, at)
    }
  }
  for (const user of input.users) {
    mark(user.id, dayOf(user.createdAt), user.createdAt)
  }
  for (const row of input.byDay) mark(row.userId, row.day)
  for (const row of input.byUser)
    mark(row.userId, dayOf(row.lastAt), row.lastAt)
  for (const row of input.reviews)
    mark(row.userId, dayOf(row.createdAt), row.createdAt)
  for (const row of input.failures) {
    mark(row.userId, dayOf(row.createdAt), row.createdAt)
  }

  const activeIn = (count: number) => {
    const set = new Set<string>()
    for (const day of days.slice(-count)) {
      for (const id of activeOn.get(day) ?? []) set.add(id)
    }
    return set.size
  }

  const countBy = <T>(rows: T[], key: (row: T) => string | null) => {
    const counts = new Map<string, number>()
    for (const row of rows) {
      const k = key(row)
      if (k) counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    return counts
  }
  const signupsOn = countBy(input.users, (u) => dayOf(u.createdAt))
  const reviewsOn = countBy(input.reviews, (r) => dayOf(r.createdAt))
  const requestsOn = new Map<string, number>()
  for (const row of input.byDay) {
    requestsOn.set(row.day, (requestsOn.get(row.day) ?? 0) + row.requests)
  }

  const reviewsBy = countBy(input.reviews, (r) => r.userId)
  const seededBy = countBy(input.reviews.filter(isSeeded), (r) => r.userId)
  const failuresBy = countBy(input.failures, (f) => f.userId)
  const requestsBy = new Map(
    input.byUser.map((row) => [row.userId, row.requests])
  )

  const kinds = new Map<string, { signed_in: number; anonymous: number }>()
  for (const row of input.byDay) {
    const entry = kinds.get(row.kind) ?? { signed_in: 0, anonymous: 0 }
    if (row.userId) entry.signed_in += row.requests
    else entry.anonymous += row.requests
    kinds.set(row.kind, entry)
  }
  const requests30 = input.byDay.reduce((sum, row) => sum + row.requests, 0)
  const anonymous30 = input.byDay
    .filter((row) => !row.userId)
    .reduce((sum, row) => sum + row.requests, 0)

  const who = (userId: string | null, wallet?: string) =>
    (userId && emailOf.get(userId)) ??
    (wallet ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : null)
  const activity = [
    ...input.users.map((user) => ({
      at: user.createdAt,
      type: "signup" as const,
      who: user.email,
      title: "Signed up",
      detail: null as string | null,
      seeded: false,
    })),
    ...input.reviews.map((row) => ({
      at: row.createdAt,
      type: "review" as const,
      who: who(row.userId, row.wallet),
      title: `${row.domain}${row.path === "/" ? "" : row.path}`,
      detail: [
        row.task,
        RESULT_WORDS[row.result] ?? row.result,
        row.priceUsd != null ? `$${Number(row.priceUsd.toPrecision(2))}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      seeded: isSeeded(row),
    })),
    ...input.failures.map((row) => ({
      at: row.createdAt,
      type: "failure_report" as const,
      who: who(row.userId),
      title: `${row.domain}${row.path === "/" ? "" : row.path}`,
      detail: [row.task, row.error.replaceAll("_", " ")]
        .filter(Boolean)
        .join(" · "),
      seeded: false,
    })),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, 40)

  return {
    generated_at: now.toISOString(),
    active: {
      dau: activeIn(1),
      wau: activeIn(7),
      mau: activeIn(30),
      tau: everActive.size,
    },
    totals: {
      users: input.users.length,
      users_last_7_days: input.users.filter((u) => u.createdAt >= ago(7))
        .length,
      auto_review_on: input.users.filter((u) => u.autoReview).length,
      reviews: input.reviews.length,
      reviews_seeded: input.reviews.filter(isSeeded).length,
      reviews_last_7_days: input.reviews.filter((r) => r.createdAt >= ago(7))
        .length,
      reviews_without_account: input.reviews.filter((r) => !r.userId).length,
      failure_reports: input.failures.length,
      requests_last_30_days: requests30,
      anonymous_requests_last_30_days: anonymous30,
    },
    daily: days.map((day) => ({
      day,
      active: activeOn.get(day)?.size ?? 0,
      signups: signupsOn.get(day) ?? 0,
      reviews: reviewsOn.get(day) ?? 0,
      requests: requestsOn.get(day) ?? 0,
    })),
    people: input.users
      .map((user) => ({
        email: user.email,
        signed_up_at: user.createdAt.toISOString(),
        last_active_at: (
          lastActive.get(user.id) ?? user.createdAt
        ).toISOString(),
        reviews: reviewsBy.get(user.id) ?? 0,
        seeded_reviews: seededBy.get(user.id) ?? 0,
        failure_reports: failuresBy.get(user.id) ?? 0,
        requests: requestsBy.get(user.id) ?? 0,
        auto_review: user.autoReview,
      }))
      .sort((a, b) => b.last_active_at.localeCompare(a.last_active_at)),
    activity: activity.map((event) => ({
      ...event,
      at: event.at.toISOString(),
    })),
    requests_by_kind: [...kinds]
      .map(([kind, counts]) => ({ kind, ...counts }))
      .sort((a, b) => b.signed_in + b.anonymous - (a.signed_in + a.anonymous)),
    clients: input.clients.map((row) => ({
      client: row.client ?? "unknown",
      requests: row.requests,
    })),
  }
}

export type AdminStats = ReturnType<typeof buildAdminStats>

export function adminRoutes(deps: {
  store: ApiReviewStore
  secret: string
  sendCode: SendCode | null
  adminEmails: string[]
  now?: () => Date
}) {
  const app = new Hono()
  const admins = new Set(parseAdminEmails(deps.adminEmails.join(",")))
  const now = deps.now ?? (() => new Date())
  const hit = rateLimiter()
  const Email = z.email().max(254).toLowerCase()
  const codeKey = (email: string) => `admin:${email}`
  const codeHash = (email: string, code: string) =>
    createHmac("sha256", deps.secret)
      .update(`${codeKey(email)}:${code}`)
      .digest("hex")

  const limited = (c: Context, kind: string, perMinute: number) => {
    const ip = clientIp((name) => c.req.header(name))
    return !hit(`admin-${kind}:${ip}`, perMinute).allowed
  }

  async function session(c: Context) {
    const token = /^Bearer (ads_[\w-]{20,})$/.exec(
      c.req.header("authorization") ?? ""
    )?.[1]
    if (!token) return null
    const tokenHash = hashKey(token)
    const row = await deps.store.adminSession(tokenHash)
    if (!row || row.expiresAt < now() || !admins.has(row.email)) return null
    return row
  }

  app.post("/start", bodyLimit({ maxSize: 2048 }), async (c) => {
    const body = z
      .object({ email: Email })
      .safeParse(await c.req.json().catch(() => null))
    if (!body.success) return c.json({ error: 'Send {"email": "..."}' }, 400)
    if (admins.size === 0 || !deps.sendCode) {
      return c.json({ error: "Admin sign-in isn't set up" }, 503)
    }
    if (limited(c, "start", 5)) {
      return c.json({ error: "Too many tries. Wait a minute." }, 429)
    }
    const { email } = body.data
    // Same answer either way, so the form doesn't reveal who is an admin.
    const sent = { sent: true, expires_in_seconds: CODE_TTL_MS / 1000 }
    if (!admins.has(email)) return c.json(sent)
    const existing = await deps.store.getCode(codeKey(email))
    if (
      existing &&
      now().getTime() - existing.sentAt.getTime() < RESEND_AFTER_MS
    ) {
      return c.json({ error: "A code was just sent. Check your email." }, 429)
    }
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0")
    await deps.store.saveCode({
      email: codeKey(email),
      codeHash: codeHash(email, code),
      expiresAt: new Date(now().getTime() + CODE_TTL_MS),
      attempts: 0,
      sentAt: now(),
    })
    try {
      await deps.sendCode(email, code, "admin")
    } catch (error) {
      console.error(`admin code email failed: ${(error as Error).message}`)
      await deps.store.deleteCode(codeKey(email))
      return c.json({ error: "Could not send the email. Try again." }, 502)
    }
    return c.json(sent)
  })

  app.post("/verify", bodyLimit({ maxSize: 2048 }), async (c) => {
    const body = z
      .object({ email: Email, code: z.string().regex(/^\d{6}$/) })
      .safeParse(await c.req.json().catch(() => null))
    if (!body.success) {
      return c.json({ error: 'Send {"email": "...", "code": "123456"}' }, 400)
    }
    if (limited(c, "verify", 10)) {
      return c.json({ error: "Too many tries. Wait a minute." }, 429)
    }
    const { email, code } = body.data
    const saved = admins.has(email)
      ? await deps.store.getCode(codeKey(email))
      : null
    if (!saved || saved.expiresAt < now()) {
      return c.json({ error: "That code has expired. Ask for a new one." }, 401)
    }
    if (saved.attempts >= MAX_ATTEMPTS) {
      return c.json({ error: "Too many tries. Ask for a new code." }, 429)
    }
    const expected = Buffer.from(saved.codeHash)
    const given = Buffer.from(codeHash(email, code))
    if (!timingSafeEqual(expected, given)) {
      await deps.store.bumpCodeAttempts(codeKey(email))
      return c.json({ error: "That code is not right." }, 401)
    }
    await deps.store.deleteCode(codeKey(email))
    const token = `ads_${randomBytes(32).toString("base64url")}`
    const expiresAt = new Date(now().getTime() + SESSION_MS)
    await deps.store.saveAdminSession({
      tokenHash: hashKey(token),
      email,
      expiresAt,
    })
    return c.json({ token, email, expires_at: expiresAt.toISOString() })
  })

  app.get("/stats", async (c) => {
    if (!(await session(c))) return c.json({ error: "Sign in again" }, 401)
    const at = now()
    const [users, reviews, failures, byDay, byUser, clients] =
      await Promise.all([
        deps.store.listUsers(),
        deps.store.listRecent(100_000),
        deps.store.listPaymentFailures(),
        deps.store.usageByDay(
          new Date(Date.parse(dayOf(at)) - (DAYS_SHOWN - 1) * DAY_MS)
        ),
        deps.store.usageByUser(),
        deps.store.usageClients(new Date(at.getTime() - 7 * DAY_MS), 8),
      ])
    c.header("Cache-Control", "no-store")
    return c.json(
      buildAdminStats({ users, reviews, failures, byDay, byUser, clients }, at)
    )
  })

  app.post("/logout", async (c) => {
    const row = await session(c)
    if (row) await deps.store.deleteAdminSession(row.tokenHash)
    return c.json({ signed_out: true })
  })

  return app
}
