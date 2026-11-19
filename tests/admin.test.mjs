import assert from "node:assert/strict"
import { test } from "node:test"
import { createApp } from "../server/src/index.ts"
import { buildAdminStats, parseAdminEmails } from "../server/src/v1/admin.ts"
import { memoryApiReviewStore } from "../server/src/v1/store.ts"

const ADMIN = "boss@example.com"

const json = (body, headers = {}) => ({
  method: "POST",
  headers: { "Content-Type": "application/json", ...headers },
  body: JSON.stringify(body),
})

function setup({ store = memoryApiReviewStore(), adminEmails = [ADMIN] } = {}) {
  const inbox = []
  const app = createApp(null, {
    v1: {
      store,
      baseUrl: "https://reviews.test",
      secret: "test-secret-test-secret-test-secret-00",
      readTerms: async () => ({ live: false, status: 404, accepts: [] }),
      findPayments: async () => [],
      sendCode: async (email, code, purpose = "signup") =>
        inbox.push({ email, code, purpose }),
      adminEmails,
    },
  })
  return { app, store, inbox }
}

async function signIn(app, inbox, email = ADMIN) {
  await app.request("/v1/admin/start", json({ email }))
  const { code } = inbox.at(-1)
  return (await app.request("/v1/admin/verify", json({ email, code }))).json()
}

const bearer = (token) => ({ headers: { Authorization: `Bearer ${token}` } })

test("admin emails are read from a comma-separated list", () => {
  assert.deepEqual(parseAdminEmails(" Boss@Example.com, ,b@x.io "), [
    "boss@example.com",
    "b@x.io",
  ])
  assert.deepEqual(parseAdminEmails(undefined), [])
})

test("only allowlisted emails get an admin code, and the answer doesn't say who is one", async () => {
  const { app, inbox } = setup()
  const other = await app.request(
    "/v1/admin/start",
    json({ email: "someone@example.org" })
  )
  const admin = await app.request("/v1/admin/start", json({ email: ADMIN }))
  assert.deepEqual(await other.json(), await admin.json())
  assert.equal(inbox.length, 1)
  assert.deepEqual(
    { email: inbox[0].email, purpose: inbox[0].purpose },
    { email: ADMIN, purpose: "admin" }
  )
  const wrong = await app.request(
    "/v1/admin/verify",
    json({ email: "someone@example.org", code: inbox[0].code })
  )
  assert.equal(wrong.status, 401)
})

test("admin sign-in is off until ADMIN_EMAILS is set", async () => {
  const { app } = setup({ adminEmails: [] })
  const res = await app.request("/v1/admin/start", json({ email: ADMIN }))
  assert.equal(res.status, 503)
})

test("a wrong code fails, the right one opens the stats, and sign-out closes them", async () => {
  const { app, inbox } = setup()
  await app.request("/v1/admin/start", json({ email: ADMIN }))
  const bad = await app.request(
    "/v1/admin/verify",
    json({
      email: ADMIN,
      code: inbox[0].code === "000000" ? "111111" : "000000",
    })
  )
  assert.equal(bad.status, 401)
  const good = await app.request(
    "/v1/admin/verify",
    json({ email: ADMIN, code: inbox[0].code })
  )
  const { token } = await good.json()
  assert.match(token, /^ads_/)

  assert.equal((await app.request("/v1/admin/stats")).status, 401)
  const stats = await app.request("/v1/admin/stats", bearer(token))
  assert.equal(stats.status, 200)
  assert.equal(stats.headers.get("cache-control"), "no-store")

  await app.request("/v1/admin/logout", { method: "POST", ...bearer(token) })
  assert.equal(
    (await app.request("/v1/admin/stats", bearer(token))).status,
    401
  )
})

test("removing an email from ADMIN_EMAILS ends its sessions", async () => {
  const store = memoryApiReviewStore()
  const first = setup({ store })
  const { token } = await signIn(first.app, first.inbox)
  const later = setup({ store, adminEmails: ["someone@else.com"] })
  assert.equal(
    (await later.app.request("/v1/admin/stats", bearer(token))).status,
    401
  )
})

test("stats show sign-ups, their requests and active users, and admin use isn't counted", async () => {
  const { app, inbox } = setup()
  await app.request("/v1/auth/start", json({ email: "agent@example.com" }))
  const signup = await app.request(
    "/v1/auth/verify",
    json({ email: "agent@example.com", code: inbox.at(-1).code })
  )
  const { api_key } = await signup.json()
  await app.request("/v1/ratings", {
    headers: { "X-Reviews-Key": api_key, "User-Agent": "test-agent" },
  })
  await app.request("/v1/ratings", { headers: { "User-Agent": "anon" } })

  const { token } = await signIn(app, inbox)
  const stats = await (
    await app.request("/v1/admin/stats", bearer(token))
  ).json()
  assert.deepEqual(stats.active, { dau: 1, wau: 1, mau: 1, tau: 1 })
  assert.equal(stats.totals.users, 1)
  assert.equal(stats.totals.requests_last_30_days, 2)
  assert.equal(stats.totals.anonymous_requests_last_30_days, 1)
  assert.equal(stats.people.length, 1)
  assert.equal(stats.people[0].email, "agent@example.com")
  assert.equal(stats.people[0].requests, 1)
  assert.equal(stats.activity[0].type, "signup")
  assert.equal(stats.daily.length, 30)
  assert.equal(stats.daily.at(-1).signups, 1)
  assert.deepEqual(stats.requests_by_kind, [
    { kind: "service", signed_in: 1, anonymous: 1 },
  ])
})

test("DAU, WAU, MAU and TAU count distinct people over 1, 7, 30 days and all time", () => {
  const now = new Date("2026-11-19T12:00:00Z")
  const daysAgo = (n) => new Date(now.getTime() - n * 86_400_000)
  const user = (id, created) => ({
    id,
    email: `${id}@x.io`,
    createdAt: created,
    lastSeenAt: created,
    autoReview: false,
    autoReviewAt: null,
  })
  const stats = buildAdminStats(
    {
      users: [
        user("a", daysAgo(60)),
        user("b", daysAgo(60)),
        user("c", daysAgo(60)),
        user("d", daysAgo(60)),
      ],
      reviews: [
        {
          id: "r1",
          domain: "api.example.com",
          path: "/v1/x",
          task: "scrape",
          result: "none",
          priceUsd: 0.03,
          wallet: "0x04D193A332F38980Ec9A5eC87789009ab55b5DDe",
          userId: "c",
          createdAt: daysAgo(20),
        },
      ],
      failures: [],
      byDay: [
        { day: "2026-11-19", userId: "a", kind: "brief", requests: 3 },
        { day: "2026-11-15", userId: "b", kind: "check", requests: 1 },
        { day: "2026-11-19", userId: null, kind: "brief", requests: 5 },
      ],
      byUser: [],
      clients: [],
    },
    now
  )
  assert.deepEqual(stats.active, { dau: 1, wau: 2, mau: 3, tau: 4 })
  assert.equal(stats.totals.reviews_seeded, 1)
  const review = stats.activity.find((event) => event.type === "review")
  assert.equal(review.title, "api.example.com/v1/x")
  assert.equal(review.detail, "scrape · returned nothing · $0.03")
  assert.equal(review.seeded, true)
  assert.equal(stats.people.find((p) => p.email === "c@x.io").seeded_reviews, 1)
})
