import assert from "node:assert/strict"
import { test } from "node:test"
import { createApp } from "../server/src/index.ts"
import { BASE, USDC_BASE } from "../server/src/v1/chains.ts"
import { claimDomain, verificationSteps } from "../server/src/v1/merchants.ts"
import { memoryApiReviewStore } from "../server/src/v1/store.ts"

const ADMIN = "boss@example.com"
const PRICES = {
  "https://api.example.com/cheap": "10000",
  "https://api.example.com/also-cheap": "2500",
  "https://api.example.com/pricey": "1250000",
}

const json = (body, token, method = "POST") => ({
  method,
  headers: {
    "Content-Type": "application/json",
    ...(token && { Authorization: `Bearer ${token}` }),
  },
  body: JSON.stringify(body),
})
const auth = (token) => ({ headers: { Authorization: `Bearer ${token}` } })

function setup() {
  const store = memoryApiReviewStore()
  const inbox = []
  const notices = []
  const txt = new Map()
  const files = new Map()
  const app = createApp(null, {
    v1: {
      store,
      baseUrl: "https://reviews.test",
      secret: "test-secret-test-secret-test-secret-00",
      readTerms: async (url) =>
        PRICES[url]
          ? {
              live: true,
              status: 402,
              protocols: ["x402"],
              accepts: [
                {
                  network: BASE,
                  asset: USDC_BASE,
                  payTo: "0x1",
                  amount: PRICES[url],
                },
              ],
            }
          : { live: true, status: 200, protocols: [], accepts: [] },
      findPayments: async () => [],
      sendCode: async (email, code, purpose = "signup") =>
        inbox.push({ email, code, purpose }),
      notify: async (subject, text) => notices.push({ subject, text }),
      adminEmails: [ADMIN],
      resolveTxt: async (name) => {
        if (!txt.has(name)) throw new Error("ENOTFOUND")
        return [[txt.get(name)]]
      },
      fetch: async (url) =>
        files.has(url)
          ? new Response(files.get(url))
          : new Response("missing", { status: 404 }),
    },
  })
  return { app, store, inbox, notices, txt, files }
}

async function signIn(
  { app, inbox },
  email = "owner@example.com",
  path = "merchant"
) {
  await app.request(`/v1/${path}/start`, json({ email }))
  const { code } = inbox.at(-1)
  return (
    await (
      await app.request(`/v1/${path}/verify`, json({ email, code }))
    ).json()
  ).token
}

async function claimAndVerify(ctx, token, domain = "api.example.com") {
  const claim = await (
    await ctx.app.request("/v1/merchant/claims", json({ domain }, token))
  ).json()
  ctx.txt.set(claim.verification.dns.name, claim.verification.dns.value)
  return (
    await ctx.app.request(
      `/v1/merchant/claims/${domain}/check`,
      json({}, token)
    )
  ).json()
}

test("a typed domain becomes a bare hostname, and junk is refused", () => {
  assert.equal(
    claimDomain("https://API.Example.com/v1/search?q=1"),
    "api.example.com"
  )
  assert.equal(claimDomain("www.example.com"), "example.com")
  assert.equal(claimDomain("localhost"), null)
  assert.equal(claimDomain("not a domain"), null)
  const steps = verificationSteps("api.example.com", "abc")
  assert.equal(steps.dns.name, "_api-reviews.api.example.com")
  assert.equal(steps.dns.value, "api-reviews-verification=abc")
  assert.equal(
    steps.file.url,
    "https://api.example.com/.well-known/api-reviews.txt"
  )
})

test("a merchant signs in with an emailed code worded for merchants", async () => {
  const ctx = setup()
  const token = await signIn(ctx)
  assert.match(token, /^mrs_/)
  assert.equal(ctx.inbox.at(-1).purpose, "merchant")
  const me = await (
    await ctx.app.request("/v1/merchant/me", auth(token))
  ).json()
  assert.deepEqual(me.claims, [])
  assert.equal(me.limits.seed_max_price_usd, 0.05)
  assert.equal((await ctx.app.request("/v1/merchant/me")).status, 401)
})

test("a claim is verified by a DNS TXT record, and then no one else can claim it", async () => {
  const ctx = setup()
  const token = await signIn(ctx)
  const claim = await (
    await ctx.app.request(
      "/v1/merchant/claims",
      json({ domain: "https://api.example.com/cheap" }, token)
    )
  ).json()
  assert.equal(claim.domain, "api.example.com")
  assert.equal(claim.status, "pending")

  const early = await (
    await ctx.app.request(
      "/v1/merchant/claims/api.example.com/check",
      json({}, token)
    )
  ).json()
  assert.equal(early.status, "pending")
  assert.match(early.last_error, /isn't showing yet/)

  ctx.txt.set(claim.verification.dns.name, claim.verification.dns.value)
  const verified = await (
    await ctx.app.request(
      "/v1/merchant/claims/api.example.com/check",
      json({}, token)
    )
  ).json()
  assert.equal(verified.status, "verified")
  assert.equal(verified.method, "dns")
  assert.equal(verified.verification, undefined)

  const rival = await signIn(ctx, "rival@example.com")
  const taken = await ctx.app.request(
    "/v1/merchant/claims",
    json({ domain: "api.example.com" }, rival)
  )
  assert.equal(taken.status, 409)
})

test("a claim can also be verified by a well-known file", async () => {
  const ctx = setup()
  const token = await signIn(ctx)
  const claim = await (
    await ctx.app.request(
      "/v1/merchant/claims",
      json({ domain: "files.example.com" }, token)
    )
  ).json()
  ctx.files.set(
    claim.verification.file.url,
    `${claim.verification.file.contents}\n`
  )
  const verified = await (
    await ctx.app.request(
      "/v1/merchant/claims/files.example.com/check",
      json({}, token)
    )
  ).json()
  assert.equal(verified.status, "verified")
  assert.equal(verified.method, "file")
})

test("only a verified owner edits the profile, and the API's page shows it", async () => {
  const ctx = setup()
  const token = await signIn(ctx)
  await ctx.app.request(
    "/v1/merchant/claims",
    json({ domain: "api.example.com" }, token)
  )
  const early = await ctx.app.request(
    "/v1/merchant/claims/api.example.com/profile",
    json({ name: "Example" }, token, "PUT")
  )
  assert.equal(early.status, 403)

  await claimAndVerify(ctx, token)
  const bad = await ctx.app.request(
    "/v1/merchant/claims/api.example.com/profile",
    json({ docs_url: "http://x.example" }, token, "PUT")
  )
  assert.equal(bad.status, 400)
  const saved = await (
    await ctx.app.request(
      "/v1/merchant/claims/api.example.com/profile",
      json(
        {
          name: "Example Data",
          description: "Market data for agents.",
          docs_url: "https://docs.example.com",
          contact_email: "",
        },
        token,
        "PUT"
      )
    )
  ).json()
  assert.equal(saved.profile.name, "Example Data")
  assert.equal(saved.profile.contact_email, null)

  const page = await (
    await ctx.app.request("/v1/services/api.example.com")
  ).json()
  assert.equal(page.owner.claimed, true)
  assert.equal(page.owner.name, "Example Data")
  assert.equal(page.owner.docs_url, "https://docs.example.com")
  assert.equal(page.owner.contact_email, undefined)
  const unclaimed = await (
    await ctx.app.request("/v1/services/other.example.com")
  ).json()
  assert.equal(unclaimed.owner, null)
})

test("seeding takes up to 3 cheap endpoints on the claimed domain, and tells the team", async () => {
  const ctx = setup()
  const token = await signIn(ctx)
  await claimAndVerify(ctx, token)
  const seed = (endpoints, notes) =>
    ctx.app.request(
      "/v1/merchant/claims/api.example.com/seeding",
      json({ endpoints, notes }, token)
    )

  const refused = await seed([
    "https://api.example.com/cheap",
    "https://api.example.com/pricey",
    "https://elsewhere.example/cheap",
  ])
  assert.equal(refused.status, 400)
  const { endpoints } = await refused.json()
  assert.equal(endpoints[0].problem, null)
  assert.match(endpoints[1].problem, /Costs \$1.25 a call/)
  assert.match(endpoints[2].problem, /Not on api.example.com/)
  assert.match(
    (await (await seed(["https://api.example.com/unpaid"])).json()).endpoints[0]
      .problem,
    /payment terms/
  )
  assert.equal((await seed(["a", "b", "c", "d"])).status, 400)

  const ok = await seed(
    ["https://api.example.com/cheap", "https://api.example.com/also-cheap"],
    "Try the search workflow"
  )
  assert.equal(ok.status, 201)
  const request = await ok.json()
  assert.deepEqual(
    request.endpoints.map((e) => e.price_usd),
    [0.01, 0.0025]
  )
  assert.equal(ctx.notices.length, 1)
  assert.match(ctx.notices[0].subject, /api.example.com/)
  assert.match(ctx.notices[0].text, /Try the search workflow/)

  assert.equal((await seed(["https://api.example.com/cheap"])).status, 409)

  const me = await (
    await ctx.app.request("/v1/merchant/me", auth(token))
  ).json()
  assert.equal(me.claims[0].seeding_requests[0].status, "open")

  const admin = await signIn(ctx, ADMIN, "admin")
  const stats = await (
    await ctx.app.request("/v1/admin/stats", auth(admin))
  ).json()
  assert.equal(stats.merchants.claims[0].domain, "api.example.com")
  assert.equal(stats.merchants.seeding_requests[0].id, request.id)
  const done = await ctx.app.request(
    `/v1/admin/seeding/${request.id}`,
    json({ status: "seeded" }, admin)
  )
  assert.equal((await done.json()).status, "seeded")
  assert.equal(
    (
      await ctx.app.request(
        `/v1/admin/seeding/${request.id}`,
        json({ status: "seeded" })
      )
    ).status,
    401
  )
})

test("signing out ends the merchant session", async () => {
  const ctx = setup()
  const token = await signIn(ctx)
  await ctx.app.request("/v1/merchant/logout", {
    method: "POST",
    ...auth(token),
  })
  assert.equal(
    (await ctx.app.request("/v1/merchant/me", auth(token))).status,
    401
  )
})

test("merchants can sign in with Google when it's set up", async () => {
  const idToken = (claims) =>
    `x.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`
  let claims = {}
  const exchanges = []
  const make = (google) =>
    createApp(null, {
      v1: {
        store: memoryApiReviewStore(),
        baseUrl: "https://reviews.test",
        secret: "test-secret-test-secret-test-secret-00",
        readTerms: async () => ({ live: false, status: 404, accepts: [] }),
        findPayments: async () => [],
        sendCode: async () => {},
        google,
        fetch: async (url, init) => {
          exchanges.push({ url, body: String(init?.body) })
          return Response.json({ id_token: idToken(claims) })
        },
      },
    })
  const off = make(null)
  assert.deepEqual(await (await off.request("/v1/merchant/config")).json(), {
    google_client_id: null,
  })
  const body = {
    code: "auth-code",
    redirect_uri: "https://402reviews.xyz/merchants/google/callback",
    code_verifier: "v".repeat(43),
  }
  assert.equal(
    (await off.request("/v1/merchant/google", json(body))).status,
    503
  )

  const app = make({ clientId: "client-1", clientSecret: "secret-1" })
  assert.equal(
    (await (await app.request("/v1/merchant/config")).json()).google_client_id,
    "client-1"
  )
  const good = {
    aud: "client-1",
    iss: "https://accounts.google.com",
    exp: Math.floor(Date.now() / 1000) + 600,
    email: "Owner@Example.com",
    email_verified: true,
  }
  for (const bad of [
    { ...good, aud: "someone-else" },
    { ...good, email_verified: false },
    { ...good, exp: 1 },
    { ...good, iss: "https://evil.example" },
  ]) {
    claims = bad
    assert.equal(
      (await app.request("/v1/merchant/google", json(body))).status,
      401
    )
  }
  claims = good
  const signedIn = await (
    await app.request("/v1/merchant/google", json(body))
  ).json()
  assert.match(signedIn.token, /^mrs_/)
  assert.equal(signedIn.email, "owner@example.com")
  const me = await (
    await app.request("/v1/merchant/me", auth(signedIn.token))
  ).json()
  assert.equal(me.email, "owner@example.com")
  const sent = new URLSearchParams(exchanges.at(-1).body)
  assert.equal(exchanges.at(-1).url, "https://oauth2.googleapis.com/token")
  assert.equal(sent.get("client_secret"), "secret-1")
  assert.equal(sent.get("code_verifier"), "v".repeat(43))
})
