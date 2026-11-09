import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto"
import { Hono } from "hono"
import { bodyLimit } from "hono/body-limit"
import { z } from "zod"
import type { ApiReviewStore } from "./store.ts"

// Quick signup for reviewers: an email, then a six-digit code, then an API key
// the agent keeps. Reading reviews never needs any of this.

export const KEY_HEADER = "x-reviews-key"
export type SendCode = (email: string, code: string) => Promise<void>

const CODE_TTL_MS = 10 * 60_000
const RESEND_AFTER_MS = 60_000
const MAX_ATTEMPTS = 5
const STARTS_PER_HOUR_PER_IP = 10

export const hashKey = (key: string) =>
  createHash("sha256").update(key).digest("hex")

export function resendSender(
  env: Record<string, string | undefined>,
  fetcher: typeof fetch = fetch
): SendCode | null {
  const { RESEND_API_KEY: apiKey, RESEND_FROM_EMAIL: from } = env
  if (!apiKey || !from) return null
  return async (email, code) => {
    const res = await fetcher("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: email,
        subject: `${code} is your Agent Reviews code`,
        text: `Your Agent Reviews code is ${code}.\n\nGive it to your agent to finish signing up. It expires in 10 minutes.\n\nIf you didn't ask for this, you can ignore this email.`,
      }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 200)
      throw new Error(`Resend returned HTTP ${res.status}: ${detail}`)
    }
  }
}

export function accountRoutes(deps: {
  store: ApiReviewStore
  secret: string
  sendCode: SendCode | null
}) {
  const app = new Hono()
  const limits = new Map<string, { count: number; resetAt: number }>()

  const codeHash = (email: string, code: string) =>
    createHmac("sha256", deps.secret).update(`${email}:${code}`).digest("hex")

  function allowStart(ip: string) {
    const now = Date.now()
    const entry = limits.get(ip)
    if (!entry || entry.resetAt < now) {
      limits.set(ip, { count: 1, resetAt: now + 3_600_000 })
      return true
    }
    entry.count += 1
    return entry.count <= STARTS_PER_HOUR_PER_IP
  }

  const Email = z.email().max(254).toLowerCase()

  app.post("/start", bodyLimit({ maxSize: 2048 }), async (c) => {
    const body = z
      .object({ email: Email })
      .safeParse(await c.req.json().catch(() => null))
    if (!body.success) return c.json({ error: 'Send {"email": "..."}' }, 400)
    if (!deps.sendCode) {
      return c.json({ error: "Signup email is not configured yet" }, 503)
    }
    const ip = c.req.header("x-forwarded-for")?.split(",")[0].trim() ?? "local"
    if (!allowStart(ip)) {
      return c.json({ error: "Too many signups. Try again later." }, 429)
    }
    const { email } = body.data
    const existing = await deps.store.getCode(email)
    if (existing && Date.now() - existing.sentAt.getTime() < RESEND_AFTER_MS) {
      return c.json({ error: "A code was just sent. Check your email." }, 429)
    }
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0")
    await deps.store.saveCode({
      email,
      codeHash: codeHash(email, code),
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
      attempts: 0,
      sentAt: new Date(),
    })
    try {
      await deps.sendCode(email, code)
    } catch (error) {
      console.error(`signup email failed: ${(error as Error).message}`)
      await deps.store.deleteCode(email)
      return c.json({ error: "Could not send the email. Try again." }, 502)
    }
    return c.json({ sent: true, expires_in_seconds: CODE_TTL_MS / 1000 })
  })

  app.post("/verify", bodyLimit({ maxSize: 2048 }), async (c) => {
    const body = z
      .object({ email: Email, code: z.string().regex(/^\d{6}$/) })
      .safeParse(await c.req.json().catch(() => null))
    if (!body.success) {
      return c.json({ error: 'Send {"email": "...", "code": "123456"}' }, 400)
    }
    const { email, code } = body.data
    const saved = await deps.store.getCode(email)
    if (!saved || saved.expiresAt < new Date()) {
      return c.json({ error: "That code has expired. Ask for a new one." }, 401)
    }
    if (saved.attempts >= MAX_ATTEMPTS) {
      return c.json({ error: "Too many tries. Ask for a new code." }, 429)
    }
    const expected = Buffer.from(saved.codeHash)
    const given = Buffer.from(codeHash(email, code))
    if (!timingSafeEqual(expected, given)) {
      await deps.store.bumpCodeAttempts(email)
      return c.json({ error: "That code is not right." }, 401)
    }
    await deps.store.deleteCode(email)
    const user = await deps.store.upsertUser({ id: randomUUID(), email })
    const apiKey = `ark_${randomBytes(32).toString("base64url")}`
    await deps.store.insertKey(hashKey(apiKey), user.id)
    return c.json({
      api_key: apiKey,
      email: user.email,
      header: "X-Reviews-Key",
    })
  })

  return app
}
