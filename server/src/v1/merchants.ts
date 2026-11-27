import {
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto"
import { resolveTxt as dnsResolveTxt } from "node:dns/promises"
import type { Context } from "hono"
import { Hono } from "hono"
import { bodyLimit } from "hono/body-limit"
import { z } from "zod"
import {
  hashKey,
  type Notify,
  type SendCode,
  type SendEmail,
} from "./accounts.ts"
import { priceUsd } from "./chains.ts"
import { type DiscoverEndpoints, endpointDiscoverer } from "./discover.ts"
import { chainRefunds, type FindRefund } from "./chains.ts"
import { attachRefund, refundView } from "./refunds.ts"
import { clientIp, rateLimiter } from "./limits.ts"
import { approveGrant, clientFor, OauthError } from "./oauth.ts"
import type {
  ApiReviewStore,
  MerchantClaim,
  MerchantProfile,
  ProviderKey,
  SeedingRequest,
} from "./store.ts"
import { assertPublicHttps, locate, type ReadTerms } from "./terms.ts"

// Merchants sign in with an emailed code, claim their API's domain, prove it
// by showing the claim's code on that domain, then edit the API's profile and
// ask 402reviews to seed reviews of a few cheap endpoints. None of this ever
// changes a rating or hides a review.

const DAY_MS = 86_400_000
const SESSION_MS = 30 * DAY_MS
const CODE_TTL_MS = 10 * 60_000
const RESEND_AFTER_MS = 60_000
const MAX_ATTEMPTS = 5
const MAX_CLAIMS_PER_EMAIL = 20
const MAX_PROVIDER_KEYS = 5

// What a merchant sees about one of their provider keys. Never the key itself.
function providerKeyView(key: ProviderKey) {
  return {
    id: key.id,
    prefix: key.prefix,
    // The app that made it by signing in, or null for a key made by hand.
    name: key.name ?? null,
    created_at: key.createdAt.toISOString(),
    last_used_at: key.lastUsedAt?.toISOString() ?? null,
  }
}

// 402reviews pays for seeding, so it covers only cheap calls: at most
// $0.50 for an API, one call to each endpoint picked.
export const SEED_MAX_PRICE_USD = 0.05
export const SEED_MAX_ENDPOINTS = 10

// Where a domain can show a claim's code. Names are about the job, not the
// brand, and more can be added later without breaking verified claims.
export const VERIFY_NAMES = [
  {
    record: "_api-reviews",
    file: "api-reviews.txt",
    prefix: "api-reviews-verification=",
  },
]

export function verificationSteps(domain: string, code: string) {
  const name = VERIFY_NAMES[0]
  return {
    code,
    dns: {
      type: "TXT",
      name: `${name.record}.${domain}`,
      value: `${name.prefix}${code}`,
    },
    file: {
      url: `https://${domain}/.well-known/${name.file}`,
      contents: `${name.prefix}${code}`,
    },
  }
}

export type ResolveTxt = (name: string) => Promise<string[][]>

export async function checkOwnership(
  domain: string,
  code: string,
  deps: {
    resolveTxt: ResolveTxt
    fetcher: typeof fetch
    assertPublic: (url: string) => Promise<void>
  }
): Promise<{ method: "dns" | "file" } | { error: string }> {
  for (const name of VERIFY_NAMES) {
    const expected = `${name.prefix}${code}`
    const records = await deps
      .resolveTxt(`${name.record}.${domain}`)
      .catch(() => [] as string[][])
    if (records.some((chunks) => chunks.join("").trim() === expected)) {
      return { method: "dns" }
    }
    const url = `https://${domain}/.well-known/${name.file}`
    try {
      await deps.assertPublic(url)
      const res = await deps.fetcher(url, {
        redirect: "manual",
        headers: { "User-Agent": "402reviews-verify/1" },
        signal: AbortSignal.timeout(8000),
      })
      if (res.ok) {
        const text = (await res.text()).slice(0, 4096)
        if (
          text
            .split(/\s+/)
            .some((token) => token === expected || token === code)
        ) {
          return { method: "file" }
        }
      }
    } catch {}
  }
  const steps = verificationSteps(domain, code)
  return {
    error: `The code isn't showing yet. Add the TXT record at ${steps.dns.name} or the file at ${steps.file.url}, then check again. DNS changes can take a few minutes.`,
  }
}

const HOST =
  /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

// The domain a merchant typed, as a bare hostname, or null.
export function claimDomain(input: string) {
  try {
    const { domain } = locate(input.trim())
    return HOST.test(domain) ? domain : null
  } catch {
    return null
  }
}

const iso = (date: Date | null) => (date ? date.toISOString() : null)

export function profileView(profile: MerchantProfile | undefined) {
  return profile
    ? {
        name: profile.name,
        description: profile.description,
        docs_url: profile.docsUrl,
        spec_url: profile.specUrl,
        pricing_url: profile.pricingUrl,
        contact_email: profile.contactEmail,
        updated_at: iso(profile.updatedAt),
      }
    : null
}

export function seedingView(request: SeedingRequest) {
  return {
    id: request.id,
    domain: request.domain,
    email: request.email,
    endpoints: request.endpoints.map((e) => ({
      url: e.url,
      price_usd: e.priceUsd,
    })),
    notes: request.notes,
    status: request.status,
    created_at: iso(request.createdAt),
    updated_at: iso(request.updatedAt),
  }
}

export function merchantRoutes(deps: {
  store: ApiReviewStore
  secret: string
  sendCode: SendCode | null
  notify?: Notify | null
  // Emails one merchant, such as a seeding confirmation.
  sendEmail?: SendEmail | null
  readTerms: ReadTerms
  // Finds a domain's paid endpoints for the seeding picker.
  discover?: DiscoverEndpoints
  // Reads refunds on chain, when an owner attaches one to a review.
  findRefund?: FindRefund
  resolveTxt?: ResolveTxt
  fetch?: typeof fetch
  assertPublic?: (url: string) => Promise<void>
  // "Continue with Google", when GOOGLE_CLIENT_ID and _SECRET are set.
  google?: { clientId: string; clientSecret: string } | null
  // This API's public address, the issuer apps sign in against.
  baseUrl?: string
  now?: () => Date
}) {
  const app = new Hono()
  const now = deps.now ?? (() => new Date())
  const discover =
    deps.discover ??
    endpointDiscoverer({
      readTerms: deps.readTerms,
      priceUsd,
      fetcher: deps.fetch ?? fetch,
      assertPublic: deps.assertPublic ?? assertPublicHttps,
    })
  const hit = rateLimiter()
  const Email = z.email().max(254).toLowerCase()
  const codeKey = (email: string) => `merchant:${email}`
  const codeHash = (email: string, code: string) =>
    createHmac("sha256", deps.secret)
      .update(`${codeKey(email)}:${code}`)
      .digest("hex")
  const limited = (c: Context, kind: string, perMinute: number, who = "") =>
    !hit(
      `merchant-${kind}:${who || clientIp((name) => c.req.header(name))}`,
      perMinute
    ).allowed

  // For the admin dashboard. A failure here never fails the request.
  const record = (email: string, kind: string, domain: string | null = null, detail: string | null = null) =>
    deps.store
      .recordMerchantEvent({ id: randomUUID(), email, kind, domain, detail })
      .catch((error: Error) => console.error(`merchant event failed: ${error.message}`))

  async function sessionEmail(c: Context) {
    const token = /^Bearer (mrs_[\w-]{20,})$/.exec(
      c.req.header("authorization") ?? ""
    )?.[1]
    if (!token) return null
    const row = await deps.store.merchantSession(hashKey(token))
    return row && row.expiresAt > now() ? row.email : null
  }

  // The signed-in merchant's claim to a domain, if any.
  async function claimOf(email: string, domain: string) {
    const claims = await deps.store.claimsFor({ domain })
    return {
      mine: claims.find((claim) => claim.email === email) ?? null,
      takenByOther: claims.some(
        (claim) => claim.status === "verified" && claim.email !== email
      ),
    }
  }

  async function claimView(claim: MerchantClaim) {
    const verified = claim.status === "verified"
    const [profile, requests, failures] = verified
      ? await Promise.all([
          deps.store.merchantProfiles([claim.domain]),
          deps.store.seedingRequests({ domain: claim.domain }),
          deps.store.listPaymentFailures([claim.domain]),
        ])
      : [
          new Map<string, MerchantProfile>(),
          [] as SeedingRequest[],
          [] as Awaited<ReturnType<ApiReviewStore["listPaymentFailures"]>>,
        ]
    return {
      domain: claim.domain,
      status: claim.status,
      method: claim.method,
      created_at: iso(claim.createdAt),
      checked_at: iso(claim.checkedAt),
      verified_at: iso(claim.verifiedAt),
      last_error: claim.lastError,
      ...(!verified && {
        verification: verificationSteps(claim.domain, claim.code),
      }),
      ...(verified && {
        profile: profileView(profile.get(claim.domain)),
        seeding_requests: requests.map(seedingView),
        // Payments agents say failed without a charge. Unverified, so they
        // never move a rating, but they point at a real bottleneck.
        payment_failures: failures.map((failure) => ({
          endpoint: failure.path || "/",
          error: failure.error,
          created_at: failure.createdAt.toISOString(),
        })),
      }),
    }
  }

  app.post("/start", bodyLimit({ maxSize: 2048 }), async (c) => {
    const body = z
      .object({ email: Email })
      .safeParse(await c.req.json().catch(() => null))
    if (!body.success) return c.json({ error: "Enter a valid email" }, 400)
    if (!deps.sendCode)
      return c.json({ error: "Sign-in email isn't set up" }, 503)
    if (limited(c, "start", 5)) {
      return c.json({ error: "Too many tries. Wait a minute." }, 429)
    }
    const { email } = body.data
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
      await deps.sendCode(email, code, "merchant")
    } catch (error) {
      console.error(`merchant code email failed: ${(error as Error).message}`)
      await deps.store.deleteCode(codeKey(email))
      return c.json({ error: "Could not send the email. Try again." }, 502)
    }
    return c.json({ sent: true, expires_in_seconds: CODE_TTL_MS / 1000 })
  })

  app.post("/verify", bodyLimit({ maxSize: 2048 }), async (c) => {
    const body = z
      .object({ email: Email, code: z.string().regex(/^\d{6}$/) })
      .safeParse(await c.req.json().catch(() => null))
    if (!body.success) return c.json({ error: "Enter the 6-digit code" }, 400)
    if (limited(c, "verify", 10)) {
      return c.json({ error: "Too many tries. Wait a minute." }, 429)
    }
    const { email, code } = body.data
    const saved = await deps.store.getCode(codeKey(email))
    if (!saved || saved.expiresAt < now()) {
      return c.json({ error: "That code has expired. Ask for a new one." }, 401)
    }
    if (saved.attempts >= MAX_ATTEMPTS) {
      return c.json({ error: "Too many tries. Ask for a new code." }, 429)
    }
    if (
      !timingSafeEqual(
        Buffer.from(saved.codeHash),
        Buffer.from(codeHash(email, code))
      )
    ) {
      await deps.store.bumpCodeAttempts(codeKey(email))
      return c.json({ error: "That code is not right." }, 401)
    }
    await deps.store.deleteCode(codeKey(email))
    return c.json(await startSession(email, "email"))
  })

  async function startSession(email: string, method: "email" | "google") {
    await record(email, "signed_in", null, method)
    const token = `mrs_${randomBytes(32).toString("base64url")}`
    const expiresAt = new Date(now().getTime() + SESSION_MS)
    await deps.store.saveMerchantSession({
      tokenHash: hashKey(token),
      email,
      expiresAt,
    })
    return { token, email, expires_at: expiresAt.toISOString() }
  }

  // What the sign-in page can offer.
  app.get("/config", (c) =>
    c.json({ google_client_id: deps.google?.clientId ?? null })
  )

  // Finishes "Continue with Google": the site sends the code Google gave it,
  // and this swaps it for the account's verified email. The ID token comes
  // straight from Google's token endpoint over TLS, so its claims are read
  // as is and checked against this client.
  app.post("/google", bodyLimit({ maxSize: 4096 }), async (c) => {
    const google = deps.google
    if (!google) return c.json({ error: "Google sign-in isn't set up" }, 503)
    const body = z
      .object({
        code: z.string().min(1).max(2048),
        redirect_uri: z.url().max(300),
        code_verifier: z.string().min(43).max(128),
      })
      .safeParse(await c.req.json().catch(() => null))
    if (!body.success)
      return c.json({ error: "Google sign-in failed. Try again." }, 400)
    if (limited(c, "google", 10)) {
      return c.json({ error: "Too many tries. Wait a minute." }, 429)
    }
    const res = await (deps.fetch ?? fetch)(
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code: body.data.code,
          client_id: google.clientId,
          client_secret: google.clientSecret,
          redirect_uri: body.data.redirect_uri,
          code_verifier: body.data.code_verifier,
          grant_type: "authorization_code",
        }),
        signal: AbortSignal.timeout(10_000),
      }
    ).catch(() => null)
    const tokens = res?.ok
      ? ((await res.json().catch(() => null)) as { id_token?: string } | null)
      : null
    let claims: Record<string, unknown> | null = null
    try {
      const payload = tokens?.id_token?.split(".")[1]
      claims = payload
        ? JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))
        : null
    } catch {}
    const email =
      typeof claims?.email === "string" ? claims.email.toLowerCase() : null
    const valid =
      claims &&
      email &&
      claims.aud === google.clientId &&
      (claims.iss === "https://accounts.google.com" ||
        claims.iss === "accounts.google.com") &&
      typeof claims.exp === "number" &&
      claims.exp * 1000 > now().getTime() &&
      claims.email_verified === true
    if (!valid)
      return c.json({ error: "Google sign-in failed. Try again." }, 401)
    return c.json(await startSession(email, "google"))
  })

  app.post("/logout", async (c) => {
    const token = /^Bearer (mrs_[\w-]{20,})$/.exec(
      c.req.header("authorization") ?? ""
    )?.[1]
    if (token) await deps.store.deleteMerchantSession(hashKey(token))
    return c.json({ signed_out: true })
  })

  app.get("/me", async (c) => {
    const email = await sessionEmail(c)
    if (!email) return c.json({ error: "Sign in again" }, 401)
    const [claims, keys] = await Promise.all([
      deps.store.claimsFor({ email }),
      deps.store.providerKeys(email),
    ])
    c.header("Cache-Control", "no-store")
    return c.json({
      email,
      claims: await Promise.all(claims.map(claimView)),
      provider_keys: keys.map(providerKeyView),
      limits: {
        seed_max_price_usd: SEED_MAX_PRICE_USD,
        seed_max_endpoints: SEED_MAX_ENDPOINTS,
      },
    })
  })

  // Keys for the providers MCP. A key reads feedback on the merchant's
  // verified domains and nothing else; it is shown once, then only its prefix.
  app.post("/keys", async (c) => {
    const email = await sessionEmail(c)
    if (!email) return c.json({ error: "Sign in again" }, 401)
    if (limited(c, "keys", 10, email)) {
      return c.json({ error: "Too many tries. Wait a minute." }, 429)
    }
    const existing = (await deps.store.providerKeys(email)).filter(
      (key) => !key.name
    )
    if (existing.length >= MAX_PROVIDER_KEYS) {
      return c.json(
        { error: `You can have ${MAX_PROVIDER_KEYS} keys. Revoke one first.` },
        409
      )
    }
    const key = `mpk_${randomBytes(32).toString("base64url")}`
    const row = {
      id: randomUUID(),
      email,
      keyHash: hashKey(key),
      prefix: key.slice(0, 12),
      name: null,
    }
    await deps.store.insertProviderKey(row)
    await record(email, "key_created", null, row.prefix)
    const [saved] = (await deps.store.providerKeys(email)).filter(
      (k) => k.id === row.id
    )
    return c.json({ key, ...providerKeyView(saved) }, 201)
  })

  app.delete("/keys/:id", async (c) => {
    const email = await sessionEmail(c)
    if (!email) return c.json({ error: "Sign in again" }, 401)
    const revoked = await deps.store.revokeProviderKey(c.req.param("id"), email)
    if (!revoked) return c.json({ error: "No such key" }, 404)
    await record(email, "key_revoked")
    return c.json({ revoked: true })
  })

  // Signing in to the providers MCP from an app: the approval page shows the
  // app's name, then the signed-in merchant approves it.
  app.get("/oauth/client", async (c) => {
    const client = await clientFor(
      deps.store,
      c.req.query("client_id") ?? "",
      c.req.query("redirect_uri") ?? ""
    )
    if (!client) return c.json({ error: "Unknown app or redirect" }, 404)
    return c.json(client)
  })

  app.post("/oauth/approve", bodyLimit({ maxSize: 8192 }), async (c) => {
    const email = await sessionEmail(c)
    if (!email) return c.json({ error: "Sign in again" }, 401)
    if (limited(c, "oauth", 20, email)) {
      return c.json({ error: "Too many tries. Wait a minute." }, 429)
    }
    const body = ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>
    const text = (value: unknown) => (typeof value === "string" ? value : "")
    try {
      const redirect = await approveGrant(
        deps.store,
        deps.baseUrl ?? "",
        {
          email,
          clientId: text(body.client_id),
          redirectUri: text(body.redirect_uri),
          codeChallenge: text(body.code_challenge),
          codeChallengeMethod: text(body.code_challenge_method) || "S256",
          state: text(body.state) || null,
          resource: text(body.resource) || null,
        },
        now()
      )
      const client = await deps.store.oauthClient(text(body.client_id))
      await record(email, "app_connected", null, client?.name ?? null)
      return c.json({ redirect })
    } catch (error) {
      if (error instanceof OauthError) {
        // Kept so a sign-in that fails for an app can be traced in admin.
        const client = await deps.store.oauthClient(text(body.client_id)).catch(() => null)
        const detail = `${client?.name ?? "unknown app"}: ${error.code}${
          error.code === "invalid_target" ? ` (${text(body.resource).slice(0, 200)})` : ""
        }`
        console.warn(`oauth approve refused for ${detail}`)
        await record(email, "app_refused", null, detail)
        return c.json({ error: error.message, code: error.code }, error.status)
      }
      throw error
    }
  })

  app.post("/claims", bodyLimit({ maxSize: 2048 }), async (c) => {
    const email = await sessionEmail(c)
    if (!email) return c.json({ error: "Sign in again" }, 401)
    const body = z
      .object({ domain: z.string().max(300) })
      .safeParse(await c.req.json().catch(() => null))
    const domain = body.success ? claimDomain(body.data.domain) : null
    if (!domain) {
      return c.json(
        { error: "Enter your API's domain, like api.example.com" },
        400
      )
    }
    const { mine, takenByOther } = await claimOf(email, domain)
    if (takenByOther) {
      return c.json(
        { error: `${domain} has already been claimed by its owner.` },
        409
      )
    }
    if (mine) return c.json(await claimView(mine))
    if (
      (await deps.store.claimsFor({ email })).length >= MAX_CLAIMS_PER_EMAIL
    ) {
      return c.json(
        { error: "That's the most domains one email can claim." },
        429
      )
    }
    const claim: MerchantClaim = {
      id: `mc_${randomUUID()}`,
      domain,
      email,
      code: randomBytes(12).toString("hex"),
      status: "pending",
      method: null,
      lastError: null,
      createdAt: now(),
      checkedAt: null,
      verifiedAt: null,
    }
    await deps.store.saveClaim(claim)
    await record(email, "claimed", claim.domain)
    return c.json(await claimView(claim), 201)
  })

  app.post("/claims/:domain/check", async (c) => {
    const email = await sessionEmail(c)
    if (!email) return c.json({ error: "Sign in again" }, 401)
    const domain = claimDomain(c.req.param("domain"))
    if (!domain) return c.json({ error: "Unknown domain" }, 400)
    const { mine, takenByOther } = await claimOf(email, domain)
    if (!mine) return c.json({ error: "Claim this domain first" }, 404)
    if (mine.status === "verified") return c.json(await claimView(mine))
    if (takenByOther) {
      return c.json(
        { error: `${domain} has already been claimed by its owner.` },
        409
      )
    }
    if (limited(c, "check", 6, email)) {
      return c.json({ error: "Checked a lot just now. Wait a minute." }, 429)
    }
    const result = await checkOwnership(domain, mine.code, {
      resolveTxt: deps.resolveTxt ?? dnsResolveTxt,
      fetcher: deps.fetch ?? fetch,
      assertPublic: deps.assertPublic ?? assertPublicHttps,
    })
    const updated: MerchantClaim = {
      ...mine,
      checkedAt: now(),
      ...("method" in result
        ? {
            status: "verified",
            method: result.method,
            verifiedAt: now(),
            lastError: null,
          }
        : { lastError: result.error }),
    }
    try {
      await deps.store.saveClaim(updated)
    } catch {
      return c.json(
        { error: `${domain} has already been claimed by its owner.` },
        409
      )
    }
    if (updated.status === "verified" && mine.status !== "verified") {
      await record(email, "verified", domain, updated.method)
    }
    return c.json(await claimView(updated))
  })

  const Link = z
    .union([z.url({ protocol: /^https$/ }).max(300), z.literal("")])
    .optional()
  const Profile = z.object({
    name: z.string().trim().max(60).optional(),
    description: z.string().trim().max(280).optional(),
    docs_url: Link,
    spec_url: Link,
    pricing_url: Link,
    contact_email: z.union([z.email().max(254), z.literal("")]).optional(),
  })

  async function verifiedClaim(c: Context) {
    const email = await sessionEmail(c)
    if (!email) return { error: c.json({ error: "Sign in again" }, 401) }
    const domain = claimDomain(c.req.param("domain") ?? "")
    const { mine } = domain ? await claimOf(email, domain) : { mine: null }
    if (!domain || mine?.status !== "verified") {
      return { error: c.json({ error: "Verify this domain first" }, 403) }
    }
    return { email, domain, claim: mine }
  }

  app.put(
    "/claims/:domain/profile",
    bodyLimit({ maxSize: 4096 }),
    async (c) => {
      const found = await verifiedClaim(c)
      if ("error" in found) return found.error
      const body = Profile.safeParse(await c.req.json().catch(() => null))
      if (!body.success) {
        return c.json(
          { error: "Check the fields: links must start with https://" },
          400
        )
      }
      const value = (text?: string) => (text ? text : null)
      const profile: MerchantProfile = {
        domain: found.domain,
        name: value(body.data.name),
        description: value(body.data.description),
        docsUrl: value(body.data.docs_url),
        specUrl: value(body.data.spec_url),
        pricingUrl: value(body.data.pricing_url),
        contactEmail: value(body.data.contact_email),
        updatedBy: found.email,
        updatedAt: now(),
      }
      await deps.store.saveMerchantProfile(profile)
      await record(found.email, "profile_saved", found.domain)
      return c.json(await claimView(found.claim))
    }
  )

  // An owner shows a review's payment was refunded: the chain must show the
  // full price going back to the wallet that paid. The review's words stay
  // as the agent wrote them; it stops counting as charged with no result.
  app.post("/claims/:domain/refunds", bodyLimit({ maxSize: 2048 }), async (c) => {
    const found = await verifiedClaim(c)
    if ("error" in found) return found.error
    const body = z
      .object({ review_id: z.string().trim().min(1).max(80), transaction: z.string().trim().max(80) })
      .safeParse(await c.req.json().catch(() => null))
    if (!body.success) {
      return c.json({ error: 'Send {"review_id": "rev_...", "transaction": "0x..."}' }, 400)
    }
    if (limited(c, "refund", 10, found.email)) {
      return c.json({ error: "Too many tries. Wait a minute." }, 429)
    }
    const attached = await attachRefund(
      { store: deps.store, findRefund: deps.findRefund ?? chainRefunds() },
      {
        reviewId: body.data.review_id,
        transaction: body.data.transaction,
        addedBy: "provider",
        domain: found.domain,
      }
    )
    if (!attached.ok) return c.json({ error: attached.error }, attached.status)
    const refund = refundView(attached.review, attached.review.amended?.refund as NonNullable<NonNullable<typeof attached.review.amended>["refund"]>)
    await record(
      found.email,
      "refund_attached",
      found.domain,
      `${attached.review.path || "/"}${refund.amount_usd !== null ? ` · $${refund.amount_usd}` : ""}`
    )
    return c.json({ review_id: attached.review.id, refund }, 201)
  })

  // The paid endpoints a verified API publishes, for picking what to seed.
  app.get("/claims/:domain/endpoints", async (c) => {
    const found = await verifiedClaim(c)
    if ("error" in found) return found.error
    if (limited(c, "endpoints", 10, found.email)) {
      return c.json({ error: "Too many tries. Wait a minute." }, 429)
    }
    const result = await discover(found.domain).catch(() => null)
    if (!result) {
      return c.json({ error: `Couldn't reach ${found.domain}. Try again.` }, 502)
    }
    return c.json({
      domain: found.domain,
      sources: result.sources,
      skipped_templated: result.skipped_templated,
      max_price_usd: SEED_MAX_PRICE_USD,
      max_endpoints: SEED_MAX_ENDPOINTS,
      endpoints: result.endpoints.map((endpoint) => ({
        ...endpoint,
        problem:
          endpoint.price_usd === null
            ? "No price found"
            : endpoint.price_usd > SEED_MAX_PRICE_USD
              ? `Over $${SEED_MAX_PRICE_USD.toFixed(2)}`
              : null,
      })),
    })
  })

  app.post(
    "/claims/:domain/seeding",
    bodyLimit({ maxSize: 8192 }),
    async (c) => {
      const found = await verifiedClaim(c)
      if ("error" in found) return found.error
      // One click is enough: endpoints are optional, since 402reviews picks
      // cheap ones itself when none are listed.
      const body = z
        .object({
          endpoints: z
            .array(z.string().trim().min(1).max(500))
            .max(SEED_MAX_ENDPOINTS)
            .default([]),
          notes: z.string().trim().max(1000).optional(),
        })
        .safeParse((await c.req.json().catch(() => null)) ?? {})
      if (!body.success) {
        return c.json(
          { error: `List up to ${SEED_MAX_ENDPOINTS} endpoint URLs to seed` },
          400
        )
      }
      // One request per API. While it's open, sending again changes which
      // endpoints it covers.
      const earlier = await deps.store.seedingRequests({ domain: found.domain })
      const open = earlier.find((request) => request.status === "open") ?? null
      if (earlier.length > 0 && !open) {
        return c.json(
          { error: "Seeding has already been done for this API." },
          409
        )
      }
      if (open && body.data.endpoints.length === 0) {
        return c.json({ error: "Pick at least one endpoint." }, 400)
      }
      if (limited(c, "seeding", 5, found.email)) {
        return c.json({ error: "Too many tries. Wait a minute." }, 429)
      }
      const urls = [...new Set(body.data.endpoints)]
      const checked = await Promise.all(
        urls.map(async (input) => {
          let url: string
          try {
            const located = locate(input)
            if (located.domain !== found.domain) {
              return {
                url: input,
                price_usd: null,
                problem: `Not on ${found.domain}`,
              }
            }
            url = located.url
          } catch {
            return { url: input, price_usd: null, problem: "Not a URL" }
          }
          const terms = await deps.readTerms(url).catch(() => null)
          if (!terms || terms.status !== 402 || terms.accepts.length === 0) {
            return {
              url,
              price_usd: null,
              problem: `Didn't answer with payment terms${terms?.status ? ` (HTTP ${terms.status})` : ""}`,
            }
          }
          const prices = terms.accepts.flatMap((accept) =>
            accept.amount && /^\d+$/.test(accept.amount)
              ? [priceUsd(accept.asset, BigInt(accept.amount))].filter(
                  (price): price is number => price !== null
                )
              : []
          )
          if (prices.length === 0) {
            return {
              url,
              price_usd: null,
              problem: "No dollar price in its payment terms",
            }
          }
          const price = Math.min(...prices)
          return price > SEED_MAX_PRICE_USD
            ? {
                url,
                price_usd: price,
                problem: `Costs $${price} a call. Seeding covers up to $${SEED_MAX_PRICE_USD}.`,
              }
            : { url, price_usd: price, problem: null }
        })
      )
      if (checked.some((endpoint) => endpoint.problem)) {
        return c.json(
          { error: "Some endpoints can't be seeded", endpoints: checked },
          400
        )
      }
      const endpoints = checked.map((endpoint) => ({
        url: endpoint.url,
        priceUsd: endpoint.price_usd as number,
      }))
      if (open) {
        const updated = await deps.store.updateSeedingRequest(open.id, {
          endpoints,
          notes: body.data.notes || open.notes,
        })
        if (!updated) {
          return c.json({ error: "This request was just handled. Refresh the page." }, 409)
        }
        await record(
          found.email,
          "seeding_updated",
          found.domain,
          `${endpoints.length} endpoint${endpoints.length === 1 ? "" : "s"}`
        )
        await deps
          .notify?.(
            `Seeding request updated: ${found.domain}`,
            [
              `${found.email} changed the endpoints to seed on ${found.domain}.`,
              "",
              ...endpoints.map((e) => `- ${e.url} ($${e.priceUsd} a call)`),
              "",
              `Total: $${endpoints.reduce((sum, e) => sum + e.priceUsd, 0).toFixed(3)}`,
              ...(updated.notes ? ["", `Notes: ${updated.notes}`] : []),
            ].join("\n")
          )
          .catch((error: Error) =>
            console.error(`seeding notice failed: ${error.message}`)
          )
        return c.json(seedingView(updated))
      }
      const request: SeedingRequest = {
        id: `sr_${randomUUID()}`,
        domain: found.domain,
        email: found.email,
        endpoints,
        notes: body.data.notes || null,
        status: "open",
        createdAt: now(),
        updatedAt: now(),
      }
      await deps.store.insertSeedingRequest(request)
      await record(
        found.email,
        "seeding_requested",
        found.domain,
        `${request.endpoints.length} endpoint${request.endpoints.length === 1 ? "" : "s"}`
      )
      const listed = request.endpoints.length
        ? request.endpoints.map((e) => `- ${e.url} ($${e.priceUsd} a call)`)
        : [
            `No endpoints listed. Pick a few that cost $${SEED_MAX_PRICE_USD} or less a call.`,
          ]
      await Promise.all([
        deps
          .notify?.(
            `Seeding request: ${found.domain}`,
            [
              `${found.email} asked 402reviews to seed ${found.domain}.`,
              "",
              ...listed,
              ...(request.notes ? ["", `Notes: ${request.notes}`] : []),
              "",
              "See it in the admin dashboard.",
            ].join("\n")
          )
          .catch((error: Error) =>
            console.error(`seeding notice failed: ${error.message}`)
          ),
        deps
          .sendEmail?.(
            found.email,
            `We got your seeding request for ${found.domain}`,
            [
              `Thanks for asking 402reviews to seed ${found.domain}.`,
              "",
              "We'll pay for a few real calls to your API, review what comes back honestly, and email you when the reviews are up. Seeded reviews are labelled as seeded, and claiming your API never changes a rating.",
              "",
              `Your API's page: https://402reviews.xyz/s/${found.domain}`,
            ].join("\n")
          )
          .catch((error: Error) =>
            console.error(`seeding confirmation failed: ${error.message}`)
          ),
      ])
      return c.json(seedingView(request), 201)
    }
  )

  return app
}
