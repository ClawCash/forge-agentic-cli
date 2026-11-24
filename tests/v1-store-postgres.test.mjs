import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { test } from "node:test"
import postgres from "postgres"
import {
  PaymentAlreadyReviewedError,
  postgresApiReviewStore,
} from "../server/src/v1/store.ts"

// Runs against a real database only when one is provided, like
// store-postgres.test.mjs.
const url = process.env.REVIEWS_TEST_DATABASE_URL

test(
  "the Postgres store migrates and behaves like the memory store",
  { skip: !url },
  async () => {
    const database = `reviews_v1_test_${randomUUID().replaceAll("-", "")}`
    const admin = postgres(url, { max: 1, onnotice: () => {} })
    await admin.unsafe(`create database ${database}`)
    const scopedUrl = new URL(url)
    scopedUrl.pathname = `/${database}`
    let store
    try {
      store = await postgresApiReviewStore(scopedUrl.toString())
      const review = {
        id: "rev_1",
        advertisedFields: ["emails"],
        promised: "Work emails for any profile",
        delivered: "4 of 7 profiles matched",
        domain: "stableenrich.dev",
        path: "/api/x",
        url: "https://stableenrich.dev/api/x",
        task: "enrichment",
        language: null,
        format: null,
        result: "full",
        listing: "accurate",
        satisfaction: "satisfied",
        satisfactionFrom: "agent",
        problems: ["stale"],
        checked: null,
        payAgain: null,
        tries: 2,
        note: null,
        noteStatus: "none",
        wallet: "0xabc",
        network: "eip155:8453",
        paymentReference: "eip155:8453:0x1",
        asset: "0xusdc",
        amountAtomic: "10000",
        priceUsd: 0.01,
        paidAt: new Date(),
        proofMethod: "siwx",
        userId: null,
      }
      const row = await store.insert(review)
      assert.deepEqual(row.advertisedFields, ["emails"])
      assert.equal(row.promised, "Work emails for any profile")
      assert.equal(row.delivered, "4 of 7 profiles matched")
      assert.deepEqual(row.problems, ["stale"])
      await assert.rejects(
        store.insert({ ...review, id: "rev_2" }),
        PaymentAlreadyReviewedError
      )
      assert.equal((await store.listByDomains(["stableenrich.dev"])).length, 1)
      assert.equal((await store.listByTask("enrichment")).length, 1)
      assert.equal((await store.listRecent(10)).length, 1)
      const profile = {
        domain: "stableenrich.dev",
        name: "StableEnrich",
        description: "Data for agents.",
        iconType: "image/png",
        iconData: "aWNvbg==",
        siteUrl: "https://stableenrich.dev",
        fetchedAt: new Date(),
      }
      await store.saveProfile(profile)
      await store.saveProfile({ ...profile, name: "Renamed" })
      const profiles = await store.getProfiles(["stableenrich.dev", "none.dev"])
      assert.equal(profiles.size, 1)
      assert.equal(profiles.get("stableenrich.dev").name, "Renamed")
      const health = {
        url: "https://stableenrich.dev/api/x",
        domain: "stableenrich.dev",
        status: "live",
        checkedAt: new Date(),
      }
      await store.saveHealth(health)
      await store.saveHealth({ ...health, status: "down" })
      const savedHealth = await store.getHealth([
        health.url,
        "https://none.dev/x",
      ])
      assert.equal(savedHealth.size, 1)
      assert.equal(savedHealth.get(health.url).status, "down")
      assert.equal(
        (await store.listHealthByDomains(["stableenrich.dev"])).length,
        1
      )
      assert.deepEqual(await store.listHealthDomains(), ["stableenrich.dev"])

      const failure = await store.insertPaymentFailure({
        id: "pf_1",
        domain: "market.example",
        path: "/a/scrape",
        task: "web-scrape",
        userId: "user_1",
        error: "verification_failed",
      })
      assert.ok(failure.createdAt instanceof Date)
      assert.deepEqual(
        (await store.listPaymentFailures(["market.example"])).map((r) => r.id),
        ["pf_1"]
      )
      assert.deepEqual(await store.listPaymentFailures(["other.example"]), [])
      assert.equal((await store.listPaymentFailures()).length, 1)
      assert.deepEqual(
        [...(await store.usedReferences(["eip155:8453:0x1", "other"]))],
        ["eip155:8453:0x1"]
      )

      const later = new Date(Date.now() + 60_000)
      assert.equal(await store.useProof("siwx:a", later), true)
      assert.equal(await store.useProof("siwx:a", later), false)

      const email = "a@example.com"
      const code = {
        email,
        codeHash: "h",
        expiresAt: later,
        attempts: 0,
        sentAt: new Date(),
      }
      await store.saveCode(code)
      await store.bumpCodeAttempts(email)
      assert.equal((await store.getCode(email)).attempts, 1)
      await store.saveCode({ ...code, codeHash: "h2" })
      const saved = await store.getCode(email)
      assert.equal(saved.codeHash, "h2")
      assert.equal(saved.attempts, 0)
      await store.deleteCode(email)
      assert.equal(await store.getCode(email), null)

      const user = await store.upsertUser({ id: "u1", email })
      const again = await store.upsertUser({ id: "u2", email })
      assert.equal(again.id, user.id, "the same email keeps one account")
      assert.equal(user.autoReview, false)
      const on = await store.setAutoReview(user.id, true)
      assert.equal(on.autoReview, true)
      assert.ok(on.autoReviewAt)
      await store.insertKey("hash", user.id)
      assert.equal((await store.userForKey("hash")).email, email)
      assert.equal(await store.userForKey("nope"), null)

      await store.recordUsage({
        id: "e1",
        userId: user.id,
        kind: "check",
        task: null,
        domain: null,
        status: 200,
        client: "test",
      })
      assert.equal((await store.listUsage()).length, 1)
      await store.recordUsage({
        id: "e2",
        userId: null,
        kind: "check",
        task: null,
        domain: null,
        status: 200,
        client: "anon",
      })
      const today = new Date().toISOString().slice(0, 10)
      const byDay = await store.usageByDay(new Date(Date.now() - 86_400_000))
      assert.deepEqual(
        byDay
          .map(
            (row) =>
              `${row.day}|${row.userId ?? "-"}|${row.kind}|${row.requests}`
          )
          .sort(),
        [`${today}|-|check|1`, `${today}|${user.id}|check|1`].sort()
      )
      await store.recordUsage({
        id: "e3",
        userId: null,
        kind: "check",
        task: null,
        domain: null,
        status: 200,
        client: "402reviews-site",
      })
      const stats = await store.stats()
      assert.equal(stats.checks, 2)
      assert.ok(stats.reviews >= 1 && stats.apisReviewed >= 1 && stats.buyers >= 1)
      assert.ok(stats.paidUsd >= 0.01 && typeof stats.paidUsd === "number")
      assert.ok(stats.apisTracked >= stats.apisReviewed)
      const [byUser] = await store.usageByUser()
      assert.equal(byUser.userId, user.id)
      assert.equal(byUser.requests, 1)
      assert.ok(byUser.lastAt instanceof Date)
      assert.equal(
        (await store.usageClients(new Date(Date.now() - 86_400_000), 8)).length,
        3
      )
      assert.equal((await store.listUsers())[0].id, user.id)
      await store.saveAdminSession({
        tokenHash: "h1",
        email: "boss@example.com",
        expiresAt: new Date(Date.now() + 60_000),
      })
      assert.equal((await store.adminSession("h1")).email, "boss@example.com")
      await store.deleteAdminSession("h1")
      assert.equal(await store.adminSession("h1"), null)

      await store.saveMerchantSession({
        tokenHash: "m1",
        email: "owner@example.com",
        expiresAt: new Date(Date.now() + 60_000),
      })
      assert.equal(
        (await store.merchantSession("m1")).email,
        "owner@example.com"
      )
      await store.deleteMerchantSession("m1")
      assert.equal(await store.merchantSession("m1"), null)

      await store.insertProviderKey({
        id: "pk_1",
        email: "owner@example.com",
        keyHash: "kh1",
        prefix: "mpk_abcdefgh",
      })
      assert.equal((await store.providerKey("kh1")).email, "owner@example.com")
      assert.equal((await store.providerKeys("owner@example.com")).length, 1)
      await store.touchProviderKey("pk_1")
      assert.ok((await store.providerKey("kh1")).lastUsedAt)
      assert.equal(await store.revokeProviderKey("pk_1", "someone@else.com"), false)
      assert.equal(await store.revokeProviderKey("pk_1", "owner@example.com"), true)
      assert.equal(await store.revokeProviderKey("pk_1", "owner@example.com"), false)
      assert.equal(await store.providerKey("kh1"), null)
      assert.equal((await store.providerKeys("owner@example.com")).length, 0)
      const claim = {
        id: "mc_1",
        domain: "api.example.com",
        email: "owner@example.com",
        code: "abc",
        status: "pending",
        method: null,
        lastError: null,
        createdAt: new Date(),
        checkedAt: null,
        verifiedAt: null,
      }
      await store.saveClaim(claim)
      await store.saveClaim({
        ...claim,
        status: "verified",
        method: "dns",
        verifiedAt: new Date(),
      })
      const [savedClaim] = await store.claimsFor({ domain: "api.example.com" })
      assert.equal(savedClaim.status, "verified")
      assert.equal(
        (await store.claimsFor({ email: "owner@example.com" })).length,
        1
      )
      assert.equal((await store.claimsFor({})).length, 1)
      await assert.rejects(
        store.saveClaim({
          ...claim,
          id: "mc_2",
          email: "rival@example.com",
          status: "verified",
        })
      )
      await store.saveMerchantProfile({
        domain: "api.example.com",
        name: "Example",
        description: null,
        docsUrl: "https://docs.example.com",
        specUrl: null,
        pricingUrl: null,
        contactEmail: null,
        updatedBy: "owner@example.com",
        updatedAt: new Date(),
      })
      assert.equal(
        (await store.merchantProfiles(["api.example.com"])).get(
          "api.example.com"
        ).name,
        "Example"
      )
      await store.insertSeedingRequest({
        id: "sr_1",
        domain: "api.example.com",
        email: "owner@example.com",
        endpoints: [{ url: "https://api.example.com/x", priceUsd: 0.01 }],
        notes: null,
        status: "open",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      assert.equal(
        (await store.seedingRequests({ domain: "api.example.com" }))[0]
          .endpoints[0].priceUsd,
        0.01
      )
      assert.equal(
        (await store.setSeedingStatus("sr_1", "seeded")).status,
        "seeded"
      )
      assert.equal(await store.setSeedingStatus("nope", "seeded"), null)
      assert.equal((await store.listBySubdomains(["enrich.dev"])).length, 0)
      await store.insert({
        ...review,
        id: "rev_sub",
        domain: "api.stableenrich.dev",
        paymentReference: "eip155:8453:0xsub",
      })
      assert.equal(
        (await store.listBySubdomains(["stableenrich.dev"])).length,
        1
      )
    } finally {
      await store?.close()
      await admin.unsafe(`drop database if exists ${database} with (force)`)
      await admin.end()
    }
  }
)
