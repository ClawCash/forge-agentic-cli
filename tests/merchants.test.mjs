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
  const mails = []
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
      sendEmail: async (to, subject, text) => mails.push({ to, subject, text }),
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
  return { app, store, inbox, notices, mails, txt, files }
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

test("the leaderboard marks APIs their owner has verified", async () => {
  const ctx = setup()
  const review = (domain, n) => ({
    id: `rev_${domain}_${n}`,
    domain,
    path: "/x",
    url: `https://${domain}/x`,
    task: "web-search",
    language: null,
    format: null,
    result: "full",
    listing: "accurate",
    satisfaction: "satisfied",
    satisfactionFrom: "agent",
    problems: [],
    checked: "against_source",
    payAgain: null,
    tries: null,
    note: null,
    noteStatus: "none",
    wallet: `0x${String(n).padStart(40, "0")}`,
    network: BASE,
    paymentReference: `ref_${domain}_${n}`,
    asset: USDC_BASE,
    amountAtomic: "10000",
    priceUsd: 0.01,
    paidAt: new Date(),
    proofMethod: "siwx",
    createdAt: new Date(),
  })
  for (const domain of ["api.example.com", "other.example.com"]) {
    for (const n of [1, 2, 3]) await ctx.store.insert(review(domain, n))
  }
  await claimAndVerify(ctx, await signIn(ctx))
  const board = await (await ctx.app.request("/v1/leaderboard")).json()
  const verified = Object.fromEntries(
    board.top.map((entry) => [entry.domain, entry.verified])
  )
  assert.deepEqual(verified, {
    "api.example.com": true,
    "other.example.com": false,
  })
})

test("seeding is one click, done once, and emails the merchant and the team", async () => {
  const ctx = setup()
  const token = await signIn(ctx)
  await claimAndVerify(ctx, token)
  const seed = () =>
    ctx.app.request(
      "/v1/merchant/claims/api.example.com/seeding",
      json({}, token)
    )

  const ok = await seed()
  assert.equal(ok.status, 201)
  const request = await ok.json()
  assert.deepEqual(request.endpoints, [])
  assert.equal(ctx.notices.length, 1)
  assert.match(ctx.notices[0].subject, /api.example.com/)
  assert.match(ctx.notices[0].text, /No endpoints listed/)
  assert.equal(ctx.mails.length, 1)
  assert.equal(ctx.mails[0].to, "owner@example.com")
  assert.match(ctx.mails[0].subject, /seeding request for api.example.com/)
  // While it's open, sending again only changes the endpoints, so it needs some.
  assert.equal((await seed()).status, 400)

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
  assert.equal((await seed()).status, 409)
})

test("listed endpoints must be cheap, paid and on the claimed domain", async () => {
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
  const tooMany = await seed(
    Array.from({ length: 11 }, (_, i) => `https://api.example.com/e${i}`)
  )
  assert.equal(tooMany.status, 400)
  assert.match((await tooMany.json()).error, /up to 10/)

  const ok = await seed(
    ["https://api.example.com/cheap", "https://api.example.com/also-cheap"],
    "Try the search workflow"
  )
  assert.equal(ok.status, 201)
  assert.deepEqual(
    (await ok.json()).endpoints.map((e) => e.price_usd),
    [0.01, 0.0025]
  )
  assert.match(ctx.notices[0].text, /also-cheap \(\$0.0025 a call\)/)
  assert.match(ctx.notices[0].text, /Try the search workflow/)
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

test("the admin dashboard sees who signed up as a merchant and what they did", async () => {
  const ctx = setup()
  const token = await signIn(ctx)
  await claimAndVerify(ctx, token)
  await ctx.app.request(
    "/v1/merchant/claims/api.example.com/profile",
    json({ name: "Example" }, token, "PUT")
  )
  await ctx.app.request("/v1/merchant/claims/api.example.com/seeding", json({}, token))
  await ctx.app.request("/v1/merchant/keys", json({}, token))
  // Someone who signs in and does nothing else still counts.
  await signIn(ctx, "lurker@example.com")

  const admin = await signIn(ctx, ADMIN, "admin")
  const stats = await (await ctx.app.request("/v1/admin/stats", auth(admin))).json()
  assert.equal(stats.admin_email, ADMIN)
  const m = stats.merchants
  assert.equal(m.totals.merchants, 2)
  assert.equal(m.totals.merchants_last_7_days, 2)
  assert.equal(m.totals.verified, 1)
  assert.equal(m.totals.keys, 1)
  assert.equal(m.totals.seeding_open, 1)
  assert.equal(m.daily.at(-1).signups, 2)
  assert.deepEqual(
    m.events.map((event) => event.kind).reverse(),
    ["signed_in", "claimed", "verified", "profile_saved", "seeding_requested", "key_created", "signed_in"]
  )
  assert.equal(m.events.find((event) => event.kind === "verified").detail, "dns")
  const owner = m.accounts.find((account) => account.email === "owner@example.com")
  assert.deepEqual(owner.apis, [{ domain: "api.example.com", status: "verified" }])
  assert.equal(owner.sign_in, "email")
  assert.equal(owner.keys, 1)
  assert.equal(owner.seeding_requests, 1)
  assert.equal(owner.actions, 6)
})

test("a verified API's paid endpoints are found from its spec, and an open request can change them", async () => {
  const ctx = setup()
  const token = await signIn(ctx)
  await claimAndVerify(ctx, token)
  ctx.files.set(
    "https://api.example.com/openapi.json",
    JSON.stringify({
      openapi: "3.1.0",
      paths: {
        "/cheap": {
          post: {
            summary: "Search the web",
            "x-payment-info": { price: { mode: "fixed", currency: "USDC", amount: "0.010000" }, protocols: [{ x402: {} }] },
          },
          get: { "x-payment-info": { price: { currency: "USDC", amount: "0.010000" } } },
        },
        "/pricey": { post: { "x-price-usd": 1.25 } },
        "/items/{id}": { get: { "x-price-usd": 0.01 } },
        "/health": { get: { summary: "Free" } },
      },
    })
  )
  ctx.files.set(
    "https://api.example.com/.well-known/x402",
    JSON.stringify({ version: 1, resources: ["https://api.example.com/also-cheap", "https://elsewhere.example/x"] })
  )

  const res = await ctx.app.request("/v1/merchant/claims/api.example.com/endpoints", auth(token))
  assert.equal(res.status, 200)
  const found = await res.json()
  assert.deepEqual(found.sources, ["openapi.json", ".well-known/x402"])
  assert.equal(found.skipped_templated, 1)
  assert.equal(found.max_endpoints, 10)
  assert.deepEqual(
    found.endpoints.map((e) => [e.path, e.price_usd, e.price_source, e.problem]),
    [
      ["/also-cheap", 0.0025, "live", null],
      ["/cheap", 0.01, "listed", null],
      ["/pricey", 1.25, "listed", "Over $0.05"],
    ]
  )
  const cheap = found.endpoints.find((e) => e.path === "/cheap")
  assert.deepEqual(cheap.methods, ["GET", "POST"])
  assert.deepEqual(cheap.protocols, ["x402"])
  assert.equal(cheap.summary, "Search the web")

  // Only the verified owner can look.
  const other = await signIn(ctx, "someone@example.com")
  assert.equal((await ctx.app.request("/v1/merchant/claims/api.example.com/endpoints", auth(other))).status, 403)

  const seed = (endpoints) =>
    ctx.app.request("/v1/merchant/claims/api.example.com/seeding", json({ endpoints }, token))
  const first = await seed(["https://api.example.com/cheap"])
  assert.equal(first.status, 201)
  const changed = await seed(["https://api.example.com/cheap", "https://api.example.com/also-cheap"])
  assert.equal(changed.status, 200)
  const updated = await changed.json()
  assert.equal(updated.id, (await first.json()).id)
  assert.equal(updated.endpoints.length, 2)
  assert.match(ctx.notices.at(-1).subject, /Seeding request updated: api.example.com/)
  assert.match(ctx.notices.at(-1).text, /Total: \$0.013/)
  const events = await ctx.store.merchantEvents(10)
  assert.equal(events.filter((e) => e.kind === "seeding_updated").length, 1)
})
